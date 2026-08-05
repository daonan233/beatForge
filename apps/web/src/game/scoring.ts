export type Grade = "perfect" | "great" | "good" | "miss";

export const judgementWindows = { perfect: 45, great: 90, good: 140 } as const;
export const judgementWeights: Record<Grade, number> = { perfect: 1, great: 0.72, good: 0.35, miss: 0 };

export function classifyTiming(deltaMs: number): Grade {
  const absolute = Math.abs(deltaMs);
  if (absolute <= judgementWindows.perfect) return "perfect";
  if (absolute <= judgementWindows.great) return "great";
  if (absolute <= judgementWindows.good) return "good";
  return "miss";
}

export function normalizedScore(weightedHits: number, totalEvents: number): number {
  return totalEvents > 0 ? Math.round(weightedHits / totalEvents * 1_000_000) : 0;
}
