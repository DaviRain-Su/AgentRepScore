import hre from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const { viem } = hre;
  const walletClients = await viem.getWalletClients();
  const deployer = walletClients[0];

  console.log("Deploying AgentRepValidator with account:", deployer.account.address);

  const identityRegistry = process.env.IDENTITY_REGISTRY;
  const reputationRegistry = process.env.REPUTATION_REGISTRY;
  const validationRegistry = process.env.VALIDATION_REGISTRY || "0x0000000000000000000000000000000000000000";

  if (!identityRegistry || !reputationRegistry) {
    throw new Error("Registry addresses not set in environment");
  }

  const validator = await viem.deployContract("AgentRepValidator", [
    identityRegistry as `0x${string}`,
    reputationRegistry as `0x${string}`,
    validationRegistry as `0x${string}`,
    deployer.account.address,
  ]);
  console.log("AgentRepValidator deployed to:", validator.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
