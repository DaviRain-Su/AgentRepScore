import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import {
  loadKeeperHealth,
  saveKeeperHealth,
  updateKeeperHealth,
  getMaxSubmittedBlock,
  type KeeperState,
} from "../../src/skill/keeper-utils";

const TEST_HEALTH_PATH = ".test-keeper-health.json";
const TEST_STATE_PATH = ".test-keeper-state.json";

describe("keeper health", () => {
  beforeEach(() => {
    process.env.KEEPER_HEALTH_PATH = TEST_HEALTH_PATH;
    process.env.KEEPER_STATE_PATH = TEST_STATE_PATH;
    if (existsSync(TEST_HEALTH_PATH)) unlinkSync(TEST_HEALTH_PATH);
    if (existsSync(TEST_STATE_PATH)) unlinkSync(TEST_STATE_PATH);
  });

  afterEach(() => {
    delete process.env.KEEPER_HEALTH_PATH;
    delete process.env.KEEPER_STATE_PATH;
    if (existsSync(TEST_HEALTH_PATH)) unlinkSync(TEST_HEALTH_PATH);
    if (existsSync(TEST_STATE_PATH)) unlinkSync(TEST_STATE_PATH);
  });

  it("returns default health when file is missing", () => {
    const health = loadKeeperHealth();
    expect(health.lastSuccessBlock).toBe("0");
    expect(health.lastSuccessTimestamp).toBe("");
    expect(health.lastRunTimestamp).toBe("");
    expect(health.consecutiveFailures).toBe(0);
  });

  it("roundtrips health via save and load", () => {
    const health = {
      lastSuccessBlock: "12345",
      lastSuccessTimestamp: "2024-01-01T00:00:00.000Z",
      lastRunTimestamp: "2024-01-01T00:05:00.000Z",
      consecutiveFailures: 2,
    };
    saveKeeperHealth(health);
    const loaded = loadKeeperHealth();
    expect(loaded).toEqual(health);
  });

  it("getMaxSubmittedBlock returns 0 for empty state", () => {
    const state: KeeperState = {
      version: 1,
      submissions: { uniswap: {}, activity: {} },
    };
    expect(getMaxSubmittedBlock(state)).toBe(0n);
  });

  it("getMaxSubmittedBlock returns highest block across modules", () => {
    const state: KeeperState = {
      version: 1,
      submissions: {
        uniswap: {
          "0x1111": {
            lastSubmittedBlock: "100",
            lastSubmittedAt: "1",
            evidenceHashes: [],
          },
        },
        activity: {
          "0x2222": {
            lastSubmittedBlock: "500",
            lastSubmittedAt: "2",
            evidenceHashes: [],
          },
        },
      },
    };
    expect(getMaxSubmittedBlock(state)).toBe(500n);
  });

  it("updateKeeperHealth on success resets failures and updates timestamps", () => {
    // seed state so max block > 0
    const state: KeeperState = {
      version: 1,
      submissions: {
        uniswap: {
          "0x1111": {
            lastSubmittedBlock: "42",
            lastSubmittedAt: "1",
            evidenceHashes: [],
          },
        },
        activity: {},
      },
    };
    writeFileSync(TEST_STATE_PATH, JSON.stringify(state));

    const health = updateKeeperHealth(true);
    expect(health.consecutiveFailures).toBe(0);
    expect(health.lastSuccessBlock).toBe("42");
    expect(health.lastSuccessTimestamp).not.toBe("");
    expect(health.lastRunTimestamp).not.toBe("");

    const loaded = loadKeeperHealth();
    expect(loaded.consecutiveFailures).toBe(0);
  });

  it("updateKeeperHealth on failure increments consecutiveFailures", () => {
    updateKeeperHealth(false);
    updateKeeperHealth(false);
    const health = updateKeeperHealth(false);
    expect(health.consecutiveFailures).toBe(3);
  });

  it("preserves partial health fields when loading malformed json", () => {
    writeFileSync(TEST_HEALTH_PATH, "not json");
    const health = loadKeeperHealth();
    expect(health.consecutiveFailures).toBe(0);
    expect(health.lastSuccessBlock).toBe("0");
  });
});
