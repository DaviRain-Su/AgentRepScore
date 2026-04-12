import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import {
  getStatePath,
  loadKeeperState,
  saveKeeperState,
  isAlreadySubmitted,
  recordSubmission,
  submitWithRetry,
  sleep,
} from "../../src/skill/keeper-utils";

const TEST_STATE_PATH = ".keeper-state-test.json";

describe("keeper-utils", () => {
  beforeEach(() => {
    process.env.KEEPER_STATE_PATH = TEST_STATE_PATH;
    if (existsSync(TEST_STATE_PATH)) {
      unlinkSync(TEST_STATE_PATH);
    }
  });

  afterEach(() => {
    if (existsSync(TEST_STATE_PATH)) {
      unlinkSync(TEST_STATE_PATH);
    }
    delete process.env.KEEPER_STATE_PATH;
  });

  it("getStatePath falls back to default", () => {
    delete process.env.KEEPER_STATE_PATH;
    expect(getStatePath()).toBe(".keeper-state.json");
  });

  it("getStatePath respects env var", () => {
    process.env.KEEPER_STATE_PATH = "/tmp/custom.json";
    expect(getStatePath()).toBe("/tmp/custom.json");
  });

  it("loadKeeperState returns default when file missing", () => {
    const state = loadKeeperState();
    expect(state.version).toBe(1);
    expect(Object.keys(state.submissions)).toEqual(["uniswap", "activity"]);
  });

  it("saveKeeperState persists and loadKeeperState reads back", () => {
    const state = loadKeeperState();
    state.submissions.uniswap["0x1111111111111111111111111111111111111111"] = {
      lastSubmittedBlock: "100",
      lastSubmittedAt: "1234567890",
      evidenceHashes: ["0xabc"],
    };
    saveKeeperState(state);
    const loaded = loadKeeperState();
    expect(loaded.submissions.uniswap["0x1111111111111111111111111111111111111111"]).toEqual({
      lastSubmittedBlock: "100",
      lastSubmittedAt: "1234567890",
      evidenceHashes: ["0xabc"],
    });
  });

  it("isAlreadySubmitted returns false for unknown wallet", () => {
    const state = loadKeeperState();
    expect(
      isAlreadySubmitted(state, "uniswap", "0x1111111111111111111111111111111111111111", "0xabc")
    ).toBe(false);
  });

  it("isAlreadySubmitted returns true for known evidence hash", () => {
    const state = loadKeeperState();
    const wallet = "0x1111111111111111111111111111111111111111";
    state.submissions.uniswap[wallet.toLowerCase()] = {
      lastSubmittedBlock: "100",
      lastSubmittedAt: "1234567890",
      evidenceHashes: ["0xabc123"],
    };
    expect(isAlreadySubmitted(state, "uniswap", wallet, "0xabc123")).toBe(true);
    expect(isAlreadySubmitted(state, "uniswap", wallet, "0xdef456")).toBe(false);
  });

  it("recordSubmission creates wallet state if missing", () => {
    const state = loadKeeperState();
    const newState = recordSubmission(
      state,
      "activity",
      "0x2222222222222222222222222222222222222222",
      "0xhash",
      200n
    );
    const ws = newState.submissions.activity["0x2222222222222222222222222222222222222222"];
    expect(ws.lastSubmittedBlock).toBe("200");
    expect(ws.evidenceHashes).toContain("0xhash");
  });

  it("recordSubmission caps evidenceHashes at 100 entries", () => {
    const state = loadKeeperState();
    const wallet = "0x3333333333333333333333333333333333333333";
    state.submissions.uniswap[wallet.toLowerCase()] = {
      lastSubmittedBlock: "1",
      lastSubmittedAt: "1",
      evidenceHashes: Array.from({ length: 100 }, (_, i) => `0x${i}`),
    };
    const newState = recordSubmission(state, "uniswap", wallet, "0xnew", 2n);
    const ws = newState.submissions.uniswap[wallet.toLowerCase()];
    expect(ws.evidenceHashes).toHaveLength(100);
    expect(ws.evidenceHashes[ws.evidenceHashes.length - 1]).toBe("0xnew");
    expect(ws.evidenceHashes[0]).toBe("0x1");
  });

  it("submitWithRetry succeeds on first attempt", async () => {
    let calls = 0;
    const result = await submitWithRetry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("submitWithRetry retries and eventually succeeds", async () => {
    let calls = 0;
    const result = await submitWithRetry(async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("submitWithRetry throws after max retries", async () => {
    let calls = 0;
    await expect(
      submitWithRetry(async () => {
        calls++;
        throw new Error("fail");
      })
    ).rejects.toThrow("fail");
    expect(calls).toBe(3);
  });

  it("submitWithRetry respects custom maxRetries", async () => {
    let calls = 0;
    await expect(
      submitWithRetry(
        async () => {
          calls++;
          throw new Error("fail");
        },
        { maxRetries: 2 }
      )
    ).rejects.toThrow("fail");
    expect(calls).toBe(2);
  });

  it("sleep delays for given ms", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});
