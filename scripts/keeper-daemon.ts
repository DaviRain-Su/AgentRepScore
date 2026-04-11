/**
 * Scheduled daemon that automatically runs keeper submissions
 * for swap, activity, and wallet meta at regular intervals.
 *
 * Usage:
 *   npx tsx scripts/keeper-daemon.ts
 *
 * Environment:
 *   WALLETS                    Comma-separated wallet addresses to process
 *   DAEMON_INTERVAL_MS         Interval in milliseconds (default: 300000 = 5 min)
 *   PRIVATE_KEY                Keeper private key
 *   BASE_MODULE                BaseActivityModule address
 *   UNISWAP_MODULE             UniswapScoreModule address
 *   UNISWAP_POOLS              Comma-separated pool addresses
 *   AAVE_MODULE                AaveScoreModule address
 *   OKX_API_KEY, OKX_API_SECRET, OKX_PASSPHRASE  For OKX keeper
 */
import { spawn } from "node:child_process";
import { type Address } from "viem";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

dotenv.config();

export function parseWallets(env: string): Address[] {
  if (!env) return [];
  return env
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("0x") && s.length === 42) as Address[];
}

export function buildKeeperCommands(
  wallet: Address,
  env: NodeJS.ProcessEnv = process.env
): string[][] {
  const commands: string[][] = [];
  const hasOkx = env.OKX_API_KEY && env.OKX_API_SECRET && env.OKX_PASSPHRASE;
  const hasUniswap = env.UNISWAP_MODULE && env.UNISWAP_POOLS;
  const hasBase = env.BASE_MODULE;
  const hasAave = env.AAVE_MODULE;

  if (hasUniswap) {
    commands.push(["npx", "tsx", "scripts/indexer-uniswap.ts", `--wallet=${wallet}`]);
  }
  if (hasBase) {
    if (hasOkx) {
      commands.push(["npx", "tsx", "scripts/keeper-oklink.ts", `--wallet=${wallet}`]);
    } else {
      commands.push(["npx", "tsx", "scripts/keeper-rpc.ts", `--wallet=${wallet}`]);
    }
  }
  if (hasAave) {
    commands.push(["npx", "tsx", "scripts/keeper-aave.ts", `--wallet=${wallet}`]);
  }

  return commands;
}

export async function runCommand(cmd: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const [file, ...args] = cmd;
    console.log(`[daemon] Running: ${cmd.join(" ")}`);
    const child = spawn(file, args, {
      stdio: "inherit",
      shell: false,
      cwd: process.cwd(),
    });

    child.on("error", (err) => {
      console.error(`[daemon] Failed to start ${cmd.join(" ")}:`, err.message);
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        console.error(`[daemon] Command exited with code ${code}: ${cmd.join(" ")}`);
        reject(new Error(`Command exited with code ${code}`));
      }
    });
  });
}

export async function runRound(wallets: Address[]): Promise<void> {
  for (const wallet of wallets) {
    console.log(`\n[daemon] Processing wallet ${wallet} at ${new Date().toISOString()}`);
    const commands = buildKeeperCommands(wallet);
    for (const cmd of commands) {
      try {
        await runCommand(cmd);
      } catch (err) {
        console.error(`[daemon] Keeper failed for ${wallet}:`, (err as Error).message);
      }
    }
  }
}

async function main() {
  const wallets = parseWallets(process.env.WALLETS || "");
  if (wallets.length === 0) {
    console.error("Error: No wallets configured. Set WALLETS env var.");
    process.exit(1);
  }

  const intervalMs = Number(process.env.DAEMON_INTERVAL_MS || "300000");
  if (Number.isNaN(intervalMs) || intervalMs < 1000) {
    console.error("Error: DAEMON_INTERVAL_MS must be at least 1000");
    process.exit(1);
  }

  console.log(`[daemon] Starting keeper daemon`);
  console.log(`[daemon] Wallets: ${wallets.join(", ")}`);
  console.log(`[daemon] Interval: ${intervalMs}ms (${intervalMs / 60000} minutes)`);

  // Run immediately on start
  await runRound(wallets);

  // Then schedule
  setInterval(() => {
    runRound(wallets).catch((err) => {
      console.error("[daemon] Uncaught round error:", err);
    });
  }, intervalMs);

  // Keep process alive
  console.log("[daemon] Scheduled. Press Ctrl+C to stop.");
}

function isMainModule() {
  if (!import.meta.url.startsWith("file:")) return false;
  const modulePath = realpathSync(fileURLToPath(import.meta.url));
  const argvPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
  return modulePath === argvPath;
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
