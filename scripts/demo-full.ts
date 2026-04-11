import { createWalletClient, createPublicClient, http, decodeEventLog, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const IDENTITY_REGISTRY = process.env.IDENTITY_REGISTRY || "";
const REPUTATION_REGISTRY = process.env.REPUTATION_REGISTRY || "";
const VALIDATOR_ADDRESS = process.env.VALIDATOR_ADDRESS || "";
const UNISWAP_MODULE = process.env.UNISWAP_MODULE || "";
const BASE_MODULE = process.env.BASE_MODULE || "";

function makeEvidence(label: string) {
  return keccak256(toBytes(label));
}

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

const uniswapAbi = [
  {
    inputs: [
      { internalType: "address", name: "wallet", type: "address" },
      {
        components: [
          { internalType: "uint256", name: "swapCount", type: "uint256" },
          { internalType: "uint256", name: "volumeUSD", type: "uint256" },
          { internalType: "int256", name: "netPnL", type: "int256" },
          { internalType: "uint256", name: "avgSlippageBps", type: "uint256" },
          { internalType: "uint256", name: "feeToPnlRatioBps", type: "uint256" },
          { internalType: "bool", name: "washTradeFlag", type: "bool" },
          { internalType: "uint256", name: "timestamp", type: "uint256" },
          { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
        ],
        internalType: "struct UniswapScoreModule.SwapSummary",
        name: "summary",
        type: "tuple",
      },
    ],
    name: "submitSwapSummary",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const baseAbi = [
  {
    inputs: [
      { internalType: "address", name: "wallet", type: "address" },
      {
        components: [
          { internalType: "uint256", name: "txCount", type: "uint256" },
          { internalType: "uint256", name: "firstTxTimestamp", type: "uint256" },
          { internalType: "uint256", name: "lastTxTimestamp", type: "uint256" },
          { internalType: "uint256", name: "uniqueCounterparties", type: "uint256" },
          { internalType: "uint256", name: "timestamp", type: "uint256" },
          { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
        ],
        internalType: "struct BaseActivityModule.ActivitySummary",
        name: "summary",
        type: "tuple",
      },
    ],
    name: "submitActivitySummary",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const profiles: Record<string, { swap: any; activity: any }> = {
  good: {
    swap: {
      swapCount: 120n,
      volumeUSD: 250_000n * 1_000_000n,
      netPnL: 15_000n * 1_000_000n,
      avgSlippageBps: 8n,
      feeToPnlRatioBps: 1500n,
      washTradeFlag: false,
      evidenceHash: makeEvidence("good-swap-evidence"),
    },
    activity: {
      txCount: 2500n,
      firstTxTimestamp: BigInt(Math.floor(Date.now() / 1000) - 400 * 86400),
      lastTxTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      uniqueCounterparties: 80n,
      evidenceHash: makeEvidence("good-activity-evidence"),
    },
  },
  wash: {
    swap: {
      swapCount: 500n,
      volumeUSD: 50_000n * 1_000_000n,
      netPnL: -5_000n * 1_000_000n,
      avgSlippageBps: 120n,
      feeToPnlRatioBps: 8500n,
      washTradeFlag: true,
      evidenceHash: makeEvidence("wash-swap-evidence"),
    },
    activity: {
      txCount: 800n,
      firstTxTimestamp: BigInt(Math.floor(Date.now() / 1000) - 200 * 86400),
      lastTxTimestamp: BigInt(Math.floor(Date.now() / 1000) - 5 * 86400),
      uniqueCounterparties: 2n,
      evidenceHash: makeEvidence("wash-activity-evidence"),
    },
  },
};

async function main() {
  if (!PRIVATE_KEY || !IDENTITY_REGISTRY || !VALIDATOR_ADDRESS || !UNISWAP_MODULE || !BASE_MODULE) {
    console.error("Missing required env vars");
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const wallet = account.address;
  const transport = http(process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech");
  const walletClient = createWalletClient({ account, chain: xLayerTestnet, transport });
  const publicClient = createPublicClient({ chain: xLayerTestnet, transport });

  async function submitProfile(profileName: string) {
    const p = profiles[profileName];
    const now = BigInt(Math.floor(Date.now() / 1000));
    const swap = { ...p.swap, timestamp: now, evidenceHash: makeEvidence(`${profileName}-swap-${now}`) };
    const activity = { ...p.activity, timestamp: now, evidenceHash: makeEvidence(`${profileName}-activity-${now}`) };

    const tx1 = await walletClient.writeContract({
      address: UNISWAP_MODULE as `0x${string}`,
      abi: uniswapAbi,
      functionName: "submitSwapSummary",
      args: [wallet, swap],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx1 });

    const tx2 = await walletClient.writeContract({
      address: BASE_MODULE as `0x${string}`,
      abi: baseAbi,
      functionName: "submitActivitySummary",
      args: [wallet, activity],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx2 });

    console.log(`   Keeper ${profileName} data submitted`);
  }

  async function registerAgent(): Promise<bigint> {
    const registerHash = await walletClient.writeContract({
      address: IDENTITY_REGISTRY as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: "register",
      args: ["https://example.com/agent.json"],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });

    let agentId = 0n;
    for (const log of (receipt as any).logs || []) {
      try {
        const topics = (log.topics || []).map((t: any) => String(t)) as [`0x${string}`, ...`0x${string}`[]];
        const event = decodeEventLog({ abi: identityRegistryAbi, eventName: "Registered", data: log.data, topics });
        agentId = event.args.agentId;
        break;
      } catch {
        continue;
      }
    }
    if (agentId === 0n) {
      throw new Error("Failed to parse agentId");
    }
    return agentId;
  }

  async function setAgentWallet(agentId: bigint) {
    const owner = await publicClient.readContract({
      address: IDENTITY_REGISTRY as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [agentId],
    });
    const blockTs = (await publicClient.getBlock()).timestamp;
    const deadline = blockTs + 300n;

    const signature = await walletClient.signTypedData({
      domain: {
        name: "ERC8004IdentityRegistry",
        version: "1",
        chainId: 1952,
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
      message: { agentId, newWallet: wallet, owner, deadline },
    });

    const hash = await walletClient.writeContract({
      address: IDENTITY_REGISTRY as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: "setAgentWallet",
      args: [agentId, wallet, deadline, signature],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function evaluate(agentId: bigint) {
    const hash = await walletClient.writeContract({
      address: VALIDATOR_ADDRESS as `0x${string}`,
      abi: validatorAbi,
      functionName: "evaluateAgent",
      args: [agentId],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function getScore(agentId: bigint) {
    const latest = await publicClient.readContract({
      address: VALIDATOR_ADDRESS as `0x${string}`,
      abi: validatorAbi,
      functionName: "getLatestScore",
      args: [agentId],
    });
    const modules = await publicClient.readContract({
      address: VALIDATOR_ADDRESS as `0x${string}`,
      abi: validatorAbi,
      functionName: "getModuleScores",
      args: [agentId],
    });
    return { score: Number(latest[0]), timestamp: Number(latest[1]), modules };
  }

  // ========== Demo Flow ==========
  console.log("\n=== AgentRepScore Full Demo ===\n");

  // Step 1: good agent
  console.log("[1/6] Submitting GOOD keeper data...");
  await submitProfile("good");

  console.log("[2/6] Registering & evaluating GOOD agent...");
  const goodAgentId = await registerAgent();
  await setAgentWallet(goodAgentId);
  await evaluate(goodAgentId);
  const goodScore = await getScore(goodAgentId);
  console.log(`   Good Agent ID: ${goodAgentId}`);
  console.log(`   Score: ${goodScore.score}`);
  for (let i = 0; i < goodScore.modules[0].length; i++) {
    console.log(`     ${goodScore.modules[0][i]}: ${Number(goodScore.modules[1][i])}`);
  }

  // Step 2: wash agent (overwrite keeper data for same wallet)
  console.log("\n[3/6] Submitting WASH keeper data...");
  await submitProfile("wash");

  console.log("[4/6] Registering & evaluating WASH agent...");
  const washAgentId = await registerAgent();
  await setAgentWallet(washAgentId);
  await evaluate(washAgentId);
  const washScore = await getScore(washAgentId);
  console.log(`   Wash Agent ID: ${washAgentId}`);
  console.log(`   Score: ${washScore.score}`);
  for (let i = 0; i < washScore.modules[0].length; i++) {
    console.log(`     ${washScore.modules[0][i]}: ${Number(washScore.modules[1][i])}`);
  }

  // Step 3: compare
  console.log("\n[5/6] Comparison:");
  const rows = [
    { id: goodAgentId.toString(), score: goodScore.score },
    { id: washAgentId.toString(), score: washScore.score },
  ].sort((a, b) => b.score - a.score);
  for (const r of rows) {
    const tier = r.score > 8000 ? "elite" : r.score > 5000 ? "verified" : r.score > 2000 ? "basic" : "untrusted";
    console.log(`   Agent ${r.id}: score=${r.score}, tier=${tier}`);
  }

  // Step 4: verify reputation registry
  console.log("\n[6/6] Verifying ReputationRegistry feedback...");
  for (const id of [goodAgentId, washAgentId]) {
    const summary = await publicClient.readContract({
      address: REPUTATION_REGISTRY as `0x${string}`,
      abi: reputationAbi,
      functionName: "getSummary",
      args: [id, [VALIDATOR_ADDRESS as `0x${string}`], "agent-rep-score", ""],
    });
    console.log(`   Agent ${id}: feedbackCount=${Number(summary[0])}, summaryValue=${Number(summary[1])}`);
  }

  console.log("\n✅ Full demo completed successfully");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
