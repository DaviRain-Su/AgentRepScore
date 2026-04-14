import { createPublicClient, http } from "viem";
import { xLayer, xLayerTestnet } from "viem/chains";
import { QueryInput, ScoreOutput } from "../types.ts";
import { applyDecay, trustTier } from "../../utils/score-decay.ts";
import { config } from "../../config.ts";
import { identityRegistryAbi, validatorAbi } from "../abis.ts";

const chain = config.network === "mainnet" ? xLayer : xLayerTestnet;

export async function query(input: QueryInput): Promise<ScoreOutput> {
  if (!config.validatorAddress) {
    throw new Error("VALIDATOR_ADDRESS not set");
  }

  const VALIDATOR_ADDRESS = config.validatorAddress as `0x${string}`;
  const transport = http(config.rpc);
  const publicClient = createPublicClient({ chain, transport });

  const wallet = await publicClient.readContract({
    address: config.identityRegistry as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "getAgentWallet",
    args: [BigInt(input.agentId)],
  });

  const [latest, modules, moduleConfigs, effectiveWeights, correlationAssessment] = await Promise.all([
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
    publicClient.readContract({
      address: VALIDATOR_ADDRESS,
      abi: validatorAbi,
      functionName: "getCorrelationAssessment",
      args: [BigInt(input.agentId)],
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
  const decayedScore = applyDecay(rawScore, timestamp);
  const correlation = {
    penalty: Number(correlationAssessment[0]),
    evidenceHash: correlationAssessment[1],
    ruleCount: Number(correlationAssessment[2]),
    timestamp: Number(correlationAssessment[3]),
  };

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
    correlation,
    moduleBreakdown,
  };
}
