import { JsonRpcProvider, Wallet, ContractFactory, Contract } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.mainnet" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.XLAYER_RPC || "https://xlayerrpc.okx.com";
const AAVE_POOL = process.env.AAVE_POOL || "";
const IDENTITY_REGISTRY = process.env.IDENTITY_REGISTRY || "";
const REPUTATION_REGISTRY = process.env.REPUTATION_REGISTRY || "";
const VALIDATION_REGISTRY = process.env.VALIDATION_REGISTRY || "0x0000000000000000000000000000000000000000";

function loadArtifact(name: string): { abi: any; bytecode: string } {
  // Determine subdirectory: modules/ for module contracts, root for AgentRepValidator
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

async function deployContract(wallet: Wallet, name: string, args: any[] = []): Promise<string> {
  const { abi, bytecode } = loadArtifact(name);
  const factory = new ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${name} deployed to: ${address}`);
  return address;
}

async function main() {
  if (!PRIVATE_KEY || !AAVE_POOL || !IDENTITY_REGISTRY || !REPUTATION_REGISTRY) {
    console.error("Missing required env vars in .env.mainnet");
    process.exit(1);
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const wallet = new Wallet(PRIVATE_KEY, provider);
  const deployer = wallet.address;

  console.log("Deploying to X Layer mainnet with account:", deployer);
  const balance = await provider.getBalance(deployer);
  console.log("Balance:", balance.toString(), "wei");

  // 1. Deploy modules
  const aaveModule = await deployContract(wallet, "AaveScoreModule", [AAVE_POOL]);
  const uniModule = await deployContract(wallet, "UniswapScoreModule", [deployer]);
  const baseModule = await deployContract(wallet, "BaseActivityModule", [deployer]);

  // 2. Deploy validator
  const validatorAbi = loadArtifact("AgentRepValidator").abi;
  const validatorBytecode = loadArtifact("AgentRepValidator").bytecode;
  const validatorFactory = new ContractFactory(validatorAbi, validatorBytecode, wallet);
  const validator = await validatorFactory.deploy(
    IDENTITY_REGISTRY,
    REPUTATION_REGISTRY,
    VALIDATION_REGISTRY,
    deployer
  );
  await validator.waitForDeployment();
  const validatorAddress = await validator.getAddress();
  console.log("AgentRepValidator deployed to:", validatorAddress);

  // 3. Register modules in validator
  const weights = [
    { name: "AaveScoreModule", address: aaveModule, weight: 3500n },
    { name: "UniswapScoreModule", address: uniModule, weight: 4000n },
    { name: "BaseActivityModule", address: baseModule, weight: 2500n },
  ];

  for (const mod of weights) {
    const tx = await validator.registerModule(mod.address, mod.weight);
    await tx.wait();
    console.log(`Registered ${mod.name} with weight ${mod.weight}`);
  }

  // 4. Set deployer as keeper for Uniswap and Base modules
  const uniContract = new Contract(uniModule, loadArtifact("UniswapScoreModule").abi, wallet);
  const baseContract = new Contract(baseModule, loadArtifact("BaseActivityModule").abi, wallet);

  const tx1 = await uniContract.setKeeper(deployer, true);
  await tx1.wait();
  console.log("Set keeper for UniswapScoreModule:", deployer);

  const tx2 = await baseContract.setKeeper(deployer, true);
  await tx2.wait();
  console.log("Set keeper for BaseActivityModule:", deployer);

  // 5. Output env vars
  console.log("\n=== Update .env.mainnet with these addresses ===");
  console.log(`AAVE_MODULE=${aaveModule}`);
  console.log(`UNISWAP_MODULE=${uniModule}`);
  console.log(`BASE_MODULE=${baseModule}`);
  console.log(`VALIDATOR_ADDRESS=${validatorAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
