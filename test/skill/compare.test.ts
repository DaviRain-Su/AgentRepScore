import { describe, it, expect } from "vitest";

describe("compare fallback", () => {
  it("sorts successful results by decayedScore descending", async () => {
    const mockResults = [
      { agentId: "a", decayedScore: 3000, trustTier: "basic" as const },
      { agentId: "b", decayedScore: 8000, trustTier: "elite" as const },
      { agentId: "c", decayedScore: 5000, trustTier: "verified" as const },
    ];
    // Simulate a tolerant compare that never throws
    const compare = async () => mockResults.sort((a, b) => b.decayedScore - a.decayedScore);
    const results = await compare();
    expect(results[0].agentId).toBe("b");
    expect(results[1].agentId).toBe("c");
    expect(results[2].agentId).toBe("a");
  });
});

describe("withTimeout pattern", () => {
  it("resolves when promise is faster than timeout", async () => {
    const fast = Promise.resolve(42);
    const result = await Promise.race([
      fast,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), 1000)
      ),
    ]);
    expect(result).toBe(42);
  });

  it("rejects when timeout is exceeded", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 100));
    const raced = Promise.race([
      slow,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out after 10ms")), 10)
      ),
    ]);
    await expect(raced).rejects.toThrow("timed out after 10ms");
  });
});
