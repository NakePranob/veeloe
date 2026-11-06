// Tokens as the Budget screens show them: 2.4M, 300K.
export function formatTokens(count: number) {
  if (count >= 1_000_000) return `${+(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return `${count}`;
}
