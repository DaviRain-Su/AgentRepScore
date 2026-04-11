/**
 * Real keeper script that fetches full on-chain activity data from OKLink
 * Open API and submits it to BaseActivityModule.
 *
 * OKLink provides paginated, full-history transaction data for X Layer
 * with no block range limitations.
 *
 * Usage:
 *   npx tsx scripts/keeper-oklink.ts --wallet=0x... [--dry-run]
 *
 * Required env vars:
 *   PRIVATE_KEY          - Keeper wallet private key
 *   BASE_MODULE          - BaseActivityModule contract address
 *   OKLINK_API_KEY       - OKLink Open API key (get from https://www.oklink.com/account/my-api)
 *   XLAYER_TESTNET_RPC   - X Layer testnet RPC (optional)
 *
 * Optional env vars:
 *   OKLINK_CHAIN         - Chain short name (default: XLAYER_TESTNET)
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
import * as dotenv from "dotenv";

dotenv.config();

const OKLINK_API_KEY = process.env.OKLINK_API_KEY || process.env.OKX_API_KEY || "";
const OKLINK_CHAIN = process.env.OKLINK_CHAIN || "XLAYER_TESTNET";
const BASE_MODULE = process.env.BASE_MODULE || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon";
const OKLINK_BASE_URL = "https://www.oklink.com";

interface OkLinkTx {
  txId: string;
  from: string;
  to: string;
  transactionTime: string; // milliseconds as string
  amount: string;
  state: string;
  methodId: string;
  isFromContract: boolean;
  isToContract: boolean;
}

interface OkLinkTxListResponse {
  code: string;
  msg: string;
  data: Array<{
    page: string;
    limit: string;
    totalPage: string;
    chainFullName: string;
    chainShortName: string;
    transactionLists: OkLinkTx[];
  }>;
}

interface ActivityData {
  txCount: bigint;
  firstTxTimestamp: bigint;
  lastTxTimestamp: bigint;
  uniqueCounterparties: bigint;
  totalPages: number;
}

async function oklinkFetch(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(path, OKLINK_BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { "Ok-Access-Key": OKLINK_API_KEY },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OKLink API failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (data.code !== "0") {
    throw new Error(`OKLink API error: code=${data.code} msg=${data.msg}`);
  }
  return data;
}

async function fetchAllTransactions(wallet: string): Promise<OkLinkTx[]> {
  const allTxs: OkLinkTx[] = [];
  let page = 1;
  let totalPage = 1;
  const limit = "100"; // max per page

  console.log(`  Fetching transactions from OKLink (chain: ${OKLINK_CHAIN})...`);

  while (page <= totalPage) {
    const resp: OkLinkTxListResponse = await oklinkFetch(
      "/api/v5/explorer/address/transaction-list",
      {
        chainShortName: OKLINK_CHAIN,
        address: wallet,
        page: String(page),
        limit,
      }
    );

    if (!resp.data || resp.data.length === 0) break;

    const pageData = resp.data[0];
    totalPage = parseInt(pageData.totalPage, 10);
    allTxs.push(...pageData.transactionLists);

    console.log(`  Page ${page}/${totalPage}: ${pageData.transactionLists.length} txs (total so far: ${allTxs.length})`);
    page++;

    // Rate limiting: OKLink free tier has rate limits
    if (page <= totalPage) {
      await sleep(200);
    }
  }

  return allTxs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function analyzeTransactions(txs: OkLinkTx[], wallet: string): ActivityData {
  if (txs.length === 0) {
    return {
      txCount: 0n,
      firstTxTimestamp: 0n,
      lastTxTimestamp: 0n,
      uniqueCounterparties: 0n,
      totalPages: 0,
    };
  }

  const walletLower = wallet.toLowerCase();
  const counterparties = new Set<string>();
  let firstTs = Infinity;
  let lastTs = 0;
  let outgoingCount = 0;

  for (const tx of txs) {
    const ts = parseInt(tx.transactionTime, 10); // milliseconds
    const tsSec = Math.floor(ts / 1000);

    if (tsSec < firstTs) firstTs = tsSec;
    if (tsSec > lastTs) lastTs = tsSec;

    // Count outgoing txs and track counterparties
    if (tx.from.toLowerCase() === walletLower) {
      outgoingCount++;
      if (tx.to && tx.to.toLowerCase() !== walletLower) {
        counterparties.add(tx.to.toLowerCase());
      }
    }

    // Also count incoming counterparties for a fuller picture
    if (tx.to.toLowerCase() === walletLower) {
      if (tx.from && tx.from.toLowerCase() !== walletLower) {
        counterparties.add(tx.from.toLowerCase());
      }
    }
  }

  return {
    txCount: BigInt(outgoingCount > 0 ? outgoingCount : txs.length),
    firstTxTimestamp: firstTs === Infinity ? 0n : BigInt(firstTs),
    lastTxTimestamp: BigInt(lastTs),
    uniqueCounterparties: BigInt(counterparties.size),
    totalPages: 0,
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

Fetches full on-chain activity data from OKLink Open API (no block range
limitations) and submits it to BaseActivityModule on X Layer.

Data collected (paginated, full history):
  - txCount:              total outgoing transactions
  - firstTxTimestamp:     earliest transaction timestamp
  - lastTxTimestamp:      most recent transaction timestamp
  - uniqueCounterparties: distinct addresses interacted with

Required env vars:
  PRIVATE_KEY        Keeper wallet private key
  BASE_MODULE        BaseActivityModule contract address
  OKLINK_API_KEY     OKLink API key (https://www.oklink.com/account/my-api)

Optional env vars:
  OKLINK_CHAIN       Chain name (default: XLAYER_TESTNET, use XLAYER for mainnet)

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

  if (!OKLINK_API_KEY) {
    console.error("Error: OKLINK_API_KEY not set");
    console.error("Get your API key at https://www.oklink.com/account/my-api");
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

  console.log(`Fetching full activity data for ${wallet} from OKLink...`);

  const txs = await fetchAllTransactions(wallet);
  const activity = analyzeTransactions(txs, wallet);

  console.log(`\n--- Activity Data (${txs.length} total txs fetched) ---`);
  console.log(`  txCount (outgoing):   ${activity.txCount}`);
  console.log(
    `  firstTxTimestamp:     ${activity.firstTxTimestamp} (${activity.firstTxTimestamp > 0n ? new Date(Number(activity.firstTxTimestamp) * 1000).toISOString() : "N/A"})`
  );
  console.log(
    `  lastTxTimestamp:      ${activity.lastTxTimestamp} (${activity.lastTxTimestamp > 0n ? new Date(Number(activity.lastTxTimestamp) * 1000).toISOString() : "N/A"})`
  );
  console.log(`  uniqueCounterparties: ${activity.uniqueCounterparties}`);

  if (activity.txCount === 0n) {
    console.log("\nNo transactions found for this wallet. Nothing to submit.");
    process.exit(0);
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const evidenceHash = keccak256(
    toBytes(
      `oklink-activity:${wallet.toLowerCase()}:${activity.txCount}:${activity.firstTxTimestamp}:${activity.lastTxTimestamp}:${activity.uniqueCounterparties}:${now}`
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

  console.log("\nSubmitting to BaseActivityModule...");

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: xLayerTestnet,
    transport: http(RPC_URL),
  });

  const txHash = await walletClient.writeContract({
    address: BASE_MODULE as Address,
    abi: baseModuleAbi,
    functionName: "submitActivitySummary",
    args: [wallet, summary],
  });

  console.log(`Transaction submitted: ${txHash}`);

  const publicClient = createPublicClient({
    chain: xLayerTestnet,
    transport: http(RPC_URL),
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 60_000,
  });

  if (receipt.status === "success") {
    console.log(`Activity summary submitted successfully (block ${receipt.blockNumber})`);
  } else {
    console.error("Transaction reverted!");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
