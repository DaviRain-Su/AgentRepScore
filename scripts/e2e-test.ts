import { createWalletClient, createPublicClient, http, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const IDENTITY_REGISTRY = process.env.IDENTITY_REGISTRY || "";
const REPUTATION_REGISTRY = process.env.REPUTATION_REGISTRY || "";
const VALIDATOR_ADDRESS = process.env.VALIDATOR_ADDRESS || "";

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

const validatorAbi = [
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "evaluateAgent",
    outputs: [
      { internalType: "int256", name: "score", type: "int256" },
      { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "getLatestScore",
    outputs: [
      { internalType: "int256", name: "score", type: "int256" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
      { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "getModuleScores",
    outputs: [
      { internalType: "string[]", name: "names", type: "string[]" },
      { internalType: "int256[]", name: "scores", type: "int256[]" },
      { internalType: "uint256[]", name: "confidences", type: "uint256[]" },
      { internalType: "bytes32[]", name: "evidences", type: "bytes32[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const reputationAbi = [
  {
    inputs: [
      { internalType: "uint256", name: "agentId", type: "uint256" },
      { internalType: "address[]", name: "clientAddresses", type: "address[]" },
      { internalType: "string", name: "tag1", type: "string" },
      { internalType: "string", name: "tag2", type: "string" },
    ],
    name: "getSummary",
    outputs: [
      { internalType: "uint64", name: "count", type: "uint64" },
      { internalType: "int128", name: "summaryValue", type: "int128" },
      { internalType: "uint8", name: "summaryValueDecimals", type: "uint8" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function main() {
  if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const transport = http(process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech");
  const walletClient = createWalletClient({ account, chain: xLayerTestnet, transport });
  const publicClient = createPublicClient({ chain: xLayerTestnet, transport });

  const wallet = account.address;
  console.log("Wallet:", wallet);

  // 1. Register agent
  console.log("\n1. Registering agent on IdentityRegistry...");
  const registerHash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "register",
    args: ["https://example.com/agent.json"],
  });
  const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });

  let agentId = 0n;
  for (const log of (registerReceipt as any).logs || []) {
    try {
      const topics = (log.topics || []).map((t: any) => String(t)) as [`0x${string}`, ...`0x${string}`[]];
      const event = decodeEventLog({
        abi: identityRegistryAbi,
        eventName: "Registered",
        data: log.data,
        topics,
      });
      agentId = event.args.agentId;
      break;
    } catch {
      continue;
    }
  }
  if (agentId === 0n) {
    // Fallback: IdentityRegistry.register incrementally mints token IDs starting from 1.
    // We can infer it from totalSupply since only our deployer creates agents in this test.
    console.log("   Event parse failed, using fallback totalSupply inference");
    const totalSupplyAbi = [{ inputs: [], name: "totalSupply", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" }] as const;
    try {
      const supply = await publicClient.readContract({ address: IDENTITY_REGISTRY as `0x${string}`, abi: totalSupplyAbi, functionName: "totalSupply" });
      agentId = supply; // last minted token = totalSupply
      console.log("   Inferred Agent ID:", agentId.toString());
    } catch (e: any) {
      console.log("   totalSupply failed:", e.shortMessage || e.message);
    }
  }
  console.log("   Agent ID:", agentId.toString(), "Tx:", registerHash);

  // 2. Set agent wallet (requires EIP-712 signature from the new wallet)
  console.log("\n2. Setting agent wallet...");
  const owner = await publicClient.readContract({
    address: IDENTITY_REGISTRY as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "ownerOf",
    args: [agentId],
  });
  const blockTs = (await publicClient.getBlock()).timestamp;
  const deadline = blockTs + 300n; // 5 minutes from current block

  const signature = await walletClient.signTypedData({
    domain: {
      name: "ERC8004IdentityRegistry",
      version: "1",
      chainId: xLayerTestnet.id,
      verifyingContract: IDENTITY_REGISTRY as `0x${string}`,
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
      agentId,
      newWallet: wallet,
      owner,
      deadline,
    },
  });

  const setWalletHash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "setAgentWallet",
    args: [agentId, wallet, deadline, signature],
  });
  await publicClient.waitForTransactionReceipt({ hash: setWalletHash });
  console.log("   Tx:", setWalletHash);

  // 3. Evaluate agent
  console.log("\n3. Calling evaluateAgent...");
  const evalHash = await walletClient.writeContract({
    address: VALIDATOR_ADDRESS as `0x${string}`,
    abi: validatorAbi,
    functionName: "evaluateAgent",
    args: [agentId],
  });
  await publicClient.waitForTransactionReceipt({ hash: evalHash });
  console.log("   Tx:", evalHash);

  // 4. Query latest score
  console.log("\n4. Querying latest score...");
  const latest = await publicClient.readContract({
    address: VALIDATOR_ADDRESS as `0x${string}`,
    abi: validatorAbi,
    functionName: "getLatestScore",
    args: [agentId],
  });
  console.log("   Score:", Number(latest[0]));
  console.log("   Timestamp:", Number(latest[1]));

  // 5. Query module scores
  console.log("\n5. Querying module scores...");
  const modules = await publicClient.readContract({
    address: VALIDATOR_ADDRESS as `0x${string}`,
    abi: validatorAbi,
    functionName: "getModuleScores",
    args: [agentId],
  });
  for (let i = 0; i < modules[0].length; i++) {
    console.log(`   ${modules[0][i]}: score=${Number(modules[1][i])}, conf=${Number(modules[2][i])}`);
  }

  // 6. Verify ERC-8004 ReputationRegistry
  console.log("\n6. Verifying ReputationRegistry feedback...");
  const summary = await publicClient.readContract({
    address: REPUTATION_REGISTRY as `0x${string}`,
    abi: reputationAbi,
    functionName: "getSummary",
    args: [agentId, [VALIDATOR_ADDRESS as `0x${string}`], "agent-rep-score", ""],
  });
  console.log("   Feedback count:", Number(summary[0]));
  console.log("   Summary value:", Number(summary[1]));
  console.log("   Summary decimals:", Number(summary[2]));

  if (Number(summary[0]) > 0 && Number(summary[1]) === Number(latest[0])) {
    console.log("\n✅ End-to-end test PASSED");
  } else {
    console.log("\n❌ End-to-end test FAILED");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
