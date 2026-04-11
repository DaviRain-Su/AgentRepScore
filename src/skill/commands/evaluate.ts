import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import { config } from "../../config.ts";
import { EvaluateInput, ScoreOutput } from "../types.ts";
import { applyDecay, trustTier } from "../../utils/score-decay.ts";

const identityRegistryAbi = [
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "getAgentWallet",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
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
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "modules",
    outputs: [
      { internalType: "contract IScoreModule", name: "module", type: "address" },
      { internalType: "uint256", name: "weight", type: "uint256" },
      { internalType: "bool", name: "active", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "moduleCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export async function evaluate(input: EvaluateInput): Promise<ScoreOutput> {
  if (!config.validatorAddress) {
    throw new Error("VALIDATOR_ADDRESS not set");
  }

  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY not set");
  }

  const VALIDATOR_ADDRESS = config.validatorAddress as `0x${string}`;
  const account = privateKeyToAccount(config.privateKey as `0x${string}`);
  const transport = http(config.xlayerTestnetRpc);
  const walletClient = createWalletClient({ account, chain: xLayerTestnet, transport });
  const publicClient = createPublicClient({ chain: xLayerTestnet, transport });

  const wallet = await publicClient.readContract({
    address: config.identityRegistry as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "getAgentWallet",
    args: [BigInt(input.agentId)],
  });

  if (wallet === "0x0000000000000000000000000000000000000000") {
    throw new Error("Agent wallet not set");
  }

  const txHash = await walletClient.writeContract({
    address: VALIDATOR_ADDRESS,
    abi: validatorAbi,
    functionName: "evaluateAgent",
    args: [BigInt(input.agentId)],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error("evaluateAgent transaction failed");
  }

  const latest = await publicClient.readContract({
    address: VALIDATOR_ADDRESS,
    abi: validatorAbi,
    functionName: "getLatestScore",
    args: [BigInt(input.agentId)],
  });

  const modules = await publicClient.readContract({
    address: VALIDATOR_ADDRESS,
    abi: validatorAbi,
    functionName: "getModuleScores",
    args: [BigInt(input.agentId)],
  });

  const moduleCount = await publicClient.readContract({
    address: VALIDATOR_ADDRESS,
    abi: validatorAbi,
    functionName: "moduleCount",
  });

  const weights: Record<string, number> = {};
  for (let i = 0; i < Number(moduleCount); i++) {
    const mod = await publicClient.readContract({
      address: VALIDATOR_ADDRESS,
      abi: validatorAbi,
      functionName: "modules",
      args: [BigInt(i)],
    });
    const name = await publicClient.readContract({
      address: mod[0],
      abi: [{ inputs: [], name: "name", outputs: [{ internalType: "string", name: "", type: "string" }], stateMutability: "view", type: "function" }] as const,
      functionName: "name",
    });
    weights[name] = Number(mod[1]);
  }

  const rawScore = Number(latest[0]);
  const timestamp = Number(latest[1]);
  const decayedScore = applyDecay(rawScore, timestamp);

  const moduleBreakdown = modules[0].map((name, i) => ({
    name,
    score: Number(modules[1][i]),
    confidence: Number(modules[2][i]),
    weight: weights[name] ?? 0,
  }));

  return {
    agentId: input.agentId,
    wallet,
    rawScore,
    decayedScore,
    trustTier: trustTier(decayedScore),
    timestamp,
    moduleBreakdown,
  };
}
