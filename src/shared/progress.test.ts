import { expect, test } from "bun:test";
import { canUse, effortXp, levelFromXp, levelProgress, placeBonus, raceXp, unlockedBetween, xpForLevel } from "./progress";

test("levels follow the xp curve", () => {
  expect(levelFromXp(0)).toBe(1);
  expect(levelFromXp(99)).toBe(1);
  expect(levelFromXp(100)).toBe(2);
  expect(levelFromXp(xpForLevel(10))).toBe(10);
  expect(levelProgress(150)).toEqual({ level: 2, into: 50, needed: 200 });
});

test("harder races and better places earn more xp", () => {
  expect(raceXp(60, 100, "hard", 2, 2)).toBeGreaterThan(raceXp(60, 100, "normal", 2, 2));
  expect(raceXp(60, 100, "normal", 1, 2) - raceXp(60, 100, "normal", 2, 2)).toBe(50);
  expect(raceXp(60, 50, "normal", 2, 2)).toBeLessThan(raceXp(60, 100, "normal", 2, 2));
  expect(effortXp(60, 100, "normal")).toBe(70);
});

test("place bonuses reward the podium but never last place", () => {
  expect([1, 2].map((p) => placeBonus(p, 2))).toEqual([50, 0]);
  expect([1, 2, 3].map((p) => placeBonus(p, 3))).toEqual([50, 25, 0]);
  expect([1, 2, 3, 4, 5].map((p) => placeBonus(p, 5))).toEqual([50, 25, 10, 0, 0]);
});

test("cars are locked until their level", () => {
  expect(canUse({ paint: "cobalt", body: "gt" }, 1)).toBe(true);
  expect(canUse({ paint: "gold", body: "gt" }, 5)).toBe(false);
  expect(canUse({ paint: "gold", body: "hyper" }, 6)).toBe(true);
  expect(canUse({ paint: "nope" as never, body: "gt" }, 99)).toBe(false);
  expect(unlockedBetween(3, 5)).toEqual(["Aqua", "Hyper"]);
});
