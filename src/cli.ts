import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { register, evaluate, query, compare, modules } from "./skill/index.ts";
import { loadKeeperHealth } from "./skill/keeper-utils.ts";
import { loadConfigFromEnv, runOnce, startDaemon } from "./skill/keepers/runner.ts";
import { logger } from "./skill/logger.ts";

export const program = new Command();

program.name("rep").description("AgentRepScore CLI").version("1.0.0");

program
  .command("register <uri>")
  .description("Register a new agent and set its wallet")
  .requiredOption("-w, --wallet <address>", "Agent wallet address")
  .action(async (uri: string, options: { wallet: string }) => {
    const result = await register({
      uri,
      wallet: options.wallet as `0x${string}`,
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("evaluate <agentId>")
  .description("Evaluate an agent and return its score")
  .action(async (agentId: string) => {
    const result = await evaluate({ agentId });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("query <agentId>")
  .description("Query the latest score for an agent")
  .action(async (agentId: string) => {
    const result = await query({ agentId });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("compare <agentIds...>")
  .description("Compare scores across multiple agents")
  .action(async (agentIds: string[]) => {
    const result = await compare({ agentIds });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("modules")
  .description("List all validator modules")
  .action(async () => {
    const result = await modules();
    console.log(JSON.stringify(result, null, 2));
  });

const keeper = program
  .command("keeper")
  .description("Keeper service commands");

keeper
  .command("start")
  .description("Start the keeper daemon (runs continuously)")
  .action(async () => {
    const cfg = loadConfigFromEnv();
    await startDaemon(cfg);
  });

keeper
  .command("run-once")
  .description("Run a single keeper round and exit")
  .action(async () => {
    const cfg = loadConfigFromEnv();
    const success = await runOnce(cfg);
    console.log(JSON.stringify({ success }, null, 2));
    if (!success) process.exitCode = 1;
  });

keeper
  .command("health")
  .description("Show keeper service health status")
  .option("-t, --threshold <number>", "Alert threshold for consecutive failures", "3")
  .action(async (options: { threshold: string }) => {
    const health = loadKeeperHealth();
    const threshold = Number(options.threshold);
    const healthy = health.consecutiveFailures < threshold;
    console.log(
      JSON.stringify(
        {
          healthy,
          lastSuccessBlock: health.lastSuccessBlock,
          lastSuccessTimestamp: health.lastSuccessTimestamp,
          lastRunTimestamp: health.lastRunTimestamp,
          consecutiveFailures: health.consecutiveFailures,
          alertThreshold: threshold,
        },
        null,
        2
      )
    );
    if (!healthy) process.exitCode = 1;
  });

function isMainModule() {
  if (!import.meta.url.startsWith("file:")) return false;
  const modulePath = realpathSync(fileURLToPath(import.meta.url));
  const argvPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
  return modulePath === argvPath;
}

if (isMainModule()) {
  program.parseAsync(process.argv).catch((err: unknown) => {
    logger.error("CLI command failed", { err });
    process.exit(1);
  });
}
