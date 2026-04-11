import hre from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const { viem } = hre;
  const walletClients = await viem.getWalletClients();
  const deployer = walletClients[0];

  console.log("Deploying contracts with account:", deployer.account.address);

  const aavePool = process.env.AAVE_POOL;
  if (!aavePool) {
    throw new Error("AAVE_POOL not set in environment");
  }

  const aaveModule = await viem.deployContract("AaveScoreModule", [aavePool as `0x${string}`]);
  console.log("AaveScoreModule deployed to:", aaveModule.address);

  const uniModule = await viem.deployContract("UniswapScoreModule", [deployer.account.address]);
  console.log("UniswapScoreModule deployed to:", uniModule.address);

  const baseModule = await viem.deployContract("BaseActivityModule", [deployer.account.address]);
  console.log("BaseActivityModule deployed to:", baseModule.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
