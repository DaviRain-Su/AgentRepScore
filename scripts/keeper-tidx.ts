/**
 * Real keeper script that fetches on-chain activity data from tidx indexer
 * and submits it to BaseActivityModule.
 *
 * Usage:
 *   npx ts-node scripts/keeper-tidx.ts --wallet=0x... [--dry-run]
 *
 * Required env vars:
 *   PRIVATE_KEY          - Keeper wallet private key
 *   BASE_MODULE          - BaseActivityModule contract address
 *   TIDX_API_URL         - tidx HTTP API endpoint (e.g. https://tidx.example.com)
 *   TIDX_CHAIN_ID        - Chain ID configured in tidx for X Layer
 *   XLAYER_TESTNET_RPC   - X Layer testnet RPC (optional, defaults to https://testrpc.xlayer.tech)
 */
import { createWalletClient, createPublicClient, http, keccak256, toBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

const TIDX_API_URL = process.env.TIDX_API_URL || "";
const TIDX_CHAIN_ID = process.env.TIDX_CHAIN_ID || "196";
const BASE_MODULE = process.env.BASE_MODULE || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech";

interface TidxQueryResponse {
  ok: boolean;
  columns: string[];
  rows: (string | number | null)[][];
  row_count: number;
  engine: string;
}

interface ActivityData {
  txCount: bigint;
  firstTxTimestamp: bigint;
  lastTxTimestamp: bigint;
  uniqueCounterparties: bigint;
}

async function tidxQuery(sql: string): Promise<TidxQueryResponse> {
  const url = new URL("/query", TIDX_API_URL);
  url.searchParams.set("chainId", TIDX_CHAIN_ID);
  url.searchParams.set("sql", sql);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`tidx query failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as TidxQueryResponse;
  if (!data.ok) {
    throw new Error(`tidx query returned error: ${JSON.stringify(data)}`);
  }
  return data;
}

async function fetchActivityData(wallet: string): Promise<ActivityData> {
  const walletLower = wallet.toLowerCase();
  const walletBytes = `'\\x${walletLower.slice(2)}'`;

  // Query 1: tx count and timestamps for txs sent BY this wallet
  const txStatsQuery = `
    SELECT
      COUNT(*) AS tx_count,
      MIN(block_timestamp) AS first_tx,
      MAX(block_timestamp) AS last_tx
    FROM txs
    WHERE "from" = ${walletBytes}
  `;

  // Query 2: unique counterparties (distinct "to" addresses)
  const counterpartiesQuery = `
    SELECT COUNT(DISTINCT "to") AS unique_counterparties
    FROM txs
    WHERE "from" = ${walletBytes}
      AND "to" IS NOT NULL
  `;

  const [txStats, counterparties] = await Promise.all([
    tidxQuery(txStatsQuery),
    tidxQuery(counterpartiesQuery),
  ]);

  if (txStats.row_count === 0 || !txStats.rows[0]) {
    return {
      txCount: 0n,
      firstTxTimestamp: 0n,
      lastTxTimestamp: 0n,
      uniqueCounterparties: 0n,
    };
  }

  const txCount = BigInt(txStats.rows[0][0] ?? 0);

  // tidx returns timestamps as ISO strings or unix — parse accordingly
  const firstTx = parseTimestamp(txStats.rows[0][1]);
  const lastTx = parseTimestamp(txStats.rows[0][2]);

  const uniqueCount = counterparties.row_count > 0 && counterparties.rows[0]
    ? BigInt(counterparties.rows[0][0] ?? 0)
    : 0n;

  return {
    txCount,
    firstTxTimestamp: firstTx,
    lastTxTimestamp: lastTx,
    uniqueCounterparties: uniqueCount,
  };
}

function parseTimestamp(value: string | number | null | undefined): bigint {
  if (value == null) return 0n;
  if (typeof value === "number") return BigInt(Math.floor(value));
  // ISO 8601 string
  const ms = Date.parse(String(value));
  if (!isNaN(ms)) return BigInt(Math.floor(ms / 1000));
  // Try as raw unix timestamp
  const num = Number(value);
  if (!isNaN(num)) return BigInt(Math.floor(num));
  return 0n;
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
  npx ts-node scripts/keeper-tidx.ts --wallet=0x... [--dry-run]

Fetches real on-chain activity data from tidx indexer and submits
it to BaseActivityModule on X Layer.

Required env vars:
  PRIVATE_KEY        Keeper wallet private key
  BASE_MODULE        BaseActivityModule contract address
  TIDX_API_URL       tidx HTTP API endpoint
  TIDX_CHAIN_ID      Chain ID in tidx config (default: 196)

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

  if (!TIDX_API_URL) {
    console.error("Error: TIDX_API_URL not set");
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

  const wallet = walletArg.split("=")[1] as `0x${string}`;
  const dryRun = process.argv.includes("--dry-run");

  console.log(`Fetching activity data for ${wallet} from tidx (${TIDX_API_URL})...`);

  const activity = await fetchActivityData(wallet);

  console.log("\n--- Activity Data from tidx ---");
  console.log(`  txCount:              ${activity.txCount}`);
  console.log(`  firstTxTimestamp:     ${activity.firstTxTimestamp} (${activity.firstTxTimestamp > 0n ? new Date(Number(activity.firstTxTimestamp) * 1000).toISOString() : "N/A"})`);
  console.log(`  lastTxTimestamp:      ${activity.lastTxTimestamp} (${activity.lastTxTimestamp > 0n ? new Date(Number(activity.lastTxTimestamp) * 1000).toISOString() : "N/A"})`);
  console.log(`  uniqueCounterparties: ${activity.uniqueCounterparties}`);

  if (activity.txCount === 0n) {
    console.log("\nNo transactions found for this wallet. Nothing to submit.");
    process.exit(0);
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const evidenceHash = keccak256(
    toBytes(
      `tidx-activity:${wallet.toLowerCase()}:${activity.txCount}:${activity.firstTxTimestamp}:${activity.lastTxTimestamp}:${activity.uniqueCounterparties}:${now}`
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
    console.log("Summary that would be submitted:", summary);
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
    address: BASE_MODULE as `0x${string}`,
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
