import {
  keccak256,
  toBytes,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { createHmac } from "node:crypto";
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

const XLAYER_CHAIN_INDEX = "196";
const OKX_BASE_URL = "https://web3.okx.com";
const OKX_MIN_INTERVAL_MS = 1500; // OKX rate limit: avoid 429

let okxLastRequestTime = 0;

export interface OkxCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  projectId: string;
}

interface OkxTx {
  txHash: string;
  txTime: string;
  from: Array<{ address: string }>;
  to: Array<{ address: string }>;
  txStatus: string;
}

interface OkxTxResponse {
  code: string;
  msg: string;
  data: Array<{ cursor: string; transactionList: OkxTx[] }>;
}

interface ActivityData {
  txCount: bigint;
  firstTxTimestamp: bigint;
  lastTxTimestamp: bigint;
  uniqueCounterparties: bigint;
}

function signRequest(secret: string, timestamp: string, method: string, path: string): string {
  const prehash = timestamp + method.toUpperCase() + path;
  return createHmac("sha256", secret).update(prehash).digest("base64");
}

async function okxFetch(path: string, creds: OkxCredentials): Promise<OkxTxResponse> {
  const now = Date.now();
  const elapsed = now - okxLastRequestTime;
  if (elapsed < OKX_MIN_INTERVAL_MS) {
    await sleep(OKX_MIN_INTERVAL_MS - elapsed);
  }
  okxLastRequestTime = Date.now();

  const timestamp = new Date().toISOString();
  const sign = signRequest(creds.apiSecret, timestamp, "GET", path);
  const res = await fetch(OKX_BASE_URL + path, {
    headers: {
      "OK-ACCESS-KEY": creds.apiKey,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": creds.passphrase,
      "OK-ACCESS-PROJECT": creds.projectId,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OKX API failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as OkxTxResponse;
  if (data.code !== "0") throw new Error(`OKX API error: code=${data.code} msg=${data.msg}`);
  return data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllTransactions(wallet: string, creds: OkxCredentials): Promise<OkxTx[]> {
  const allTxs: OkxTx[] = [];
  let cursor = "";
  let page = 0;
  logger.info(`[activity-oklink] Fetching transactions from OKX OnchainOS...`);
  while (true) {
    page++;
    let path = `/api/v5/wallet/post-transaction/transactions-by-address?address=${wallet}&chains=${XLAYER_CHAIN_INDEX}&limit=20`;
    if (cursor) path += `&cursor=${cursor}`;
    const resp = await okxFetch(path, creds);
    if (!resp.data || resp.data.length === 0) break;
    const pageData = resp.data[0];
    if (!pageData.transactionList || pageData.transactionList.length === 0) break;
    allTxs.push(...pageData.transactionList);
    logger.info(`[activity-oklink] Page ${page}: ${pageData.transactionList.length} txs (total: ${allTxs.length})`);
    cursor = pageData.cursor;
    if (!cursor) break;
  }
  return allTxs;
}

function analyzeTransactions(txs: OkxTx[], wallet: string): ActivityData {
  if (txs.length === 0) {
    return { txCount: 0n, firstTxTimestamp: 0n, lastTxTimestamp: 0n, uniqueCounterparties: 0n };
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
    const isOutgoing = tx.from.some((f) => f.address.toLowerCase() === walletLower);
    if (isOutgoing) {
      outgoingCount++;
      for (const t of tx.to) {
        if (t.address && t.address.toLowerCase() !== walletLower) counterparties.add(t.address.toLowerCase());
      }
    }
    const isIncoming = tx.to.some((t) => t.address.toLowerCase() === walletLower);
    if (isIncoming) {
      for (const f of tx.from) {
        if (f.address && f.address.toLowerCase() !== walletLower) counterparties.add(f.address.toLowerCase());
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

export async function fetchTransactionsForSybilDetection(
  wallet: string,
  creds: OkxCredentials
): Promise<TxRecord[]> {
  const txs = await fetchAllTransactions(wallet, creds);
  const records: TxRecord[] = [];
  const walletLower = wallet.toLowerCase();

  for (const tx of txs) {
    if (tx.txStatus !== "success") continue;
    const ts = Math.floor(parseInt(tx.txTime, 10) / 1000);
    const isIncoming = tx.to.some((t) => t.address.toLowerCase() === walletLower);
    if (isIncoming && tx.from.length > 0) {
      records.push({
        from: tx.from[0].address.toLowerCase(),
        to: walletLower,
        timestamp: ts,
      });
    }
  }

  return records;
}

export async function fetchAndSubmitActivity(
  publicClient: PublicClient,
  walletClient: WalletClient,
  wallet: Address,
  moduleAddress: Address,
  creds: OkxCredentials,
  options: { dryRun?: boolean; sybilClusterFlag?: boolean } = {}
): Promise<{ submitted: boolean; activity: ActivityData }> {
  const txs = await fetchAllTransactions(wallet, creds);
  const activity = analyzeTransactions(txs, wallet);

  logger.info(`[activity-oklink] txCount=${activity.txCount}, counterparties=${activity.uniqueCounterparties}`);

  if (activity.txCount === 0n || options.dryRun) {
    return { submitted: false, activity };
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const evidenceHash = keccak256(
    toBytes(
      `okx-activity:${wallet.toLowerCase()}:${activity.txCount}:${activity.firstTxTimestamp}:${activity.lastTxTimestamp}:${activity.uniqueCounterparties}:${now}:${options.sybilClusterFlag ?? false}`
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
    logger.info("[activity-oklink] Already submitted, skipping");
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
      logger.info(`[activity-oklink] Tx submitted: ${txHash}`);
      return publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
    },
    { label: "submitActivitySummary", maxRetries: 3 }
  );

  if (receipt.status === "success") {
    logger.info(`[activity-oklink] Submitted successfully (block ${receipt.blockNumber})`);
    const newState = recordSubmission(state, "activity", wallet, evidenceHash, receipt.blockNumber);
    saveKeeperState(newState);
    return { submitted: true, activity };
  }
  throw new Error("Transaction reverted");
}
