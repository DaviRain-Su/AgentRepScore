import { describe, it, expect } from "vitest";
import { computeScore, type ModuleInput } from "../../src/skill/commands/simulate";

describe("simulate", () => {
  it("computes weighted average score from modules", () => {
    const modules: ModuleInput[] = [
      { name: "UniswapScoreModule", score: 8000, confidence: 100, weight: 6000 },
      { name: "BaseActivityModule", score: 5000, confidence: 100, weight: 4000 },
    ];
    const result = computeScore(modules);
    // (8000*6000 + 5000*4000) / (6000+4000) = 68000000/10000 = 6800
    expect(result.rawScore).toBe(6800);
    expect(result.trustTier).toBe("verified");
    expect(result.totalWeight).toBe(10000);
    expect(result.moduleBreakdown).toHaveLength(2);
  });

  it("applies confidence to effective weight", () => {
    const modules: ModuleInput[] = [
      { name: "Mod1", score: 9000, confidence: 50, weight: 5000 },
      { name: "Mod2", score: 3000, confidence: 100, weight: 5000 },
    ];
    const result = computeScore(modules);
    // effective weights: 2500, 5000
    // (9000*2500 + 3000*5000) / 7500 = 37500000/7500 = 5000
    expect(result.rawScore).toBe(5000);
    expect(result.moduleBreakdown[0].effectiveWeight).toBe(2500);
    expect(result.moduleBreakdown[1].effectiveWeight).toBe(5000);
  });

  it("uses runtime effective base weight when provided", () => {
    const modules: ModuleInput[] = [
      { name: "Degraded", score: 9000, confidence: 100, weight: 6000, effectiveBaseWeight: 4000 },
      { name: "Healthy", score: 3000, confidence: 100, weight: 4000, effectiveBaseWeight: 4000 },
    ];
    const result = computeScore(modules);
    // (9000*4000 + 3000*4000) / 8000 = 6000
    expect(result.rawScore).toBe(6000);
    expect(result.moduleBreakdown[0].effectiveBaseWeight).toBe(4000);
    expect(result.totalWeight).toBe(8000);
  });

  it("returns zero for empty modules", () => {
    const result = computeScore([]);
    expect(result.rawScore).toBe(0);
    expect(result.trustTier).toBe("untrusted");
    expect(result.totalWeight).toBe(0);
  });

  it("skips modules with zero confidence", () => {
    const modules: ModuleInput[] = [
      { name: "Active", score: 7000, confidence: 100, weight: 5000 },
      { name: "Stale", score: 0, confidence: 0, weight: 5000 },
    ];
    const result = computeScore(modules);
    expect(result.rawScore).toBe(7000);
    expect(result.totalWeight).toBe(5000);
  });

  it("clamps score to MAX_SCORE", () => {
    const modules: ModuleInput[] = [
      { name: "Super", score: 10000, confidence: 100, weight: 10000 },
    ];
    const result = computeScore(modules);
    expect(result.rawScore).toBe(10000);
    expect(result.trustTier).toBe("elite");
  });

  it("clamps score to MIN_SCORE", () => {
    const modules: ModuleInput[] = [
      { name: "Terrible", score: -10000, confidence: 100, weight: 10000 },
    ];
    const result = computeScore(modules);
    expect(result.rawScore).toBe(-10000);
    expect(result.trustTier).toBe("untrusted");
  });

  it("shows impact of weight changes", () => {
    const base: ModuleInput[] = [
      { name: "Uniswap", score: 9000, confidence: 100, weight: 4000 },
      { name: "Activity", score: 3000, confidence: 100, weight: 6000 },
    ];
    const original = computeScore(base);

    const reweighted: ModuleInput[] = [
      { name: "Uniswap", score: 9000, confidence: 100, weight: 8000 },
      { name: "Activity", score: 3000, confidence: 100, weight: 2000 },
    ];
    const adjusted = computeScore(reweighted);

    // Original: (9000*4000 + 3000*6000)/10000 = 5400
    expect(original.rawScore).toBe(5400);
    // Reweighted: (9000*8000 + 3000*2000)/10000 = 7800
    expect(adjusted.rawScore).toBe(7800);
    expect(adjusted.rawScore).toBeGreaterThan(original.rawScore);
  });

  it("module breakdown includes contribution", () => {
    const modules: ModuleInput[] = [
      { name: "A", score: 8000, confidence: 100, weight: 5000 },
      { name: "B", score: 4000, confidence: 100, weight: 5000 },
    ];
    const result = computeScore(modules);
    expect(result.moduleBreakdown[0].contribution).toBe(8000 * 5000);
    expect(result.moduleBreakdown[1].contribution).toBe(4000 * 5000);
  });
});
