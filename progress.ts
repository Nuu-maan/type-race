export const DIFFICULTIES = ["easy", "normal", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY = {
  easy: { label: "Easy", xp: 0.8, errorPenalty: 0.2 },
  normal: { label: "Normal", xp: 1, errorPenalty: 0.35 },
  hard: { label: "Hard", xp: 1.4, errorPenalty: 0.5 },
} satisfies Record<Difficulty, { label: string; xp: number; errorPenalty: number }>;

export function isDifficulty(value: unknown): value is Difficulty {
  return DIFFICULTIES.includes(value as Difficulty);
}

export const PAINTS = [
  { id: "cobalt", label: "Cobalt", color: "#2f7bff", level: 1 },
  { id: "crimson", label: "Crimson", color: "#ff3b5c", level: 1 },
  { id: "lime", label: "Lime", color: "#7ddc1f", level: 2 },
  { id: "sunset", label: "Sunset", color: "#ff8a1f", level: 3 },
  { id: "violet", label: "Violet", color: "#9b5cff", level: 4 },
  { id: "pearl", label: "Pearl", color: "#f1f1f4", level: 5 },
  { id: "gold", label: "Gold", color: "#e8b923", level: 7 },
  { id: "midnight", label: "Midnight", color: "#1b1d26", level: 10 },
] as const;

export const BODIES = [
  { id: "gt", label: "GT", level: 1 },
  { id: "muscle", label: "Muscle", level: 3 },
  { id: "hyper", label: "Hyper", level: 6 },
] as const;

export type PaintId = (typeof PAINTS)[number]["id"];
export type BodyId = (typeof BODIES)[number]["id"];
export type Car = { paint: PaintId; body: BodyId };

export const DEFAULT_CARS: Car[] = [
  { paint: "cobalt", body: "gt" },
  { paint: "crimson", body: "gt" },
];

export function xpForLevel(level: number) {
  return 50 * level * (level - 1);
}

export function levelFromXp(xp: number) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function levelProgress(xp: number) {
  const level = levelFromXp(xp);
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return { level, into: xp - from, needed: to - from };
}

export function raceXp(wpm: number, accuracy: number, difficulty: Difficulty, won: boolean) {
  return Math.round((10 + wpm * (accuracy / 100)) * DIFFICULTY[difficulty].xp + (won ? 50 : 0));
}

export function paintById(id: string) {
  return PAINTS.find((p) => p.id === id);
}

export function bodyById(id: string) {
  return BODIES.find((b) => b.id === id);
}

export function canUse(car: Car, level: number) {
  const paint = paintById(car.paint);
  const body = bodyById(car.body);
  return !!paint && !!body && paint.level <= level && body.level <= level;
}

export function unlockedBetween(fromLevel: number, toLevel: number) {
  return [...PAINTS, ...BODIES].filter((item) => item.level > fromLevel && item.level <= toLevel).map((item) => item.label);
}
