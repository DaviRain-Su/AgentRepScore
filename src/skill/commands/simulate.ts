import { createPublicClient, http } from "viem";
import { xLayer, xLayerTestnet } from "viem/chains";
import { config } from "../../config.ts";
import { validatorAbi } from "../abis.ts";
import { applyDecay, trustTier } from "../../utils/score-decay.ts";

const MAX_SCORE = 10000;
const MIN_SCORE = -10000;

export interface ModuleInput {
  name: string;
  score: number;
  confidence: number;
  weight: number;
  effectiveBaseWeight?: number;
}

export interface SimulateInput {
  agentId?: string;
  modules?: ModuleInput[];
  weightOverrides?: Record<string, number>;
}

export interface SimulateOutput {
  rawScore: number;
  decayedScore: number;
  trustTier: "untrusted" | "basic" | "verified" | "elite";
  totalWeight: number;
  moduleBreakdown: {
    name: string;
    score: number;
    confidence: number;
    weight: number;
    effectiveBaseWeight: number;
    effectiveWeight: number;
    contribution: number;
  }[];
}

export function computeScore(modules: ModuleInput[]): SimulateOutput {
  let totalScore = 0;
  let totalWeight = 0;

  const breakdown = modules.map((m) => {
    const effectiveBaseWeight = m.effectiveBaseWeight ?? m.weight;
    const effectiveWeight = Math.floor((effectiveBaseWeight * m.confidence) / 100);
    const contribution = effectiveWeight > 0 ? m.score * effectiveWeight : 0;
    if (effectiveWeight > 0) {
      totalScore += contribution;
      totalWeight += effectiveWeight;
    }
    return {
      name: m.name,
      score: m.score,
      confidence: m.confidence,
      weight: m.weight,
      effectiveBaseWeight,
      effectiveWeight,
      contribution,
    };
  });

  let finalScore = totalWeight > 0 ? Math.floor(totalScore / totalWeight) : 0;
  if (finalScore > MAX_SCORE) finalScore = MAX_SCORE;
  if (finalScore < MIN_SCORE) finalScore = MIN_SCORE;

  const now = Math.floor(Date.now() / 1000);
  const decayedScore = applyDecay(finalScore, now);

  return {
    rawScore: finalScore,
    decayedScore,
    trustTier: trustTier(decayedScore),
    totalWeight,
    moduleBreakdown: breakdown,
  };
}

export async function simulate(input: SimulateInput): Promise<SimulateOutput> {
  let modules: ModuleInput[];

  if (input.modules) {
    modules = input.modules;
  } else if (input.agentId) {
    modules = await fetchModuleScoresFromChain(input.agentId);
  } else {
    throw new Error("Either 'modules' or 'agentId' must be provided");
  }

  if (input.weightOverrides) {
    modules = modules.map((m) => ({
      ...m,
      weight: input.weightOverrides![m.name] ?? m.weight,
      effectiveBaseWeight: input.weightOverrides![m.name] ?? m.effectiveBaseWeight ?? m.weight,
    }));
  }

  return computeScore(modules);
}

async function fetchModuleScoresFromChain(agentId: string): Promise<ModuleInput[]> {
  if (!config.validatorAddress) {
    throw new Error("VALIDATOR_ADDRESS not set");
  }

  const chain = config.network === "mainnet" ? xLayer : xLayerTestnet;
  const publicClient = createPublicClient({ chain, transport: http(config.rpc) });
  const VALIDATOR = config.validatorAddress as `0x${string}`;

  const [moduleConfigs, moduleScores, effectiveWeightData] = await Promise.all([
    publicClient.readContract({
      address: VALIDATOR,
      abi: validatorAbi,
      functionName: "getModulesWithNames",
    }),
    publicClient.readContract({
      address: VALIDATOR,
      abi: validatorAbi,
      functionName: "getModuleScores",
      args: [BigInt(agentId)],
    }),
    publicClient.readContract({
      address: VALIDATOR,
      abi: validatorAbi,
      functionName: "getEffectiveWeights",
    }),
  ]);

  const [, names, , weights, activeStates] = moduleConfigs;
  const [, scores, confidences] = moduleScores;
  const [effectiveNames, , effectiveBaseWeights] = effectiveWeightData;
  const effectiveByName: Record<string, number> = {};
  for (let i = 0; i < effectiveNames.length; i++) {
    effectiveByName[effectiveNames[i]] = Number(effectiveBaseWeights[i]);
  }

  const modules: ModuleInput[] = [];
  for (let i = 0; i < names.length; i++) {
    if (!activeStates[i]) continue;
    const weight = Number(weights[i]);
    modules.push({
      name: names[i],
      score: Number(scores[i]),
      confidence: Number(confidences[i]),
      weight,
      effectiveBaseWeight: effectiveByName[names[i]] ?? weight,
    });
  }

  return modules;
}
