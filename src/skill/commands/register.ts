import { createWalletClient, createPublicClient, http, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import { config } from "../../config.ts";
import { RegisterInput } from "../types.ts";

const identityRegistryAbi = [
  {
    inputs: [{ internalType: "string", name: "agentURI", type: "string" }],
    name: "register",
    outputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "agentId", type: "uint256" },
      { internalType: "address", name: "newWallet", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "bytes", name: "signature", type: "bytes" },
    ],
    name: "setAgentWallet",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "agentId", type: "uint256" },
      { indexed: false, internalType: "string", name: "agentURI", type: "string" },
      { indexed: true, internalType: "address", name: "owner", type: "address" },
    ],
    name: "Registered",
    type: "event",
  },
] as const;

export async function register(input: RegisterInput): Promise<{ agentId: string; txHash: string }> {
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY not set");
  }

  const account = privateKeyToAccount(config.privateKey as `0x${string}`);
  const transport = http(config.xlayerTestnetRpc);
  const walletClient = createWalletClient({ account, chain: xLayerTestnet, transport });
  const publicClient = createPublicClient({ chain: xLayerTestnet, transport });

  const registerHash = await walletClient.writeContract({
    address: config.identityRegistry as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [input.uri],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });

  let agentId = "0";
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({ abi: identityRegistryAbi, eventName: "Registered", data: log.data, topics: log.topics });
      agentId = event.args.agentId.toString();
      break;
    } catch {
      continue;
    }
  }

  if (agentId === "0") {
    throw new Error("Failed to parse agentId from register transaction");
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
      chainId: 1952,
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

  await publicClient.waitForTransactionReceipt({ hash: setWalletHash });

  return { agentId, txHash: registerHash };
}
