import { DIFFICULTY, paintById, type Difficulty } from "../shared/progress";
import { $, el } from "./ui";

type LiveRacer = { name: string; paint: string; progress: number; place: number | null; left: boolean };
type LiveRoom = { code: string; status: "lobby" | "countdown" | "racing" | "finished"; difficulty: Difficulty; spectators: number; racers: LiveRacer[] };

const STATUS = { racing: "Racing", countdown: "Starting", lobby: "In the lobby", finished: "Finished" } as const;
const EYE =
  '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 4C5.4 4 2.9 6.6 2 9c.9 2.4 3.4 5 7 5s6.1-2.6 7-5c-.9-2.4-3.4-5-7-5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /><circle cx="9" cy="9" r="2.2" fill="var(--color-bg-page)" /></svg>';

let timer = 0;
let visible = false;
let polling = false;
let cards = new Map<string, HTMLLIElement>();
let empty: HTMLLIElement | null = null;
let onWatch: (code: string) => void = () => {};

function card(room: LiveRoom, index: number) {
  const li = el("li", "live-card");
  li.style.setProperty("--n", String(index));
  li.addEventListener("animationend", () => (li.style.animation = "none"), { once: true });
  li.innerHTML = `<div class="live-meta"><span class="status"></span><span class="live-code"></span></div><div class="live-racers"></div><div class="live-side"><span class="watch-chip" title="Spectators">${EYE}<span class="count"></span><span class="sr-only">watching</span></span><a class="btn small watch">Watch</a></div>`;
  li.querySelector<HTMLAnchorElement>(".watch")!.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onWatch(room.code);
  });
  return li;
}

function update(li: HTMLLIElement, room: LiveRoom) {
  const status = li.querySelector<HTMLElement>(".status")!;
  status.className = `status ${room.status}`;
  status.textContent = STATUS[room.status];
  li.querySelector(".live-code")!.textContent = `${room.code} · ${DIFFICULTY[room.difficulty].label}`;
  li.querySelector(".count")!.textContent = String(room.spectators);
  const link = li.querySelector<HTMLAnchorElement>(".watch")!;
  link.href = `/?watch=${room.code}`;
  link.setAttribute("aria-label", `Watch race ${room.code}`);
  const racers = li.querySelector<HTMLElement>(".live-racers")!;
  if (racers.children.length !== room.racers.length) {
    racers.replaceChildren(
      ...room.racers.map(() => {
        const row = el("div", "live-racer");
        row.append(el("span", "swatch"), el("strong"), el("span", "live-track"));
        row.lastElementChild!.append(el("span", "live-fill"));
        return row;
      }),
    );
  }
  room.racers.forEach((r, i) => {
    const row = racers.children[i] as HTMLElement;
    const color = paintById(r.paint)?.color ?? "#888";
    (row.children[0] as HTMLElement).style.background = color;
    row.children[1]!.textContent = r.left ? `${r.name} (left)` : r.place ? `${r.name} · P${r.place}` : r.name;
    const fill = row.querySelector<HTMLElement>(".live-fill")!;
    fill.style.background = color;
    fill.style.setProperty("--p", String(Math.min(1, r.progress)));
  });
}

function emptyState() {
  if (!empty) {
    empty = el("li", "live-empty");
    empty.append(el("strong", "", "No races right now"), el("span", "", "Start one and share the watch link so others can follow along."));
    empty.addEventListener("animationend", () => (empty!.style.animation = "none"), { once: true });
  }
  return empty;
}

function render(rooms: LiveRoom[]) {
  const list = $("live-list");
  const next = new Map<string, HTMLLIElement>();
  rooms.forEach((room, i) => {
    const li = cards.get(room.code) ?? card(room, i);
    update(li, room);
    next.set(room.code, li);
  });
  cards = next;
  const items = rooms.length ? [...next.values()] : [emptyState()];
  if (items.length !== list.children.length || items.some((li, i) => list.children[i] !== li)) list.replaceChildren(...items);
}

function renderBadge(rooms: LiveRoom[]) {
  const live = rooms.filter((r) => r.status === "racing" || r.status === "countdown").length;
  const badge = $("live-count");
  badge.hidden = live === 0;
  badge.textContent = String(live);
}

async function poll() {
  clearTimeout(timer);
  if (document.hidden || polling) return;
  polling = true;
  try {
    const response = await fetch("/api/live");
    if (!response.ok) throw new Error("Live races unavailable");
    const rooms: LiveRoom[] = await response.json();
    renderBadge(rooms);
    if (visible) render(rooms);
  } catch {}
  polling = false;
  clearTimeout(timer);
  if (!document.hidden) timer = window.setTimeout(poll, visible ? 1000 : 15000);
}

export function initLive(watch: (code: string) => void) {
  onWatch = watch;
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (!document.hidden) void poll();
  });
  void poll();
}

export function showLive(on: boolean) {
  visible = on;
  clearTimeout(timer);
  if (!document.hidden) {
    if (on) void poll();
    else timer = window.setTimeout(poll, 15000);
  }
}
