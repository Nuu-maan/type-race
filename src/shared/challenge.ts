export const RACE_MODES = ["multiplayer", "practice", "ghost", "daily"] as const;

export type RaceMode = (typeof RACE_MODES)[number];
export type RaceTrace = [elapsedMs: number, position: number][];

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

export function tracePosition(trace: RaceTrace, elapsedMs: number) {
  if (!trace.length || elapsedMs <= trace[0]![0]) return trace[0]?.[1] ?? 0;
  for (let i = 1; i < trace.length; i++) {
    const next = trace[i]!;
    if (elapsedMs > next[0]) continue;
    const previous = trace[i - 1]!;
    const progress = (elapsedMs - previous[0]) / Math.max(1, next[0] - previous[0]);
    return previous[1] + (next[1] - previous[1]) * progress;
  }
  return trace.at(-1)![1];
}
