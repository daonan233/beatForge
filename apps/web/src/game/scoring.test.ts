import { describe, expect, it } from "vitest";
import { classifyTiming, judgementWindowsForDifficulty, normalizedScore } from "./scoring";

describe("rhythm scoring", () => {
  it("uses inclusive timing windows", () => {
    expect(classifyTiming(-45)).toBe("perfect");
    expect(classifyTiming(46)).toBe("great");
    expect(classifyTiming(90)).toBe("great");
    expect(classifyTiming(-140)).toBe("good");
    expect(classifyTiming(141)).toBe("miss");
  });

  it("normalizes a perfect run to one million", () => {
    expect(normalizedScore(100, 100)).toBe(1_000_000);
    expect(normalizedScore(0, 0)).toBe(0);
  });

  it("uses stricter windows for Ultra", () => {
    const ultra = judgementWindowsForDifficulty("ultra");
    expect(classifyTiming(25, ultra)).toBe("perfect");
    expect(classifyTiming(26, ultra)).toBe("great");
    expect(classifyTiming(85, ultra)).toBe("good");
    expect(classifyTiming(86, ultra)).toBe("miss");
  });
});
