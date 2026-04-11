import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { register, evaluate, query, compare, modules } from "./skill/index.ts";

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

function isMainModule() {
  if (!import.meta.url.startsWith("file:")) return false;
  const modulePath = realpathSync(fileURLToPath(import.meta.url));
  const argvPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
  return modulePath === argvPath;
}

if (isMainModule()) {
  program.parseAsync(process.argv).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
