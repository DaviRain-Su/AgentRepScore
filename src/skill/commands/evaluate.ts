import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer, xLayerTestnet } from "viem/chains";
import { config } from "../../config.ts";
import { EvaluateInput, ScoreOutput } from "../types.ts";
import { applyDecay, trustTier } from "../../utils/score-decay.ts";
import { identityRegistryAbi, validatorAbi } from "../abis.ts";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

const chain = config.network === "mainnet" ? xLayer : xLayerTestnet;

export async function evaluate(input: EvaluateInput): Promise<ScoreOutput & { evidenceHash: `0x${string}` }> {
  if (!config.validatorAddress) {
    throw new Error("VALIDATOR_ADDRESS not set");
  }

  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY not set");
  }

  const VALIDATOR_ADDRESS = config.validatorAddress as `0x${string}`;
  const account = privateKeyToAccount(config.privateKey as `0x${string}`);
  const transport = http(config.rpc);
  const walletClient = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

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

  const receipt = await withTimeout(
    publicClient.waitForTransactionReceipt({ hash: txHash }),
    60_000,
    "waitForTransactionReceipt (evaluateAgent)"
  );
  if (receipt.status !== "success") {
    throw new Error("evaluateAgent transaction failed");
  }

  const [latest, modules, moduleConfigs, effectiveWeights] = await Promise.all([
    publicClient.readContract({
      address: VALIDATOR_ADDRESS,
      abi: validatorAbi,
      functionName: "getLatestScore",
      args: [BigInt(input.agentId)],
    }),
    publicClient.readContract({
      address: VALIDATOR_ADDRESS,
      abi: validatorAbi,
      functionName: "getModuleScores",
      args: [BigInt(input.agentId)],
    }),
    publicClient.readContract({
      address: VALIDATOR_ADDRESS,
      abi: validatorAbi,
      functionName: "getModulesWithNames",
    }),
    publicClient.readContract({
      address: VALIDATOR_ADDRESS,
      abi: validatorAbi,
      functionName: "getEffectiveWeights",
    }),
  ]);

  const [, moduleNames, , moduleWeights] = moduleConfigs;
  const [effectiveNames, , effectiveBaseWeights] = effectiveWeights;

  const nominalWeightsByName: Record<string, number> = {};
  for (let i = 0; i < moduleNames.length; i++) {
    nominalWeightsByName[moduleNames[i]] = Number(moduleWeights[i]);
  }

  const effectiveWeightsByName: Record<string, number> = {};
  for (let i = 0; i < effectiveNames.length; i++) {
    effectiveWeightsByName[effectiveNames[i]] = Number(effectiveBaseWeights[i]);
  }

  const rawScore = Number(latest[0]);
  const timestamp = Number(latest[1]);
  const evidenceHash = latest[2];
  const decayedScore = applyDecay(rawScore, timestamp);

  const moduleBreakdown = modules[0].map((name, i) => {
    const confidence = Number(modules[2][i]);
    const weight = nominalWeightsByName[name] ?? 0;
    const effectiveBaseWeight = effectiveWeightsByName[name] ?? weight;
    return {
      name,
      score: Number(modules[1][i]),
      confidence,
      weight,
      effectiveBaseWeight,
      effectiveWeight: Math.floor((effectiveBaseWeight * confidence) / 100),
    };
  });

  return {
    agentId: input.agentId,
    wallet,
    rawScore,
    decayedScore,
    trustTier: trustTier(decayedScore),
    timestamp,
    evidenceHash,
    moduleBreakdown,
  };
}
