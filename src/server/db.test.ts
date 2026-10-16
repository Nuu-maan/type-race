import { expect, test } from "bun:test";
import { dayKey } from "../shared/challenge";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? ":memory:";
const { bestGhost, competitions, ensurePlayer, getProfile, leaderboard, logEvent, recordAttempt, recordRace, setCar } = await import("./db");

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

test("attempts build history, goals, ghost data and competitions", async () => {
  await ensurePlayer("d", "Daily", "lime");
  await logEvent({ player: "d", session: "session-d", name: "first_keystroke", elapsedMs: 4200 });
  await recordAttempt({
    player: "d",
    mode: "daily",
    difficulty: "normal",
    seed: 42,
    challengeKey: dayKey(),
    wpm: 80,
    accuracy: 97,
    durationMs: 45_000,
    won: true,
    xp: 90,
    firstKeyMs: 4200,
    trace: [[0, 0], [22_500, 500], [45_000, 1000]],
  });
  await recordAttempt({
    player: "d",
    mode: "practice",
    difficulty: "easy",
    seed: 43,
    wpm: 70,
    accuracy: 96,
    durationMs: 50_000,
    won: true,
    xp: 40,
  });

  const profile = (await getProfile("d"))!;
  expect(profile).toMatchObject({ races: 2, bestWpm: 80, averageAccuracy: 97, practiceRaces: 2, dailyStreak: 1, readyInMs: 4200 });
  expect(profile.history.map((attempt) => attempt.mode)).toEqual(["practice", "daily"]);
  expect(profile.goals.find((goal) => goal.id === "daily")?.current).toBe(1);
  expect(await bestGhost("d")).toMatchObject({ wpm: 80, durationMs: 45_000 });

  const board = await competitions("d");
  expect(board.daily.you).toMatchObject({ name: "Daily", score: 77 });
  expect(board.weekly.you).toMatchObject({ days: 1, score: 77 });
});
