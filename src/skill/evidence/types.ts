import type { Address, Hex } from "viem";

export type EvidenceModuleKey = "uniswap" | "activity" | "aave";
export type EvidenceProofType = "summary-only" | "merkle" | "receipt-proof";

export interface UniswapEvidenceSummary {
  swapCount: bigint;
  volumeUSD: bigint;
  netPnL: bigint;
  avgSlippageBps: bigint;
  feeToPnlRatioBps: bigint;
  washTradeFlag: boolean;
  counterpartyConcentrationFlag: boolean;
  timestamp: bigint;
  evidenceHash: Hex;
  pool: Address;
}

export interface ActivityEvidenceSummary {
  txCount: bigint;
  firstTxTimestamp: bigint;
  lastTxTimestamp: bigint;
  uniqueCounterparties: bigint;
  timestamp: bigint;
  evidenceHash: Hex;
  sybilClusterFlag: boolean;
}

export interface AaveEvidenceSummary {
  liquidationCount: bigint;
  suppliedAssetCount: bigint;
  timestamp: bigint;
}

export interface EvidenceSummaryByModule {
  uniswap: UniswapEvidenceSummary;
  activity: ActivityEvidenceSummary;
  aave: AaveEvidenceSummary;
}

export type EvidenceSummaryEnvelope<M extends EvidenceModuleKey = EvidenceModuleKey> = {
  moduleKey: M;
  wallet: Address;
  epoch: number;
  blockNumber: bigint;
  summary: EvidenceSummaryByModule[M];
};

export type AnyEvidenceSummaryEnvelope = {
  [K in EvidenceModuleKey]: EvidenceSummaryEnvelope<K>;
}[EvidenceModuleKey];

export interface EvidenceCommitmentLeaf {
  moduleKey: EvidenceModuleKey;
  wallet: Address;
  epoch: number;
  blockNumber: bigint;
  summaryHash: Hex;
  leafHash: Hex;
}

export interface CommitmentProof {
  root: Hex;
  proof: Hex[];
}

export const EVIDENCE_SORT_KEYS = ["moduleKey", "wallet", "epoch", "summaryHash"] as const;

export interface ProofBundleMetadata {
  schemaVersion: 1;
  hashAlgorithm: "keccak256";
  merklePairHash: "sorted";
  sortKeys: typeof EVIDENCE_SORT_KEYS;
  leafCount: number;
}

export interface EvidenceProofBundle {
  proofType: EvidenceProofType;
  root: Hex;
  leaf: EvidenceCommitmentLeaf;
  proof: Hex[];
  metadata: ProofBundleMetadata;
}

export interface EvidenceProofBuildResult {
  proofType: EvidenceProofType;
  root: Hex;
  metadata: ProofBundleMetadata;
  leaves: EvidenceCommitmentLeaf[];
  bundles: EvidenceProofBundle[];
}

export interface RawEvidenceSummaryEnvelope {
  moduleKey: EvidenceModuleKey;
  wallet: string;
  epoch: number | string;
  blockNumber: number | string;
  summary: Record<string, unknown>;
}
