import { describe, expect, it } from "vitest";
import { approachDurationMs, clampScrollSpeed, perspectiveProgress } from "./scroll";

describe("perspective note scroll", () => {
  it("supports and clamps integer speed levels 1 through 30", () => {
    expect(clampScrollSpeed(-2)).toBe(1);
    expect(clampScrollSpeed(5.4)).toBe(5);
    expect(clampScrollSpeed(50)).toBe(30);
    expect(approachDurationMs(1)).toBeGreaterThan(approachDurationMs(30));
  });

  it("keeps level 15 at 1.5x and makes level 30 exactly 3x the old maximum", () => {
    expect(approachDurationMs(15)).toBeCloseTo(approachDurationMs(10) / 1.5, 8);
    expect(approachDurationMs(30)).toBeCloseTo(approachDurationMs(10) / 3, 8);
    expect(approachDurationMs(11)).toBeLessThan(approachDurationMs(10));
  });

  it("moves farther during each equal interval near the judgement line", () => {
    const positions = [0, 0.25, 0.5, 0.75, 1].map(perspectiveProgress);
    const distances = positions.slice(1).map((value, index) => value - positions[index]);
    expect(distances[1]).toBeGreaterThan(distances[0]);
    expect(distances[2]).toBeGreaterThan(distances[1]);
    expect(distances[3]).toBeGreaterThan(distances[2]);
  });
});
