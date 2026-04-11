import { createPublicClient, http } from "viem";
import { xLayerTestnet } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

const VALIDATOR_ADDRESS = process.env.VALIDATOR_ADDRESS || "";

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
] as const;

async function main() {
  const agentIdArg = process.argv.find((a) => a.startsWith("--agentId="));
  if (!agentIdArg || !VALIDATOR_ADDRESS) {
    console.error("Usage: npx ts-node scripts/diagnose-evaluate.ts --agentId=6");
    process.exit(1);
  }
  const agentId = BigInt(agentIdArg.split("=")[1]);

  const publicClient = createPublicClient({
    chain: xLayerTestnet,
    transport: http(process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech"),
  });

  try {
    await publicClient.simulateContract({
      address: VALIDATOR_ADDRESS as `0x${string}`,
      abi: validatorAbi,
      functionName: "evaluateAgent",
      args: [agentId],
      account: "0x067aBc270C4638869Cd347530Be34cBdD93D0EA1",
    });
    console.log("Simulation succeeded");
  } catch (e: any) {
    console.error("Simulation failed:", e.shortMessage || e.message);
    if (e.cause) console.error("Cause:", e.cause);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
