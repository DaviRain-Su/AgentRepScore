import { createPublicClient, http } from "viem";
import { xLayerTestnet } from "viem/chains";
import { config } from "../../config.ts";
import { ModulesOutput } from "../types.ts";
import { validatorAbi, moduleNameAbi } from "../abis.ts";

export async function modules(): Promise<ModulesOutput> {
  if (!config.validatorAddress) {
    throw new Error("VALIDATOR_ADDRESS not set");
  }

  const VALIDATOR_ADDRESS = config.validatorAddress as `0x${string}`;
  const publicClient = createPublicClient({
    chain: xLayerTestnet,
    transport: http(config.rpc),
  });

  const count = await publicClient.readContract({
    address: VALIDATOR_ADDRESS,
    abi: validatorAbi,
    functionName: "moduleCount",
  });

  const moduleList: ModulesOutput["modules"] = [];

  for (let i = 0; i < Number(count); i++) {
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

    const category = await publicClient.readContract({
      address: mod[0],
      abi: moduleNameAbi,
      functionName: "category",
    });

    moduleList.push({
      name,
      category,
      address: mod[0],
      weight: Number(mod[1]),
      active: mod[2],
    });
  }

  return { modules: moduleList };
}
