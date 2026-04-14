import { describe, expect, it } from "vitest";
import { buildCommitmentLeaf, hashLeaf } from "../../src/skill/evidence/hash.ts";
import { buildMerkleRoot } from "../../src/skill/evidence/merkle.ts";
import {
  buildEvidenceProofBundles,
  parseEvidenceSummaryEnvelope,
  verifyEvidenceProofBundle,
} from "../../src/skill/evidence/build-proof-bundle.ts";
import type { RawEvidenceSummaryEnvelope } from "../../src/skill/evidence/types.ts";

const HASH_A = `0x${"1".repeat(64)}` as const;
const HASH_B = `0x${"2".repeat(64)}` as const;
const HASH_C = `0x${"3".repeat(64)}` as const;
const HASH_D = `0x${"4".repeat(64)}` as const;
const WRONG_HASH = `0x${"f".repeat(64)}` as const;

const rawEnvelopes: RawEvidenceSummaryEnvelope[] = [
  {
    moduleKey: "uniswap",
    wallet: "0x1111111111111111111111111111111111111111",
    epoch: 7,
    blockNumber: "123456",
    summary: {
      swapCount: "12",
      volumeUSD: "3456000",
      netPnL: "-1200",
      avgSlippageBps: "15",
      feeToPnlRatioBps: "250",
      washTradeFlag: false,
      counterpartyConcentrationFlag: true,
      timestamp: "1700000011",
      evidenceHash: HASH_A,
      pool: "0x9999999999999999999999999999999999999999",
    },
  },
  {
    moduleKey: "activity",
    wallet: "0x2222222222222222222222222222222222222222",
    epoch: 7,
    blockNumber: 123457,
    summary: {
      txCount: 88,
      firstTxTimestamp: "1690000000",
      lastTxTimestamp: "1700000000",
      uniqueCounterparties: "21",
      timestamp: "1700000022",
      evidenceHash: HASH_B,
      sybilClusterFlag: false,
    },
  },
  {
    moduleKey: "aave",
    wallet: "0x3333333333333333333333333333333333333333",
    epoch: "7",
    blockNumber: "123458",
    summary: {
      liquidationCount: "1",
      suppliedAssetCount: "3",
      timestamp: "1700000033",
    },
  },
];

describe("evidence proof bundle builder", () => {
  it("produces deterministic summaryHash for the same input", () => {
    const envelope = parseEvidenceSummaryEnvelope(rawEnvelopes[0]);
    const first = buildCommitmentLeaf(envelope);
    const second = buildCommitmentLeaf(envelope);
    expect(first.summaryHash).toBe(second.summaryHash);
  });

  it("changes summaryHash when summary content changes", () => {
    const original = parseEvidenceSummaryEnvelope(rawEnvelopes[0]);
    const changed = parseEvidenceSummaryEnvelope({
      ...rawEnvelopes[0],
      summary: {
        ...rawEnvelopes[0].summary,
        swapCount: "13",
      },
    });
    expect(buildCommitmentLeaf(changed).summaryHash).not.toBe(buildCommitmentLeaf(original).summaryHash);
  });

  it("changes leafHash when wallet, epoch, or blockNumber changes", () => {
    const envelope = parseEvidenceSummaryEnvelope(rawEnvelopes[1]);
    const leaf = buildCommitmentLeaf(envelope);
    const changedWallet = hashLeaf({
      moduleKey: leaf.moduleKey,
      wallet: "0x4444444444444444444444444444444444444444",
      epoch: leaf.epoch,
      blockNumber: leaf.blockNumber,
      summaryHash: leaf.summaryHash,
    });
    const changedEpoch = hashLeaf({
      moduleKey: leaf.moduleKey,
      wallet: leaf.wallet,
      epoch: leaf.epoch + 1,
      blockNumber: leaf.blockNumber,
      summaryHash: leaf.summaryHash,
    });
    const changedBlock = hashLeaf({
      moduleKey: leaf.moduleKey,
      wallet: leaf.wallet,
      epoch: leaf.epoch,
      blockNumber: leaf.blockNumber + 1n,
      summaryHash: leaf.summaryHash,
    });

    expect(changedWallet).not.toBe(leaf.leafHash);
    expect(changedEpoch).not.toBe(leaf.leafHash);
    expect(changedBlock).not.toBe(leaf.leafHash);
  });

  it("keeps merkle root stable after canonical sorting even when input order changes", () => {
    const parsedA = rawEnvelopes.map((entry) => parseEvidenceSummaryEnvelope(entry));
    const parsedB = [...rawEnvelopes].reverse().map((entry) => parseEvidenceSummaryEnvelope(entry));
    const resultA = buildEvidenceProofBundles(parsedA);
    const resultB = buildEvidenceProofBundles(parsedB);

    expect(resultA.root).toBe(resultB.root);
    expect(resultA.leaves.map((leaf) => leaf.moduleKey)).toEqual(["aave", "activity", "uniswap"]);
  });

  it("verifies each generated proof bundle back to the computed root", () => {
    const parsed = rawEnvelopes.map((entry) => parseEvidenceSummaryEnvelope(entry));
    const result = buildEvidenceProofBundles(parsed);

    for (const bundle of result.bundles) {
      expect(verifyEvidenceProofBundle(bundle)).toBe(true);
    }
  });

  it("fails verification for malformed proofs or wrong leaves", () => {
    const parsed = rawEnvelopes.map((entry) => parseEvidenceSummaryEnvelope(entry));
    const result = buildEvidenceProofBundles(parsed);
    const baseline = result.bundles[0];

    const malformedLeafBundle = {
      ...baseline,
      leaf: {
        ...baseline.leaf,
        leafHash: HASH_C,
      },
    };

    const wrongProofBundle = {
      ...baseline,
      proof: [WRONG_HASH, ...baseline.proof.slice(1)],
    };

    expect(verifyEvidenceProofBundle(malformedLeafBundle)).toBe(false);
    expect(verifyEvidenceProofBundle(wrongProofBundle)).toBe(false);
  });

  it("builds single-leaf bundles for uniswap, activity, and aave", () => {
    for (const raw of rawEnvelopes) {
      const parsed = parseEvidenceSummaryEnvelope(raw);
      const result = buildEvidenceProofBundles([parsed], { proofType: "summary-only" });
      expect(result.leaves[0].moduleKey).toBe(raw.moduleKey);
      expect(result.root).toBe(result.leaves[0].leafHash);
      expect(result.bundles[0].proof).toEqual([]);
      expect(verifyEvidenceProofBundle(result.bundles[0])).toBe(true);
    }
  });

  it("detects wrong leaf ordering when building raw merkle roots without canonical sorting", () => {
    const unsortedLeaves = rawEnvelopes
      .map((entry) => parseEvidenceSummaryEnvelope(entry))
      .map((envelope) => buildCommitmentLeaf(envelope))
      .map((leaf) => leaf.leafHash);
    const canonicalResult = buildEvidenceProofBundles(rawEnvelopes.map((entry) => parseEvidenceSummaryEnvelope(entry)));

    const unsortedRoot = buildMerkleRoot(unsortedLeaves);
    expect(unsortedRoot).not.toBe(canonicalResult.root);
  });

  it("rejects malformed envelopes", () => {
    expect(() =>
      parseEvidenceSummaryEnvelope({
        moduleKey: "activity",
        wallet: "0x5555555555555555555555555555555555555555",
        epoch: 7,
        blockNumber: 123n.toString(),
        summary: {
          txCount: 1,
          firstTxTimestamp: 2,
          lastTxTimestamp: 3,
          uniqueCounterparties: 4,
          timestamp: 5,
          sybilClusterFlag: false,
        },
      })
    ).toThrow("summary.evidenceHash");
  });

  it("supports receipt-proof proofType output shape", () => {
    const parsed = rawEnvelopes.map((entry) => parseEvidenceSummaryEnvelope(entry));
    const result = buildEvidenceProofBundles(parsed, { proofType: "receipt-proof" });
    expect(result.proofType).toBe("receipt-proof");
    expect(result.bundles.every((bundle) => bundle.proofType === "receipt-proof")).toBe(true);
  });

  it("uses module-specific canonical field ordering for hashing", () => {
    const uniswap = parseEvidenceSummaryEnvelope(rawEnvelopes[0]);
    const activity = parseEvidenceSummaryEnvelope(rawEnvelopes[1]);
    const aave = parseEvidenceSummaryEnvelope(rawEnvelopes[2]);

    expect(buildCommitmentLeaf(uniswap).summaryHash).not.toBe(HASH_A);
    expect(buildCommitmentLeaf(activity).summaryHash).not.toBe(HASH_B);
    expect(buildCommitmentLeaf(aave).summaryHash).not.toBe(HASH_D);
  });
});
