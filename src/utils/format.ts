export function formatScore(value: number, decimals = 2): string {
  const scaled = value / 10 ** decimals;
  return scaled.toFixed(decimals);
}
