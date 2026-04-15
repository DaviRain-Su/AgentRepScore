import { query } from "./query.ts";
import { CompareInput, CompareResultItem } from "../types.ts";

export async function compare(input: CompareInput): Promise<CompareResultItem[]> {
  const settled = await Promise.allSettled(
    input.agentIds.map(async (agentId) => {
      const score = await query({ agentId });
      return {
        agentId,
        decayedScore: score.decayedScore,
        trustTier: score.trustTier,
        correlationPenalty: score.correlation.penalty,
        correlationRuleCount: score.correlation.ruleCount,
        verifiedEvidence: score.verifiedEvidence,
        evidenceMode: score.evidenceMode,
      };
    })
  );

  const results: CompareResultItem[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      results.push(s.value);
    } else {
      results.push({
        agentId: input.agentIds[i],
        decayedScore: -Infinity,
        trustTier: "untrusted",
        correlationPenalty: 0,
        correlationRuleCount: 0,
        verifiedEvidence: false,
        evidenceMode: "legacy-summary",
        error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      });
    }
  }

  return results.sort((a, b) => {
    if (a.decayedScore === b.decayedScore) return 0;
    return a.decayedScore > b.decayedScore ? -1 : 1;
  });
}
