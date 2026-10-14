import { DIFFICULTY, isDifficulty, paintById, type Difficulty } from "../shared/progress";
import { $, bindSeg, el } from "./ui";

type Row = { name: string; level: number; paint: string; bestWpm: number; accuracy: number; races: number; wins: number };

let difficulty: Difficulty = "normal";
let request = 0;

function head() {
  const row = el("li", "board-row board-head");
  row.setAttribute("aria-hidden", "true");
  row.append(el("span", "num", "#"), el("span", "", "Racer"), el("span", "num", "Best"), el("span", "num acc", "Accuracy"), el("span", "num", "Wins"));
  return row;
}

function line(r: Row, i: number) {
  const row = el("li", "board-row");
  row.style.setProperty("--n", String(i));
  const who = el("span", "who");
  const swatch = el("span", "swatch");
  swatch.style.background = paintById(r.paint)?.color ?? "#888";
  who.append(swatch, el("strong", "", r.name), el("span", "level", String(r.level)));
  row.append(el("span", "num rank", String(i + 1)), who, el("span", "num", `${r.bestWpm} wpm`), el("span", "num acc", `${r.accuracy}%`), el("span", "num", String(r.wins)));
  return row;
}

export async function refreshLeaderboard() {
  const id = ++request;
  const board = $("board");
  let rows: Row[] = [];
  try {
    rows = await (await fetch(`/api/leaderboard?d=${difficulty}`)).json();
  } catch {
    rows = [];
  }
  if (id !== request) return;
  if (!rows.length) {
    const empty = el("li", "board-empty", `No ${DIFFICULTY[difficulty].label.toLowerCase()} races yet. Finish one to get on the board.`);
    board.replaceChildren(empty);
    return;
  }
  board.replaceChildren(head(), ...rows.map(line));
}

export function initLeaderboard() {
  bindSeg($("board-tabs"), (value) => {
    if (!isDifficulty(value)) return;
    difficulty = value;
    void refreshLeaderboard();
  });
  void refreshLeaderboard();
}
