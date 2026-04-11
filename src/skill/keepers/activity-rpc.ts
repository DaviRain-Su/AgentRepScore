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
} from "../keeper-utils.ts";
import { fetchNonce, signActivitySummary, type ActivitySummary } from "../eip712.ts";
import { type TxRecord } from "../sybil-detector.ts";

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

interface ActivityData {
  txCount: bigint;
  firstTxTimestamp: bigint;
  lastTxTimestamp: bigint;
  uniqueCounterparties: bigint;
}

async function binarySearchFirstTx(
  client: PublicClient,
  wallet: Address,
  low: bigint,
  high: bigint
): Promise<bigint | null> {
  if (low > high) return null;
  const nonceAtLow = await client
    .getTransactionCount({ address: wallet, blockNumber: low })
    .catch(() => 0);
  if (nonceAtLow > 0) return low;

  let lo = low;
  let hi = high;
  let result: bigint | null = null;
  let iterations = 0;
  const MAX_ITERATIONS = 30;

  while (lo <= hi && iterations < MAX_ITERATIONS) {
    iterations++;
    const mid = lo + (hi - lo) / 2n;
    try {
      const nonce = await client.getTransactionCount({ address: wallet, blockNumber: mid });
      if (nonce > 0) {
        result = mid;
        hi = mid - 1n;
      } else {
        lo = mid + 1n;
      }
    } catch {
      lo = mid + 1n;
    }
  }
  return result;
}

export async function fetchActivityData(
  client: PublicClient,
  wallet: Address
): Promise<ActivityData> {
  const nonce = await client.getTransactionCount({ address: wallet });
  const txCount = BigInt(nonce);
  if (txCount === 0n) {
    return { txCount: 0n, firstTxTimestamp: 0n, lastTxTimestamp: 0n, uniqueCounterparties: 0n };
  }

  const latestBlock = await client.getBlockNumber();
  let firstTxTimestamp = 0n;
  let lastTxTimestamp = 0n;
  const counterparties = new Set<string>();

  const firstTxBlock = await binarySearchFirstTx(client, wallet, 0n, latestBlock);
  if (firstTxBlock !== null) {
    const block = await client.getBlock({ blockNumber: firstTxBlock });
    firstTxTimestamp = BigInt(block.timestamp);
  }

  const scanStart = latestBlock > 10000n ? latestBlock - 10000n : 0n;
  const BATCH_SIZE = 2000n;

  for (let from = scanStart; from <= latestBlock; from += BATCH_SIZE) {
    const to = from + BATCH_SIZE - 1n > latestBlock ? latestBlock : from + BATCH_SIZE - 1n;
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
        const block = await client.getBlock({ blockNumber: log.blockNumber });
        const ts = BigInt(block.timestamp);
        if (firstTxTimestamp === 0n || ts < firstTxTimestamp) firstTxTimestamp = ts;
        if (ts > lastTxTimestamp) lastTxTimestamp = ts;
        if (log.args.to) counterparties.add(log.args.to.toLowerCase());
      }
    } catch {
      logger.warn(`[activity-rpc] getLogs failed for range ${from}-${to}, skipping`);
    }
  }

  if (lastTxTimestamp === 0n) {
    const block = await client.getBlock({ blockNumber: latestBlock });
    lastTxTimestamp = BigInt(block.timestamp);
  }

  const uniqueCounterparties = counterparties.size > 0 ? BigInt(counterparties.size) : txCount > 0n ? 1n : 0n;
  return { txCount, firstTxTimestamp, lastTxTimestamp, uniqueCounterparties };
}

export async function fetchTransactionsForSybilDetection(
  client: PublicClient,
  wallet: Address,
  maxBlocks: bigint = 10000n
): Promise<TxRecord[]> {
  const latestBlock = await client.getBlockNumber();
  const startBlock = latestBlock > maxBlocks ? latestBlock - maxBlocks : 0n;
  const BATCH_SIZE = 2000n;
  const records: TxRecord[] = [];

  for (let from = startBlock; from <= latestBlock; from += BATCH_SIZE) {
    const to = from + BATCH_SIZE - 1n > latestBlock ? latestBlock : from + BATCH_SIZE - 1n;
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
        args: { to: wallet },
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        const block = await client.getBlock({ blockNumber: log.blockNumber });
        records.push({
          from: String(log.args.from).toLowerCase(),
          to: wallet.toLowerCase(),
          timestamp: Number(block.timestamp),
        });
      }
    } catch {
      logger.warn(`[activity-rpc] getLogs failed for incoming transfers range ${from}-${to}, skipping`);
    }
  }
  return records;
}

export async function fetchAndSubmitActivity(
  publicClient: PublicClient,
  walletClient: WalletClient,
  wallet: Address,
  moduleAddress: Address,
  options: { dryRun?: boolean; sybilClusterFlag?: boolean } = {}
): Promise<{ submitted: boolean; activity: ActivityData }> {
  logger.info(`[activity-rpc] Fetching activity for ${wallet}`);
  const activity = await fetchActivityData(publicClient, wallet);

  logger.info(`[activity-rpc] txCount=${activity.txCount}, counterparties=${activity.uniqueCounterparties}`);

  if (activity.txCount === 0n || options.dryRun) {
    return { submitted: false, activity };
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const evidenceHash = keccak256(
    toBytes(
      `rpc-activity:${wallet.toLowerCase()}:${activity.txCount}:${activity.firstTxTimestamp}:${activity.lastTxTimestamp}:${activity.uniqueCounterparties}:${now}:${options.sybilClusterFlag ?? false}`
    )
  );

  const summary: ActivitySummary = {
    txCount: activity.txCount,
    firstTxTimestamp: activity.firstTxTimestamp,
    lastTxTimestamp: activity.lastTxTimestamp,
    uniqueCounterparties: activity.uniqueCounterparties,
    timestamp: now,
    evidenceHash,
    sybilClusterFlag: options.sybilClusterFlag ?? false,
  };

  const state = loadKeeperState();
  if (isAlreadySubmitted(state, "activity", wallet, evidenceHash)) {
    logger.info("[activity-rpc] Already submitted, skipping");
    return { submitted: false, activity };
  }

  const nonce = await fetchNonce(publicClient, moduleAddress, wallet);
  const signature = await signActivitySummary(walletClient, moduleAddress, wallet, summary, nonce);

  const receipt = await submitWithRetry(
    async () => {
      const txHash = await walletClient.writeContract({
        chain: walletClient.chain as Chain,
        account: walletClient.account!,
        address: moduleAddress,
        abi: baseModuleAbi,
        functionName: "submitActivitySummary",
        args: [wallet, summary, signature],
      });
      logger.info(`[activity-rpc] Tx submitted: ${txHash}`);
      return publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
    },
    { label: "submitActivitySummary", maxRetries: 3 }
  );

  if (receipt.status === "success") {
    logger.info(`[activity-rpc] Submitted successfully (block ${receipt.blockNumber})`);
    const newState = recordSubmission(state, "activity", wallet, evidenceHash, receipt.blockNumber);
    saveKeeperState(newState);
    return { submitted: true, activity };
  }
  throw new Error("Transaction reverted");
}
