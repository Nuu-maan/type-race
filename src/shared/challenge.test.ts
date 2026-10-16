import { expect, test } from "bun:test";
import { challengeSeed, dayKey, isRaceMode, nextWpmTarget, tracePosition, weekKey } from "./challenge";

test("daily challenges are stable for a UTC date", () => {
  const morning = Date.UTC(2026, 9, 16, 1);
  const evening = Date.UTC(2026, 9, 16, 23);
  expect(dayKey(morning)).toBe("2026-10-16");
  expect(dayKey(evening)).toBe("2026-10-16");
  expect(challengeSeed(dayKey(morning))).toBe(challengeSeed(dayKey(evening)));
  expect(challengeSeed("2026-10-17")).not.toBe(challengeSeed("2026-10-16"));
});

test("weekly competition starts on Monday UTC", () => {
  expect(weekKey(Date.UTC(2026, 9, 12))).toBe("2026-10-12");
  expect(weekKey(Date.UTC(2026, 9, 18, 23, 59))).toBe("2026-10-12");
  expect(weekKey(Date.UTC(2026, 9, 19))).toBe("2026-10-19");
});

test("race modes and personal targets stay bounded", () => {
  expect(isRaceMode("ghost")).toBe(true);
  expect(isRaceMode("ranked")).toBe(false);
  expect(nextWpmTarget(0)).toBe(20);
  expect(nextWpmTarget(59)).toBe(60);
  expect(nextWpmTarget(60)).toBe(65);
  expect(nextWpmTarget(200)).toBe(200);
});

test("ghost traces interpolate and stop at their last position", () => {
  const trace: [number, number][] = [[0, 0], [1000, 400], [2000, 1000]];
  expect(tracePosition(trace, -1)).toBe(0);
  expect(tracePosition(trace, 500)).toBe(200);
  expect(tracePosition(trace, 1500)).toBe(700);
  expect(tracePosition(trace, 3000)).toBe(1000);
  expect(tracePosition([], 1000)).toBe(0);
});
