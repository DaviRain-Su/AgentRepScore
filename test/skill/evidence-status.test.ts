import { describe, it, expect, vi } from "vitest";
import { resolveEvidenceStatus } from "../../src/skill/evidence-status.ts";

const WALLET = "0x00000000000000000000000000000000000000aa";
const UNISWAP = "0x00000000000000000000000000000000000000b1";
const ACTIVITY = "0x00000000000000000000000000000000000000b2";

function acceptedCommitmentTuple(options?: {
  accepted?: boolean;
  root?: string;
  leafHash?: string;
  summaryHash?: string;
  epoch?: bigint;
  blockNumber?: bigint;
  proofType?: bigint;
  verifiedAt?: bigint;
}) {
  return [
    options?.accepted ?? true,
    options?.root ?? "0x0000000000000000000000000000000000000000000000000000000000000011",
    options?.leafHash ?? "0x0000000000000000000000000000000000000000000000000000000000000012",
    options?.summaryHash ?? "0x0000000000000000000000000000000000000000000000000000000000000013",
    options?.epoch ?? 10n,
    options?.blockNumber ?? 100n,
    options?.proofType ?? 1n,
    options?.verifiedAt ?? 1000n,
  ];
}

describe("resolveEvidenceStatus", () => {
  it("returns legacy-summary when there are no contributing modules", async () => {
    const reader = { readContract: vi.fn() };
    const status = await resolveEvidenceStatus({
      wallet: WALLET,
      reader,
      modules: [{ name: "UniswapScoreModule", address: UNISWAP, confidence: 0, active: true }],
    });
    expect(status).toEqual({
      verifiedEvidence: false,
      evidenceMode: "legacy-summary",
    });
    expect(reader.readContract).not.toHaveBeenCalled();
  });

  it("returns legacy-summary for pure legacy summaries", async () => {
    const reader = {
      readContract: vi.fn(async () =>
        acceptedCommitmentTuple({
          accepted: false,
          root: "0x0000000000000000000000000000000000000000000000000000000000000000",
          leafHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          summaryHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          epoch: 0n,
          blockNumber: 0n,
          proofType: 0n,
          verifiedAt: 0n,
        })
      ),
    };

    const status = await resolveEvidenceStatus({
      wallet: WALLET,
      reader,
      modules: [
        { name: "UniswapScoreModule", address: UNISWAP, confidence: 100, active: true },
        { name: "BaseActivityModule", address: ACTIVITY, confidence: 100, active: true },
      ],
    });

    expect(status).toEqual({
      verifiedEvidence: false,
      evidenceMode: "legacy-summary",
    });
  });

  it("returns accepted-commitment when all contributing modules are accepted", async () => {
    const reader = {
      readContract: vi.fn(async (params: { functionName: string }) => {
        if (params.functionName === "getAcceptedSwapCommitment") {
          return acceptedCommitmentTuple();
        }
        return acceptedCommitmentTuple({
          root: "0x0000000000000000000000000000000000000000000000000000000000000021",
          leafHash: "0x0000000000000000000000000000000000000000000000000000000000000022",
          summaryHash: "0x0000000000000000000000000000000000000000000000000000000000000023",
          epoch: 11n,
          blockNumber: 101n,
          verifiedAt: 2000n,
        });
      }),
    };

    const status = await resolveEvidenceStatus({
      wallet: WALLET,
      reader,
      modules: [
        { name: "UniswapScoreModule", address: UNISWAP, confidence: 100, active: true },
        { name: "BaseActivityModule", address: ACTIVITY, confidence: 90, active: true },
      ],
    });

    expect(status.verifiedEvidence).toBe(true);
    expect(status.evidenceMode).toBe("accepted-commitment");
    expect(status.proofType).toBe(1);
    expect(status.commitment?.root).toBe("0x0000000000000000000000000000000000000000000000000000000000000021");
    expect(status.commitment?.blockNumber).toBe("101");
  });

  it("returns legacy-summary when any contributing module is not accepted", async () => {
    const reader = {
      readContract: vi.fn(async (params: { functionName: string }) => {
        if (params.functionName === "getAcceptedSwapCommitment") {
          return acceptedCommitmentTuple();
        }
        return acceptedCommitmentTuple({
          accepted: false,
          root: "0x0000000000000000000000000000000000000000000000000000000000000000",
          leafHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          summaryHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          epoch: 0n,
          blockNumber: 0n,
          proofType: 0n,
          verifiedAt: 0n,
        });
      }),
    };

    const status = await resolveEvidenceStatus({
      wallet: WALLET,
      reader,
      modules: [
        { name: "UniswapScoreModule", address: UNISWAP, confidence: 100, active: true },
        { name: "BaseActivityModule", address: ACTIVITY, confidence: 90, active: true },
      ],
    });

    expect(status).toEqual({
      verifiedEvidence: false,
      evidenceMode: "legacy-summary",
    });
  });

  it("falls back to legacy-summary when accepted commitment binding is invalid", async () => {
    const reader = {
      readContract: vi.fn(async () =>
        acceptedCommitmentTuple({
          summaryHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        })
      ),
    };

    const status = await resolveEvidenceStatus({
      wallet: WALLET,
      reader,
      modules: [{ name: "UniswapScoreModule", address: UNISWAP, confidence: 100, active: true }],
    });

    expect(status).toEqual({
      verifiedEvidence: false,
      evidenceMode: "legacy-summary",
    });
  });

  it("falls back to legacy-summary when accepted getter reverts", async () => {
    const reader = {
      readContract: vi.fn(async () => {
        throw new Error("reverted");
      }),
    };

    const status = await resolveEvidenceStatus({
      wallet: WALLET,
      reader,
      modules: [{ name: "UniswapScoreModule", address: UNISWAP, confidence: 100, active: true }],
    });

    expect(status).toEqual({
      verifiedEvidence: false,
      evidenceMode: "legacy-summary",
    });
  });

  it("ignores contributing-disabled modules with confidence=0 in migration edge cases", async () => {
    const reader = {
      readContract: vi.fn(async (params: { functionName: string }) => {
        if (params.functionName === "getAcceptedSwapCommitment") {
          return acceptedCommitmentTuple();
        }
        return acceptedCommitmentTuple({
          accepted: false,
          root: "0x0000000000000000000000000000000000000000000000000000000000000000",
          leafHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          summaryHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          epoch: 0n,
          blockNumber: 0n,
          proofType: 0n,
          verifiedAt: 0n,
        });
      }),
    };

    const status = await resolveEvidenceStatus({
      wallet: WALLET,
      reader,
      modules: [
        { name: "UniswapScoreModule", address: UNISWAP, confidence: 100, active: true },
        { name: "BaseActivityModule", address: ACTIVITY, confidence: 0, active: true },
      ],
    });

    expect(status.verifiedEvidence).toBe(true);
    expect(status.evidenceMode).toBe("accepted-commitment");
  });

  it("tracks migration lifecycle from legacy to verified and back to fallback", async () => {
    let stage: "legacy" | "verified" | "fallback" = "legacy";
    const reader = {
      readContract: vi.fn(async () => {
        if (stage === "legacy") {
          return acceptedCommitmentTuple({
            accepted: false,
            root: "0x0000000000000000000000000000000000000000000000000000000000000000",
            leafHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
            summaryHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
            epoch: 0n,
            blockNumber: 0n,
            proofType: 0n,
            verifiedAt: 0n,
          });
        }
        if (stage === "verified") {
          return acceptedCommitmentTuple();
        }
        return acceptedCommitmentTuple({
          summaryHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        });
      }),
    };

    const modules: { name: string; address: `0x${string}`; confidence: number; active: boolean }[] = [
      { name: "UniswapScoreModule", address: UNISWAP, confidence: 100, active: true },
    ];

    const legacyStatus = await resolveEvidenceStatus({ wallet: WALLET, reader, modules });
    expect(legacyStatus).toEqual({
      verifiedEvidence: false,
      evidenceMode: "legacy-summary",
    });

    stage = "verified";
    const verifiedStatus = await resolveEvidenceStatus({ wallet: WALLET, reader, modules });
    expect(verifiedStatus.verifiedEvidence).toBe(true);
    expect(verifiedStatus.evidenceMode).toBe("accepted-commitment");

    stage = "fallback";
    const fallbackStatus = await resolveEvidenceStatus({ wallet: WALLET, reader, modules });
    expect(fallbackStatus).toEqual({
      verifiedEvidence: false,
      evidenceMode: "legacy-summary",
    });
  });
});
