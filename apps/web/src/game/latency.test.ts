import { describe, expect, it } from "vitest";
import { estimateLatencyMs, median } from "./latency";

describe("latency calibration", () => {
  it("calculates medians for odd and even sample counts", () => {
    expect(median([8, 2, 5])).toBe(5);
    expect(median([8, 2, 5, 3])).toBe(4);
  });

  it("rejects a mistap and keeps the stable device offset", () => {
    expect(estimateLatencyMs([47, 52, 49, 51, 48, 190, 50, 53])).toBe(50);
  });

  it("requires enough taps and clamps the setting range", () => {
    expect(estimateLatencyMs([20, 21, 19])).toBeNull();
    expect(estimateLatencyMs([250, 251, 249, 252])).toBe(200);
  });
});
