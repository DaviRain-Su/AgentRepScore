/**
 * Real keeper script that fetches full on-chain activity data from OKX
 * OnchainOS Wallet API and submits it to BaseActivityModule.
 *
 * Uses paginated transaction history API with no block range limitations.
 *
 * Usage:
 *   npx tsx scripts/keeper-oklink.ts --wallet=0x... [--dry-run]
 *
 * Required env vars:
 *   PRIVATE_KEY          - Keeper wallet private key
 *   BASE_MODULE          - BaseActivityModule contract address
 *   OKX_API_KEY          - OKX OS API key
 *   OKX_API_SECRET       - OKX OS API secret (for HMAC signing)
 *   OKX_PASSPHRASE       - OKX OS API passphrase
 *   OKX_PROJECT_ID       - OKX OS project ID
 */
import {
  createWalletClient,
  createPublicClient,
  http,
  keccak256,
  toBytes,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import { createHmac } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import {
  loadKeeperState,
  isAlreadySubmitted,
  recordSubmission,
  saveKeeperState,
  submitWithRetry,
} from "../src/skill/keeper-utils.ts";
import {
  fetchNonce,
  signActivitySummary,
} from "../src/skill/eip712.ts";

dotenv.config();

const OKX_API_KEY = process.env.OKX_API_KEY || "";
const OKX_API_SECRET = process.env.OKX_API_SECRET || "";
const OKX_PASSPHRASE = process.env.OKX_PASSPHRASE || "";
const OKX_PROJECT_ID = process.env.OKX_PROJECT_ID || "";
const BASE_MODULE = process.env.BASE_MODULE || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon";

// X Layer chainIndex in OKX OnchainOS = 196
const XLAYER_CHAIN_INDEX = "196";
const OKX_BASE_URL = "https://web3.okx.com";

interface OkxTx {
  chainIndex: string;
  txHash: string;
  iType: string;
  methodId: string;
  nonce: string;
  txTime: string; // milliseconds as string
  from: Array<{ address: string; amount: string }>;
  to: Array<{ address: string; amount: string }>;
  tokenAddress: string;
  amount: string;
  symbol: string;
  txFee: string;
  txStatus: string;
}

interface OkxTxResponse {
  code: string;
  msg: string;
  data: Array<{
    cursor: string;
    transactionList: OkxTx[];
  }>;
}

interface ActivityData {
  txCount: bigint;
  firstTxTimestamp: bigint;
  lastTxTimestamp: bigint;
  uniqueCounterparties: bigint;
}

function signRequest(timestamp: string, method: string, path: string, body: string = ""): string {
  const prehash = timestamp + method.toUpperCase() + path + body;
  return createHmac("sha256", OKX_API_SECRET).update(prehash).digest("base64");
}

async function okxFetch(path: string): Promise<any> {
  const timestamp = new Date().toISOString();
  const sign = signRequest(timestamp, "GET", path);

  const url = OKX_BASE_URL + path;
  const res = await fetch(url, {
    headers: {
      "OK-ACCESS-KEY": OKX_API_KEY,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
      "OK-ACCESS-PROJECT": OKX_PROJECT_ID,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OKX API failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { code: string | number; msg: string };
  if (data.code !== "0" && data.code !== 0) {
    throw new Error(`OKX API error: code=${data.code} msg=${data.msg}`);
  }
  return data as OkxTxResponse;
}

async function fetchAllTransactions(wallet: string): Promise<OkxTx[]> {
  const allTxs: OkxTx[] = [];
  let cursor = "";
  let page = 0;

  console.log(`  Fetching transactions from OKX OnchainOS (chainIndex: ${XLAYER_CHAIN_INDEX})...`);

  while (true) {
    page++;
    let path = `/api/v5/wallet/post-transaction/transactions-by-address?address=${wallet}&chains=${XLAYER_CHAIN_INDEX}&limit=20`;
    if (cursor) {
      path += `&cursor=${cursor}`;
    }

    const resp: OkxTxResponse = await okxFetch(path);

    if (!resp.data || resp.data.length === 0) break;

    const pageData = resp.data[0];
    if (!pageData.transactionList || pageData.transactionList.length === 0) break;

    allTxs.push(...pageData.transactionList);
    console.log(`  Page ${page}: ${pageData.transactionList.length} txs (total: ${allTxs.length})`);

    cursor = pageData.cursor;
    if (!cursor) break;

    // Rate limiting
    await sleep(300);
  }

  return allTxs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function analyzeTransactions(txs: OkxTx[], wallet: string): ActivityData {
  if (txs.length === 0) {
    return {
      txCount: 0n,
      firstTxTimestamp: 0n,
      lastTxTimestamp: 0n,
      uniqueCounterparties: 0n,
    };
  }

  const walletLower = wallet.toLowerCase();
  const counterparties = new Set<string>();
  let firstTs = Infinity;
  let lastTs = 0;
  let outgoingCount = 0;

  for (const tx of txs) {
    if (tx.txStatus !== "success") continue;

    const ts = parseInt(tx.txTime, 10);
    const tsSec = Math.floor(ts / 1000);

    if (tsSec > 0 && tsSec < firstTs) firstTs = tsSec;
    if (tsSec > lastTs) lastTs = tsSec;

    // Count outgoing txs
    const isOutgoing = tx.from.some((f) => f.address.toLowerCase() === walletLower);
    if (isOutgoing) {
      outgoingCount++;
      for (const t of tx.to) {
        if (t.address && t.address.toLowerCase() !== walletLower) {
          counterparties.add(t.address.toLowerCase());
        }
      }
    }

    // Also count incoming counterparties
    const isIncoming = tx.to.some((t) => t.address.toLowerCase() === walletLower);
    if (isIncoming) {
      for (const f of tx.from) {
        if (f.address && f.address.toLowerCase() !== walletLower) {
          counterparties.add(f.address.toLowerCase());
        }
      }
    }
  }

  return {
    txCount: BigInt(outgoingCount > 0 ? outgoingCount : txs.length),
    firstTxTimestamp: firstTs === Infinity ? 0n : BigInt(firstTs),
    lastTxTimestamp: BigInt(lastTs),
    uniqueCounterparties: BigInt(counterparties.size),
  };
}

const baseModuleAbi = [
  {
    inputs: [
      { internalType: "address", name: "wallet", type: "address" },
      {
        components: [
          { internalType: "uint256", name: "txCount", type: "uint256" },
          { internalType: "uint256", name: "firstTxTimestamp", type: "uint256" },
          { internalType: "uint256", name: "lastTxTimestamp", type: "uint256" },
          { internalType: "uint256", name: "uniqueCounterparties", type: "uint256" },
          { internalType: "uint256", name: "timestamp", type: "uint256" },
          { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
        ],
        internalType: "struct BaseActivityModule.ActivitySummary",
        name: "summary",
        type: "tuple",
      },
      { internalType: "bytes", name: "signature", type: "bytes" },
    ],
    name: "submitActivitySummary",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

function printUsage() {
  console.log(`
Usage:
  npx tsx scripts/keeper-oklink.ts --wallet=0x... [--dry-run]

Fetches full on-chain activity data from OKX OnchainOS Wallet API
(paginated, full history) and submits it to BaseActivityModule.

Required env vars:
  PRIVATE_KEY        Keeper wallet private key
  BASE_MODULE        BaseActivityModule contract address
  OKX_API_KEY        OKX OS API key
  OKX_API_SECRET     OKX OS API secret
  OKX_PASSPHRASE     OKX OS passphrase
  OKX_PROJECT_ID     OKX OS project ID

Flags:
  --wallet=0x...     Target wallet to evaluate
  --dry-run          Fetch and display data without submitting on-chain
`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  if (!OKX_API_KEY || !OKX_API_SECRET || !OKX_PASSPHRASE) {
    console.error("Error: OKX API credentials not fully configured.");
    console.error("Required: OKX_API_KEY, OKX_API_SECRET, OKX_PASSPHRASE");
    console.error("Optional: OKX_PROJECT_ID");
    console.error("Get credentials at https://web3.okx.com/onchainos/docs/waas/okx-waas-requirement-standard");
    process.exit(1);
  }
  if (!PRIVATE_KEY) {
    console.error("Error: PRIVATE_KEY not set");
    process.exit(1);
  }
  if (!BASE_MODULE) {
    console.error("Error: BASE_MODULE not set");
    process.exit(1);
  }

  const walletArg = process.argv.find((a) => a.startsWith("--wallet="));
  if (!walletArg) {
    console.error("Error: Missing --wallet argument");
    printUsage();
    process.exit(1);
  }

  const wallet = walletArg.split("=")[1] as Address;
  const dryRun = process.argv.includes("--dry-run");

  console.log(`Fetching full activity data for ${wallet} from OKX OnchainOS...`);

  const txs = await fetchAllTransactions(wallet);
  const activity = analyzeTransactions(txs, wallet);

  console.log(`\n--- Activity Data (${txs.length} total txs fetched) ---`);
  console.log(`  txCount (outgoing):   ${activity.txCount}`);
  console.log(
    `  firstTxTimestamp:     ${activity.firstTxTimestamp} (${
      activity.firstTxTimestamp > 0n
        ? new Date(Number(activity.firstTxTimestamp) * 1000).toISOString()
        : "N/A"
    })`
  );
  console.log(
    `  lastTxTimestamp:      ${activity.lastTxTimestamp} (${
      activity.lastTxTimestamp > 0n
        ? new Date(Number(activity.lastTxTimestamp) * 1000).toISOString()
        : "N/A"
    })`
  );
  console.log(`  uniqueCounterparties: ${activity.uniqueCounterparties}`);

  if (activity.txCount === 0n) {
    console.log("\nNo transactions found for this wallet. Nothing to submit.");
    process.exit(0);
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const evidenceHash = keccak256(
    toBytes(
      `okx-activity:${wallet.toLowerCase()}:${activity.txCount}:${activity.firstTxTimestamp}:${activity.lastTxTimestamp}:${activity.uniqueCounterparties}:${now}`
    )
  );

  const summary = {
    txCount: activity.txCount,
    firstTxTimestamp: activity.firstTxTimestamp,
    lastTxTimestamp: activity.lastTxTimestamp,
    uniqueCounterparties: activity.uniqueCounterparties,
    timestamp: now,
    evidenceHash,
  };

  console.log(`  evidenceHash:         ${evidenceHash}`);
  console.log(`  timestamp:            ${now} (${new Date(Number(now) * 1000).toISOString()})`);

  if (dryRun) {
    console.log("\n[DRY RUN] Skipping on-chain submission.");
    console.log("Summary that would be submitted:");
    console.log(JSON.stringify(summary, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    process.exit(0);
  }

  const state = loadKeeperState();
  if (isAlreadySubmitted(state, "activity", wallet, evidenceHash)) {
    console.log("Activity summary already submitted for this wallet/evidence. Skipping.");
    process.exit(0);
  }

  console.log("\nSubmitting to BaseActivityModule...");

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: xLayerTestnet,
    transport: http(RPC_URL),
  });

  const publicClient = createPublicClient({
    chain: xLayerTestnet,
    transport: http(RPC_URL),
  });

  const nonce = await fetchNonce(publicClient, BASE_MODULE as Address, wallet);
  const signature = await signActivitySummary(walletClient, BASE_MODULE as Address, wallet, summary, nonce);

  const receipt = await submitWithRetry(
    async () => {
      const txHash = await walletClient.writeContract({
        address: BASE_MODULE as Address,
        abi: baseModuleAbi,
        functionName: "submitActivitySummary",
        args: [wallet, summary, signature],
      });
      console.log(`Transaction submitted: ${txHash}`);
      return publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 60_000,
      });
    },
    { label: "submitActivitySummary", maxRetries: 3 }
  );

  if (receipt.status === "success") {
    console.log(`Activity summary submitted successfully (block ${receipt.blockNumber})`);
    const newState = recordSubmission(state, "activity", wallet, evidenceHash, receipt.blockNumber);
    saveKeeperState(newState);
  } else {
    console.error("Transaction reverted!");
    process.exit(1);
  }
}

function isMainModule() {
  if (!import.meta.url.startsWith("file:")) return false;
  const modulePath = realpathSync(fileURLToPath(import.meta.url));
  const argvPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
  return modulePath === argvPath;
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
