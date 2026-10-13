import { generateText } from "./words";

export const TRACK = 1000;
export const UNITS_PER_WPM = TRACK / 3600;
export const WPM_WINDOW_MS = 3000;
export const MAX_WPM = 200;
export const TAU_UP = 0.5;
export const TAU_DOWN = 1.2;
export const SKID_MS = 400;
export const SKID_FACTOR = 0.6;
export const NITRO_WORDS = 8;
export const NITRO_MS = 2000;
export const NITRO_FACTOR = 1.25;
export const ACCURACY_KEYS = 50;

export type Player = {
  id: string;
  name: string;
  typed: number;
  pos: number;
  speed: number;
  correctTimes: number[];
  recent: boolean[];
  skidUntil: number;
  nitroUntil: number;
  streak: number;
  wordClean: boolean;
  totalKeys: number;
  correctKeys: number;
  finishedAt: number | null;
};

export type Race = {
  text: string;
  startedAt: number;
  players: Player[];
  winner: string | null;
};

export function createPlayer(id: string, name: string): Player {
  return {
    id,
    name,
    typed: 0,
    pos: 0,
    speed: 0,
    correctTimes: [],
    recent: [],
    skidUntil: 0,
    nitroUntil: 0,
    streak: 0,
    wordClean: true,
    totalKeys: 0,
    correctKeys: 0,
    finishedAt: null,
  };
}

export function createRace(seed: number, players: { id: string; name: string }[], now: number): Race {
  return {
    text: generateText(seed),
    startedAt: now,
    players: players.map((p) => createPlayer(p.id, p.name)),
    winner: null,
  };
}

export function applyKey(race: Race, p: Player, char: string, now: number) {
  if (race.winner || p.finishedAt !== null || p.typed >= race.text.length) return;
  p.totalKeys++;
  const ok = race.text[p.typed] === char;
  p.recent.push(ok);
  if (p.recent.length > ACCURACY_KEYS) p.recent.shift();

  if (!ok) {
    p.skidUntil = now + SKID_MS;
    p.streak = 0;
    p.wordClean = false;
    return;
  }

  p.typed++;
  p.correctKeys++;
  p.correctTimes.push(now);
  if (char === " ") {
    p.streak = p.wordClean ? p.streak + 1 : 0;
    if (p.streak > 0 && p.streak % NITRO_WORDS === 0) p.nitroUntil = now + NITRO_MS;
    p.wordClean = true;
  }
}

export function wpm(race: Race, p: Player, now: number) {
  const window = Math.max(1000, Math.min(WPM_WINDOW_MS, now - race.startedAt));
  while (p.correctTimes.length && p.correctTimes[0]! < now - WPM_WINDOW_MS) p.correctTimes.shift();
  const chars = p.correctTimes.filter((t) => t >= now - window).length;
  return chars / 5 / (window / 60000);
}

export function accuracyFactor(p: Player) {
  if (!p.recent.length) return 1;
  const acc = p.recent.filter(Boolean).length / p.recent.length;
  return 0.7 + 0.3 * Math.min(1, Math.max(0, (acc - 0.85) / 0.15));
}

export function tick(race: Race, dt: number, now: number) {
  for (const p of race.players) {
    if (p.finishedAt !== null) continue;
    let target = Math.min(wpm(race, p, now), MAX_WPM) * UNITS_PER_WPM * accuracyFactor(p);
    if (now < p.skidUntil) target *= SKID_FACTOR;
    if (now < p.nitroUntil) target *= NITRO_FACTOR;
    const tau = target > p.speed ? TAU_UP : TAU_DOWN;
    p.speed += (target - p.speed) * (1 - Math.exp(-dt / tau));
    p.pos += p.speed * dt;
    if (p.pos >= TRACK) {
      p.pos = TRACK;
      p.finishedAt = now;
      race.winner ??= p.id;
    }
  }
}

export function results(race: Race, now: number) {
  return race.players.map((p) => {
    const minutes = ((p.finishedAt ?? now) - race.startedAt) / 60000;
    return {
      id: p.id,
      name: p.name,
      wpm: Math.round(p.correctKeys / 5 / Math.max(minutes, 1 / 60)),
      accuracy: p.totalKeys ? Math.round((p.correctKeys / p.totalKeys) * 100) : 100,
      time: Math.round(minutes * 600) / 10,
      pos: p.pos,
    };
  });
}
