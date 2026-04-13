import { JsonRpcProvider, Wallet, ContractFactory, Contract, Interface, keccak256, toUtf8Bytes } from "ethers";
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

function loadFoundryArtifact(name: string, subdir = ""): { abi: any; bytecode: string } {
  const contractPath = subdir
    ? subdir
    : `${name}.sol`;
  const artifactPath = path.join(__dirname, "../out", contractPath, `${name}.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

async function deployContract(wallet: Wallet, name: string, args: any[] = [], subdir = ""): Promise<string> {
  const { abi, bytecode } = loadFoundryArtifact(name, subdir);
  const factory = new ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${name} deployed to: ${address}`);
  return address;
}

async function main() {
  if (!PRIVATE_KEY || !IDENTITY_REGISTRY || !REPUTATION_REGISTRY) {
    console.error("Missing required env vars: PRIVATE_KEY, IDENTITY_REGISTRY, REPUTATION_REGISTRY");
    process.exit(1);
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const wallet = new Wallet(PRIVATE_KEY, provider);
  const deployer = wallet.address;
  const governance = GOVERNANCE_SAFE || deployer;

  console.log("Deploying V2 Proxy architecture to X Layer Sepolia with account:", deployer);
  const balance = await provider.getBalance(deployer);
  console.log("Balance:", balance.toString(), "wei");

  // 1. Deploy modules
  const uniModule = await deployContract(wallet, "UniswapScoreModule", [deployer], "UniswapScoreModule.sol");
  const baseModule = await deployContract(wallet, "BaseActivityModule", [deployer], "BaseActivityModule.sol");

  // 2. Deploy V2 implementation
  const v2Impl = await deployContract(wallet, "AgentRepValidatorV2");

  // 3. Build initialize calldata
  const v2Abi = loadFoundryArtifact("AgentRepValidatorV2").abi;
  const iface = new Interface(v2Abi);
  const initData = iface.encodeFunctionData("initialize", [
    IDENTITY_REGISTRY,
    REPUTATION_REGISTRY,
    VALIDATION_REGISTRY,
    governance,
  ]);

  // 4. Deploy ERC1967Proxy
  const { abi: proxyAbi, bytecode: proxyBytecode } = loadFoundryArtifact("ERC1967Proxy", "ERC1967Proxy.sol");
  const proxyFactory = new ContractFactory(proxyAbi, proxyBytecode, wallet);
  const proxy = await proxyFactory.deploy(v2Impl, initData);
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  console.log("ERC1967Proxy deployed to:", proxyAddress);

  // Attach V2 ABI to proxy address
  const validator = new Contract(proxyAddress, v2Abi, wallet);

  // 5. Bootstrap modules (must be within 1 hour of deployment)
  // Weights validated via simulate sandbox:
  // 4000/2500 gives the best good/wash delta (5931) in the 2-module setup.
  // See docs/simulate-weight-analysis.md for full breakdown.
  const moduleAddrs = [uniModule, baseModule];
  const moduleWeights = [4000n, 2500n];

  const bootstrapTx = await validator.bootstrapModules(moduleAddrs, moduleWeights);
  await bootstrapTx.wait();
  console.log("Bootstrapped modules via validator.bootstrapModules()");
  for (let i = 0; i < moduleAddrs.length; i++) {
    console.log(`  Module ${i}: ${moduleAddrs[i]} weight=${moduleWeights[i]}`);
  }

  // 6. Set deployer as keeper for Uniswap and Base modules
  const uniAbi = loadFoundryArtifact("UniswapScoreModule", "UniswapScoreModule.sol").abi;
  const baseAbi = loadFoundryArtifact("BaseActivityModule", "BaseActivityModule.sol").abi;
  const uniContract = new Contract(uniModule, uniAbi, wallet);
  const baseContract = new Contract(baseModule, baseAbi, wallet);

  const tx1 = await uniContract.setKeeper(deployer, true);
  await tx1.wait();
  console.log("Set keeper for UniswapScoreModule:", deployer);

  const tx2 = await baseContract.setKeeper(deployer, true);
  await tx2.wait();
  console.log("Set keeper for BaseActivityModule:", deployer);

  // 7. Verify initial state
  console.log("\n--- Verification ---");
  const version = await validator.version();
  console.log("Validator version:", version);
  const moduleCount = await validator.moduleCount();
  console.log("Module count:", moduleCount.toString());
  const gov = await validator.governance();
  console.log("Governance:", gov);

  // 8. Test upgrade flow: deploy new impl and upgrade
  console.log("\n--- Upgrade Flow ---");
  const v2Impl2 = await deployContract(wallet, "AgentRepValidatorV2");

  const upgradeTx = await validator.upgradeToAndCall(v2Impl2, "0x");
  await upgradeTx.wait();
  console.log("Upgraded proxy to new implementation:", v2Impl2);

  // 9. Verify state preserved after upgrade
  const versionAfter = await validator.version();
  console.log("Version after upgrade:", versionAfter);
  const moduleCountAfter = await validator.moduleCount();
  console.log("Module count after upgrade:", moduleCountAfter.toString());
  const govAfter = await validator.governance();
  console.log("Governance after upgrade:", govAfter);

  if (moduleCount.toString() === moduleCountAfter.toString() && gov === govAfter) {
    console.log("\n✅ State preserved after upgrade");
  } else {
    console.error("\n❌ State NOT preserved after upgrade");
    process.exit(1);
  }

  console.log("\n=== Update .env with these V2 addresses ===");
  console.log(`UNISWAP_MODULE=${uniModule}`);
  console.log(`BASE_MODULE=${baseModule}`);
  console.log(`VALIDATOR_ADDRESS=${proxyAddress}`);
  console.log(`VALIDATOR_IMPLEMENTATION=${v2Impl2}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
