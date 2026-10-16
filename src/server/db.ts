import { SQL } from "bun";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { challengeSeed, dayKey, nextWpmTarget, weekKey, type RaceMode } from "../shared/challenge";
import { canUse, levelFromXp, type Car, type Difficulty } from "../shared/progress";
import { generateText } from "../shared/words";

function connect() {
  if (process.env.DATABASE_URL) return new SQL(process.env.DATABASE_URL, { prepare: false });
  const path = process.env.DB_PATH ?? "data/type-race.sqlite";
  if (path === ":memory:") return new SQL(":memory:");
  mkdirSync(dirname(path), { recursive: true });
  return new SQL(`sqlite://${path}`);
}

const db = connect();
const postgres = db.options.adapter === "postgres";

async function migrate() {
  if (!postgres) await db.unsafe("PRAGMA foreign_keys = ON");
  await db.unsafe(`CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    paint TEXT NOT NULL DEFAULT 'cobalt',
    body TEXT NOT NULL DEFAULT 'gt',
    created_at BIGINT NOT NULL
  )`);
  await db.unsafe(`CREATE TABLE IF NOT EXISTS races (
    id ${postgres ? "BIGINT GENERATED ALWAYS AS IDENTITY" : "INTEGER"} PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id),
    difficulty TEXT NOT NULL,
    wpm INTEGER NOT NULL,
    accuracy INTEGER NOT NULL,
    won INTEGER NOT NULL,
    xp INTEGER NOT NULL,
    at BIGINT NOT NULL
  )`);
  await db.unsafe("CREATE INDEX IF NOT EXISTS races_by_difficulty ON races (difficulty, player_id)");
  await db.unsafe(`CREATE TABLE IF NOT EXISTS attempts (
    id ${postgres ? "BIGINT GENERATED ALWAYS AS IDENTITY" : "INTEGER"} PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE,
    player_id TEXT NOT NULL REFERENCES players(id),
    mode TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    seed BIGINT NOT NULL,
    challenge_key TEXT,
    wpm INTEGER NOT NULL,
    accuracy INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    finished INTEGER NOT NULL DEFAULT 1,
    won INTEGER NOT NULL,
    xp INTEGER NOT NULL,
    first_key_ms INTEGER,
    trace TEXT,
    text TEXT,
    at BIGINT NOT NULL
  )`);
  await db.unsafe("CREATE INDEX IF NOT EXISTS attempts_by_player ON attempts (player_id, at)");
  await db.unsafe("CREATE INDEX IF NOT EXISTS attempts_by_challenge ON attempts (challenge_key, player_id)");
  await db.unsafe(`CREATE TABLE IF NOT EXISTS events (
    id ${postgres ? "BIGINT GENERATED ALWAYS AS IDENTITY" : "INTEGER"} PRIMARY KEY,
    player_id TEXT,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    elapsed_ms INTEGER,
    detail TEXT,
    at BIGINT NOT NULL
  )`);
  await db.unsafe("CREATE INDEX IF NOT EXISTS events_by_player ON events (player_id, at)");
  await db.unsafe("CREATE UNIQUE INDEX IF NOT EXISTS one_activation_event ON events (session_id, name) WHERE name IN ('landing', 'first_keystroke')");
  await db.unsafe(`CREATE TABLE IF NOT EXISTS challenges (
    key TEXT PRIMARY KEY,
    seed BIGINT NOT NULL,
    difficulty TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`);
}

const ready = migrate();
ready.catch((error) => console.error("Database setup failed:", error));

export async function databaseReady() {
  await ready;
  const [row] = await db`SELECT 1 AS ok`;
  return row.ok === 1;
}

export async function dailyChallenge(now = Date.now()) {
  await ready;
  const key = dayKey(now);
  const seed = challengeSeed(key);
  const difficulty: Difficulty = "normal";
  await db`
    INSERT INTO challenges (key, seed, difficulty, text, created_at)
    VALUES (${key}, ${seed}, ${difficulty}, ${generateText(seed, difficulty)}, ${now})
    ON CONFLICT (key) DO NOTHING`;
  const [challenge] = await db`SELECT key, seed, difficulty, text FROM challenges WHERE key = ${key}`;
  return {
    key: challenge.key as string,
    seed: Number(challenge.seed),
    difficulty: challenge.difficulty as Difficulty,
    text: challenge.text as string,
    endsAt: Date.parse(`${key}T00:00:00.000Z`) + 86_400_000,
  };
}

export type HistoryEntry = {
  id: number;
  mode: RaceMode;
  difficulty: Difficulty;
  wpm: number;
  accuracy: number;
  durationMs: number;
  finished: boolean;
  won: boolean;
  xp: number;
  challengeKey: string | null;
  at: number;
};

export type Goal = { id: string; label: string; current: number; target: number; unit: string };
export type RecordEntry = {
  mode: RaceMode;
  difficulty: Difficulty;
  wpm: number;
  accuracy: number;
  durationMs: number;
  at: number;
};

export type Profile = {
  id: string;
  name: string;
  xp: number;
  level: number;
  car: Car;
  races: number;
  wins: number;
  bestWpm: number;
  averageAccuracy: number;
  practiceRaces: number;
  dailyRaces: number;
  dailyStreak: number;
  readyInMs: number | null;
  records: RecordEntry[];
  history: HistoryEntry[];
  goals: Goal[];
};

export async function getProfile(id: string): Promise<Profile | null> {
  await ready;
  const [row] = await db`SELECT id, name, xp, paint, body FROM players WHERE id = ${id}`;
  if (!row) return null;
  const [ranked] = await db`
    SELECT CAST(COUNT(*) AS INTEGER) AS races, CAST(COALESCE(SUM(won), 0) AS INTEGER) AS wins, MAX(wpm) AS best
    FROM races WHERE player_id = ${id}`;
  const [solo] = await db`
    SELECT CAST(COUNT(*) AS INTEGER) AS races, MAX(wpm) AS best
    FROM attempts WHERE player_id = ${id} AND mode != 'multiplayer'`;
  const [attemptStats] = await db`
    SELECT CAST(COUNT(*) AS INTEGER) AS races, CAST(COALESCE(ROUND(AVG(accuracy)), 0) AS INTEGER) AS accuracy FROM (
      SELECT accuracy FROM races WHERE player_id = ${id}
      UNION ALL
      SELECT accuracy FROM attempts WHERE player_id = ${id} AND mode != 'multiplayer'
    ) results`;
  const [modeStats] = await db`
    SELECT CAST(COALESCE(SUM(CASE WHEN mode IN ('practice', 'ghost') THEN 1 ELSE 0 END), 0) AS INTEGER) AS practice,
      CAST(COALESCE(SUM(CASE WHEN mode = 'daily' THEN 1 ELSE 0 END), 0) AS INTEGER) AS daily
    FROM attempts WHERE player_id = ${id}`;
  const recordRows = await db`
    WITH results AS (
      SELECT 'multiplayer' AS mode, difficulty, wpm, accuracy, 0 AS duration_ms, at
      FROM races WHERE player_id = ${id}
      UNION ALL
      SELECT mode, difficulty, wpm, accuracy, duration_ms, at
      FROM attempts WHERE player_id = ${id} AND mode != 'multiplayer'
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY difficulty ORDER BY wpm DESC, accuracy DESC, at ASC) AS rank
      FROM results
    )
    SELECT mode, difficulty, wpm, accuracy, duration_ms, at FROM ranked WHERE rank = 1 ORDER BY wpm DESC`;
  const historyRows = await db`
    SELECT id, mode, difficulty, wpm, accuracy, duration_ms, finished, won, xp, challenge_key, at
    FROM attempts WHERE player_id = ${id} ORDER BY at DESC LIMIT 12`;
  const today = dayKey();
  const todayAt = Date.parse(`${today}T00:00:00.000Z`);
  const [todayStats] = await db`
    SELECT MAX(wpm) AS best, MAX(accuracy) AS accuracy,
      CAST(COALESCE(SUM(CASE WHEN challenge_key = ${today} THEN 1 ELSE 0 END), 0) AS INTEGER) AS daily
    FROM attempts WHERE player_id = ${id} AND at >= ${todayAt}`;
  const challengeRows = await db`
    SELECT DISTINCT challenge_key FROM attempts
    WHERE player_id = ${id} AND mode = 'daily' AND challenge_key IS NOT NULL
    ORDER BY challenge_key DESC`;
  const [activation] = await db`
    SELECT MIN(elapsed_ms) AS ready FROM events
    WHERE player_id = ${id} AND name = 'first_keystroke' AND elapsed_ms IS NOT NULL`;
  const bestWpm = Math.max(ranked.best ?? 0, solo.best ?? 0);
  const targetWpm = nextWpmTarget(bestWpm);
  return {
    id: row.id,
    name: row.name,
    xp: row.xp,
    level: levelFromXp(row.xp),
    car: { paint: row.paint, body: row.body } as Car,
    races: ranked.races + solo.races,
    wins: ranked.wins,
    bestWpm,
    averageAccuracy: attemptStats.races ? attemptStats.accuracy : 0,
    practiceRaces: modeStats.practice,
    dailyRaces: modeStats.daily,
    dailyStreak: dailyStreak(challengeRows.map((entry: { challenge_key: string }) => entry.challenge_key)),
    readyInMs: activation.ready ?? null,
    records: recordRows.map((entry: Record<string, unknown>) => ({
      mode: entry.mode as RaceMode,
      difficulty: entry.difficulty as Difficulty,
      wpm: entry.wpm as number,
      accuracy: entry.accuracy as number,
      durationMs: entry.duration_ms as number,
      at: Number(entry.at),
    })),
    history: historyRows.map((entry: Record<string, any>) => ({
      id: Number(entry.id),
      mode: entry.mode,
      difficulty: entry.difficulty,
      wpm: entry.wpm,
      accuracy: entry.accuracy,
      durationMs: entry.duration_ms,
      finished: Boolean(entry.finished),
      won: Boolean(entry.won),
      xp: entry.xp,
      challengeKey: entry.challenge_key,
      at: Number(entry.at),
    })),
    goals: [
      { id: "daily", label: "Finish today's challenge", current: todayStats.daily ? 1 : 0, target: 1, unit: "race" },
      { id: "accuracy", label: "Reach 95% accuracy", current: todayStats.accuracy ?? 0, target: 95, unit: "%" },
      { id: "pace", label: `Reach ${targetWpm} WPM`, current: todayStats.best ?? 0, target: targetWpm, unit: "wpm" },
    ],
  };
}

function dailyStreak(keys: string[]) {
  const completed = new Set(keys);
  let date = new Date(`${dayKey()}T00:00:00.000Z`);
  if (!completed.has(dayKey(date.getTime()))) date.setUTCDate(date.getUTCDate() - 1);
  let streak = 0;
  while (completed.has(dayKey(date.getTime()))) {
    streak++;
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return streak;
}

export async function ensurePlayer(id: string, name: string, defaultPaint: string) {
  await ready;
  await db`
    INSERT INTO players (id, name, paint, created_at) VALUES (${id}, ${name}, ${defaultPaint}, ${Date.now()})
    ON CONFLICT (id) DO UPDATE SET name = excluded.name`;
  return (await getProfile(id))!;
}

export async function setCar(id: string, car: Car) {
  const profile = await getProfile(id);
  if (!profile || !canUse(car, profile.level)) return false;
  await db`UPDATE players SET paint = ${car.paint}, body = ${car.body} WHERE id = ${id}`;
  return true;
}

export type AttemptEntry = {
  runId?: string;
  player: string;
  mode: RaceMode;
  difficulty: Difficulty;
  seed: number;
  challengeKey?: string | null;
  wpm: number;
  accuracy: number;
  durationMs: number;
  finished?: boolean;
  won: boolean;
  xp: number;
  firstKeyMs?: number | null;
  trace?: [number, number][];
  text?: string | null;
};

async function insertAttempt(tx: SQL, entry: AttemptEntry, at: number) {
  const [inserted] = await tx`
    INSERT INTO attempts (run_id, player_id, mode, difficulty, seed, challenge_key, wpm, accuracy, duration_ms, finished, won, xp, first_key_ms, trace, text, at)
    VALUES (${entry.runId ?? crypto.randomUUID()}, ${entry.player}, ${entry.mode}, ${entry.difficulty}, ${entry.seed}, ${entry.challengeKey ?? null},
      ${entry.wpm}, ${entry.accuracy}, ${entry.durationMs}, ${entry.finished === false ? 0 : 1}, ${entry.won ? 1 : 0}, ${entry.xp}, ${entry.firstKeyMs ?? null},
      ${entry.trace ? JSON.stringify(entry.trace) : null}, ${entry.text ?? null}, ${at})
    ON CONFLICT (run_id) DO NOTHING RETURNING id`;
  return Boolean(inserted);
}

async function playerXp(tx: SQL, player: string) {
  const [row] = await tx`SELECT xp FROM players WHERE id = ${player}`;
  return row.xp as number;
}

export async function recordAttempt(entry: AttemptEntry) {
  await ready;
  return db.begin(async (tx) => {
    if (!(await insertAttempt(tx, entry, Date.now()))) return { xp: await playerXp(tx, entry.player), awarded: 0 };
    const [player] = await tx`UPDATE players SET xp = xp + ${entry.xp} WHERE id = ${entry.player} RETURNING xp`;
    return { xp: player.xp as number, awarded: entry.xp };
  });
}

export async function recordRace(
  entry: Omit<AttemptEntry, "mode" | "seed" | "durationMs"> & { mode?: RaceMode; seed?: number; durationMs?: number },
) {
  await ready;
  return db.begin(async (tx) => {
    const at = Date.now();
    if (!(await insertAttempt(tx, { ...entry, mode: entry.mode ?? "multiplayer", seed: entry.seed ?? 0, durationMs: entry.durationMs ?? 0 }, at))) {
      return { xp: await playerXp(tx, entry.player), awarded: 0 };
    }
    await tx`
      INSERT INTO races (player_id, difficulty, wpm, accuracy, won, xp, at)
      VALUES (${entry.player}, ${entry.difficulty}, ${entry.wpm}, ${entry.accuracy}, ${entry.won ? 1 : 0}, ${entry.xp}, ${at})`;
    const [player] = await tx`UPDATE players SET xp = xp + ${entry.xp} WHERE id = ${entry.player} RETURNING xp`;
    return { xp: player.xp as number, awarded: entry.xp };
  });
}

export const EVENT_NAMES = ["landing", "race_started", "first_keystroke", "race_completed", "replay", "result_shared", "profile_viewed"] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export async function logEvent(entry: { player: string | null; session: string; name: EventName; elapsedMs?: number | null; detail?: string | null }) {
  await ready;
  await db`
    INSERT INTO events (player_id, session_id, name, elapsed_ms, detail, at)
    VALUES (${entry.player}, ${entry.session}, ${entry.name}, ${entry.elapsedMs ?? null}, ${entry.detail ?? null}, ${Date.now()})
    ON CONFLICT DO NOTHING`;
}

export async function bestGhost(player: string) {
  await ready;
  const [row] = await db`
    SELECT seed, difficulty, wpm, accuracy, duration_ms, trace, text FROM attempts
    WHERE player_id = ${player} AND finished = 1 AND trace IS NOT NULL AND text IS NOT NULL
    ORDER BY wpm DESC, accuracy DESC, at DESC LIMIT 1`;
  if (!row) return null;
  try {
    const trace = JSON.parse(row.trace);
    if (!Array.isArray(trace) || trace.length < 2 || !Array.isArray(trace.at(-1)) || Number(trace.at(-1)[1]) < 999) return null;
    return {
      seed: Number(row.seed),
      difficulty: row.difficulty as Difficulty,
      wpm: row.wpm as number,
      accuracy: row.accuracy as number,
      durationMs: row.duration_ms as number,
      trace: trace as [number, number][],
      text: row.text as string,
    };
  } catch {
    return null;
  }
}

type CompetitionRow = { id: string; name: string; xp: number; paint: string; score: number; wpm: number; accuracy: number; days?: number };

function competitionRows(rows: CompetitionRow[], player?: string) {
  return rows.map((row, index) => ({
    rank: index + 1,
    name: row.name,
    level: levelFromXp(row.xp),
    paint: row.paint,
    score: row.score,
    wpm: row.wpm,
    accuracy: row.accuracy,
    days: row.days ?? 1,
    isYou: row.id === player,
  }));
}

export async function competitions(player?: string) {
  await ready;
  const today = dayKey();
  const monday = weekKey();
  const daily: CompetitionRow[] = await db`
    WITH ranked AS (
      SELECT a.player_id, CAST(a.wpm * a.accuracy / 100.0 AS INTEGER) AS score, a.wpm, a.accuracy,
        ROW_NUMBER() OVER (PARTITION BY a.player_id ORDER BY a.wpm * a.accuracy DESC, a.wpm DESC, a.accuracy DESC, a.at ASC) AS rank
      FROM attempts a WHERE a.mode = 'daily' AND a.challenge_key = ${today}
    )
    SELECT p.id, p.name, p.xp, p.paint, r.score, r.wpm, r.accuracy
    FROM ranked r JOIN players p ON p.id = r.player_id
    WHERE r.rank = 1
    ORDER BY score DESC, wpm DESC
    LIMIT 20`;
  const weekly: CompetitionRow[] = await db`
    WITH ranked AS (
      SELECT player_id, challenge_key, CAST(wpm * accuracy / 100.0 AS INTEGER) AS score, wpm, accuracy,
        ROW_NUMBER() OVER (PARTITION BY player_id, challenge_key ORDER BY wpm * accuracy DESC, wpm DESC, accuracy DESC, at ASC) AS rank
      FROM attempts WHERE mode = 'daily' AND challenge_key >= ${monday}
    ), daily_best AS (
      SELECT player_id, score, wpm, accuracy FROM ranked WHERE rank = 1
    )
    SELECT p.id, p.name, p.xp, p.paint, CAST(SUM(d.score) AS INTEGER) AS score,
      MAX(d.wpm) AS wpm, CAST(ROUND(AVG(d.accuracy)) AS INTEGER) AS accuracy, CAST(COUNT(*) AS INTEGER) AS days
    FROM daily_best d JOIN players p ON p.id = d.player_id
    GROUP BY p.id, p.name, p.xp, p.paint
    ORDER BY score DESC, days DESC, wpm DESC
    LIMIT 20`;
  const dailyEntries = competitionRows(daily, player);
  const weeklyEntries = competitionRows(weekly, player);
  return {
    daily: { key: today, participants: dailyEntries.length, entries: dailyEntries, you: dailyEntries.find((row) => row.isYou) ?? null },
    weekly: { key: monday, entries: weeklyEntries, you: weeklyEntries.find((row) => row.isYou) ?? null },
  };
}

type BoardRow = { name: string; xp: number; paint: string; best: number; accuracy: number; races: number; wins: number };

export async function leaderboard(difficulty: Difficulty) {
  await ready;
  const rows: BoardRow[] = await db`
    WITH ranked AS (
      SELECT player_id, wpm, accuracy,
        ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY wpm DESC, accuracy DESC, at ASC) AS rank
      FROM races WHERE difficulty = ${difficulty}
    ), stats AS (
      SELECT player_id, CAST(COUNT(*) AS INTEGER) AS races, CAST(SUM(won) AS INTEGER) AS wins
      FROM races WHERE difficulty = ${difficulty} GROUP BY player_id
    )
    SELECT p.name, p.xp, p.paint, r.wpm AS best, r.accuracy, s.races, s.wins
    FROM ranked r JOIN players p ON p.id = r.player_id JOIN stats s ON s.player_id = r.player_id
    WHERE r.rank = 1
    ORDER BY best DESC, wins DESC
    LIMIT 10`;
  return rows.map((r) => ({
    name: r.name,
    level: levelFromXp(r.xp),
    paint: r.paint,
    bestWpm: r.best,
    accuracy: r.accuracy,
    races: r.races,
    wins: r.wins,
  }));
}
