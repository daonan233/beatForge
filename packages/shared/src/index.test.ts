import { describe, expect, it } from "vitest";
import { beatToTimeMs, snapBeat, timeMsToBeat, validateChartSet, type ChartSet } from "./index.js";

const anchors = [
  { beat: 0, timeMs: 100 },
  { beat: 1, timeMs: 600 },
  { beat: 2, timeMs: 1200 },
];

describe("timing conversion", () => {
  it("interpolates variable tempo in both directions", () => {
    expect(beatToTimeMs(1.5, anchors)).toBe(900);
    expect(timeMsToBeat(900, anchors)).toBe(1.5);
    expect(beatToTimeMs(-1, anchors)).toBe(-400);
  });

  it("snaps triplets", () => {
    expect(snapBeat(1.34, 1 / 3)).toBeCloseTo(4 / 3);
  });
});

describe("chart validation", () => {
  it("rejects malformed holds", () => {
    const chart = {
      schemaVersion: 1,
      songId: "song",
      revision: 1,
      generatorVersion: "test",
      laneCount: 4,
      timing: { meter: 4, anchors },
      charts: {
        easy: { notes: [{ id: "n", lane: 0, type: "hold", beat: 1, endBeat: 1 }] },
        normal: { notes: [] },
        hard: { notes: [] },
      },
      warnings: [],
    } as ChartSet;
    expect(validateChartSet(chart)).toContain("easy: invalid hold");
  });
});
