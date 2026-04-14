import { getAddress, isAddress, type Address, type Hex } from "viem";
import { buildCommitmentLeaf } from "./hash.ts";
import { buildMerkleProof, buildMerkleRoot, verifyMerkleProof } from "./merkle.ts";
import type {
  AnyEvidenceSummaryEnvelope,
  EvidenceCommitmentLeaf,
  EvidenceModuleKey,
  EvidenceProofBuildResult,
  EvidenceProofBundle,
  EvidenceProofType,
  RawEvidenceSummaryEnvelope,
  ProofBundleMetadata,
  AaveEvidenceSummary,
  ActivityEvidenceSummary,
  UniswapEvidenceSummary,
} from "./types.ts";
import { EVIDENCE_SORT_KEYS } from "./types.ts";

const UINT64_MAX = (1n << 64n) - 1n;
const BYTES32_REGEX = /^0x[0-9a-fA-F]{64}$/;

export interface BuildProofBundleOptions {
  proofType?: EvidenceProofType;
}

function ensureObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error(`${field} must be a valid address`);
  }
  return getAddress(value);
}

function asBytes32(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !BYTES32_REGEX.test(value)) {
    throw new Error(`${field} must be a 32-byte hex value`);
  }
  return value as Hex;
}

function asBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new Error(`${field} must be an integer`);
}

function asNonNegativeInteger(value: unknown, field: string): number {
  const parsed = asBigInt(value, field);
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return Number(parsed);
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function asUint64(value: bigint, field: string): bigint {
  if (value < 0n || value > UINT64_MAX) {
    throw new Error(`${field} must fit uint64`);
  }
  return value;
}

function parseUniswapSummary(summary: Record<string, unknown>): UniswapEvidenceSummary {
  return {
    swapCount: asBigInt(summary.swapCount, "summary.swapCount"),
    volumeUSD: asBigInt(summary.volumeUSD, "summary.volumeUSD"),
    netPnL: asBigInt(summary.netPnL, "summary.netPnL"),
    avgSlippageBps: asBigInt(summary.avgSlippageBps, "summary.avgSlippageBps"),
    feeToPnlRatioBps: asBigInt(summary.feeToPnlRatioBps, "summary.feeToPnlRatioBps"),
    washTradeFlag: asBoolean(summary.washTradeFlag, "summary.washTradeFlag"),
    counterpartyConcentrationFlag: asBoolean(
      summary.counterpartyConcentrationFlag,
      "summary.counterpartyConcentrationFlag"
    ),
    timestamp: asBigInt(summary.timestamp, "summary.timestamp"),
    evidenceHash: asBytes32(summary.evidenceHash, "summary.evidenceHash"),
    pool: asAddress(summary.pool, "summary.pool"),
  };
}

function parseActivitySummary(summary: Record<string, unknown>): ActivityEvidenceSummary {
  return {
    txCount: asBigInt(summary.txCount, "summary.txCount"),
    firstTxTimestamp: asBigInt(summary.firstTxTimestamp, "summary.firstTxTimestamp"),
    lastTxTimestamp: asBigInt(summary.lastTxTimestamp, "summary.lastTxTimestamp"),
    uniqueCounterparties: asBigInt(summary.uniqueCounterparties, "summary.uniqueCounterparties"),
    timestamp: asBigInt(summary.timestamp, "summary.timestamp"),
    evidenceHash: asBytes32(summary.evidenceHash, "summary.evidenceHash"),
    sybilClusterFlag: asBoolean(summary.sybilClusterFlag, "summary.sybilClusterFlag"),
  };
}

function parseAaveSummary(summary: Record<string, unknown>): AaveEvidenceSummary {
  return {
    liquidationCount: asBigInt(summary.liquidationCount, "summary.liquidationCount"),
    suppliedAssetCount: asBigInt(summary.suppliedAssetCount, "summary.suppliedAssetCount"),
    timestamp: asBigInt(summary.timestamp, "summary.timestamp"),
  };
}

export function parseEvidenceSummaryEnvelope(raw: RawEvidenceSummaryEnvelope): AnyEvidenceSummaryEnvelope {
  const moduleKey = raw.moduleKey;
  const wallet = asAddress(raw.wallet, "wallet");
  const epoch = asNonNegativeInteger(raw.epoch, "epoch");
  const blockNumber = asUint64(asBigInt(raw.blockNumber, "blockNumber"), "blockNumber");
  const summaryObject = ensureObject(raw.summary, "summary");

  switch (moduleKey) {
    case "uniswap":
      return {
        moduleKey,
        wallet,
        epoch,
        blockNumber,
        summary: parseUniswapSummary(summaryObject),
      };
    case "activity":
      return {
        moduleKey,
        wallet,
        epoch,
        blockNumber,
        summary: parseActivitySummary(summaryObject),
      };
    case "aave":
      return {
        moduleKey,
        wallet,
        epoch,
        blockNumber,
        summary: parseAaveSummary(summaryObject),
      };
    default: {
      const neverModuleKey: never = moduleKey;
      throw new Error(`Unsupported module key: ${neverModuleKey}`);
    }
  }
}

function compareLeaves(a: EvidenceCommitmentLeaf, b: EvidenceCommitmentLeaf): number {
  if (a.moduleKey !== b.moduleKey) return a.moduleKey.localeCompare(b.moduleKey);

  const walletCompare = a.wallet.toLowerCase().localeCompare(b.wallet.toLowerCase());
  if (walletCompare !== 0) return walletCompare;

  if (a.epoch !== b.epoch) return a.epoch - b.epoch;

  const summaryCompare = a.summaryHash.toLowerCase().localeCompare(b.summaryHash.toLowerCase());
  if (summaryCompare !== 0) return summaryCompare;

  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;

  return a.leafHash.toLowerCase().localeCompare(b.leafHash.toLowerCase());
}

export function sortCommitmentLeaves(leaves: readonly EvidenceCommitmentLeaf[]): EvidenceCommitmentLeaf[] {
  return [...leaves].sort(compareLeaves);
}

function buildMetadata(leafCount: number): ProofBundleMetadata {
  return {
    schemaVersion: 1,
    hashAlgorithm: "keccak256",
    merklePairHash: "sorted",
    sortKeys: EVIDENCE_SORT_KEYS,
    leafCount,
  };
}

function ensureNonEmpty(envelopes: readonly AnyEvidenceSummaryEnvelope[]): void {
  if (envelopes.length === 0) {
    throw new Error("At least one evidence summary envelope is required");
  }
}

export function buildEvidenceProofBundles(
  envelopes: readonly AnyEvidenceSummaryEnvelope[],
  options: BuildProofBundleOptions = {}
): EvidenceProofBuildResult {
  ensureNonEmpty(envelopes);

  const proofType = options.proofType ?? "merkle";
  const leaves = sortCommitmentLeaves(envelopes.map((envelope) => buildCommitmentLeaf(envelope)));
  const metadata = buildMetadata(leaves.length);

  if (proofType === "summary-only") {
    if (leaves.length !== 1) {
      throw new Error("summary-only proof type requires exactly one envelope");
    }
    const root = leaves[0].leafHash;
    const bundle: EvidenceProofBundle = {
      proofType,
      root,
      leaf: leaves[0],
      proof: [],
      metadata,
    };
    return {
      proofType,
      root,
      metadata,
      leaves,
      bundles: [bundle],
    };
  }

  const leafHashes = leaves.map((leaf) => leaf.leafHash);
  const root = buildMerkleRoot(leafHashes);
  const bundles: EvidenceProofBundle[] = leaves.map((leaf, i) => ({
    proofType,
    root,
    leaf,
    proof: buildMerkleProof(leafHashes, i),
    metadata,
  }));

  return {
    proofType,
    root,
    metadata,
    leaves,
    bundles,
  };
}

export function verifyEvidenceProofBundle(bundle: EvidenceProofBundle): boolean {
  if (bundle.proofType === "summary-only") {
    return bundle.proof.length === 0 && bundle.root.toLowerCase() === bundle.leaf.leafHash.toLowerCase();
  }
  return verifyMerkleProof(bundle.leaf.leafHash, bundle.proof, bundle.root);
}

export function filterByModuleKey(
  envelopes: readonly RawEvidenceSummaryEnvelope[],
  moduleKey?: EvidenceModuleKey
): RawEvidenceSummaryEnvelope[] {
  if (!moduleKey) return [...envelopes];
  return envelopes.filter((envelope) => envelope.moduleKey === moduleKey);
}
