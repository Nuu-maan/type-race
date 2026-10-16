import { expect, test } from "bun:test";
import { dayKey } from "../shared/challenge";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? ":memory:";
const { bestGhost, competitions, dailyChallenge, databaseReady, ensurePlayer, getProfile, leaderboard, logEvent, recordAttempt, recordRace, setCar } = await import("./db");

test("Render refuses disposable database storage", async () => {
  const child = Bun.spawn([process.execPath, "-e", "await import('./src/server/db.ts')"], {
    cwd: `${import.meta.dir}/../..`,
    env: { ...process.env, DATABASE_URL: "", RENDER: "true" },
    stdout: "ignore",
    stderr: "pipe",
  });
  expect(await child.exited).not.toBe(0);
  expect(await new Response(child.stderr).text()).toContain("DATABASE_URL is required on Render");
});

test("database readiness and daily text are stable", async () => {
  expect(await databaseReady()).toBe(true);
  const now = Date.UTC(2026, 9, 16, 10);
  const first = await dailyChallenge(now);
  const second = await dailyChallenge(now + 60_000);
  expect(second).toEqual(first);
  expect(first).toMatchObject({ key: "2026-10-16", difficulty: "normal", endsAt: Date.UTC(2026, 9, 17) });
  expect(first.text.length).toBeGreaterThan(100);
});

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

test("leaderboards keep accuracy paired with the scored race", async () => {
  await ensurePlayer("paired", "Paired", "sunset");
  await recordRace({ player: "paired", difficulty: "easy", wpm: 100, accuracy: 70, won: false, xp: 10 });
  await recordRace({ player: "paired", difficulty: "easy", wpm: 90, accuracy: 99, won: true, xp: 10 });
  const [row] = await leaderboard("easy");
  expect(row).toMatchObject({ name: "Paired", bestWpm: 100, accuracy: 70, races: 2, wins: 1 });
});

test("race writes return authoritative xp", async () => {
  await ensurePlayer("xp", "XP", "violet");
  const first = await recordRace({ player: "xp", difficulty: "normal", wpm: 50, accuracy: 100, won: false, xp: 60 });
  const second = await recordAttempt({
    player: "xp",
    mode: "practice",
    difficulty: "normal",
    seed: 1,
    wpm: 50,
    accuracy: 100,
    durationMs: 60_000,
    won: true,
    xp: 30,
  });
  expect(first).toEqual({ xp: 60, awarded: 60 });
  expect(second).toEqual({ xp: 90, awarded: 30 });
});

test("retrying the same race does not add XP twice", async () => {
  await ensurePlayer("retry", "Retry", "aqua");
  const attempt = {
    runId: "same-run",
    player: "retry",
    difficulty: "normal" as const,
    wpm: 50,
    accuracy: 100,
    won: true,
    xp: 60,
  };
  expect(await recordRace(attempt)).toEqual({ xp: 60, awarded: 60 });
  expect(await recordRace(attempt)).toEqual({ xp: 60, awarded: 0 });
  expect((await getProfile("retry"))!.races).toBe(1);
});

test("unfinished traces cannot become personal ghosts", async () => {
  await ensurePlayer("unfinished", "Unfinished", "cobalt");
  await recordAttempt({
    player: "unfinished",
    mode: "practice",
    difficulty: "normal",
    seed: 1,
    wpm: 100,
    accuracy: 100,
    durationMs: 30_000,
    finished: false,
    won: false,
    xp: 10,
    trace: [[0, 0], [30_000, 700]],
    text: "unfinished text",
  });
  expect(await bestGhost("unfinished")).toBeNull();
  expect((await getProfile("unfinished"))!.ghostReady).toBe(false);
});

test("unfinished races stay in history without rewards or records", async () => {
  await ensurePlayer("unrewarded", "Still racing", "cobalt");
  const attempt = {
    player: "unrewarded",
    mode: "ghost" as const,
    difficulty: "normal" as const,
    seed: 4,
    wpm: 200,
    accuracy: 100,
    durationMs: 30_000,
    finished: false,
    won: false,
    xp: 200,
  };
  expect(await recordAttempt(attempt)).toEqual({ xp: 0, awarded: 0 });
  expect(await recordRace({ ...attempt, mode: "multiplayer" })).toEqual({ xp: 0, awarded: 0 });
  const profile = await getProfile("unrewarded");
  expect(profile).toMatchObject({ xp: 0, bestWpm: 0, averageAccuracy: 0, records: [] });
  expect(profile!.history.map((race) => race.xp)).toEqual([0, 0]);
  expect((await leaderboard("normal")).some((row) => row.name === "Still racing")).toBe(false);
});

test("locked cars are refused", async () => {
  await ensurePlayer("c", "New", "cobalt");
  expect(await setCar("c", { paint: "gold", body: "gt" })).toBe(false);
  expect(await setCar("c", { paint: "crimson", body: "gt" })).toBe(true);
  expect((await getProfile("c"))!.car.paint).toBe("crimson");
});

test("renaming keeps progress", async () => {
  await ensurePlayer("rename", "Before", "cobalt");
  await recordRace({ player: "rename", difficulty: "normal", wpm: 40, accuracy: 90, won: false, xp: 25 });
  await ensurePlayer("rename", "After", "cobalt");
  expect((await getProfile("rename"))!.name).toBe("After");
  expect((await getProfile("rename"))!.xp).toBe(25);
});

test("race records require an existing player", async () => {
  await expect(recordRace({ player: "missing", difficulty: "normal", wpm: 40, accuracy: 90, won: false, xp: 25 })).rejects.toThrow();
});

test("attempts build history, goals, ghost data and competitions", async () => {
  await ensurePlayer("d", "Daily", "lime");
  await logEvent({ player: "d", session: "session-d", name: "first_keystroke", elapsedMs: 4200 });
  await logEvent({ player: "d", session: "session-d", name: "first_keystroke", elapsedMs: 100 });
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
    text: "saved daily text",
  });
  await recordAttempt({
    player: "d",
    mode: "daily",
    difficulty: "normal",
    seed: 42,
    challengeKey: dayKey(),
    wpm: 85,
    accuracy: 80,
    durationMs: 44_000,
    won: true,
    xp: 50,
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
  expect(profile).toMatchObject({
    races: 3,
    bestWpm: 85,
    averageAccuracy: 91,
    practiceRaces: 1,
    dailyRaces: 2,
    dailyStreak: 1,
    readyInMs: 4200,
    ghostReady: true,
  });
  expect(profile.records).toEqual([
    expect.objectContaining({ mode: "daily", difficulty: "normal", wpm: 85, accuracy: 80 }),
    expect.objectContaining({ mode: "practice", difficulty: "easy", wpm: 70, accuracy: 96 }),
  ]);
  expect(profile.history.map((attempt) => attempt.mode)).toEqual(["practice", "daily", "daily"]);
  expect(profile.goals.find((goal) => goal.id === "daily")?.current).toBe(1);
  expect(await bestGhost("d")).toMatchObject({
    seed: 42,
    difficulty: "normal",
    wpm: 80,
    accuracy: 97,
    durationMs: 45_000,
    text: "saved daily text",
  });

  const board = await competitions("d");
  expect(board.daily.you).toMatchObject({ name: "Daily", score: 77, wpm: 80, accuracy: 97 });
  expect(board.weekly.you).toMatchObject({ days: 1, score: 77, wpm: 80, accuracy: 97 });
});
