import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Address } from "viem";
import { logger } from "./logger.ts";

export type KeeperModule = "uniswap" | "activity" | "aave";

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
    aave: {},
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
