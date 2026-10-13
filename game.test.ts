import { expect, test } from "bun:test";
import { applyKey, createRace, tick, TRACK, type Race, type Player } from "./game";

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
      if (typoEvery && ++keys % typoEvery === 0) applyKey(race, p, "#", now);
      applyKey(race, p, race.text[p.typed]!, now);
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
    if (Math.round(now) % 250 === 0) applyKey(race, slow, race.text[slow.typed]!, now);
    if (Math.round(now) % 100 === 0) applyKey(race, fast, race.text[fast.typed]!, now);
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

test("wrong keys do not advance the caret", () => {
  const { race, p } = solo();
  applyKey(race, p, "#", 10);
  expect(p.typed).toBe(0);
  expect(p.skidUntil).toBeGreaterThan(10);
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
    applyKey(race, p, c, (now += 100));
    if (c === " ") words++;
  }
  expect(p.nitroUntil).toBeGreaterThan(now);
});

test("speed is capped against key floods", () => {
  const { race, p } = solo();
  drive(race, p, 500, 3, 0);
  expect(p.speed).toBeLessThanOrEqual(200 * (TRACK / 3600) * 1.25 + 0.01);
});
