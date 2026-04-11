import { describe, it, expect } from "vitest";
import { detectFundingClusters, type TxRecord } from "../../src/skill/sybil-detector";

describe("detectFundingClusters", () => {
  it("returns empty set when no transactions", () => {
    const wallets = ["0xA", "0xB", "0xC"];
    const result = detectFundingClusters(wallets, []);
    expect(result.size).toBe(0);
  });

  it("returns empty set when no shared funding source", () => {
    const wallets = ["0xA", "0xB", "0xC"];
    const txs: TxRecord[] = [
      { from: "0xF1", to: "0xA", timestamp: 100 },
      { from: "0xF2", to: "0xB", timestamp: 100 },
      { from: "0xF3", to: "0xC", timestamp: 100 },
    ];
    const result = detectFundingClusters(wallets, txs);
    expect(result.size).toBe(0);
  });

  it("flags wallets when three share the same earliest funder", () => {
    const wallets = ["0xA", "0xB", "0xC"];
    const txs: TxRecord[] = [
      { from: "0xF1", to: "0xA", timestamp: 100 },
      { from: "0xF1", to: "0xB", timestamp: 200 },
      { from: "0xF1", to: "0xC", timestamp: 300 },
    ];
    const result = detectFundingClusters(wallets, txs);
    expect(result.size).toBe(3);
    expect(result.has("0xa")).toBe(true);
    expect(result.has("0xb")).toBe(true);
    expect(result.has("0xc")).toBe(true);
  });

  it("uses earliest incoming tx per wallet", () => {
    const wallets = ["0xA", "0xB", "0xC"];
    const txs: TxRecord[] = [
      { from: "0xF1", to: "0xA", timestamp: 500 },
      { from: "0xF2", to: "0xA", timestamp: 100 }, // earliest for A is F2
      { from: "0xF1", to: "0xB", timestamp: 200 },
      { from: "0xF1", to: "0xC", timestamp: 300 },
    ];
    const result = detectFundingClusters(wallets, txs);
    // F1 funds B,C (only 2); F2 funds A (only 1) → no cluster >= 3
    expect(result.size).toBe(0);
    expect(result.has("0xa")).toBe(false);
    expect(result.has("0xb")).toBe(false);
    expect(result.has("0xc")).toBe(false);
  });

  it("ignores transactions to wallets not in the batch", () => {
    const wallets = ["0xA", "0xB"];
    const txs: TxRecord[] = [
      { from: "0xF1", to: "0xA", timestamp: 100 },
      { from: "0xF1", to: "0xB", timestamp: 200 },
      { from: "0xF1", to: "0xC", timestamp: 300 }, // C not in batch
    ];
    const result = detectFundingClusters(wallets, txs);
    expect(result.size).toBe(0);
  });

  it("flags only when >= 3 wallets share a funder", () => {
    const wallets = ["0xA", "0xB", "0xC", "0xD"];
    const txs: TxRecord[] = [
      { from: "0xF1", to: "0xA", timestamp: 100 },
      { from: "0xF1", to: "0xB", timestamp: 200 },
      { from: "0xF2", to: "0xC", timestamp: 300 },
      { from: "0xF2", to: "0xD", timestamp: 400 },
    ];
    const result = detectFundingClusters(wallets, txs);
    expect(result.size).toBe(0);
  });

  it("is case-insensitive for addresses", () => {
    const wallets = ["0xA", "0xB", "0xC"];
    const txs: TxRecord[] = [
      { from: "0xF1", to: "0xa", timestamp: 100 },
      { from: "0xf1", to: "0xB", timestamp: 200 },
      { from: "0xF1", to: "0xc", timestamp: 300 },
    ];
    const result = detectFundingClusters(wallets, txs);
    expect(result.size).toBe(3);
  });
});
