import { type Address, type Chain, type PublicClient, type WalletClient } from "viem";
import { logger } from "../logger.ts";
import {
  loadKeeperState,
  isAlreadySubmitted,
  recordSubmission,
  saveKeeperState,
  submitWithRetry,
} from "../keeper-utils.ts";
import { fetchNonce, signWalletMeta } from "../eip712.ts";

const aaveModuleAbi = [
  {
    inputs: [
      { internalType: "address", name: "wallet", type: "address" },
      { internalType: "uint256", name: "liquidationCount", type: "uint256" },
      { internalType: "uint256", name: "suppliedAssetCount", type: "uint256" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
      { internalType: "bytes", name: "signature", type: "bytes" },
    ],
    name: "submitWalletMeta",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export async function submitWalletMeta(
  publicClient: PublicClient,
  walletClient: WalletClient,
  wallet: Address,
  moduleAddress: Address,
  liquidationCount: bigint,
  suppliedAssetCount: bigint
): Promise<void> {
  const now = BigInt(Math.floor(Date.now() / 1000));

  logger.info(`[aave] Submitting wallet meta for ${wallet}`, {
    liquidationCount: liquidationCount.toString(),
    suppliedAssetCount: suppliedAssetCount.toString(),
  });

  const nonce = await fetchNonce(publicClient, moduleAddress, wallet);
  const signature = await signWalletMeta(
    walletClient,
    moduleAddress,
    wallet,
    liquidationCount,
    suppliedAssetCount,
    now,
    nonce
  );

  const receipt = await submitWithRetry(
    async () => {
      const txHash = await walletClient.writeContract({
        account: walletClient.account!,
        chain: walletClient.chain as Chain,
        address: moduleAddress,
        abi: aaveModuleAbi,
        functionName: "submitWalletMeta",
        args: [wallet, liquidationCount, suppliedAssetCount, now, signature],
      });
      logger.info(`[aave] Tx submitted: ${txHash}`);
      return publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
    },
    { label: "submitWalletMeta", maxRetries: 3 }
  );

  if (receipt.status === "success") {
    logger.info(`[aave] Submitted successfully (block ${receipt.blockNumber})`);
    const state = loadKeeperState();
    const newState = recordSubmission(state, "aave", wallet, "0x" as `0x${string}`, receipt.blockNumber);
    saveKeeperState(newState);
  } else {
    throw new Error("Transaction reverted");
  }
}
