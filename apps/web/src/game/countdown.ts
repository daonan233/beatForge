export const GAME_COUNTDOWN_SECONDS = 3;

export function countdownNumber(nowSeconds: number, startSeconds: number) {
  return Math.max(0, Math.ceil(startSeconds - nowSeconds));
}

export function countdownRenderTimeMs(rawTimeMs: number, approachMs: number, firstNoteTimeMs = 0) {
  const durationMs = GAME_COUNTDOWN_SECONDS * 1000;
  const elapsedMs = Math.max(0, Math.min(durationMs, rawTimeMs + durationMs));
  // Start with the first note just inside the normal approach window. This keeps
  // the real chart visible during the countdown, including songs with a short intro.
  const previewStartMs = Math.min(0, firstNoteTimeMs - approachMs * 0.78);
  return previewStartMs + elapsedMs / durationMs * -previewStartMs;
}
