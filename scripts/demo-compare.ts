import { createPublicClient, http } from "viem";
import { xLayerTestnet } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

const VALIDATOR_ADDRESS = process.env.VALIDATOR_ADDRESS || "";
const RPC = process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech";

const validatorAbi = [
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "getLatestScore",
    outputs: [
      { internalType: "int256", name: "score", type: "int256" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
      { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

function trustTier(score: number): "untrusted" | "basic" | "verified" | "elite" {
  if (score <= 2000) return "untrusted";
  if (score <= 5000) return "basic";
  if (score <= 8000) return "verified";
  return "elite";
}

function applyDecay(rawScore: number, evaluationTimestamp: number): number {
  const daysElapsed = (Date.now() / 1000 - evaluationTimestamp) / 86400;
  const decayFactor = Math.max(0.1, 1.0 - 0.02 * daysElapsed);
  return Math.round(rawScore * decayFactor);
}

async function main() {
  const agentIds = process.argv.slice(2);
  if (agentIds.length < 2 || !VALIDATOR_ADDRESS) {
    console.error("Usage: npx ts-node scripts/demo-compare.ts <agentId1> <agentId2> [...]");
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain: xLayerTestnet,
    transport: http(RPC),
  });

  const results = await Promise.all(
    agentIds.map(async (agentId) => {
      const latest = await publicClient.readContract({
        address: VALIDATOR_ADDRESS as `0x${string}`,
        abi: validatorAbi,
        functionName: "getLatestScore",
        args: [BigInt(agentId)],
      });
      const rawScore = Number(latest[0]);
      const timestamp = Number(latest[1]);
      const decayedScore = applyDecay(rawScore, timestamp);
      return {
        agentId,
        rawScore,
        decayedScore,
        trustTier: trustTier(decayedScore),
        timestamp,
      };
    })
  );

  results.sort((a, b) => b.decayedScore - a.decayedScore);

  console.log("\nRanked comparison results:");
  for (const r of results) {
    console.log(
      `  Agent ${r.agentId}: raw=${r.rawScore}, decayed=${r.decayedScore}, tier=${r.trustTier}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
