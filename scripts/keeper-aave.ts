/**
 * Keeper script that submits Aave wallet meta to AaveScoreModule.
 *
 * Usage:
 *   npx tsx scripts/keeper-aave.ts --wallet=0x... [--liquidation-count=N] [--supplied-asset-count=N] [--dry-run]
 */
import { createWalletClient, createPublicClient, http, keccak256, toBytes, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import {
  loadKeeperState,
  isAlreadySubmitted,
  recordSubmission,
  saveKeeperState,
  submitWithRetry,
} from "../src/skill/keeper-utils.ts";

dotenv.config();

const AAVE_MODULE = process.env.AAVE_MODULE || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon";

const aaveModuleAbi = [
  {
    inputs: [
      { internalType: "address", name: "wallet", type: "address" },
      { internalType: "uint256", name: "liquidationCount", type: "uint256" },
      { internalType: "uint256", name: "suppliedAssetCount", type: "uint256" },
    ],
    name: "submitWalletMeta",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

function printUsage() {
  console.log(`
Usage:
  npx tsx scripts/keeper-aave.ts --wallet=0x... [--liquidation-count=N] [--supplied-asset-count=N] [--dry-run]

Submits Aave wallet meta (liquidationCount, suppliedAssetCount) to AaveScoreModule.

Required env vars:
  PRIVATE_KEY        Keeper wallet private key
  AAVE_MODULE        AaveScoreModule contract address

Flags:
  --wallet=0x...           Target wallet
  --liquidation-count=N    Number of liquidations (default: 0)
  --supplied-asset-count=N Number of supplied assets (default: 1)
  --dry-run                Build without submitting
`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  if (!PRIVATE_KEY) {
    console.error("Error: PRIVATE_KEY not set");
    process.exit(1);
  }
  if (!AAVE_MODULE) {
    console.error("Error: AAVE_MODULE not set");
    process.exit(1);
  }

  const walletArg = process.argv.find((a) => a.startsWith("--wallet="));
  if (!walletArg) {
    console.error("Error: Missing --wallet argument");
    printUsage();
    process.exit(1);
  }

  const wallet = walletArg.split("=")[1] as Address;
  const dryRun = process.argv.includes("--dry-run");

  const liquidationCountArg = process.argv.find((a) => a.startsWith("--liquidation-count="));
  const suppliedAssetCountArg = process.argv.find((a) => a.startsWith("--supplied-asset-count="));

  const liquidationCount = liquidationCountArg ? BigInt(liquidationCountArg.split("=")[1]) : 0n;
  const suppliedAssetCount = suppliedAssetCountArg ? BigInt(suppliedAssetCountArg.split("=")[1]) : 1n;

  console.log(`Submitting Aave wallet meta for ${wallet}...`);
  console.log(`  liquidationCount:   ${liquidationCount}`);
  console.log(`  suppliedAssetCount: ${suppliedAssetCount}`);

  if (dryRun) {
    console.log("\n[DRY RUN] Skipping on-chain submission.");
    process.exit(0);
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const evidenceHash = keccak256(
    toBytes(
      `aave-wallet-meta:${wallet.toLowerCase()}:${liquidationCount}:${suppliedAssetCount}:${now}`
    )
  );

  const state = loadKeeperState();
  if (isAlreadySubmitted(state, "aave", wallet, evidenceHash)) {
    console.log("Aave wallet meta already submitted for this wallet/evidence. Skipping.");
    process.exit(0);
  }

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: xLayerTestnet,
    transport: http(RPC_URL),
  });

  const publicClient = createPublicClient({
    chain: xLayerTestnet,
    transport: http(RPC_URL),
  });

  const receipt = await submitWithRetry(
    async () => {
      const txHash = await walletClient.writeContract({
        address: AAVE_MODULE as Address,
        abi: aaveModuleAbi,
        functionName: "submitWalletMeta",
        args: [wallet, liquidationCount, suppliedAssetCount],
      });
      console.log(`Transaction submitted: ${txHash}`);
      return publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 60_000,
      });
    },
    { label: "submitWalletMeta", maxRetries: 3 }
  );

  if (receipt.status === "success") {
    console.log(`Wallet meta submitted successfully (block ${receipt.blockNumber})`);
    const newState = recordSubmission(state, "aave", wallet, evidenceHash, receipt.blockNumber);
    saveKeeperState(newState);
  } else {
    console.error("Transaction reverted!");
    process.exit(1);
  }
}

function isMainModule() {
  if (!import.meta.url.startsWith("file:")) return false;
  const modulePath = realpathSync(fileURLToPath(import.meta.url));
  const argvPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
  return modulePath === argvPath;
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
