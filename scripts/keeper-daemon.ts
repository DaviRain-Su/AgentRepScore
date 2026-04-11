/**
 * Keeper daemon — thin wrapper around `src/skill/keepers/runner.ts`.
 *
 * Prefer using the CLI: `rep keeper start`
 *
 * Usage:
 *   npx tsx scripts/keeper-daemon.ts
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { loadConfigFromEnv, startDaemon, parseWallets } from "../src/skill/keepers/runner.ts";
import { logger } from "../src/skill/logger.ts";

dotenv.config();

export { parseWallets } from "../src/skill/keepers/runner.ts";

export function buildKeeperCommands(
  wallet: string,
  env: NodeJS.ProcessEnv = process.env
): string[][] {
  const commands: string[][] = [];
  const hasOkx = env.OKX_API_KEY && env.OKX_API_SECRET && env.OKX_PASSPHRASE;
  const hasUniswap = env.UNISWAP_MODULE && env.UNISWAP_POOLS;
  const hasBase = env.BASE_MODULE;
  if (hasUniswap) commands.push(["npx", "tsx", "scripts/indexer-uniswap.ts", `--wallet=${wallet}`]);
  if (hasBase) {
    if (hasOkx) commands.push(["npx", "tsx", "scripts/keeper-oklink.ts", `--wallet=${wallet}`]);
    else commands.push(["npx", "tsx", "scripts/keeper-rpc.ts", `--wallet=${wallet}`]);
  }
  return commands;
}

function isMainModule() {
  if (!import.meta.url.startsWith("file:")) return false;
  const modulePath = realpathSync(fileURLToPath(import.meta.url));
  const argvPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
  return modulePath === argvPath;
}

if (isMainModule()) {
  const cfg = loadConfigFromEnv();
  startDaemon(cfg).catch((err) => {
    logger.error("[daemon] Fatal error", { err });
    process.exit(1);
  });
}
