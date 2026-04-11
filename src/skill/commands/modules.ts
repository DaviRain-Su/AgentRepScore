import { createPublicClient, http } from "viem";
import { xLayerTestnet } from "viem/chains";
import { config } from "../../config.ts";
import { ModulesOutput } from "../types.ts";

const validatorAbi = [
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

const moduleAbi = [
  {
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "category",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export async function modules(): Promise<ModulesOutput> {
  if (!config.validatorAddress) {
    throw new Error("VALIDATOR_ADDRESS not set");
  }

  const VALIDATOR_ADDRESS = config.validatorAddress as `0x${string}`;
  const publicClient = createPublicClient({
    chain: xLayerTestnet,
    transport: http(config.xlayerTestnetRpc),
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
      abi: moduleAbi,
      functionName: "name",
    });

    const category = await publicClient.readContract({
      address: mod[0],
      abi: moduleAbi,
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
