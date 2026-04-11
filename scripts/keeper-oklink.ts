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
  updateKeeperHealth,
} from "../src/skill/keeper-utils.ts";
import {
  fetchNonce,
  signActivitySummary,
} from "../src/skill/eip712.ts";
import { logger } from "../src/skill/logger.ts";
import { detectFundingClusters, type TxRecord } from "../src/skill/sybil-detector.ts";
import { fetchTransactionsForSybilDetection } from "../src/skill/keepers/activity-oklink.ts";

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

  logger.info(`  Fetching transactions from OKX OnchainOS (chainIndex: ${XLAYER_CHAIN_INDEX})...`);

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
    logger.info(`  Page ${page}: ${pageData.transactionList.length} txs (total: ${allTxs.length})`);

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
          { internalType: "bool", name: "sybilClusterFlag", type: "bool" },
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
  logger.info(`
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
    logger.error("Error: OKX API credentials not fully configured.");
    logger.error("Required: OKX_API_KEY, OKX_API_SECRET, OKX_PASSPHRASE");
    logger.error("Optional: OKX_PROJECT_ID");
    logger.error("Get credentials at https://web3.okx.com/onchainos/docs/waas/okx-waas-requirement-standard");
    process.exit(1);
  }
  if (!PRIVATE_KEY) {
    logger.error("Error: PRIVATE_KEY not set");
    process.exit(1);
  }
  if (!BASE_MODULE) {
    logger.error("Error: BASE_MODULE not set");
    process.exit(1);
  }

  const walletArg = process.argv.find((a) => a.startsWith("--wallet="));
  if (!walletArg) {
    logger.error("Error: Missing --wallet argument");
    printUsage();
    process.exit(1);
  }

  const wallet = walletArg.split("=")[1] as Address;
  const dryRun = process.argv.includes("--dry-run");

  logger.info(`Fetching full activity data for ${wallet} from OKX OnchainOS...`);

  const txs = await fetchAllTransactions(wallet);
  const activity = analyzeTransactions(txs, wallet);

  logger.info(`--- Activity Data (${txs.length} total txs fetched) ---`);
  logger.info(`  txCount (outgoing):   ${activity.txCount}`);
  logger.info(
    `  firstTxTimestamp:     ${activity.firstTxTimestamp} (${
      activity.firstTxTimestamp > 0n
        ? new Date(Number(activity.firstTxTimestamp) * 1000).toISOString()
        : "N/A"
    })`
  );
  logger.info(
    `  lastTxTimestamp:      ${activity.lastTxTimestamp} (${
      activity.lastTxTimestamp > 0n
        ? new Date(Number(activity.lastTxTimestamp) * 1000).toISOString()
        : "N/A"
    })`
  );
  logger.info(`  uniqueCounterparties: ${activity.uniqueCounterparties}`);

  if (activity.txCount === 0n) {
    logger.info("No transactions found for this wallet. Nothing to submit.");
    process.exit(0);
  }

  const walletsEnv = process.env.WALLETS || "";
  const batchWallets = walletsEnv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("0x") && s.length === 42);
  let sybilClusterFlag = false;
  if (batchWallets.length >= 3) {
    const creds = {
      apiKey: OKX_API_KEY,
      apiSecret: OKX_API_SECRET,
      passphrase: OKX_PASSPHRASE,
      projectId: OKX_PROJECT_ID,
    };
    const allRecords: TxRecord[] = [];
    for (const w of batchWallets) {
      try {
        const recs = await fetchTransactionsForSybilDetection(w, creds);
        allRecords.push(...recs);
      } catch {
        // ignore per-wallet failures
      }
    }
    const flagged = detectFundingClusters(batchWallets, allRecords);
    sybilClusterFlag = flagged.has(wallet.toLowerCase());
  }

  const now = BigInt(Math.floor(Date.now() / 1000));

  const evidenceHash = keccak256(
    toBytes(
      `okx-activity:${wallet.toLowerCase()}:${activity.txCount}:${activity.firstTxTimestamp}:${activity.lastTxTimestamp}:${activity.uniqueCounterparties}:${now}:${sybilClusterFlag}`
    )
  );

  const summary = {
    txCount: activity.txCount,
    firstTxTimestamp: activity.firstTxTimestamp,
    lastTxTimestamp: activity.lastTxTimestamp,
    uniqueCounterparties: activity.uniqueCounterparties,
    timestamp: now,
    evidenceHash,
    sybilClusterFlag,
  };

  logger.info(`  evidenceHash:         ${evidenceHash}`);
  logger.info(`  timestamp:            ${now} (${new Date(Number(now) * 1000).toISOString()})`);

  if (dryRun) {
    logger.info("[DRY RUN] Skipping on-chain submission.");
    logger.info("Summary that would be submitted:", { summary: JSON.stringify(summary, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) });
    process.exit(0);
  }

  const state = loadKeeperState();
  if (isAlreadySubmitted(state, "activity", wallet, evidenceHash)) {
    logger.info("Activity summary already submitted for this wallet/evidence. Skipping.");
    process.exit(0);
  }

  logger.info("Submitting to BaseActivityModule...");

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
      logger.info(`Transaction submitted: ${txHash}`);
      return publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 60_000,
      });
    },
    { label: "submitActivitySummary", maxRetries: 3 }
  );

  if (receipt.status === "success") {
    logger.info(`Activity summary submitted successfully (block ${receipt.blockNumber})`);
    const newState = recordSubmission(state, "activity", wallet, evidenceHash, receipt.blockNumber);
    saveKeeperState(newState);
    updateKeeperHealth(true);
  } else {
    updateKeeperHealth(false);
    logger.error("Transaction reverted!");
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
    logger.error("Fatal error", { err });
    process.exit(1);
  });
}
