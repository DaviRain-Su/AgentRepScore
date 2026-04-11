import { createPublicClient, http } from "viem";
import { xLayerTestnet } from "viem/chains";
import { config } from "../../config.ts";
import { ModulesOutput } from "../types.ts";
import { validatorAbi } from "../abis.ts";

export async function modules(): Promise<ModulesOutput> {
  if (!config.validatorAddress) {
    throw new Error("VALIDATOR_ADDRESS not set");
  }

  const VALIDATOR_ADDRESS = config.validatorAddress as `0x${string}`;
  const publicClient = createPublicClient({
    chain: xLayerTestnet,
    transport: http(config.rpc),
  });

  const moduleData = await publicClient.readContract({
    address: VALIDATOR_ADDRESS,
    abi: validatorAbi,
    functionName: "getModulesWithNames",
  });

  const [addresses_, names, categories, weights, activeStates] = moduleData;

  const moduleList: ModulesOutput["modules"] = [];
  for (let i = 0; i < names.length; i++) {
    moduleList.push({
      name: names[i],
      category: categories[i],
      address: addresses_[i],
      weight: Number(weights[i]),
      active: activeStates[i],
    });
  }

  return { modules: moduleList };
}
