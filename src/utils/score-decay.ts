export function applyDecay(rawScore: number, evaluationTimestamp: number): number {
  const daysElapsed = (Date.now() / 1000 - evaluationTimestamp) / 86400;
  const decayFactor = Math.max(0.1, 1.0 - 0.02 * daysElapsed);
  return Math.round(rawScore * decayFactor);
}

export function trustTier(score: number): "untrusted" | "basic" | "verified" | "elite" {
  if (score <= 2000) return "untrusted";
  if (score <= 5000) return "basic";
  if (score <= 8000) return "verified";
  return "elite";
}
