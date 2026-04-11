import { query } from "./query.ts";
import { CompareInput } from "../types.ts";

export async function compare(input: CompareInput): Promise<
  { agentId: string; decayedScore: number; trustTier: "untrusted" | "basic" | "verified" | "elite"; error?: string }[]
> {
  const settled = await Promise.allSettled(
    input.agentIds.map(async (agentId) => {
      const score = await query({ agentId });
      return {
        agentId,
        decayedScore: score.decayedScore,
        trustTier: score.trustTier,
      };
    })
  );

  const results: { agentId: string; decayedScore: number; trustTier: "untrusted" | "basic" | "verified" | "elite"; error?: string }[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      results.push(s.value);
    } else {
      results.push({
        agentId: input.agentIds[i],
        decayedScore: -Infinity,
        trustTier: "untrusted",
        error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      });
    }
  }

  return results.sort((a, b) => {
    if (a.decayedScore === b.decayedScore) return 0;
    return a.decayedScore > b.decayedScore ? -1 : 1;
  });
}
