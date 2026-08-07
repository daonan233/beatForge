import { describe, expect, it } from "vitest";
import { hitSoundProfile } from "./hit-sound";

describe("hit sound profiles", () => {
  it("uses distinct tones for tap and hold events", () => {
    const tap = hitSoundProfile({ kind: "tap", lane: 1, grade: "perfect", volume: 1 });
    const head = hitSoundProfile({ kind: "holdHead", lane: 1, grade: "perfect", volume: 1 });
    const tail = hitSoundProfile({ kind: "holdTail", lane: 1, grade: "perfect", volume: 1 });
    expect(head.playbackRate).toBeLessThan(tap.playbackRate);
    expect(tail.playbackRate).toBeGreaterThan(tap.playbackRate);
  });

  it("keeps judgement pitch stable and makes weaker judgements softer", () => {
    const perfect = hitSoundProfile({ kind: "tap", lane: 1, grade: "perfect", volume: 1 });
    const good = hitSoundProfile({ kind: "tap", lane: 1, grade: "good", volume: 1 });
    expect(good.playbackRate).toBe(perfect.playbackRate);
    expect(good.level).toBeLessThan(perfect.level);
  });

  it("clamps volume and lane inputs", () => {
    const silent = hitSoundProfile({ kind: "tap", lane: -5, grade: "perfect", volume: -1 });
    const loud = hitSoundProfile({ kind: "tap", lane: 99, grade: "perfect", volume: 3 });
    expect(silent.level).toBe(0);
    expect(loud.level).toBeLessThanOrEqual(1);
    expect(loud.playbackRate).toBe(1);
  });
});
