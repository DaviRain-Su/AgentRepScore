import {
  keccak256,
  toBytes,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { logger } from "../logger.ts";
import {
  loadKeeperState,
  isAlreadySubmitted,
  recordSubmission,
  saveKeeperState,
  submitWithRetry,
  updateKeeperHealth,
} from "../keeper-utils.ts";
import { fetchNonce, signSwapSummary } from "../eip712.ts";

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
          { internalType: "bool", name: "counterpartyConcentrationFlag", type: "bool" },
          { internalType: "uint256", name: "timestamp", type: "uint256" },
          { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
          { internalType: "address", name: "pool", type: "address" },
        ],
        internalType: "struct UniswapScoreModule.SwapSummary",
        name: "summary",
        type: "tuple",
      },
      { internalType: "bytes", name: "signature", type: "bytes" },
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
  counterpartyConcentrationFlag: boolean;
  timestamp: bigint;
  evidenceHash: `0x${string}`;
  pool: Address;
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

function priceFromSqrtPriceX96(sqrtPriceX96: bigint): bigint {
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
      logger.warn(`Warning: failed to fetch logs for pool ${pool}`, { err });
    }
  }
  events.sort((a, b) => Number(a.blockNumber - b.blockNumber));
  return events;
}

export function detectCounterpartyConcentration(events: SwapEvent[], wallet: Address): boolean {
  if (events.length === 0) return false;
  const walletLower = wallet.toLowerCase();
  const counterparties = new Map<string, number>();
  for (const evt of events) {
    const senderLower = evt.sender.toLowerCase();
    const recipientLower = evt.recipient.toLowerCase();
    const counterparty = senderLower === walletLower ? recipientLower : senderLower;
    counterparties.set(counterparty, (counterparties.get(counterparty) || 0) + 1);
  }
  const totalSwaps = events.length;
  const uniqueCounterparties = counterparties.size;
  if (uniqueCounterparties <= 2) {
    const sortedCounts = Array.from(counterparties.values()).sort((a, b) => b - a);
    const topTwoCount = sortedCounts.slice(0, 2).reduce((sum, c) => sum + c, 0);
    return (topTwoCount * 100) / totalSwaps > 70;
  }
  return false;
}

export function detectWashTrade(events: SwapEvent[]): boolean {
  const sorted = [...events].sort((a, b) => Number(a.blockNumber - b.blockNumber));
  for (let i = 0; i < sorted.length; i++) {
    const first = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const second = sorted[j];
      if (second.blockNumber - first.blockNumber > 10n) break;
      const amount0Flips =
        (first.amount0 > 0n && second.amount0 < 0n) ||
        (first.amount0 < 0n && second.amount0 > 0n);
      const amount1Flips =
        (first.amount1 > 0n && second.amount1 < 0n) ||
        (first.amount1 < 0n && second.amount1 > 0n);
      if (amount0Flips && amount1Flips) return true;
    }
  }
  return false;
}

export function buildSwapSummary(
  wallet: Address,
  allEvents: SwapEvent[],
  referencePrices: Record<string, bigint>,
  pool: Address = "0x0000000000000000000000000000000000000000"
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
    volumeUSD += abs(evt.amount0) + abs(evt.amount1);
    netPnL += abs(evt.amount1) - abs(evt.amount0);
    const refPrice = referencePrices[evt.transactionHash] ?? 0n;
    if (refPrice > 0n) {
      const execPrice = priceFromSqrtPriceX96(evt.sqrtPriceX96);
      if (execPrice > 0n) {
        const diff = abs(execPrice - refPrice);
        totalSlippageBps += (diff * 10000n) / refPrice;
      }
    }
  }
  const avgSlippageBps = swapCount > 0n ? totalSlippageBps / swapCount : 0n;
  const washTradeFlag = detectWashTrade(walletEvents);
  const counterpartyConcentrationFlag = detectCounterpartyConcentration(walletEvents, wallet);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const evidenceHash = keccak256(
    toBytes(
      `uniswap-indexer:${walletLower}:${swapCount}:${volumeUSD}:${netPnL}:${avgSlippageBps}:${washTradeFlag}:${counterpartyConcentrationFlag}:${pool}:${now}`
    )
  );
  return {
    swapCount,
    volumeUSD,
    netPnL,
    avgSlippageBps,
    feeToPnlRatioBps: 0n,
    washTradeFlag,
    counterpartyConcentrationFlag,
    timestamp: now,
    evidenceHash,
    pool,
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

export async function indexAndSubmit(
  publicClient: PublicClient,
  walletClient: WalletClient,
  wallet: Address,
  pools: Address[],
  moduleAddress: Address,
  options: { fromBlock?: bigint; toBlock?: bigint; dryRun?: boolean } = {}
): Promise<{ submitted: boolean; summary: SwapSummary }> {
  const latestBlock = await publicClient.getBlockNumber();
  const fromBlock = options.fromBlock ?? (latestBlock > 10000n ? latestBlock - 10000n : 0n);
  const toBlock = options.toBlock ?? latestBlock;

  logger.info(`[uniswap] Indexing swaps for ${wallet}`, { fromBlock: fromBlock.toString(), toBlock: toBlock.toString() });

  const events = await fetchSwapEvents(publicClient, pools, fromBlock, toBlock);
  const refPrices = await fetchReferencePrices(publicClient, pools);
  const firstRefPrice = Object.values(refPrices).find((p) => p > 0n) ?? 0n;
  const txRefMap: Record<string, bigint> = {};
  for (const evt of events) {
    txRefMap[evt.transactionHash] = firstRefPrice;
  }
  const primaryPool = pools[0] ?? ("0x0000000000000000000000000000000000000000" as Address);
  const summary = buildSwapSummary(wallet, events, txRefMap, primaryPool);

  logger.info(`[uniswap] Summary: swapCount=${summary.swapCount}, volume=${summary.volumeUSD}, wash=${summary.washTradeFlag}`);

  if (options.dryRun || summary.swapCount === 0n) {
    return { submitted: false, summary };
  }

  const state = loadKeeperState();
  if (isAlreadySubmitted(state, "uniswap", wallet, summary.evidenceHash)) {
    logger.info("[uniswap] Already submitted, skipping");
    return { submitted: false, summary };
  }

  const nonce = await fetchNonce(publicClient, moduleAddress, wallet);
  const signature = await signSwapSummary(walletClient, moduleAddress, wallet, summary, nonce);

  const receipt = await submitWithRetry(
    async () => {
      const txHash = await walletClient.writeContract({
        chain: walletClient.chain as Chain,
        account: walletClient.account!,
        address: moduleAddress,
        abi: submitSwapSummaryAbi,
        functionName: "submitSwapSummary",
        args: [wallet, summary, signature],
      });
      logger.info(`[uniswap] Tx submitted: ${txHash}`);
      return publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
    },
    { label: "submitSwapSummary", maxRetries: 3 }
  );

  if (receipt.status === "success") {
    logger.info(`[uniswap] Submitted successfully (block ${receipt.blockNumber})`);
    const newState = recordSubmission(state, "uniswap", wallet, summary.evidenceHash, receipt.blockNumber);
    saveKeeperState(newState);
    return { submitted: true, summary };
  }
  throw new Error("Transaction reverted");
}
