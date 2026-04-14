import { createPublicClient, http } from "viem";
import { xLayer, xLayerTestnet } from "viem/chains";
import { config } from "../../config.ts";
import { ModulesOutput } from "../types.ts";
import { validatorAbi } from "../abis.ts";

const chain = config.network === "mainnet" ? xLayer : xLayerTestnet;

export async function modules(): Promise<ModulesOutput> {
  if (!config.validatorAddress) {
    throw new Error("VALIDATOR_ADDRESS not set");
  }

  const VALIDATOR_ADDRESS = config.validatorAddress as `0x${string}`;
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpc),
  });

  const [moduleData, effectiveWeightData] = await Promise.all([
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

  const [addresses_, names, categories, weights, activeStates] = moduleData;
  const [effectiveNames, , effectiveBaseWeights] = effectiveWeightData;
  const effectiveByName: Record<string, number> = {};
  for (let i = 0; i < effectiveNames.length; i++) {
    effectiveByName[effectiveNames[i]] = Number(effectiveBaseWeights[i]);
  }

  const moduleList: ModulesOutput["modules"] = [];
  for (let i = 0; i < names.length; i++) {
    const weight = Number(weights[i]);
    moduleList.push({
      name: names[i],
      category: categories[i],
      address: addresses_[i],
      weight,
      effectiveBaseWeight: effectiveByName[names[i]] ?? weight,
      active: activeStates[i],
    });
  }

  return { modules: moduleList };
}
