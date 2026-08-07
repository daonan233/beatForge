import type { Grade } from "./scoring";

export type HitSoundKind = "tap" | "holdHead" | "holdTail";

export interface HitSoundOptions {
  kind: HitSoundKind;
  lane: number;
  grade: Exclude<Grade, "miss">;
  volume: number;
}

interface HitSoundProfile {
  playbackRate: number;
  level: number;
}

// These are fixed CC0 acoustic cymbal recordings. Web Audio is used only as a
// low-latency sample player; no oscillator or synthetic sound is generated.
const samples: Record<HitSoundKind, string> = {
  tap: "/sfx/hit-tap.ogg?v=cymbal-3",
  holdHead: "/sfx/hit-hold-head.ogg?v=cymbal-3",
  holdTail: "/sfx/hit-hold-tail.ogg?v=cymbal-3",
};

const gradeLevel: Record<Exclude<Grade, "miss">, number> = {
  perfect: 1,
  great: 0.94,
  good: 0.84,
};

export function hitSoundProfile(options: HitSoundOptions): HitSoundProfile {
  const kindRate = options.kind === "holdHead" ? 0.98 : options.kind === "holdTail" ? 1.02 : 1;
  const kindLevel = options.kind === "holdHead" ? 0.9 : options.kind === "holdTail" ? 0.82 : 1;
  return {
    // Keep lanes at the same pitch. Rhythm-game key sounds should reinforce
    // timing without adding a four-note melody over the song.
    playbackRate: kindRate,
    level: kindLevel * gradeLevel[options.grade] * Math.max(0, Math.min(1, options.volume)),
  };
}

export class HitSoundPlayer {
  private readonly buffers = new Map<HitSoundKind, AudioBuffer>();
  private readonly activeSources = new Set<AudioBufferSourceNode>();
  private readonly loading: Promise<void>;

  constructor(private readonly context: AudioContext) {
    this.loading = this.loadSamples();
  }

  private async loadSamples() {
    await Promise.all(Object.entries(samples).map(async ([kind, url]) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        this.buffers.set(kind as HitSoundKind, buffer);
      } catch (error) {
        console.warn(`Failed to preload ${kind} hit sound`, error);
      }
    }));
  }

  async prepare() {
    await this.loading;
  }

  play(options: HitSoundOptions) {
    const buffer = this.buffers.get(options.kind);
    if (!buffer || this.context.state !== "running") return;
    const profile = hitSoundProfile(options);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = profile.playbackRate;
    gain.gain.value = profile.level;
    source.connect(gain).connect(this.context.destination);
    this.activeSources.add(source);
    source.addEventListener("ended", () => {
      this.activeSources.delete(source);
      source.disconnect();
      gain.disconnect();
    }, { once: true });
    // Scheduling on the song's own audio clock removes HTMLMediaElement queue delay.
    source.start(this.context.currentTime);
  }

  dispose() {
    for (const source of this.activeSources) {
      try { source.stop(); } catch { /* source may already have ended */ }
      source.disconnect();
    }
    this.activeSources.clear();
    this.buffers.clear();
  }
}
