import { expect, test } from "bun:test";
import { canUse, levelFromXp, levelProgress, raceXp, unlockedBetween, xpForLevel } from "./progress";

test("levels follow the xp curve", () => {
  expect(levelFromXp(0)).toBe(1);
  expect(levelFromXp(99)).toBe(1);
  expect(levelFromXp(100)).toBe(2);
  expect(levelFromXp(xpForLevel(10))).toBe(10);
  expect(levelProgress(150)).toEqual({ level: 2, into: 50, needed: 200 });
});

test("harder races and wins earn more xp", () => {
  expect(raceXp(60, 100, "hard", false)).toBeGreaterThan(raceXp(60, 100, "normal", false));
  expect(raceXp(60, 100, "normal", true) - raceXp(60, 100, "normal", false)).toBe(50);
  expect(raceXp(60, 50, "normal", false)).toBeLessThan(raceXp(60, 100, "normal", false));
});

test("cars are locked until their level", () => {
  expect(canUse({ paint: "cobalt", body: "gt" }, 1)).toBe(true);
  expect(canUse({ paint: "gold", body: "gt" }, 6)).toBe(false);
  expect(canUse({ paint: "gold", body: "hyper" }, 7)).toBe(true);
  expect(canUse({ paint: "nope" as never, body: "gt" }, 99)).toBe(false);
  expect(unlockedBetween(2, 3)).toEqual(["Sunset", "Muscle"]);
});
