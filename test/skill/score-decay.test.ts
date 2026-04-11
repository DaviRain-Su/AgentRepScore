import { describe, it, expect } from "vitest";
import { applyDecay, trustTier } from "../../src/utils/score-decay.ts";

describe("applyDecay", () => {
  it("returns the same score when evaluated now", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(applyDecay(5000, nowSec)).toBe(5000);
  });

  it("decays by 2% per day", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const tenDaysAgo = nowSec - 10 * 86400;
    // 5000 * (1 - 0.2) = 4000
    expect(applyDecay(5000, tenDaysAgo)).toBe(4000);
  });

  it("floors at 10% after 45 days", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const fiftyDaysAgo = nowSec - 50 * 86400;
    // 5000 * 0.1 = 500
    expect(applyDecay(5000, fiftyDaysAgo)).toBe(500);
  });

  it("handles negative scores correctly", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const tenDaysAgo = nowSec - 10 * 86400;
    expect(applyDecay(-5000, tenDaysAgo)).toBe(-4000);
  });
});

describe("trustTier", () => {
  it("classifies untrusted", () => {
    expect(trustTier(-1000)).toBe("untrusted");
    expect(trustTier(0)).toBe("untrusted");
    expect(trustTier(2000)).toBe("untrusted");
  });

  it("classifies basic", () => {
    expect(trustTier(2001)).toBe("basic");
    expect(trustTier(5000)).toBe("basic");
  });

  it("classifies verified", () => {
    expect(trustTier(5001)).toBe("verified");
    expect(trustTier(8000)).toBe("verified");
  });

  it("classifies elite", () => {
    expect(trustTier(8001)).toBe("elite");
    expect(trustTier(10000)).toBe("elite");
  });
});
