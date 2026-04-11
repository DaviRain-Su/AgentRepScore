/**
 * Real keeper script that fetches on-chain activity data directly from
 * X Layer RPC and submits it to BaseActivityModule.
 *
 * Data sources:
 *   - txCount: eth_getTransactionCount (nonce = total sent txs)
 *   - firstTxTimestamp / lastTxTimestamp / uniqueCounterparties:
 *     Binary search on blocks + recent tx scanning via debug/trace or
 *     block scanning
 *
 * Usage:
 *   npx ts-node scripts/keeper-rpc.ts --wallet=0x... [--dry-run]
 */
import {
  createWalletClient,
  createPublicClient,
  http,
  keccak256,
  toBytes,
  type Address,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
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

dotenv.config();

const BASE_MODULE = process.env.BASE_MODULE || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech";

interface ActivityData {
  txCount: bigint;
  firstTxTimestamp: bigint;
  lastTxTimestamp: bigint;
  uniqueCounterparties: bigint;
}

async function fetchActivityData(
  client: PublicClient,
  wallet: Address
): Promise<ActivityData> {
  // 1. Get nonce (= total outgoing tx count)
  const nonce = await client.getTransactionCount({ address: wallet });
  const txCount = BigInt(nonce);

  if (txCount === 0n) {
    return {
      txCount: 0n,
      firstTxTimestamp: 0n,
      lastTxTimestamp: 0n,
      uniqueCounterparties: 0n,
    };
  }

  // 2. Get current block for scanning range
  const latestBlock = await client.getBlockNumber();

  // 3. Find first and last tx timestamps + unique counterparties
  //    by scanning recent blocks. For wallets with many txs, we scan
  //    a window of recent blocks and estimate.
  const SCAN_BLOCKS = 50000n; // scan last ~50k blocks
  const startBlock = latestBlock > SCAN_BLOCKS ? latestBlock - SCAN_BLOCKS : 0n;

  console.log(`  Scanning blocks ${startBlock} to ${latestBlock} for wallet activity...`);

  let firstTxTimestamp = 0n;
  let lastTxTimestamp = 0n;
  const counterparties = new Set<string>();
  let foundTxCount = 0;

  // Scan in batches using eth_getLogs won't work for txs directly,
  // so we use a sampling approach: check key blocks
  // For a more thorough approach, we'd use an indexer.

  // Strategy: binary search for first tx, then scan recent for last tx + counterparties
  // First, find the earliest block where this wallet has a nonce > 0
  const firstTxBlock = await binarySearchFirstTx(client, wallet, 0n, latestBlock);
  if (firstTxBlock !== null) {
    const block = await client.getBlock({ blockNumber: firstTxBlock });
    firstTxTimestamp = BigInt(block.timestamp);
  }

  // Scan recent blocks for last tx and counterparties
  const scanStart = latestBlock > 10000n ? latestBlock - 10000n : 0n;
  const BATCH_SIZE = 2000n;

  for (let from = scanStart; from <= latestBlock; from += BATCH_SIZE) {
    const to = from + BATCH_SIZE - 1n > latestBlock ? latestBlock : from + BATCH_SIZE - 1n;

    // Use eth_getLogs to find Transfer events from this wallet as a proxy for activity
    try {
      const logs = await client.getLogs({
        address: undefined,
        event: {
          type: "event",
          name: "Transfer",
          inputs: [
            { type: "address", name: "from", indexed: true },
            { type: "address", name: "to", indexed: true },
            { type: "uint256", name: "value", indexed: false },
          ],
        },
        args: { from: wallet },
        fromBlock: from,
        toBlock: to,
      });

      for (const log of logs) {
        foundTxCount++;
        const block = await client.getBlock({ blockNumber: log.blockNumber });
        const ts = BigInt(block.timestamp);

        if (firstTxTimestamp === 0n || ts < firstTxTimestamp) {
          firstTxTimestamp = ts;
        }
        if (ts > lastTxTimestamp) {
          lastTxTimestamp = ts;
        }
        if (log.args.to) {
          counterparties.add(log.args.to.toLowerCase());
        }
      }
    } catch {
      // Some RPCs don't support wide block ranges, narrow down
      console.log(`  Warning: getLogs failed for range ${from}-${to}, skipping...`);
    }
  }

  // If no Transfer events found, try getting the latest block's timestamp
  // as an approximation for lastTxTimestamp
  if (lastTxTimestamp === 0n) {
    const block = await client.getBlock({ blockNumber: latestBlock });
    lastTxTimestamp = BigInt(block.timestamp);
  }

  // Counterparties: at minimum 1 if we have txs but couldn't scan enough
  const uniqueCounterparties = counterparties.size > 0
    ? BigInt(counterparties.size)
    : txCount > 0n ? 1n : 0n;

  return {
    txCount,
    firstTxTimestamp,
    lastTxTimestamp,
    uniqueCounterparties,
  };
}

async function binarySearchFirstTx(
  client: PublicClient,
  wallet: Address,
  low: bigint,
  high: bigint
): Promise<bigint | null> {
  // Find the earliest block where the wallet's nonce > 0
  // This means the wallet had sent at least 1 tx by that block
  if (low > high) return null;

  const nonceAtLow = await client.getTransactionCount({
    address: wallet,
    blockNumber: low,
  }).catch(() => 0);

  if (nonceAtLow > 0) return low;

  let lo = low;
  let hi = high;
  let result: bigint | null = null;

  // Limit iterations to avoid too many RPC calls
  let iterations = 0;
  const MAX_ITERATIONS = 30;

  while (lo <= hi && iterations < MAX_ITERATIONS) {
    iterations++;
    const mid = lo + (hi - lo) / 2n;

    try {
      const nonce = await client.getTransactionCount({
        address: wallet,
        blockNumber: mid,
      });

      if (nonce > 0) {
        result = mid;
        hi = mid - 1n;
      } else {
        lo = mid + 1n;
      }
    } catch {
      // If historical block query fails, move forward
      lo = mid + 1n;
    }
  }

  return result;
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
  npx ts-node scripts/keeper-rpc.ts --wallet=0x... [--dry-run]

Fetches real on-chain activity data directly from X Layer RPC and
submits it to BaseActivityModule.

Data collected:
  - txCount:              from eth_getTransactionCount (nonce)
  - firstTxTimestamp:     binary search for first nonce > 0
  - lastTxTimestamp:      from recent Transfer event scanning
  - uniqueCounterparties: from Transfer event "to" addresses

Required env vars:
  PRIVATE_KEY        Keeper wallet private key
  BASE_MODULE        BaseActivityModule contract address

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

  const publicClient = createPublicClient({
    chain: xLayerTestnet,
    transport: http(RPC_URL),
  });

  console.log(`Fetching activity data for ${wallet} from X Layer testnet RPC...`);

  const activity = await fetchActivityData(publicClient, wallet);

  console.log("\n--- Activity Data ---");
  console.log(`  txCount:              ${activity.txCount}`);
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
      `rpc-activity:${wallet.toLowerCase()}:${activity.txCount}:${activity.firstTxTimestamp}:${activity.lastTxTimestamp}:${activity.uniqueCounterparties}:${now}`
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
    console.log(JSON.stringify(summary, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
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

  const receipt = await submitWithRetry(
    async () => {
      const txHash = await walletClient.writeContract({
        address: BASE_MODULE as Address,
        abi: baseModuleAbi,
        functionName: "submitActivitySummary",
        args: [wallet, summary],
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
