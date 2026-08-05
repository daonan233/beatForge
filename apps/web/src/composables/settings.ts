import { reactive, watch } from "vue";
import { clampScrollSpeed } from "../game/scroll";

export interface PlayerSettings {
  keys: string[];
  volume: number;
  latencyMs: number;
  scrollSpeed: number;
}

const defaults: PlayerSettings = {
  keys: ["KeyD", "KeyF", "KeyJ", "KeyK"],
  volume: 0.8,
  latencyMs: 0,
  scrollSpeed: 4,
};

const settingsVersion = 2;

function load(): PlayerSettings {
  try {
    const stored = JSON.parse(localStorage.getItem("beatforge-settings") ?? "{}") as Partial<PlayerSettings> & { version?: number };
    const merged = { ...defaults, ...stored };
    let scrollSpeed = Number(merged.scrollSpeed);
    if (stored.version !== settingsVersion && typeof stored.scrollSpeed === "number") {
      const legacy = Math.max(0.6, Math.min(2, stored.scrollSpeed));
      scrollSpeed = 1 + (legacy - 0.6) / 1.4 * 9;
    }
    return {
      keys: Array.isArray(merged.keys) && merged.keys.length === 4 ? merged.keys : [...defaults.keys],
      volume: Number(merged.volume),
      latencyMs: Number(merged.latencyMs),
      scrollSpeed: clampScrollSpeed(scrollSpeed),
    };
  } catch { return { ...defaults }; }
}

const settings = reactive<PlayerSettings>(load());
watch(settings, (value) => localStorage.setItem("beatforge-settings", JSON.stringify({ version: settingsVersion, ...value })), { deep: true });

export function useSettings() {
  const reset = () => Object.assign(settings, defaults);
  return { settings, reset };
}
