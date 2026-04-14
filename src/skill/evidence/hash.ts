import { encodePacked, getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import type {
  AaveEvidenceSummary,
  ActivityEvidenceSummary,
  AnyEvidenceSummaryEnvelope,
  EvidenceCommitmentLeaf,
  EvidenceModuleKey,
  EvidenceSummaryByModule,
  UniswapEvidenceSummary,
} from "./types.ts";

const BYTES32_REGEX = /^0x[0-9a-fA-F]{64}$/;
const UINT64_MAX = (1n << 64n) - 1n;

function assertBytes32(value: Hex, field: string): void {
  if (!BYTES32_REGEX.test(value)) {
    throw new Error(`${field} must be a 32-byte hex value`);
  }
}

function assertAddress(value: Address, field: string): Address {
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${field} must be a valid address`);
  }
  return getAddress(value);
}

function assertUint64(value: bigint, field: string): void {
  if (value < 0n || value > UINT64_MAX) {
    throw new Error(`${field} must be within uint64 range`);
  }
}

function assertEpoch(epoch: number): void {
  if (!Number.isInteger(epoch) || epoch < 0) {
    throw new Error("epoch must be a non-negative integer");
  }
}

export function hashUniswapSummary(summary: UniswapEvidenceSummary): Hex {
  assertBytes32(summary.evidenceHash, "summary.evidenceHash");
  const pool = assertAddress(summary.pool, "summary.pool");
  return keccak256(
    encodePacked(
      ["uint256", "uint256", "int256", "uint256", "uint256", "bool", "bool", "uint256", "bytes32", "address"],
      [
        summary.swapCount,
        summary.volumeUSD,
        summary.netPnL,
        summary.avgSlippageBps,
        summary.feeToPnlRatioBps,
        summary.washTradeFlag,
        summary.counterpartyConcentrationFlag,
        summary.timestamp,
        summary.evidenceHash,
        pool,
      ]
    )
  );
}

export function hashActivitySummary(summary: ActivityEvidenceSummary): Hex {
  assertBytes32(summary.evidenceHash, "summary.evidenceHash");
  return keccak256(
    encodePacked(
      ["uint256", "uint256", "uint256", "uint256", "uint256", "bytes32", "bool"],
      [
        summary.txCount,
        summary.firstTxTimestamp,
        summary.lastTxTimestamp,
        summary.uniqueCounterparties,
        summary.timestamp,
        summary.evidenceHash,
        summary.sybilClusterFlag,
      ]
    )
  );
}

export function hashAaveSummary(summary: AaveEvidenceSummary): Hex {
  return keccak256(
    encodePacked(
      ["uint256", "uint256", "uint256"],
      [summary.liquidationCount, summary.suppliedAssetCount, summary.timestamp]
    )
  );
}

export function hashSummary<M extends EvidenceModuleKey>(
  moduleKey: M,
  summary: EvidenceSummaryByModule[M]
): Hex {
  switch (moduleKey) {
    case "uniswap":
      return hashUniswapSummary(summary as EvidenceSummaryByModule["uniswap"]);
    case "activity":
      return hashActivitySummary(summary as EvidenceSummaryByModule["activity"]);
    case "aave":
      return hashAaveSummary(summary as EvidenceSummaryByModule["aave"]);
    default: {
      const unknownModule: never = moduleKey;
      throw new Error(`Unsupported module key: ${unknownModule}`);
    }
  }
}

export interface LeafHashInput {
  moduleKey: EvidenceModuleKey;
  wallet: Address;
  epoch: number;
  blockNumber: bigint;
  summaryHash: Hex;
}

export function hashLeaf(input: LeafHashInput): Hex {
  assertEpoch(input.epoch);
  assertUint64(BigInt(input.epoch), "epoch");
  assertUint64(input.blockNumber, "blockNumber");
  assertBytes32(input.summaryHash, "summaryHash");
  const wallet = assertAddress(input.wallet, "wallet");
  return keccak256(
    encodePacked(
      ["string", "address", "uint64", "uint64", "bytes32"],
      [input.moduleKey, wallet, BigInt(input.epoch), input.blockNumber, input.summaryHash]
    )
  );
}

export function buildCommitmentLeaf(envelope: AnyEvidenceSummaryEnvelope): EvidenceCommitmentLeaf {
  assertEpoch(envelope.epoch);
  const wallet = assertAddress(envelope.wallet, "wallet");
  const summaryHash = hashSummary(envelope.moduleKey, envelope.summary as never);
  const leafHash = hashLeaf({
    moduleKey: envelope.moduleKey,
    wallet,
    epoch: envelope.epoch,
    blockNumber: envelope.blockNumber,
    summaryHash,
  });
  return {
    moduleKey: envelope.moduleKey,
    wallet,
    epoch: envelope.epoch,
    blockNumber: envelope.blockNumber,
    summaryHash,
    leafHash,
  };
}
