import { describe, it, expect, vi } from "vitest";
import { compare } from "../../src/skill/commands/compare";

const mockQuery = vi.fn();

vi.mock("../../src/skill/commands/query", () => ({
  query: (...args: any[]) => mockQuery(...args),
}));

describe("compare", () => {
  it("sorts successful results by decayedScore descending", async () => {
    mockQuery.mockResolvedValueOnce({
      agentId: "a",
      decayedScore: 3000,
      trustTier: "basic",
      verifiedEvidence: false,
      evidenceMode: "legacy-summary",
      correlation: { penalty: 100, ruleCount: 1, evidenceHash: "0x01", timestamp: 1 },
    });
    mockQuery.mockResolvedValueOnce({
      agentId: "b",
      decayedScore: 8000,
      trustTier: "elite",
      verifiedEvidence: true,
      evidenceMode: "accepted-commitment",
      correlation: { penalty: 0, ruleCount: 0, evidenceHash: "0x00", timestamp: 1 },
    });
    mockQuery.mockResolvedValueOnce({
      agentId: "c",
      decayedScore: 5000,
      trustTier: "verified",
      verifiedEvidence: false,
      evidenceMode: "legacy-summary",
      correlation: { penalty: 500, ruleCount: 1, evidenceHash: "0x02", timestamp: 1 },
    });

    const results = await compare({ agentIds: ["a", "b", "c"] });
    expect(results[0].agentId).toBe("b");
    expect(results[0].correlationPenalty).toBe(0);
    expect(results[0].verifiedEvidence).toBe(true);
    expect(results[0].evidenceMode).toBe("accepted-commitment");
    expect(results[1].agentId).toBe("c");
    expect(results[1].correlationPenalty).toBe(500);
    expect(results[1].verifiedEvidence).toBe(false);
    expect(results[1].evidenceMode).toBe("legacy-summary");
    expect(results[2].agentId).toBe("a");
    expect(results[2].correlationPenalty).toBe(100);
    expect(results[2].verifiedEvidence).toBe(false);
    expect(results[2].evidenceMode).toBe("legacy-summary");
  });

  it("handles partial failures without throwing", async () => {
    mockQuery.mockResolvedValueOnce({
      agentId: "ok",
      decayedScore: 7000,
      trustTier: "verified",
      verifiedEvidence: true,
      evidenceMode: "accepted-commitment",
      correlation: { penalty: 300, ruleCount: 1, evidenceHash: "0x03", timestamp: 1 },
    });
    mockQuery.mockRejectedValueOnce(new Error("network error"));

    const results = await compare({ agentIds: ["ok", "bad"] });
    expect(results[0].agentId).toBe("ok");
    expect(results[0].decayedScore).toBe(7000);
    expect(results[0].correlationPenalty).toBe(300);
    expect(results[0].verifiedEvidence).toBe(true);
    expect(results[1].agentId).toBe("bad");
    expect(results[1].decayedScore).toBe(-Infinity);
    expect(results[1].trustTier).toBe("untrusted");
    expect(results[1].correlationPenalty).toBe(0);
    expect(results[1].verifiedEvidence).toBe(false);
    expect(results[1].evidenceMode).toBe("legacy-summary");
    expect(results[1].error).toBe("network error");
  });

  it("handles all failures gracefully", async () => {
    mockQuery.mockRejectedValueOnce(new Error("fail1"));
    mockQuery.mockRejectedValueOnce(new Error("fail2"));

    const results = await compare({ agentIds: ["a", "b"] });
    expect(results.every((r) => r.decayedScore === -Infinity)).toBe(true);
    expect(results.every((r) => r.trustTier === "untrusted")).toBe(true);
    expect(results.every((r) => r.verifiedEvidence === false)).toBe(true);
    expect(results.every((r) => r.evidenceMode === "legacy-summary")).toBe(true);
  });
});
