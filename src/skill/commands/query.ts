import { createPublicClient, http } from "viem";
import { xLayerTestnet } from "viem/chains";
import { QueryInput, ScoreOutput } from "../types.ts";
import { applyDecay, trustTier } from "../../utils/score-decay.ts";
import { config } from "../../config.ts";
import { identityRegistryAbi, validatorAbi, moduleNameAbi } from "../abis.ts";

export async function query(input: QueryInput): Promise<ScoreOutput> {
  if (!config.validatorAddress) {
    throw new Error("VALIDATOR_ADDRESS not set");
  }

  const VALIDATOR_ADDRESS = config.validatorAddress as `0x${string}`;
  const transport = http(config.xlayerTestnetRpc);
  const publicClient = createPublicClient({ chain: xLayerTestnet, transport });

  const wallet = await publicClient.readContract({
    address: config.identityRegistry as `0x${string}`,
    abi: identityRegistryAbi,
    functionName: "getAgentWallet",
    args: [BigInt(input.agentId)],
  });

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
      abi: moduleNameAbi,
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
