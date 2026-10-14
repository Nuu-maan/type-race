import { SQL } from "bun";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { canUse, levelFromXp, type Car, type Difficulty } from "../shared/progress";

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
}

const ready = migrate();
ready.catch((error) => console.error("Database setup failed:", error));

export type Profile = { id: string; name: string; xp: number; level: number; car: Car; races: number; wins: number; bestWpm: number };

export async function getProfile(id: string): Promise<Profile | null> {
  await ready;
  const [row] = await db`SELECT id, name, xp, paint, body FROM players WHERE id = ${id}`;
  if (!row) return null;
  const [stats] = await db`
    SELECT CAST(COUNT(*) AS INTEGER) AS races, CAST(COALESCE(SUM(won), 0) AS INTEGER) AS wins, MAX(wpm) AS best
    FROM races WHERE player_id = ${id}`;
  return {
    id: row.id,
    name: row.name,
    xp: row.xp,
    level: levelFromXp(row.xp),
    car: { paint: row.paint, body: row.body } as Car,
    races: stats.races,
    wins: stats.wins,
    bestWpm: stats.best ?? 0,
  };
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

export async function recordRace(entry: { player: string; difficulty: Difficulty; wpm: number; accuracy: number; won: boolean; xp: number }) {
  await ready;
  await db.begin(async (tx) => {
    await tx`
      INSERT INTO races (player_id, difficulty, wpm, accuracy, won, xp, at)
      VALUES (${entry.player}, ${entry.difficulty}, ${entry.wpm}, ${entry.accuracy}, ${entry.won ? 1 : 0}, ${entry.xp}, ${Date.now()})`;
    await tx`UPDATE players SET xp = xp + ${entry.xp} WHERE id = ${entry.player}`;
  });
}

type BoardRow = { name: string; xp: number; paint: string; best: number; accuracy: number; races: number; wins: number };

export async function leaderboard(difficulty: Difficulty) {
  await ready;
  const rows: BoardRow[] = await db`
    SELECT p.name, p.xp, p.paint, MAX(r.wpm) AS best, CAST(ROUND(AVG(r.accuracy)) AS INTEGER) AS accuracy,
      CAST(COUNT(*) AS INTEGER) AS races, CAST(SUM(r.won) AS INTEGER) AS wins
    FROM races r JOIN players p ON p.id = r.player_id
    WHERE r.difficulty = ${difficulty}
    GROUP BY p.id, p.name, p.xp, p.paint
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
