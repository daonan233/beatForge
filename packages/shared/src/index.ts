export type Difficulty = "easy" | "normal" | "hard";
export type NoteType = "tap" | "hold";
export type SongStatus = "queued" | "analyzing" | "ready" | "failed";
export type JobStatus = "queued" | "running" | "complete" | "failed";

export interface TimingAnchor {
  beat: number;
  timeMs: number;
  strength?: number;
  downbeat?: boolean;
}

export interface ChartNote {
  id: string;
  lane: 0 | 1 | 2 | 3;
  type: NoteType;
  beat: number;
  endBeat?: number;
  /** Generated-note micro timing relative to the snapped beat. Manual notes default to 0. */
  offsetMs?: number;
}

export interface DifficultyChart {
  notes: ChartNote[];
}

export interface ChartSet {
  schemaVersion: 1;
  songId: string;
  revision: number;
  generatorVersion: string;
  laneCount: 4;
  timing: {
    meter: 4;
    anchors: TimingAnchor[];
  };
  charts: Record<Difficulty, DifficultyChart>;
  warnings: string[];
}

export interface ScoreSummary {
  score: number;
  accuracy: number;
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  miss: number;
  createdAt?: string;
}

export interface SongSummary {
  id: string;
  title: string;
  artist: string;
  originalName: string;
  mimeType: string;
  durationMs: number;
  status: SongStatus;
  error?: string | null;
  revision?: number | null;
  createdAt: string;
  bestScores: Partial<Record<Difficulty, ScoreSummary>>;
}

export interface SongDetail extends SongSummary {
  analysis?: {
    bpm: number;
    confidence: number;
    waveform: number[];
    warnings: string[];
  } | null;
}

export interface AnalysisJob {
  id: string;
  songId: string;
  status: JobStatus;
  progress: number;
  stage: string;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function beatToTimeMs(beat: number, anchors: TimingAnchor[]): number {
  if (anchors.length === 0) return beat * 500;
  if (anchors.length === 1) return anchors[0].timeMs + (beat - anchors[0].beat) * 500;
  const sorted = anchors;
  let left = sorted[0];
  let right = sorted[1];
  if (beat <= left.beat) {
    right = sorted[1];
  } else if (beat >= sorted[sorted.length - 1].beat) {
    left = sorted[sorted.length - 2];
    right = sorted[sorted.length - 1];
  } else {
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo + 1 < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (sorted[mid].beat <= beat) lo = mid;
      else hi = mid;
    }
    left = sorted[lo];
    right = sorted[hi];
  }
  const span = right.beat - left.beat || 1;
  return left.timeMs + ((beat - left.beat) / span) * (right.timeMs - left.timeMs);
}

export function timeMsToBeat(timeMs: number, anchors: TimingAnchor[]): number {
  if (anchors.length === 0) return timeMs / 500;
  if (anchors.length === 1) return anchors[0].beat + (timeMs - anchors[0].timeMs) / 500;
  let left = anchors[0];
  let right = anchors[1];
  if (timeMs <= left.timeMs) {
    right = anchors[1];
  } else if (timeMs >= anchors[anchors.length - 1].timeMs) {
    left = anchors[anchors.length - 2];
    right = anchors[anchors.length - 1];
  } else {
    let lo = 0;
    let hi = anchors.length - 1;
    while (lo + 1 < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (anchors[mid].timeMs <= timeMs) lo = mid;
      else hi = mid;
    }
    left = anchors[lo];
    right = anchors[hi];
  }
  const span = right.timeMs - left.timeMs || 1;
  return left.beat + ((timeMs - left.timeMs) / span) * (right.beat - left.beat);
}

export function snapBeat(beat: number, step: number): number {
  return Math.round(beat / step) * step;
}

export function validateChartSet(chartSet: ChartSet): string[] {
  const errors: string[] = [];
  if (chartSet.schemaVersion !== 1) errors.push("Unsupported schema version");
  if (chartSet.laneCount !== 4) errors.push("laneCount must be 4");
  if (chartSet.timing.anchors.length < 2) errors.push("At least two timing anchors are required");
  for (let i = 1; i < chartSet.timing.anchors.length; i += 1) {
    const a = chartSet.timing.anchors[i - 1];
    const b = chartSet.timing.anchors[i];
    if (b.beat <= a.beat || b.timeMs <= a.timeMs) errors.push("Timing anchors must increase");
  }
  for (const difficulty of ["easy", "normal", "hard"] as Difficulty[]) {
    for (const note of chartSet.charts[difficulty]?.notes ?? []) {
      if (!Number.isFinite(note.beat) || note.beat < 0) errors.push(`${difficulty}: invalid beat`);
      if (note.lane < 0 || note.lane > 3) errors.push(`${difficulty}: invalid lane`);
      if (note.offsetMs != null && (!Number.isFinite(note.offsetMs) || Math.abs(note.offsetMs) > 180)) {
        errors.push(`${difficulty}: invalid offsetMs`);
      }
      if (note.type === "hold" && (!Number.isFinite(note.endBeat) || note.endBeat! <= note.beat)) {
        errors.push(`${difficulty}: invalid hold`);
      }
    }
  }
  return errors;
}
