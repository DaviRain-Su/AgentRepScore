import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer, xLayerTestnet } from "viem/chains";
import { config } from "../../config.ts";
import { EvaluateInput, ScoreOutput } from "../types.ts";
import { applyDecay, trustTier } from "../../utils/score-decay.ts";
import { identityRegistryAbi, validatorAbi } from "../abis.ts";
import { resolveEvidenceStatus } from "../evidence-status.ts";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

const chain = config.network === "mainnet" ? xLayer : xLayerTestnet;

const validatorIdentityRegistryAbi = [
  {
    inputs: [],
    name: "identityRegistry",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function resolveAgentWallet(
  publicClient: ReturnType<typeof createPublicClient>,
  validatorAddress: `0x${string}`,
  agentId: bigint
): Promise<`0x${string}`> {
  const configuredIdentity = config.identityRegistry as `0x${string}`;

  try {
    return await publicClient.readContract({
      address: configuredIdentity,
      abi: identityRegistryAbi,
      functionName: "getAgentWallet",
      args: [agentId],
    });
  } catch {
    const validatorIdentity = await publicClient.readContract({
      address: validatorAddress,
      abi: validatorIdentityRegistryAbi,
      functionName: "identityRegistry",
    });

    return await publicClient.readContract({
      address: validatorIdentity as `0x${string}`,
      abi: identityRegistryAbi,
      functionName: "getAgentWallet",
      args: [agentId],
    });
  }
}

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
  const agentId = BigInt(input.agentId);
  const wallet = await resolveAgentWallet(publicClient, VALIDATOR_ADDRESS, agentId);

  if (wallet === "0x0000000000000000000000000000000000000000") {
    throw new Error("Agent wallet not set");
  }

  const txHash = await walletClient.writeContract({
    address: VALIDATOR_ADDRESS,
    abi: validatorAbi,
    functionName: "evaluateAgent",
    args: [agentId],
  });

  const receipt = await withTimeout(
    publicClient.waitForTransactionReceipt({ hash: txHash }),
    60_000,
    "waitForTransactionReceipt (evaluateAgent)"
  );
  if (receipt.status !== "success") {
    throw new Error("evaluateAgent transaction failed");
  }

  const [latest, modules, moduleConfigs, correlationAssessment] = await Promise.all([
    publicClient.readContract({
      address: VALIDATOR_ADDRESS,
      abi: validatorAbi,
      functionName: "getLatestScore",
      args: [agentId],
    }),
    publicClient.readContract({
      address: VALIDATOR_ADDRESS,
      abi: validatorAbi,
      functionName: "getModuleScores",
      args: [agentId],
    }),
    publicClient.readContract({
      address: VALIDATOR_ADDRESS,
      abi: validatorAbi,
      functionName: "getModulesWithNames",
    }),
    publicClient.readContract({
      address: VALIDATOR_ADDRESS,
      abi: validatorAbi,
      functionName: "getCorrelationAssessment",
      args: [agentId],
    }),
  ]);

  const effectiveWeights = await publicClient
    .readContract({
      address: VALIDATOR_ADDRESS,
      abi: validatorAbi,
      functionName: "getEffectiveWeights",
    })
    .catch(() => null);

  const [moduleAddresses, moduleNames, , moduleWeights, moduleActiveStates] = moduleConfigs;

  const nominalWeightsByName: Record<string, number> = {};
  for (let i = 0; i < moduleNames.length; i++) {
    nominalWeightsByName[moduleNames[i]] = Number(moduleWeights[i]);
  }

  const effectiveWeightsByName: Record<string, number> = {};
  if (effectiveWeights) {
    const [effectiveNames, , effectiveBaseWeights] = effectiveWeights;
    for (let i = 0; i < effectiveNames.length; i++) {
      effectiveWeightsByName[effectiveNames[i]] = Number(effectiveBaseWeights[i]);
    }
  }

  const rawScore = Number(latest[0]);
  const timestamp = Number(latest[1]);
  const evidenceHash = latest[2];
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

  const evidenceStatus = await resolveEvidenceStatus({
    wallet,
    reader: publicClient,
    modules: modules[0].map((name, i) => ({
      name,
      address: moduleAddresses[i],
      confidence: Number(modules[2][i]),
      active: moduleActiveStates[i],
    })),
  });

  return {
    agentId: input.agentId,
    wallet,
    rawScore,
    decayedScore,
    trustTier: trustTier(decayedScore),
    timestamp,
    evidenceHash,
    ...evidenceStatus,
    correlation,
    moduleBreakdown,
  };
}
