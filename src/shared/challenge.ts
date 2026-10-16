export const RACE_MODES = ["multiplayer", "practice", "ghost", "daily"] as const;

export type RaceMode = (typeof RACE_MODES)[number];

export function isRaceMode(value: unknown): value is RaceMode {
  return RACE_MODES.includes(value as RaceMode);
}

export function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function weekKey(now = Date.now()) {
  const date = new Date(now);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

export function challengeSeed(key: string) {
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function nextWpmTarget(bestWpm: number) {
  return Math.max(40, Math.ceil((bestWpm + 1) / 5) * 5);
}
