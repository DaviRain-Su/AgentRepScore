/**
 * Uniswap V3 Swap event indexer for X Layer testnet.
 *
 * Listens to Swap events from configured Uniswap V3 pools and
 * generates swap summaries compatible with submitSwapSummary.
 *
 * Usage:
 *   npx tsx scripts/indexer-uniswap.ts --wallet=0x... [--from-block=NUMBER] [--to-block=NUMBER] [--dry-run]
 */
import {
  createPublicClient,
  createWalletClient,
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

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech";
const UNISWAP_MODULE = process.env.UNISWAP_MODULE || "";
const POOLS_ENV = process.env.UNISWAP_POOLS || "";

const SWAP_EVENT_ABI = {
  type: "event",
  name: "Swap",
  inputs: [
    { type: "address", name: "sender", indexed: true },
    { type: "address", name: "recipient", indexed: true },
    { type: "int256", name: "amount0" },
    { type: "int256", name: "amount1" },
    { type: "uint160", name: "sqrtPriceX96" },
    { type: "uint128", name: "liquidity" },
    { type: "int24", name: "tick" },
  ],
} as const;

const SLOT0_ABI = [
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { internalType: "uint160", name: "sqrtPriceX96", type: "uint160" },
      { internalType: "int24", name: "tick", type: "int24" },
      { internalType: "uint16", name: "observationIndex", type: "uint16" },
      { internalType: "uint16", name: "observationCardinality", type: "uint16" },
      { internalType: "uint16", name: "observationCardinalityNext", type: "uint16" },
      { internalType: "uint8", name: "feeProtocol", type: "uint8" },
      { internalType: "bool", name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const submitSwapSummaryAbi = [
  {
    inputs: [
      { internalType: "address", name: "wallet", type: "address" },
      {
        components: [
          { internalType: "uint256", name: "swapCount", type: "uint256" },
          { internalType: "uint256", name: "volumeUSD", type: "uint256" },
          { internalType: "int256", name: "netPnL", type: "int256" },
          { internalType: "uint256", name: "avgSlippageBps", type: "uint256" },
          { internalType: "uint256", name: "feeToPnlRatioBps", type: "uint256" },
          { internalType: "bool", name: "washTradeFlag", type: "bool" },
          { internalType: "uint256", name: "timestamp", type: "uint256" },
          { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
        ],
        internalType: "struct UniswapScoreModule.SwapSummary",
        name: "summary",
        type: "tuple",
      },
    ],
    name: "submitSwapSummary",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export interface SwapEvent {
  sender: Address;
  recipient: Address;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
}

export interface SwapSummary {
  swapCount: bigint;
  volumeUSD: bigint;
  netPnL: bigint;
  avgSlippageBps: bigint;
  feeToPnlRatioBps: bigint;
  washTradeFlag: boolean;
  timestamp: bigint;
  evidenceHash: `0x${string}`;
}

export function parsePools(env: string): Address[] {
  if (!env) return [];
  return env
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("0x") && s.length === 42) as Address[];
}

function abs(a: bigint): bigint {
  return a < 0n ? -a : a;
}

/**
 * Compute implied price from sqrtPriceX96 as a simple ratio scaled by 1e18.
 */
function priceFromSqrtPriceX96(sqrtPriceX96: bigint): bigint {
  // price = (sqrtPriceX96 / 2^96)^2
  // We compute (sqrtPriceX96 * sqrtPriceX96) / 2^192
  const Q96 = 2n ** 96n;
  const Q192 = 2n ** 192n;
  const numerator = sqrtPriceX96 * sqrtPriceX96;
  return (numerator * 10n ** 18n) / Q192;
}

export async function fetchSwapEvents(
  client: PublicClient,
  pools: Address[],
  fromBlock: bigint,
  toBlock: bigint
): Promise<SwapEvent[]> {
  const events: SwapEvent[] = [];
  for (const pool of pools) {
    try {
      const logs = await client.getLogs({
        address: pool,
        event: SWAP_EVENT_ABI,
        fromBlock,
        toBlock,
      });
      for (const log of logs) {
        events.push({
          sender: log.args.sender as Address,
          recipient: log.args.recipient as Address,
          amount0: log.args.amount0 as bigint,
          amount1: log.args.amount1 as bigint,
          sqrtPriceX96: log.args.sqrtPriceX96 as bigint,
          liquidity: log.args.liquidity as bigint,
          tick: Number(log.args.tick),
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
        });
      }
    } catch (err) {
      console.warn(`  Warning: failed to fetch logs for pool ${pool}: ${err}`);
    }
  }
  // Sort by blockNumber ascending for wash-trade detection
  events.sort((a, b) => Number(a.blockNumber - b.blockNumber));
  return events;
}

export function detectWashTrade(events: SwapEvent[]): boolean {
  const sorted = [...events].sort((a, b) => Number(a.blockNumber - b.blockNumber));
  for (let i = 0; i < sorted.length; i++) {
    const first = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const second = sorted[j];
      if (second.blockNumber - first.blockNumber > 10n) break;
      // A→B→A: signs of amount0 and amount1 must flip between the two swaps
      const amount0Flips =
        (first.amount0 > 0n && second.amount0 < 0n) ||
        (first.amount0 < 0n && second.amount0 > 0n);
      const amount1Flips =
        (first.amount1 > 0n && second.amount1 < 0n) ||
        (first.amount1 < 0n && second.amount1 > 0n);
      if (amount0Flips && amount1Flips) {
        return true;
      }
    }
  }
  return false;
}

export function buildSwapSummary(
  wallet: Address,
  allEvents: SwapEvent[],
  referencePrices: Record<Address, bigint>
): SwapSummary {
  const walletLower = wallet.toLowerCase();
  const walletEvents = allEvents.filter(
    (e) => e.sender.toLowerCase() === walletLower || e.recipient.toLowerCase() === walletLower
  );

  const swapCount = BigInt(walletEvents.length);
  let volumeUSD = 0n;
  let netPnL = 0n;
  let totalSlippageBps = 0n;

  for (const evt of walletEvents) {
    // Volume: sum of absolute token amounts, scaled to "USD-like" units
    volumeUSD += abs(evt.amount0) + abs(evt.amount1);

    // Simple PnL proxy: difference between incoming and outgoing absolute values
    netPnL += abs(evt.amount1) - abs(evt.amount0);

    // Slippage: deviation of execution price from reference pool price
    const refPrice = referencePrices[evt.transactionHash] ?? 0n;
    if (refPrice > 0n) {
      const execPrice = priceFromSqrtPriceX96(evt.sqrtPriceX96);
      if (execPrice > 0n) {
        const diff = abs(execPrice - refPrice);
        const slippageBps = (diff * 10000n) / refPrice;
        totalSlippageBps += slippageBps;
      }
    }
  }

  const avgSlippageBps = swapCount > 0n ? totalSlippageBps / swapCount : 0n;
  const washTradeFlag = detectWashTrade(walletEvents);
  const now = BigInt(Math.floor(Date.now() / 1000));

  const evidenceHash = keccak256(
    toBytes(
      `uniswap-indexer:${walletLower}:${swapCount}:${volumeUSD}:${netPnL}:${avgSlippageBps}:${washTradeFlag}:${now}`
    )
  );

  return {
    swapCount,
    volumeUSD,
    netPnL,
    avgSlippageBps,
    feeToPnlRatioBps: 0n,
    washTradeFlag,
    timestamp: now,
    evidenceHash,
  };
}

export async function fetchReferencePrices(
  client: PublicClient,
  pools: Address[]
): Promise<Record<Address, bigint>> {
  const prices: Record<Address, bigint> = {};
  for (const pool of pools) {
    try {
      const slot0 = await client.readContract({
        address: pool,
        abi: SLOT0_ABI,
        functionName: "slot0",
      });
      prices[pool] = priceFromSqrtPriceX96(slot0[0]);
    } catch {
      prices[pool] = 0n;
    }
  }
  return prices;
}

export async function indexWalletSwaps(
  client: PublicClient,
  wallet: Address,
  pools: Address[],
  fromBlock: bigint,
  toBlock: bigint
): Promise<SwapSummary> {
  const events = await fetchSwapEvents(client, pools, fromBlock, toBlock);
  const refPrices = await fetchReferencePrices(client, pools);
  // Map tx hash to a reference price from the pool it occurred on.
  // For simplicity, look up by pool address. In fetchSwapEvents we don't
  // store pool per event, so we'll enhance the event type or just pass
  // the first available reference price (simplification for testnet).
  const firstRefPrice = Object.values(refPrices).find((p) => p > 0n) ?? 0n;
  const txRefMap: Record<`0x${string}`, bigint> = {};
  for (const evt of events) {
    txRefMap[evt.transactionHash] = firstRefPrice;
  }
  return buildSwapSummary(wallet, events, txRefMap);
}

function printUsage() {
  console.log(`
Usage:
  npx tsx scripts/indexer-uniswap.ts --wallet=0x... [--from-block=NUMBER] [--to-block=NUMBER] [--dry-run]

Indexes Uniswap V3 Swap events from configured pools and builds a
SwapSummary compatible with UniswapScoreModule.submitSwapSummary.

Required env vars:
  PRIVATE_KEY        Keeper wallet private key (for on-chain submission)
  UNISWAP_MODULE     UniswapScoreModule contract address
  UNISWAP_POOLS      Comma-separated list of Uniswap V3 pool addresses

Flags:
  --wallet=0x...     Target wallet to index
  --from-block=N     Start block (default: latest - 10000)
  --to-block=N       End block (default: latest)
  --dry-run          Build summary without submitting on-chain
`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const walletArg = process.argv.find((a) => a.startsWith("--wallet="));
  if (!walletArg) {
    console.error("Error: Missing --wallet argument");
    printUsage();
    process.exit(1);
  }
  const wallet = walletArg.split("=")[1] as Address;
  const dryRun = process.argv.includes("--dry-run");

  const pools = parsePools(POOLS_ENV);
  if (pools.length === 0) {
    console.error("Error: No Uniswap pools configured. Set UNISWAP_POOLS env var.");
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain: xLayerTestnet,
    transport: http(RPC_URL),
  });

  const latestBlock = await publicClient.getBlockNumber();
  const fromBlockArg = process.argv.find((a) => a.startsWith("--from-block="));
  const toBlockArg = process.argv.find((a) => a.startsWith("--to-block="));

  const fromBlock = fromBlockArg ? BigInt(fromBlockArg.split("=")[1]) : latestBlock - 10000n;
  const toBlock = toBlockArg ? BigInt(toBlockArg.split("=")[1]) : latestBlock;

  console.log(`Indexing Uniswap V3 Swaps for ${wallet}`);
  console.log(`  Pools: ${pools.join(", ")}`);
  console.log(`  Blocks: ${fromBlock} -> ${toBlock}`);

  const summary = await indexWalletSwaps(publicClient, wallet, pools, fromBlock, toBlock);

  console.log("\n--- Swap Summary ---");
  console.log(`  swapCount:        ${summary.swapCount}`);
  console.log(`  volumeUSD:        ${summary.volumeUSD}`);
  console.log(`  netPnL:           ${summary.netPnL}`);
  console.log(`  avgSlippageBps:   ${summary.avgSlippageBps}`);
  console.log(`  washTradeFlag:    ${summary.washTradeFlag}`);
  console.log(`  evidenceHash:     ${summary.evidenceHash}`);
  console.log(`  timestamp:        ${summary.timestamp}`);

  if (dryRun || summary.swapCount === 0n) {
    if (summary.swapCount === 0n) {
      console.log("\nNo swap events found for this wallet. Nothing to submit.");
    } else {
      console.log("\n[DRY RUN] Skipping on-chain submission.");
    }
    console.log(
      "Summary:",
      JSON.stringify(summary, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)
    );
    process.exit(0);
  }

  if (!PRIVATE_KEY) {
    console.error("Error: PRIVATE_KEY not set");
    process.exit(1);
  }
  if (!UNISWAP_MODULE) {
    console.error("Error: UNISWAP_MODULE not set");
    process.exit(1);
  }

  const state = loadKeeperState();
  if (isAlreadySubmitted(state, "uniswap", wallet, summary.evidenceHash)) {
    console.log("Swap summary already submitted for this wallet/evidence. Skipping.");
    process.exit(0);
  }

  console.log("\nSubmitting to UniswapScoreModule...");

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: xLayerTestnet,
    transport: http(RPC_URL),
  });

  const receipt = await submitWithRetry(
    async () => {
      const txHash = await walletClient.writeContract({
        address: UNISWAP_MODULE as Address,
        abi: submitSwapSummaryAbi,
        functionName: "submitSwapSummary",
        args: [wallet, summary],
      });
      console.log(`Transaction submitted: ${txHash}`);
      return publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 60_000,
      });
    },
    { label: "submitSwapSummary", maxRetries: 3 }
  );

  if (receipt.status === "success") {
    console.log(`Swap summary submitted successfully (block ${receipt.blockNumber})`);
    const newState = recordSubmission(
      state,
      "uniswap",
      wallet,
      summary.evidenceHash,
      receipt.blockNumber
    );
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
