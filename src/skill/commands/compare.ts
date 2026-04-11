import { query } from "./query.ts";
import { CompareInput } from "../types.ts";

export async function compare(input: CompareInput): Promise<
  { agentId: string; decayedScore: number; trustTier: "untrusted" | "basic" | "verified" | "elite" }[]
> {
  const results = await Promise.all(
    input.agentIds.map(async (agentId) => {
      const score = await query({ agentId });
      return {
        agentId,
        decayedScore: score.decayedScore,
        trustTier: score.trustTier,
      };
    })
  );

  return results.sort((a, b) => b.decayedScore - a.decayedScore);
}
