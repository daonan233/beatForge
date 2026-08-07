import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChartSet } from "@beatforge/shared";
import { Database } from "./database.js";

let directory: string;
let database: Database;

function chart(): ChartSet {
  return {
    schemaVersion: 1, songId: "song", revision: 1, generatorVersion: "test", laneCount: 4,
    timing: { meter: 4, anchors: [{ beat: 0, timeMs: 0 }, { beat: 1, timeMs: 500 }] },
    charts: { easy: { notes: [] }, normal: { notes: [] }, hard: { notes: [] }, ultra: { notes: [] } }, warnings: [],
  };
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "beatforge-db-"));
  database = new Database(directory);
  database.createSong({ id: "song", title: "Test", artist: "", originalName: "test.mp3", mimeType: "audio/mpeg", audioPath: "test.mp3", durationMs: 1000 });
  database.saveGeneratedResult("song", chart(), { bpm: 120, confidence: 1, durationMs: 1000, waveform: [0, 1], warnings: [] });
});

afterEach(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });

describe("chart revisions", () => {
  it("rejects stale updates and increments valid updates", () => {
    const current = database.getChartSet("song")!;
    expect(current.revision).toBe(1);
    current.charts.easy.notes.push({ id: "n", lane: 0, type: "tap", beat: 0 });
    const updated = database.updateChartSet("song", 1, current);
    expect(updated).not.toBe("conflict");
    expect(updated !== "conflict" && updated?.revision).toBe(2);
    expect(database.updateChartSet("song", 1, current)).toBe("conflict");
  });

  it("keeps only the better score", () => {
    const result = { score: 800000, accuracy: 88, maxCombo: 20, perfect: 20, great: 5, good: 2, miss: 1 };
    database.upsertBestScore("song", "easy", 1, result);
    const best = database.upsertBestScore("song", "easy", 1, { ...result, score: 700000 });
    expect(best.score).toBe(800000);
  });
});
