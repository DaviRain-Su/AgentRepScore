import { createWalletClient, createPublicClient, http, decodeEventLog, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer, xLayerTestnet } from "viem/chains";
import { config } from "../../config.ts";
import { RegisterInput } from "../types.ts";
import { identityRegistryAbi } from "../abis.ts";

const chain = config.network === "mainnet" ? xLayer : xLayerTestnet;
const REGISTERED_EVENT_SIG = keccak256(toHex("Registered(uint256,string,address)"));

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function register(input: RegisterInput): Promise<{ agentId: string; txHash: string }> {
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY not set");
  }

  const account = privateKeyToAccount(config.privateKey as `0x${string}`);
  const transport = http(config.rpc);
  const walletClient = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  // Simulate first to reliably obtain the returned agentId (register() returns uint256)
  const { result: simulatedAgentId } = await publicClient.simulateContract({
    address: config.identityRegistry as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [input.uri],
    account,
  });

  const registerHash = await walletClient.writeContract({
    address: config.identityRegistry as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [input.uri],
  });

  const receipt = await withTimeout(
    publicClient.waitForTransactionReceipt({ hash: registerHash }),
    60_000,
    "waitForTransactionReceipt (register)"
  );

  let agentId = simulatedAgentId.toString();

  // Best-effort validation from logs (optional)
  for (const log of receipt.logs) {
    if (log.topics[0]?.toLowerCase() === REGISTERED_EVENT_SIG.toLowerCase() && log.topics[1]) {
      agentId = BigInt(log.topics[1]).toString();
      break;
    }
    try {
      const event = decodeEventLog({ abi: identityRegistryAbi, eventName: "Registered", data: log.data, topics: log.topics });
      agentId = event.args.agentId.toString();
      break;
    } catch {
      continue;
    }
  }

  // Set agent wallet requires an EIP-712 signature from the new wallet.
  if (input.wallet.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `Wallet ${input.wallet} must sign setAgentWallet itself. Only self-registration is supported in this MVP.`
    );
  }

  const owner = await publicClient.readContract({
    address: config.identityRegistry as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "ownerOf",
    args: [BigInt(agentId)],
  });

  const blockTs = (await publicClient.getBlock()).timestamp;
  const deadline = blockTs + 300n;

  const signature = await walletClient.signTypedData({
    domain: {
      name: "ERC8004IdentityRegistry",
      version: "1",
      chainId: BigInt(chain.id),
      verifyingContract: config.identityRegistry as `0x${string}`,
    },
    types: {
      AgentWalletSet: [
        { name: "agentId", type: "uint256" },
        { name: "newWallet", type: "address" },
        { name: "owner", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "AgentWalletSet",
    message: {
      agentId: BigInt(agentId),
      newWallet: input.wallet,
      owner,
      deadline,
    },
  });

  const setWalletHash = await walletClient.writeContract({
    address: config.identityRegistry as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "setAgentWallet",
    args: [BigInt(agentId), input.wallet, deadline, signature],
  });

  await withTimeout(
    publicClient.waitForTransactionReceipt({ hash: setWalletHash }),
    60_000,
    "waitForTransactionReceipt (setAgentWallet)"
  );

  return { agentId, txHash: registerHash };
}
