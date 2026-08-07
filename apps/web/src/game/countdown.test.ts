import { describe, expect, it } from "vitest";
import { countdownNumber, countdownRenderTimeMs, GAME_COUNTDOWN_SECONDS } from "./countdown";

describe("game countdown", () => {
  it("shows three full preparation beats", () => {
    const start = 10 + GAME_COUNTDOWN_SECONDS;
    expect(countdownNumber(10, start)).toBe(3);
    expect(countdownNumber(10.01, start)).toBe(3);
    expect(countdownNumber(11, start)).toBe(2);
    expect(countdownNumber(12, start)).toBe(1);
  });

  it("ends exactly when scheduled playback starts", () => {
    expect(countdownNumber(13, 13)).toBe(0);
    expect(countdownNumber(14, 13)).toBe(0);
  });

  it("previews the first chart note throughout the countdown", () => {
    expect(countdownRenderTimeMs(-3000, 1600, 1100)).toBe(-148);
    expect(countdownRenderTimeMs(-1500, 1600, 1100)).toBe(-74);
    expect(countdownRenderTimeMs(0, 1600)).toBe(0);
  });
});
