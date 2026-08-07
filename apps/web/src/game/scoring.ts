import type { Difficulty } from "@beatforge/shared";

export type Grade = "perfect" | "great" | "good" | "miss";

export const judgementWindows = { perfect: 45, great: 90, good: 140 } as const;
export const ultraJudgementWindows = { perfect: 25, great: 55, good: 85 } as const;
export type JudgementWindows = { perfect: number; great: number; good: number };
export const judgementWeights: Record<Grade, number> = { perfect: 1, great: 0.72, good: 0.35, miss: 0 };

export function judgementWindowsForDifficulty(difficulty: Difficulty): JudgementWindows {
  return difficulty === "ultra" ? ultraJudgementWindows : judgementWindows;
}

export function classifyTiming(deltaMs: number, windows: JudgementWindows = judgementWindows): Grade {
  const absolute = Math.abs(deltaMs);
  if (absolute <= windows.perfect) return "perfect";
  if (absolute <= windows.great) return "great";
  if (absolute <= windows.good) return "good";
  return "miss";
}

export function normalizedScore(weightedHits: number, totalEvents: number): number {
  return totalEvents > 0 ? Math.round(weightedHits / totalEvents * 1_000_000) : 0;
}
