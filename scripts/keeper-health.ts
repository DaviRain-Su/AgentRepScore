/**
 * Keeper health check CLI.
 *
 * Reads the keeper health file and exits 0 (healthy) or 1 (unhealthy).
 *
 * Usage:
 *   npx tsx scripts/keeper-health.ts
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadKeeperHealth } from "../src/skill/keeper-utils.ts";

function isMainModule() {
  if (!import.meta.url.startsWith("file:")) return false;
  const modulePath = realpathSync(fileURLToPath(import.meta.url));
  const argvPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
  return modulePath === argvPath;
}

async function main() {
  const health = loadKeeperHealth();

  if (health.consecutiveFailures >= 3 || !health.lastSuccessTimestamp) {
    // eslint-disable-next-line no-console
    console.error(
      `UNHEALTHY: consecutiveFailures=${health.consecutiveFailures}, lastSuccess=${health.lastSuccessTimestamp || "never"}`
    );
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(
    `HEALTHY: lastSuccess=${health.lastSuccessTimestamp}, lastSuccessBlock=${health.lastSuccessBlock}, consecutiveFailures=${health.consecutiveFailures}`
  );
  process.exit(0);
}

if (isMainModule()) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
