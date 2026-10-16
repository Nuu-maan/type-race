import { METERS_PER_UNIT, TRACK } from "../shared/game";
import { $, el } from "./ui";

export type HudRacer = { id: string; name: string; color: string; pos: number; speed: number; wpm: number; place: number | null; left: boolean };

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th"];

let rosterKey = "";
let markers = new Map<string, HTMLElement>();
let rows = new Map<string, HTMLElement>();
let onPick: (id: string) => void = () => {};

export function ordinal(place: number) {
  return ORDINAL[place - 1] ?? `${place}th`;
}

function textOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 140 ? "var(--color-text-inverse)" : "var(--color-text-primary)";
}

function build(racers: HudRacer[]) {
  markers = new Map();
  rows = new Map();
  $("markers").replaceChildren(
    ...racers.map((r) => {
      const m = el("span", "marker", r.name.slice(0, 1).toUpperCase());
      m.style.background = r.color;
      m.style.color = textOn(r.color);
      markers.set(r.id, m);
      return m;
    }),
  );
  $("tower").replaceChildren(
    ...racers.map((r) => {
      const row = el("li", "tower-row");
      const stripe = el("span", "tower-stripe");
      stripe.style.background = r.color;
      row.append(el("span", "tower-pos"), stripe, el("span", "tower-name", r.name), el("span", "tower-gap"));
      row.addEventListener("click", () => onPick(r.id));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(r.id);
        }
      });
      rows.set(r.id, row);
      return row;
    }),
  );
}

export function setHudPicker(pick: ((id: string) => void) | null) {
  onPick = pick ?? (() => {});
  for (const row of rows.values()) {
    if (pick) {
      row.tabIndex = 0;
      row.setAttribute("role", "button");
    } else {
      row.removeAttribute("tabindex");
      row.removeAttribute("role");
    }
  }
}

export function standingsOf(racers: HudRacer[]) {
  return [...racers].sort(
    (a, b) => Number(a.left) - Number(b.left) || (a.place ?? Infinity) - (b.place ?? Infinity) || b.pos - a.pos,
  );
}

export function renderHud(racers: HudRacer[], focusId: string, spectating: boolean) {
  const key = racers.map((r) => `${r.id}${r.color}`).join("|");
  if (key !== rosterKey) {
    rosterKey = key;
    build(racers);
    if (spectating) setHudPicker(onPick);
  }
  const focus = racers.find((r) => r.id === focusId) ?? racers[0];
  if (!focus) return;
  const order = standingsOf(racers);
  const width = $("markers").clientWidth;

  for (const r of racers) {
    const m = markers.get(r.id)!;
    m.style.transform = `translateX(${(Math.min(TRACK, r.pos) / TRACK) * width}px)`;
    m.classList.toggle("me", r.id === focus.id);
    m.classList.toggle("left", r.left);
  }

  order.forEach((r, rank) => {
    const row = rows.get(r.id)!;
    row.style.setProperty("--rank", String(rank));
    row.classList.toggle("me", r.id === focus.id);
    row.classList.toggle("left", r.left);
    row.children[0]!.textContent = String(rank + 1);
    const gap = Math.round((r.pos - focus.pos) * METERS_PER_UNIT);
    row.children[3]!.textContent = r.left ? "out" : r.place ? "done" : r.id === focus.id ? `${r.wpm} wpm` : `${gap > 0 ? "+" : "−"}${Math.abs(gap)} m`;
    row.setAttribute("aria-label", `${rank + 1}. ${r.name}${r.place ? ", finished" : ""}${r.left ? ", left the race" : ""}`);
  });

  $("track-fill").style.setProperty("--p", String(Math.min(1, focus.pos / TRACK)));
  $("hud-togo").textContent = String(Math.max(0, Math.round((TRACK - focus.pos) * METERS_PER_UNIT)));
  $("hud-kmh").textContent = String(Math.round(focus.speed * METERS_PER_UNIT * 3.6));
  $("hud-wpm").textContent = String(focus.wpm);
  const rank = order.indexOf(focus) + 1;
  $("hud-place").textContent = `P${rank}`;
  $("hud-of").textContent = `of ${racers.filter((r) => !r.left).length}`;
}

export function renderWatchers(count: number) {
  $("hud-watch").textContent = String(count);
  $("hud-watch-chip").classList.toggle("none", count === 0);
  $("room-watch").textContent = String(count);
}
