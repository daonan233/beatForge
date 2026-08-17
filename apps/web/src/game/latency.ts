export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function estimateLatencyMs(offsetsMs: number[]): number | null {
  if (offsetsMs.length < 4) return null;
  const center = median(offsetsMs);
  const deviation = median(offsetsMs.map((value) => Math.abs(value - center)));
  const tolerance = Math.max(45, deviation * 2.5);
  const stable = offsetsMs.filter((value) => Math.abs(value - center) <= tolerance);
  if (stable.length < 4) return null;
  const average = stable.reduce((total, value) => total + value, 0) / stable.length;
  return Math.max(-200, Math.min(200, Math.round(average)));
}
