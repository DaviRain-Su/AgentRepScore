import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Address } from "viem";
import { logger } from "./logger.ts";

export type KeeperModule = "uniswap" | "activity";

export interface WalletSubmissionState {
  lastSubmittedBlock: string;
  lastSubmittedAt: string;
  evidenceHashes: string[];
}

export interface KeeperState {
  version: number;
  submissions: Record<KeeperModule, Record<string, WalletSubmissionState>>;
}

const DEFAULT_STATE: KeeperState = {
  version: 1,
  submissions: {
    uniswap: {},
    activity: {},
  },
};

export function getStatePath(): string {
  return process.env.KEEPER_STATE_PATH || ".keeper-state.json";
}

export function loadKeeperState(): KeeperState {
  const path = getStatePath();
  if (!existsSync(path)) {
    return structuredClone(DEFAULT_STATE);
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<KeeperState>;
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      submissions: {
        ...structuredClone(DEFAULT_STATE).submissions,
        ...parsed.submissions,
      },
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveKeeperState(state: KeeperState): void {
  const path = getStatePath();
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function isAlreadySubmitted(
  state: KeeperState,
  module: KeeperModule,
  wallet: Address,
  evidenceHash: string
): boolean {
  const walletState = state.submissions[module][wallet.toLowerCase()];
  if (!walletState) return false;
  return walletState.evidenceHashes.includes(evidenceHash.toLowerCase());
}

export function recordSubmission(
  state: KeeperState,
  module: KeeperModule,
  wallet: Address,
  evidenceHash: string,
  blockNumber: bigint
): KeeperState {
  const key = wallet.toLowerCase();
  if (!state.submissions[module][key]) {
    state.submissions[module][key] = {
      lastSubmittedBlock: blockNumber.toString(),
      lastSubmittedAt: Math.floor(Date.now() / 1000).toString(),
      evidenceHashes: [],
    };
  }
  const ws = state.submissions[module][key];
  ws.lastSubmittedBlock = blockNumber.toString();
  ws.lastSubmittedAt = Math.floor(Date.now() / 1000).toString();
  const eh = evidenceHash.toLowerCase();
  if (!ws.evidenceHashes.includes(eh)) {
    ws.evidenceHashes.push(eh);
    // Keep only last 100 to prevent unbounded growth
    if (ws.evidenceHashes.length > 100) {
      ws.evidenceHashes = ws.evidenceHashes.slice(-100);
    }
  }
  return state;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function submitWithRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; label?: string } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const label = options.label ?? "submit";

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;
      const delayMs = 1000 * 2 ** (attempt - 1);
      logger.warn(`[${label}] Attempt ${attempt}/${maxRetries} failed, retrying in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

// ------------------------------------------------------------------
// Keeper health tracking
// ------------------------------------------------------------------

export interface KeeperHealth {
  lastSuccessBlock: string;
  lastSuccessTimestamp: string;
  lastRunTimestamp: string;
  consecutiveFailures: number;
}

const DEFAULT_HEALTH: KeeperHealth = {
  lastSuccessBlock: "0",
  lastSuccessTimestamp: "",
  lastRunTimestamp: "",
  consecutiveFailures: 0,
};

export function getHealthPath(): string {
  return process.env.KEEPER_HEALTH_PATH || "keeper-health.json";
}

export function loadKeeperHealth(): KeeperHealth {
  const path = getHealthPath();
  if (!existsSync(path)) {
    return structuredClone(DEFAULT_HEALTH);
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<KeeperHealth>;
    return { ...structuredClone(DEFAULT_HEALTH), ...parsed };
  } catch {
    return structuredClone(DEFAULT_HEALTH);
  }
}

export function saveKeeperHealth(health: KeeperHealth): void {
  const path = getHealthPath();
  writeFileSync(path, JSON.stringify(health, null, 2));
}

export function getMaxSubmittedBlock(state: KeeperState): bigint {
  let maxBlock = 0n;
  for (const module of Object.values(state.submissions)) {
    for (const walletState of Object.values(module)) {
      const block = BigInt(walletState.lastSubmittedBlock || "0");
      if (block > maxBlock) maxBlock = block;
    }
  }
  return maxBlock;
}

export function updateKeeperHealth(success: boolean): KeeperHealth {
  const health = loadKeeperHealth();
  const now = new Date().toISOString();
  health.lastRunTimestamp = now;

  if (success) {
    const state = loadKeeperState();
    const maxBlock = getMaxSubmittedBlock(state);
    health.lastSuccessBlock = maxBlock.toString();
    health.lastSuccessTimestamp = now;
    health.consecutiveFailures = 0;
  } else {
    health.consecutiveFailures += 1;
  }

  saveKeeperHealth(health);
  return health;
}
