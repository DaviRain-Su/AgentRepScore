import { JsonRpcProvider, Wallet, ContractFactory, Contract } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon";
const IDENTITY_REGISTRY = process.env.IDENTITY_REGISTRY || "";
const REPUTATION_REGISTRY = process.env.REPUTATION_REGISTRY || "";
const VALIDATION_REGISTRY = process.env.VALIDATION_REGISTRY || "0x0000000000000000000000000000000000000000";
const GOVERNANCE_SAFE = process.env.GOVERNANCE_SAFE || "";
const UNISWAP_MODULE = process.env.UNISWAP_MODULE || "";
const BASE_MODULE = process.env.BASE_MODULE || "";

function loadArtifact(name: string): { abi: any; bytecode: string } {
  const subdir = name.endsWith("Module") ? "modules" : "";
  const artifactPath = path.join(
    __dirname,
    "../artifacts/contracts",
    subdir,
    `${name}.sol`,
    `${name}.json`
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return { abi: artifact.abi, bytecode: artifact.bytecode };
}

async function main() {
  if (!PRIVATE_KEY || !IDENTITY_REGISTRY || !REPUTATION_REGISTRY || !UNISWAP_MODULE || !BASE_MODULE) {
    console.error("Missing required env vars");
    process.exit(1);
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const wallet = new Wallet(PRIVATE_KEY, provider);
  const deployer = wallet.address;
  const governance = GOVERNANCE_SAFE || deployer;

  console.log("Redeploying AgentRepValidator to X Layer Sepolia with account:", deployer);
  const balance = await provider.getBalance(deployer);
  console.log("Balance:", balance.toString(), "wei");

  // Deploy new validator
  const { abi, bytecode } = loadArtifact("AgentRepValidator");
  const factory = new ContractFactory(abi, bytecode, wallet);
  const validator = await factory.deploy(
    IDENTITY_REGISTRY,
    REPUTATION_REGISTRY,
    VALIDATION_REGISTRY,
    governance
  );
  await validator.waitForDeployment();
  const validatorAddress = await validator.getAddress();
  console.log("Governance address:", governance);
  console.log("AgentRepValidator deployed to:", validatorAddress);

  // Bootstrap modules (must be within 1 hour of deployment)
  const moduleAddrs = [UNISWAP_MODULE, BASE_MODULE];
  const moduleWeights = [4000n, 2500n];

  // @ts-expect-error hardhat type inference limitation
  const bootstrapTx = await validator.bootstrapModules(moduleAddrs, moduleWeights);
  await bootstrapTx.wait();
  console.log("Bootstrapped modules via validator.bootstrapModules()");
  for (let i = 0; i < moduleAddrs.length; i++) {
    console.log(`  Module ${i}: ${moduleAddrs[i]} weight=${moduleWeights[i]}`);
  }

  // Set deployer as keeper for Uniswap and Base modules
  const uniContract = new Contract(UNISWAP_MODULE, loadArtifact("UniswapScoreModule").abi, wallet);
  const baseContract = new Contract(BASE_MODULE, loadArtifact("BaseActivityModule").abi, wallet);

  const tx1 = await uniContract.setKeeper(deployer, true);
  await tx1.wait();
  console.log("Set keeper for UniswapScoreModule:", deployer);

  const tx2 = await baseContract.setKeeper(deployer, true);
  await tx2.wait();
  console.log("Set keeper for BaseActivityModule:", deployer);

  console.log("\n=== Update .env VALIDATOR_ADDRESS ===");
  console.log(`VALIDATOR_ADDRESS=${validatorAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
