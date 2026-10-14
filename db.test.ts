import { expect, test } from "bun:test";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? ":memory:";
const { ensurePlayer, getProfile, leaderboard, recordRace, setCar } = await import("./db");

test("races add xp, stats and leaderboard rows", async () => {
  await ensurePlayer("a", "Numan", "cobalt");
  await ensurePlayer("b", "Friend", "crimson");
  await recordRace({ player: "a", difficulty: "normal", wpm: 90, accuracy: 98, won: true, xp: 140 });
  await recordRace({ player: "b", difficulty: "normal", wpm: 70, accuracy: 92, won: false, xp: 75 });
  await recordRace({ player: "a", difficulty: "hard", wpm: 60, accuracy: 95, won: true, xp: 130 });

  const a = (await getProfile("a"))!;
  expect(a.xp).toBe(270);
  expect(a.level).toBe(2);
  expect(a.races).toBe(2);
  expect(a.wins).toBe(2);
  expect(a.bestWpm).toBe(90);

  const board = await leaderboard("normal");
  expect(board.map((r) => r.name)).toEqual(["Numan", "Friend"]);
  expect(await leaderboard("hard")).toHaveLength(1);
  expect(await leaderboard("easy")).toHaveLength(0);
});

test("locked cars are refused", async () => {
  await ensurePlayer("c", "New", "cobalt");
  expect(await setCar("c", { paint: "gold", body: "gt" })).toBe(false);
  expect(await setCar("c", { paint: "crimson", body: "gt" })).toBe(true);
  expect((await getProfile("c"))!.car.paint).toBe("crimson");
});

test("renaming keeps progress", async () => {
  await ensurePlayer("a", "Numan K", "cobalt");
  expect((await getProfile("a"))!.name).toBe("Numan K");
  expect((await getProfile("a"))!.xp).toBe(270);
});
