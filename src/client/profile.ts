import type { RaceMode } from "../shared/challenge";
import { levelProgress, type Car, type Difficulty } from "../shared/progress";
import { $, replay } from "./ui";

export type Goal = { id: string; label: string; current: number; target: number; unit: string };
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
export type RecordEntry = Pick<HistoryEntry, "mode" | "difficulty" | "wpm" | "accuracy" | "durationMs" | "at">;
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
  ghostReady: boolean;
  records: RecordEntry[];
  history: HistoryEntry[];
  goals: Goal[];
};

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function loadId() {
  try {
    const saved = localStorage.getItem("pid");
    if (saved) return saved;
    const id = uuid();
    localStorage.setItem("pid", id);
    return id;
  } catch {
    return uuid();
  }
}

export const playerId = loadId();

export async function fetchProfile(): Promise<Profile | null> {
  try {
    const res = await fetch(`/api/profile?id=${playerId}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

let shownLevel = 0;

export function renderMe(name: string, xp: number) {
  const { level, into, needed } = levelProgress(xp);
  $("me-chip").hidden = false;
  $("me-name").textContent = name;
  $("me-chip").setAttribute("aria-label", `Open ${name}'s profile, level ${level}`);
  const badge = $("me-level");
  badge.textContent = String(level);
  if (shownLevel && level > shownLevel) replay(badge, "pulse");
  shownLevel = level;
  $("me-xp").style.setProperty("--p", String(into / needed));
}
