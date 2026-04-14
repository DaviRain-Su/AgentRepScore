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

function loadFoundryArtifact(name: string, subdir = ""): { abi: any; bytecode: string } {
  const contractPath = subdir ? subdir : `${name}.sol`;
  const artifactPath = path.join(__dirname, "../out", contractPath, `${name}.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

async function main() {
  if (!PRIVATE_KEY) {
    console.error("PRIVATE_KEY not set");
    process.exit(1);
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const wallet = new Wallet(PRIVATE_KEY, provider);
  const deployer = wallet.address;
  console.log("Deployer:", deployer);

  const { abi, bytecode } = loadFoundryArtifact("MockSwapPool", "MockSwapPool.sol");
  const factory = new ContractFactory(abi, bytecode, wallet);
  const deployedPool = await factory.deploy();
  await deployedPool.waitForDeployment();
  const poolAddress = await deployedPool.getAddress();
  const pool = new Contract(poolAddress, abi, wallet);
  console.log("MockSwapPool deployed to:", poolAddress);

  // Emit a few swap events for the deployer wallet
  const swaps = [
    { amount0: 1000000, amount1: -950000, sqrtPriceX96: 79228162514264337593543950336n },
    { amount0: 2000000, amount1: -1900000, sqrtPriceX96: 79228162514264337593543950336n },
    { amount0: -500000, amount1: 475000, sqrtPriceX96: 79228162514264337593543950336n },
  ];

  for (let i = 0; i < swaps.length; i++) {
    const s = swaps[i];
    const tx = await pool.getFunction("emitSwap")(deployer, deployer, s.amount0, s.amount1, s.sqrtPriceX96, 1000000n, 0);
    await tx.wait();
    console.log(`Swap ${i + 1} emitted: tx=${tx.hash}`);
    if (i < swaps.length - 1) await new Promise((r) => setTimeout(r, 3000));
  }

  console.log("\n=== Use this pool address for UNISWAP_POOLS ===");
  console.log(poolAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
