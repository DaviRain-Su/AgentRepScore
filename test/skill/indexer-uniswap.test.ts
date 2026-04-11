import { describe, it, expect } from "vitest";
import {
  buildSwapSummary,
  parsePools,
  type SwapEvent,
} from "../../scripts/indexer-uniswap";

const wallet = "0x1234567890123456789012345678901234567890" as const;

function makeEvent(
  overrides: Partial<SwapEvent> & { sender?: string; recipient?: string }
): SwapEvent {
  return {
    sender: (overrides.sender ?? wallet) as `0x${string}`,
    recipient: (overrides.recipient ?? "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") as `0x${string}`,
    amount0: 1000n,
    amount1: -900n,
    sqrtPriceX96: 2n ** 96n,
    liquidity: 1000000n,
    tick: 0,
    blockNumber: 100n,
    transactionHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    ...overrides,
  };
}

describe("indexer-uniswap", () => {
  it("parsePools splits comma-separated addresses", () => {
    const pools = parsePools(
      "0x1111111111111111111111111111111111111111, 0x2222222222222222222222222222222222222222"
    );
    expect(pools).toHaveLength(2);
    expect(pools[0]).toBe("0x1111111111111111111111111111111111111111");
    expect(pools[1]).toBe("0x2222222222222222222222222222222222222222");
  });

  it("parsePools filters invalid addresses", () => {
    const pools = parsePools("0xBAD, 0x1111111111111111111111111111111111111111");
    expect(pools).toHaveLength(1);
    expect(pools[0]).toBe("0x1111111111111111111111111111111111111111");
  });

  it("buildSwapSummary returns zeroes when no events match wallet", () => {
    const events: SwapEvent[] = [
      makeEvent({ sender: "0x9999999999999999999999999999999999999999" }),
    ];
    const summary = buildSwapSummary(wallet, events, {});
    expect(summary.swapCount).toBe(0n);
    expect(summary.volumeUSD).toBe(0n);
    expect(summary.netPnL).toBe(0n);
    expect(summary.avgSlippageBps).toBe(0n);
    expect(summary.washTradeFlag).toBe(false);
  });

  it("buildSwapSummary aggregates matching events", () => {
    const events: SwapEvent[] = [
      makeEvent({ amount0: 1000n, amount1: -900n }),
      makeEvent({
        amount0: 2000n,
        amount1: -1800n,
        transactionHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
      }),
    ];
    const summary = buildSwapSummary(wallet, events, {});
    expect(summary.swapCount).toBe(2n);
    // volumeUSD = sum(abs(amount0)+abs(amount1))
    expect(summary.volumeUSD).toBe(
      (1000n + 900n) + (2000n + 1800n)
    );
    // netPnL = sum(abs(amount1)-abs(amount0))
    expect(summary.netPnL).toBe(
      (900n - 1000n) + (1800n - 2000n)
    );
    expect(summary.washTradeFlag).toBe(false);
    expect(summary.evidenceHash.startsWith("0x")).toBe(true);
  });

  it("buildSwapSummary computes slippage when reference price is provided", () => {
    const events: SwapEvent[] = [
      makeEvent({
        sender: wallet,
        sqrtPriceX96: 2n ** 96n, // price = 1e18
      }),
    ];
    const refPrices: Record<string, bigint> = {
      [events[0].transactionHash]: 12n * 10n ** 17n, // 1.2e18 (20% higher than exec)
    };
    const summary = buildSwapSummary(wallet, events, refPrices);
    expect(summary.swapCount).toBe(1n);
    expect(summary.avgSlippageBps).toBe(1666n); // 16.66% = 1666 bps
  });

  it("buildSwapSummary includes sender matches", () => {
    const events: SwapEvent[] = [
      makeEvent({ sender: wallet, recipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    ];
    const summary = buildSwapSummary(wallet, events, {});
    expect(summary.swapCount).toBe(1n);
  });

  it("buildSwapSummary includes recipient matches", () => {
    const events: SwapEvent[] = [
      makeEvent({ sender: "0xcccccccccccccccccccccccccccccccccccccccc", recipient: wallet }),
    ];
    const summary = buildSwapSummary(wallet, events, {});
    expect(summary.swapCount).toBe(1n);
  });
});
