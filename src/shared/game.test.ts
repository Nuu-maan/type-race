import { expect, test } from "bun:test";
import {
  FINISH_GRACE_MS,
  raceOver,
  results,
  standings,
  applyBackspace,
  applyKey,
  createRace,
  MARK_MISSED,
  MARK_NONE,
  MARK_OK,
  MARK_WRONG,
  tick,
  TRACK,
  type Player,
  type Race,
} from "./game";

const DT = 0.05;

function drive(race: Race, p: Player, charsPerSec: number, seconds: number, start: number, typoEvery = 0) {
  let now = start;
  let carry = 0;
  let keys = 0;
  for (let s = 0; s < seconds && !race.winner; s += DT) {
    now += DT * 1000;
    carry += charsPerSec * DT;
    while (carry >= 1) {
      carry--;
      const typo = typoEvery && ++keys % typoEvery === 0 && race.text[p.typed] !== " ";
      applyKey(race.text, p, typo ? "#" : race.text[p.typed]!, now);
    }
    tick(race, DT, now);
  }
  return now;
}

function solo(seed = 1) {
  const race = createRace(seed, [{ id: "a", name: "a" }], 0);
  return { race, p: race.players[0]! };
}

test("steady 60 wpm finishes in about a minute", () => {
  const { race, p } = solo();
  const end = drive(race, p, 5, 120, 0);
  expect(race.winner).toBe("a");
  expect(end / 1000).toBeGreaterThan(54);
  expect(end / 1000).toBeLessThan(66);
});

test("faster typing wins", () => {
  const race = createRace(1, [{ id: "slow", name: "s" }, { id: "fast", name: "f" }], 0);
  const [slow, fast] = race.players as [Player, Player];
  let now = 0;
  while (!race.winner && now < 200_000) {
    now += DT * 1000;
    if (Math.round(now) % 250 === 0) applyKey(race.text, slow, race.text[slow.typed]!, now);
    if (Math.round(now) % 100 === 0) applyKey(race.text, fast, race.text[fast.typed]!, now);
    tick(race, DT, now);
  }
  expect(race.winner).toBe("fast");
});

test("mistakes slow the car", () => {
  const clean = solo();
  const sloppy = solo();
  drive(clean.race, clean.p, 5, 20, 0);
  drive(sloppy.race, sloppy.p, 5, 20, 0, 3);
  expect(sloppy.p.pos).toBeLessThan(clean.p.pos * 0.85);
});

test("one mistake slows acceleration instead of stopping the car", () => {
  const { race, p } = solo();
  const now = drive(race, p, 6, 8, 0);
  const before = p.speed;
  applyKey(race.text, p, "#", now);
  drive(race, p, 6, 0.5, now);
  expect(p.speed).toBeGreaterThan(before * 0.9);
  expect(p.penalty).toBeGreaterThan(0);
});

test("wrong letters advance the caret and backspace clears them", () => {
  const { race, p } = solo();
  applyKey(race.text, p, race.text[0]!, 1);
  applyKey(race.text, p, "#", 2);
  expect(p.typed).toBe(2);
  expect(p.marks[0]).toBe(MARK_OK);
  expect(p.marks[1]).toBe(MARK_WRONG);
  applyBackspace(p);
  expect(p.typed).toBe(1);
  expect(p.marks[1]).toBe(MARK_NONE);
  applyBackspace(p, true);
  expect(p.typed).toBe(0);
  applyBackspace(p);
  expect(p.typed).toBe(0);
});

test("extra letters at the end of a word are erased before real ones", () => {
  const { race, p } = solo();
  const end = race.text.indexOf(" ");
  for (let i = 0; i < end; i++) applyKey(race.text, p, race.text[i]!, i);
  applyKey(race.text, p, "x", 10);
  applyKey(race.text, p, "y", 11);
  expect(p.typed).toBe(end);
  expect(p.extra).toBe("xy");
  applyBackspace(p);
  expect(p.extra).toBe("x");
  expect(p.typed).toBe(end);
  applyKey(race.text, p, " ", 12);
  expect(p.extra).toBe("");
  expect(p.typed).toBe(end + 1);
});

test("space mid-word skips to the next word and marks the rest missed", () => {
  const { race, p } = solo();
  applyKey(race.text, p, race.text[0]!, 1);
  applyKey(race.text, p, " ", 2);
  const nextWord = race.text.indexOf(" ") + 1;
  expect(p.typed).toBe(nextWord);
  expect(p.wordStart).toBe(nextWord);
  expect(p.marks[1]).toBe(MARK_MISSED);
  applyBackspace(p);
  expect(p.typed).toBe(nextWord);
});

test("car coasts to a stop when typing stops", () => {
  const { race, p } = solo();
  const now = drive(race, p, 5, 10, 0);
  expect(p.speed).toBeGreaterThan(10);
  drive(race, p, 0, 10, now);
  expect(p.speed).toBeLessThan(0.5);
});

test("eight clean words trigger nitro", () => {
  const { race, p } = solo();
  let now = 0;
  let words = 0;
  while (words < 8) {
    const c = race.text[p.typed]!;
    applyKey(race.text, p, c, (now += 100));
    if (c === " ") words++;
  }
  expect(p.nitroUntil).toBeGreaterThan(now);
});

test("hard races punish mistakes more than easy ones", () => {
  const easy = createRace(1, [{ id: "a", name: "a" }], 0, "easy").players[0]!;
  const hard = createRace(1, [{ id: "a", name: "a" }], 0, "hard").players[0]!;
  applyKey("ab", easy, "#", 1);
  applyKey("ab", hard, "#", 1);
  expect(hard.penalty).toBeGreaterThan(easy.penalty);
});

test("speed is capped against key floods", () => {
  const { race, p } = solo();
  const now = drive(race, p, 500, 3, 0);
  expect(p.speed).toBeLessThanOrEqual(200 * (TRACK / 3600) * 1.25 + 0.01);
  expect(results(race, now)[0]!.wpm).toBeLessThanOrEqual(200);
});

test("five racers finish in order and the race waits for stragglers", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const race = createRace(3, ids.map((id) => ({ id, name: id })), 0);
  const charsPerSec = [3, 4, 5, 6, 8];
  const carry = [0, 0, 0, 0, 0];
  let now = 0;
  while (race.finishers < 2) {
    now += DT * 1000;
    race.players.forEach((p, i) => {
      carry[i]! += charsPerSec[i]! * DT;
      for (; carry[i]! >= 1; carry[i]!--) applyKey(race.text, p, race.text[p.typed]!, now);
    });
    tick(race, DT, now);
  }
  expect(race.winner).toBe("e");
  expect(standings(race).map((p) => p.id).slice(0, 2)).toEqual(["e", "d"]);
  expect(raceOver(race, now)).toBe(false);
  expect(raceOver(race, race.firstFinishAt! + FINISH_GRACE_MS)).toBe(true);
  const rows = results(race, now);
  expect(rows.map((r) => r.place)).toEqual([1, 2, 3, 4, 5]);
  expect(rows[0]!.finished).toBe(true);
  expect(rows[4]!.finished).toBe(false);
});

test("racers who leave drop to the bottom and stop counting", () => {
  const race = createRace(3, [{ id: "a", name: "a" }, { id: "b", name: "b" }, { id: "c", name: "c" }], 0);
  race.players[0]!.pos = 500;
  race.players[0]!.left = true;
  race.players[1]!.pos = 100;
  expect(standings(race).map((p) => p.id)).toEqual(["b", "c", "a"]);
  race.players[1]!.finishedAt = 10;
  race.players[2]!.finishedAt = 20;
  expect(raceOver(race, 30)).toBe(true);
});
