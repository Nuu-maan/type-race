import { DIFFICULTY, type Difficulty } from "./progress";
import { generateText } from "./words";

export const TRACK = 1000;
export const UNITS_PER_WPM = TRACK / 3600;
export const WPM_WINDOW_MS = 3000;
export const MAX_WPM = 200;
export const TAU_UP = 0.5;
export const TAU_DOWN = 1.2;
export const PENALTY_ACCEL = 3;
export const PENALTY_DECAY = 1.5;
export const SLIP_MS = 350;
export const NITRO_WORDS = 8;
export const NITRO_MS = 2000;
export const NITRO_FACTOR = 1.25;
export const ACCURACY_KEYS = 50;
export const MAX_EXTRA = 8;
export const FINISH_GRACE_MS = 15000;

export const MARK_NONE = 0;
export const MARK_OK = 1;
export const MARK_WRONG = 2;
export const MARK_MISSED = 3;

export type Player = {
  id: string;
  name: string;
  typed: number;
  wordStart: number;
  extra: string;
  marks: Uint8Array;
  pos: number;
  speed: number;
  penalty: number;
  errorPenalty: number;
  correctTimes: number[];
  recent: boolean[];
  slipUntil: number;
  nitroUntil: number;
  streak: number;
  wordClean: boolean;
  totalKeys: number;
  correctKeys: number;
  finishedAt: number | null;
  place: number | null;
  left: boolean;
};

export type Race = {
  text: string;
  difficulty: Difficulty;
  startedAt: number;
  players: Player[];
  winner: string | null;
  finishers: number;
  firstFinishAt: number | null;
};

export function createPlayer(id: string, name: string, textLength: number, difficulty: Difficulty = "normal"): Player {
  return {
    id,
    name,
    typed: 0,
    wordStart: 0,
    extra: "",
    marks: new Uint8Array(textLength),
    pos: 0,
    speed: 0,
    penalty: 0,
    errorPenalty: DIFFICULTY[difficulty].errorPenalty,
    correctTimes: [],
    recent: [],
    slipUntil: 0,
    nitroUntil: 0,
    streak: 0,
    wordClean: true,
    totalKeys: 0,
    correctKeys: 0,
    finishedAt: null,
    place: null,
    left: false,
  };
}

export function createRace(
  seed: number,
  players: { id: string; name: string }[],
  now: number,
  difficulty: Difficulty = "normal",
  text = generateText(seed, difficulty),
): Race {
  return {
    text,
    difficulty,
    startedAt: now,
    players: players.map((p) => createPlayer(p.id, p.name, text.length, difficulty)),
    winner: null,
    finishers: 0,
    firstFinishAt: null,
  };
}

function record(p: Player, ok: boolean) {
  p.totalKeys++;
  p.recent.push(ok);
  if (p.recent.length > ACCURACY_KEYS) p.recent.shift();
}

function miss(p: Player, now: number) {
  record(p, false);
  p.penalty = Math.min(1, p.penalty + p.errorPenalty);
  p.slipUntil = now + SLIP_MS;
  p.streak = 0;
  p.wordClean = false;
}

function endWord(p: Player, now: number) {
  p.streak = p.wordClean ? p.streak + 1 : 0;
  if (p.streak > 0 && p.streak % NITRO_WORDS === 0) p.nitroUntil = now + NITRO_MS;
  p.wordClean = true;
  p.wordStart = p.typed;
  p.extra = "";
}

export function applyKey(text: string, p: Player, char: string, now: number) {
  if (p.finishedAt !== null || p.typed >= text.length) return;
  const expected = text[p.typed];

  if (char === " ") {
    if (p.typed === p.wordStart) return;
    if (expected === " ") {
      record(p, true);
      p.correctKeys++;
      p.correctTimes.push(now);
      p.marks[p.typed++] = MARK_OK;
    } else {
      miss(p, now);
      while (p.typed < text.length && text[p.typed] !== " ") p.marks[p.typed++] = MARK_MISSED;
      p.typed++;
    }
    endWord(p, now);
    return;
  }

  if (expected === " ") {
    miss(p, now);
    if (p.extra.length < MAX_EXTRA) p.extra += char;
    return;
  }

  if (char === expected) {
    record(p, true);
    p.correctKeys++;
    p.correctTimes.push(now);
    p.marks[p.typed++] = MARK_OK;
  } else {
    miss(p, now);
    p.marks[p.typed++] = MARK_WRONG;
  }
}

export function applyBackspace(p: Player, wholeWord = false) {
  if (p.finishedAt !== null) return;
  if (p.extra) {
    p.extra = wholeWord ? "" : p.extra.slice(0, -1);
    if (!wholeWord) return;
  }
  do {
    if (p.typed <= p.wordStart) return;
    p.marks[--p.typed] = MARK_NONE;
  } while (wholeWord);
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
    if (p.finishedAt !== null || p.left) continue;
    let target = Math.min(wpm(race, p, now), MAX_WPM) * UNITS_PER_WPM * accuracyFactor(p);
    if (now < p.nitroUntil) target *= NITRO_FACTOR;
    const tau = target > p.speed ? TAU_UP * (1 + PENALTY_ACCEL * p.penalty) : TAU_DOWN;
    p.speed += (target - p.speed) * (1 - Math.exp(-dt / tau));
    p.penalty *= Math.exp(-dt / PENALTY_DECAY);
    p.pos += p.speed * dt;
    if (p.pos >= TRACK) {
      p.pos = TRACK;
      p.finishedAt = now;
      p.place = ++race.finishers;
      race.winner ??= p.id;
      race.firstFinishAt ??= now;
    }
  }
}

export function standings(race: Race) {
  return [...race.players].sort(
    (a, b) => Number(a.left) - Number(b.left) || (a.place ?? Infinity) - (b.place ?? Infinity) || b.pos - a.pos,
  );
}

export function raceOver(race: Race, now: number) {
  const active = race.players.filter((p) => !p.left);
  if (active.length === 0 || active.every((p) => p.finishedAt !== null)) return true;
  return race.firstFinishAt !== null && now - race.firstFinishAt >= FINISH_GRACE_MS;
}

export function results(race: Race, now: number) {
  return standings(race).map((p, i) => {
    const minutes = ((p.finishedAt ?? now) - race.startedAt) / 60000;
    const correctChars = p.marks.subarray(0, p.typed).filter((m) => m === MARK_OK).length;
    return {
      id: p.id,
      name: p.name,
      place: i + 1,
      finished: p.finishedAt !== null,
      left: p.left,
      wpm: Math.min(MAX_WPM, Math.round(correctChars / 5 / Math.max(minutes, 1 / 60))),
      accuracy: p.totalKeys ? Math.round((p.correctKeys / p.totalKeys) * 100) : 100,
      time: Math.round(minutes * 600) / 10,
      pos: p.pos,
    };
  });
}
