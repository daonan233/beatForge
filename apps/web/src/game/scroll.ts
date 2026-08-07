export const MIN_SCROLL_SPEED = 1;
export const MAX_SCROLL_SPEED = 30;
const LEGACY_MAX_SCROLL_SPEED = 10;

export function clampScrollSpeed(speed: number): number {
  return Math.max(MIN_SCROLL_SPEED, Math.min(MAX_SCROLL_SPEED, Math.round(speed)));
}

export function approachDurationMs(speed: number): number {
  const level = clampScrollSpeed(speed);
  // 1～10 档保持原手感；11～30 档继续提速，30 档精确为原 10 档的 3 倍。
  if (level <= LEGACY_MAX_SCROLL_SPEED) return 4800 / (0.6 + level * 0.62);
  const levelTenDuration = 4800 / (0.6 + LEGACY_MAX_SCROLL_SPEED * 0.62);
  const multiplier = 1 + (level - LEGACY_MAX_SCROLL_SPEED) * 0.1;
  return levelTenDuration / multiplier;
}

export function perspectiveProgress(linearProgress: number): number {
  const progress = Math.max(0, Math.min(1.08, linearProgress));
  // 等时间间隔越接近判定线，屏幕位移越大，形成真实的透视加速感。
  return Math.pow(progress, 2.3);
}
