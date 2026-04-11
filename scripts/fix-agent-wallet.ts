import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const IDENTITY_REGISTRY = process.env.IDENTITY_REGISTRY || "";

const identityRegistryAbi = [
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
] as const;

async function main() {
  if (!PRIVATE_KEY || !IDENTITY_REGISTRY) {
    console.error("Missing PRIVATE_KEY or IDENTITY_REGISTRY");
    process.exit(1);
  }

  const agentIdArg = process.argv.find((a) => a.startsWith("--agentId="));
  if (!agentIdArg) {
    console.error("Usage: npx ts-node scripts/fix-agent-wallet.ts --agentId=5");
    process.exit(1);
  }
  const agentId = BigInt(agentIdArg.split("=")[1]);

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const transport = http(process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech");
  const walletClient = createWalletClient({ account, chain: xLayerTestnet, transport });
  const publicClient = createPublicClient({ chain: xLayerTestnet, transport });

  const owner = await publicClient.readContract({
    address: IDENTITY_REGISTRY as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "ownerOf",
    args: [agentId],
  });

  const newWallet = account.address;
  const blockTs = (await publicClient.getBlock()).timestamp;
  const deadline = blockTs + 300n; // 5 minutes

  const domain = {
    name: "ERC8004IdentityRegistry",
    version: "1",
    chainId: 1952,
    verifyingContract: IDENTITY_REGISTRY as `0x${string}`,
  };

  const types = {
    AgentWalletSet: [
      { name: "agentId", type: "uint256" },
      { name: "newWallet", type: "address" },
      { name: "owner", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
  } as const;

  const message = {
    agentId: agentId,
    newWallet,
    owner,
    deadline,
  };

  const signature = await walletClient.signTypedData({
    domain,
    types,
    primaryType: "AgentWalletSet",
    message,
  });

  console.log(`Signing setAgentWallet for agentId=${agentId}`);
  console.log(`Owner: ${owner}`);
  console.log(`New wallet: ${newWallet}`);
  console.log(`Deadline: ${deadline}`);
  console.log(`Signature: ${signature}`);

  const tx = await walletClient.writeContract({
    address: IDENTITY_REGISTRY as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "setAgentWallet",
    args: [agentId, newWallet, deadline, signature],
  });

  console.log("Transaction:", tx);
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("Agent wallet set successfully");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
