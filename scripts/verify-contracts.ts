/**
 * Verify deployed contract source code on block explorers.
 *
 * Supports OKLink (X Layer) and Blockscout-compatible APIs.
 * Uses Foundry's `forge verify-contract` under the hood.
 *
 * Usage:
 *   npx tsx scripts/verify-contracts.ts --network=testnet|mainnet
 *
 * Required env vars:
 *   VALIDATOR_ADDRESS    - AgentRepValidator contract address
 *   UNISWAP_MODULE       - UniswapScoreModule address (optional)
 *   BASE_MODULE          - BaseActivityModule address (optional)
 *   OKLINK_API_KEY       - OKLink API key for verification (optional, uses Blockscout if missing)
 */
import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

dotenv.config();

interface ContractVerification {
  name: string;
  address: string;
  contractPath: string;
  constructorArgs?: string;
}

const EXPLORER_CONFIG = {
  testnet: {
    rpc: process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon",
    verifierUrl: "https://www.oklink.com/api/v5/explorer/contract/verify-source-code",
    blockscoutUrl: "https://www.okx.com/explorer/xlayer-test/api",
    chainId: 195,
  },
  mainnet: {
    rpc: process.env.XLAYER_RPC || "https://rpc.xlayer.tech",
    verifierUrl: "https://www.oklink.com/api/v5/explorer/contract/verify-source-code",
    blockscoutUrl: "https://www.okx.com/explorer/xlayer/api",
    chainId: 196,
  },
} as const;

function getContractsToVerify(): ContractVerification[] {
  const contracts: ContractVerification[] = [];

  if (process.env.VALIDATOR_ADDRESS) {
    contracts.push({
      name: "AgentRepValidator",
      address: process.env.VALIDATOR_ADDRESS,
      contractPath: "contracts/AgentRepValidator.sol:AgentRepValidator",
    });
  }

  if (process.env.UNISWAP_MODULE) {
    contracts.push({
      name: "UniswapScoreModule",
      address: process.env.UNISWAP_MODULE,
      contractPath: "contracts/modules/UniswapScoreModule.sol:UniswapScoreModule",
    });
  }

  if (process.env.BASE_MODULE) {
    contracts.push({
      name: "BaseActivityModule",
      address: process.env.BASE_MODULE,
      contractPath: "contracts/modules/BaseActivityModule.sol:BaseActivityModule",
    });
  }

  return contracts;
}

function verifyWithForge(
  contract: ContractVerification,
  network: "testnet" | "mainnet",
  apiKey: string | undefined
): boolean {
  const cfg = EXPLORER_CONFIG[network];
  const verifierUrl = apiKey ? cfg.verifierUrl : cfg.blockscoutUrl;
  const verifierType = apiKey ? "etherscan" : "blockscout";

  const cmd = [
    "forge",
    "verify-contract",
    contract.address,
    contract.contractPath,
    `--chain-id ${cfg.chainId}`,
    `--verifier ${verifierType}`,
    `--verifier-url ${verifierUrl}`,
    "--watch",
  ];

  if (apiKey) {
    cmd.push(`--etherscan-api-key ${apiKey}`);
  }

  if (contract.constructorArgs) {
    cmd.push(`--constructor-args ${contract.constructorArgs}`);
  }

  const fullCmd = cmd.join(" ");
  console.log(`\nVerifying ${contract.name} at ${contract.address}...`);
  console.log(`  Command: ${fullCmd}`);

  try {
    execSync(fullCmd, { stdio: "inherit", timeout: 120_000 });
    console.log(`  ${contract.name}: Verified successfully`);
    return true;
  } catch (err) {
    console.error(`  ${contract.name}: Verification failed`);
    return false;
  }
}

async function main() {
  const networkArg = process.argv.find((a) => a.startsWith("--network="));
  const network = (networkArg?.split("=")[1] || "testnet") as "testnet" | "mainnet";
  const apiKey = process.env.OKLINK_API_KEY;

  console.log(`Verifying contracts on ${network}...`);
  if (!apiKey) {
    console.log("No OKLINK_API_KEY found, falling back to Blockscout verification.");
  }

  const contracts = getContractsToVerify();
  if (contracts.length === 0) {
    console.error("No contract addresses configured. Set VALIDATOR_ADDRESS, UNISWAP_MODULE, or BASE_MODULE.");
    process.exit(1);
  }

  let allSuccess = true;
  for (const contract of contracts) {
    const ok = verifyWithForge(contract, network, apiKey);
    if (!ok) allSuccess = false;
  }

  console.log(`\n=== Verification ${allSuccess ? "complete" : "completed with failures"} ===`);
  process.exit(allSuccess ? 0 : 1);
}

function isMainModule() {
  if (!import.meta.url.startsWith("file:")) return false;
  const modulePath = realpathSync(fileURLToPath(import.meta.url));
  const argvPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
  return modulePath === argvPath;
}

if (isMainModule()) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
