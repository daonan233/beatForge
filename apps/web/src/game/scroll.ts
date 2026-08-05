export const MIN_SCROLL_SPEED = 1;
export const MAX_SCROLL_SPEED = 10;

export function clampScrollSpeed(speed: number): number {
  return Math.max(MIN_SCROLL_SPEED, Math.min(MAX_SCROLL_SPEED, Math.round(speed)));
}

export function approachDurationMs(speed: number): number {
  // 1 档便于读谱，10 档仍保留约 0.7 秒的可视时间。
  return 4800 / (0.6 + clampScrollSpeed(speed) * 0.62);
}

export function perspectiveProgress(linearProgress: number): number {
  const progress = Math.max(0, Math.min(1.08, linearProgress));
  // 等时间间隔越接近判定线，屏幕位移越大，形成真实的透视加速感。
  return Math.pow(progress, 2.3);
}
