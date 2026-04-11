import {
  type WalletClient,
  type PublicClient,
  type Address,
} from "viem";
import { xLayerTestnet } from "viem/chains";

const nonceAbi = [
  {
    inputs: [{ name: "", type: "address" }],
    name: "nonces",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export async function fetchNonce(
  publicClient: PublicClient,
  moduleAddress: Address,
  wallet: Address
): Promise<bigint> {
  return publicClient.readContract({
    address: moduleAddress,
    abi: nonceAbi,
    functionName: "nonces",
    args: [wallet],
  });
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
}

export function getSwapDomain(moduleAddress: Address) {
  return {
    name: "UniswapScoreModule",
    version: "1",
    chainId: xLayerTestnet.id,
    verifyingContract: moduleAddress,
  } as const;
}

export const swapSummaryTypes = {
  SwapSummary: [
    { name: "wallet", type: "address" },
    { name: "swapCount", type: "uint256" },
    { name: "volumeUSD", type: "uint256" },
    { name: "netPnL", type: "int256" },
    { name: "avgSlippageBps", type: "uint256" },
    { name: "feeToPnlRatioBps", type: "uint256" },
    { name: "washTradeFlag", type: "bool" },
    { name: "counterpartyConcentrationFlag", type: "bool" },
    { name: "timestamp", type: "uint256" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export async function signSwapSummary(
  walletClient: WalletClient,
  moduleAddress: Address,
  wallet: Address,
  summary: SwapSummary,
  nonce: bigint
): Promise<`0x${string}`> {
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: getSwapDomain(moduleAddress),
    types: swapSummaryTypes,
    primaryType: "SwapSummary",
    message: {
      wallet,
      swapCount: summary.swapCount,
      volumeUSD: summary.volumeUSD,
      netPnL: summary.netPnL,
      avgSlippageBps: summary.avgSlippageBps,
      feeToPnlRatioBps: summary.feeToPnlRatioBps,
      washTradeFlag: summary.washTradeFlag,
      counterpartyConcentrationFlag: summary.counterpartyConcentrationFlag,
      timestamp: summary.timestamp,
      evidenceHash: summary.evidenceHash,
      nonce,
    },
  });
}

export interface ActivitySummary {
  txCount: bigint;
  firstTxTimestamp: bigint;
  lastTxTimestamp: bigint;
  uniqueCounterparties: bigint;
  timestamp: bigint;
  evidenceHash: `0x${string}`;
}

export function getActivityDomain(moduleAddress: Address) {
  return {
    name: "BaseActivityModule",
    version: "1",
    chainId: xLayerTestnet.id,
    verifyingContract: moduleAddress,
  } as const;
}

export const activitySummaryTypes = {
  ActivitySummary: [
    { name: "wallet", type: "address" },
    { name: "txCount", type: "uint256" },
    { name: "firstTxTimestamp", type: "uint256" },
    { name: "lastTxTimestamp", type: "uint256" },
    { name: "uniqueCounterparties", type: "uint256" },
    { name: "timestamp", type: "uint256" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export async function signActivitySummary(
  walletClient: WalletClient,
  moduleAddress: Address,
  wallet: Address,
  summary: ActivitySummary,
  nonce: bigint
): Promise<`0x${string}`> {
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: getActivityDomain(moduleAddress),
    types: activitySummaryTypes,
    primaryType: "ActivitySummary",
    message: {
      wallet,
      txCount: summary.txCount,
      firstTxTimestamp: summary.firstTxTimestamp,
      lastTxTimestamp: summary.lastTxTimestamp,
      uniqueCounterparties: summary.uniqueCounterparties,
      timestamp: summary.timestamp,
      evidenceHash: summary.evidenceHash,
      nonce,
    },
  });
}

export function getWalletMetaDomain(moduleAddress: Address) {
  return {
    name: "AaveScoreModule",
    version: "1",
    chainId: xLayerTestnet.id,
    verifyingContract: moduleAddress,
  } as const;
}

export const walletMetaTypes = {
  WalletMeta: [
    { name: "wallet", type: "address" },
    { name: "liquidationCount", type: "uint256" },
    { name: "suppliedAssetCount", type: "uint256" },
    { name: "timestamp", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export async function signWalletMeta(
  walletClient: WalletClient,
  moduleAddress: Address,
  wallet: Address,
  liquidationCount: bigint,
  suppliedAssetCount: bigint,
  timestamp: bigint,
  nonce: bigint
): Promise<`0x${string}`> {
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: getWalletMetaDomain(moduleAddress),
    types: walletMetaTypes,
    primaryType: "WalletMeta",
    message: {
      wallet,
      liquidationCount,
      suppliedAssetCount,
      timestamp,
      nonce,
    },
  });
}
