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
    });
    mockQuery.mockResolvedValueOnce({
      agentId: "b",
      decayedScore: 8000,
      trustTier: "elite",
    });
    mockQuery.mockResolvedValueOnce({
      agentId: "c",
      decayedScore: 5000,
      trustTier: "verified",
    });

    const results = await compare({ agentIds: ["a", "b", "c"] });
    expect(results[0].agentId).toBe("b");
    expect(results[1].agentId).toBe("c");
    expect(results[2].agentId).toBe("a");
  });

  it("handles partial failures without throwing", async () => {
    mockQuery.mockResolvedValueOnce({
      agentId: "ok",
      decayedScore: 7000,
      trustTier: "verified",
    });
    mockQuery.mockRejectedValueOnce(new Error("network error"));

    const results = await compare({ agentIds: ["ok", "bad"] });
    expect(results[0].agentId).toBe("ok");
    expect(results[0].decayedScore).toBe(7000);
    expect(results[1].agentId).toBe("bad");
    expect(results[1].decayedScore).toBe(-Infinity);
    expect(results[1].trustTier).toBe("untrusted");
    expect(results[1].error).toBe("network error");
  });

  it("handles all failures gracefully", async () => {
    mockQuery.mockRejectedValueOnce(new Error("fail1"));
    mockQuery.mockRejectedValueOnce(new Error("fail2"));

    const results = await compare({ agentIds: ["a", "b"] });
    expect(results.every((r) => r.decayedScore === -Infinity)).toBe(true);
    expect(results.every((r) => r.trustTier === "untrusted")).toBe(true);
  });
});
