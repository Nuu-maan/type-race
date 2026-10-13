import { expect, test } from "bun:test";

process.env.DB_PATH = ":memory:";
const { ensurePlayer, getProfile, leaderboard, recordRace, setCar } = await import("./db");

test("races add xp, stats and leaderboard rows", () => {
  ensurePlayer("a", "Numan", "cobalt");
  ensurePlayer("b", "Friend", "crimson");
  recordRace({ player: "a", difficulty: "normal", wpm: 90, accuracy: 98, won: true, xp: 140 });
  recordRace({ player: "b", difficulty: "normal", wpm: 70, accuracy: 92, won: false, xp: 75 });
  recordRace({ player: "a", difficulty: "hard", wpm: 60, accuracy: 95, won: true, xp: 130 });

  const a = getProfile("a")!;
  expect(a.xp).toBe(270);
  expect(a.level).toBe(2);
  expect(a.races).toBe(2);
  expect(a.wins).toBe(2);
  expect(a.bestWpm).toBe(90);

  const board = leaderboard("normal");
  expect(board.map((r) => r.name)).toEqual(["Numan", "Friend"]);
  expect(leaderboard("hard")).toHaveLength(1);
  expect(leaderboard("easy")).toHaveLength(0);
});

test("locked cars are refused", () => {
  ensurePlayer("c", "New", "cobalt");
  expect(setCar("c", { paint: "gold", body: "gt" })).toBe(false);
  expect(setCar("c", { paint: "crimson", body: "gt" })).toBe(true);
  expect(getProfile("c")!.car.paint).toBe("crimson");
});

test("renaming keeps progress", () => {
  ensurePlayer("a", "Numan K", "cobalt");
  expect(getProfile("a")!.name).toBe("Numan K");
  expect(getProfile("a")!.xp).toBe(270);
});
