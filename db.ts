import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { canUse, levelFromXp, type Car, type Difficulty } from "./progress";

const path = process.env.DB_PATH ?? "data/type-race.sqlite";
if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
const db = new Database(path, { create: true, strict: true });

db.run("PRAGMA journal_mode = WAL");
db.run(`CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  paint TEXT NOT NULL DEFAULT 'cobalt',
  body TEXT NOT NULL DEFAULT 'gt',
  created_at INTEGER NOT NULL
)`);
db.run(`CREATE TABLE IF NOT EXISTS races (
  id INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  difficulty TEXT NOT NULL,
  wpm INTEGER NOT NULL,
  accuracy INTEGER NOT NULL,
  won INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  at INTEGER NOT NULL
)`);
db.run("CREATE INDEX IF NOT EXISTS races_by_difficulty ON races (difficulty, player_id)");

export type Profile = { id: string; name: string; xp: number; level: number; car: Car; races: number; wins: number; bestWpm: number };

type PlayerRow = { id: string; name: string; xp: number; paint: string; body: string };

const selectPlayer = db.query<PlayerRow, { id: string }>("SELECT id, name, xp, paint, body FROM players WHERE id = $id");
const selectStats = db.query<{ races: number; wins: number; best: number | null }, { id: string }>(
  "SELECT COUNT(*) AS races, COALESCE(SUM(won), 0) AS wins, MAX(wpm) AS best FROM races WHERE player_id = $id",
);
const upsertPlayer = db.query<void, { id: string; name: string; now: number; paint: string }>(
  `INSERT INTO players (id, name, paint, created_at) VALUES ($id, $name, $paint, $now)
   ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
);
const updateCar = db.query<void, { id: string; paint: string; body: string }>("UPDATE players SET paint = $paint, body = $body WHERE id = $id");
const addXp = db.query<void, { id: string; xp: number }>("UPDATE players SET xp = xp + $xp WHERE id = $id");
const insertRace = db.query<void, { player: string; difficulty: string; wpm: number; accuracy: number; won: number; xp: number; at: number }>(
  "INSERT INTO races (player_id, difficulty, wpm, accuracy, won, xp, at) VALUES ($player, $difficulty, $wpm, $accuracy, $won, $xp, $at)",
);
const selectBoard = db.query<
  { name: string; xp: number; paint: string; best: number; accuracy: number; races: number; wins: number },
  { difficulty: string }
>(
  `SELECT p.name, p.xp, p.paint, MAX(r.wpm) AS best, ROUND(AVG(r.accuracy)) AS accuracy, COUNT(*) AS races, SUM(r.won) AS wins
   FROM races r JOIN players p ON p.id = r.player_id
   WHERE r.difficulty = $difficulty
   GROUP BY p.id ORDER BY best DESC, wins DESC LIMIT 10`,
);

export function getProfile(id: string): Profile | null {
  const row = selectPlayer.get({ id });
  if (!row) return null;
  const stats = selectStats.get({ id })!;
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

export function ensurePlayer(id: string, name: string, defaultPaint: string) {
  upsertPlayer.run({ id, name, now: Date.now(), paint: defaultPaint });
  return getProfile(id)!;
}

export function setCar(id: string, car: Car) {
  const profile = getProfile(id);
  if (!profile || !canUse(car, profile.level)) return false;
  updateCar.run({ id, paint: car.paint, body: car.body });
  return true;
}

export const recordRace = db.transaction(
  (entry: { player: string; difficulty: Difficulty; wpm: number; accuracy: number; won: boolean; xp: number }) => {
    insertRace.run({ ...entry, won: entry.won ? 1 : 0, at: Date.now() });
    addXp.run({ id: entry.player, xp: entry.xp });
  },
);

export function leaderboard(difficulty: Difficulty) {
  return selectBoard.all({ difficulty }).map((r) => ({
    name: r.name,
    level: levelFromXp(r.xp),
    paint: r.paint,
    bestWpm: r.best,
    accuracy: r.accuracy,
    races: r.races,
    wins: r.wins,
  }));
}
