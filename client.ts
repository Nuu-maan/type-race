import { applyBackspace, applyKey, createPlayer, MARK_OK, TRACK, type Player } from "./game";
import { createScene, METERS_PER_UNIT, type SceneCar } from "./scene";
import {
  countSound,
  finishSound,
  isMuted,
  keySound,
  nitroSound,
  setMuted,
  startEngine,
  stopEngine,
  unlockAudio,
  updateEngine,
} from "./sound";

type Info = { id: string; name: string };
type Status = "lobby" | "countdown" | "racing" | "finished";
type CarState = { id: string; pos: number; speed: number; wpm: number; slip: boolean; nitro: boolean };
type Result = { id: string; name: string; wpm: number; accuracy: number; time: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = { lobby: $("lobby"), room: $("room"), race: $("race") };
const nameInput = $<HTMLInputElement>("name");
const ghost = $<HTMLInputElement>("ghost");
const wordsEl = $("words");
const wordsInner = $("words-inner");
const caret = $("caret");
const canvas = $<HTMLCanvasElement>("track");
const countdownEl = $("countdown");
const CAR_COLORS = ["#2f7bff", "#ff3b5c"];

let ws: WebSocket | null = null;
let me = "";
let code = "";
let host = "";
let status: Status = "lobby";
let players: Info[] = [];
let shownSlots = new Set<string>();
let text = "";
let self: Player = createPlayer("", "", 0);
let letters: HTMLSpanElement[] = [];
let cars = new Map<string, CarState & { shown: number; at: number }>();
let frame = 0;

const roomParam = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";

try {
  nameInput.value = localStorage.getItem("name") ?? "";
} catch {}

if (roomParam) {
  $("lobby-btn").textContent = `Join room ${roomParam}`;
  $("crumb").textContent = `room ${roomParam}`;
}

function show(screen: keyof typeof screens) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== screen;
}

function colorOf(id: string) {
  return CAR_COLORS[Math.max(0, players.findIndex((p) => p.id === id))]!;
}

function nameOf(id: string) {
  return players.find((p) => p.id === id)?.name ?? "Player";
}

function send(msg: object) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect(room: string) {
  const name = nameInput.value.trim();
  try {
    localStorage.setItem("name", name);
  } catch {}
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?room=${room}&name=${encodeURIComponent(name)}`);
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = (e) => {
    ws = null;
    stopEngine();
    status = "lobby";
    show("lobby");
    $("finish").hidden = true;
    $("lobby-error").textContent = e.reason || (code ? "Disconnected from the room. Try joining again." : "Could not reach the server.");
    if (e.code === 4004 || e.code === 4003) {
      history.replaceState(null, "", "/");
      $("lobby-btn").textContent = "Create room";
      $("crumb").textContent = "race a friend by typing";
    }
  };
}

function handle(msg: any) {
  if (msg.t === "hello") me = msg.you;
  else if (msg.t === "room") onRoom(msg);
  else if (msg.t === "countdown") onCountdown(msg.text, msg.ms);
  else if (msg.t === "go") onGo();
  else if (msg.t === "state") onState(msg.players);
  else if (msg.t === "finish") onFinish(msg.winner, msg.forfeit, msg.results);
}

function onRoom(msg: { code: string; host: string; status: Status; players: Info[] }) {
  code = msg.code;
  host = msg.host;
  players = msg.players;
  history.replaceState(null, "", `/?room=${code}`);
  $("crumb").textContent = `room ${code}`;
  if (msg.status !== "lobby") return;
  status = "lobby";
  $("finish").hidden = true;
  show("room");
  renderRoom();
}

function renderRoom() {
  const slots = $("slots");
  slots.replaceChildren(
    ...[0, 1].map((i) => {
      const p = players[i];
      const el = document.createElement("div");
      if (!p) {
        el.className = "slot empty";
        el.textContent = "waiting for a friend…";
        return el;
      }
      el.className = shownSlots.has(p.id) ? "slot" : "slot enter";
      const tags = [p.id === host && "host", p.id === me && "you"].filter(Boolean);
      el.innerHTML = `<span class="swatch" style="background:${CAR_COLORS[i]}"></span><div><div class="slot-name"></div><div class="tags">${tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div></div>`;
      el.querySelector(".slot-name")!.textContent = p.name;
      return el;
    }),
  );
  shownSlots = new Set(players.map((p) => p.id));
  $("link").textContent = `${location.origin}/?room=${code}`;
  const start = $<HTMLButtonElement>("start");
  const isHost = host === me;
  const full = players.length === 2;
  start.hidden = !isHost;
  start.disabled = !full;
  $("room-hint").textContent = !full
    ? "Send the link to a friend. Start unlocks when they join."
    : isHost
      ? "Both players are in."
      : `Waiting for ${nameOf(host)} to start.`;
}

function renderWords() {
  letters = [];
  const frag = document.createDocumentFragment();
  for (const word of text.split(/(?<= )/)) {
    const w = document.createElement("span");
    w.className = "word";
    for (const ch of word) {
      const l = document.createElement("span");
      l.textContent = ch;
      letters.push(l);
      w.append(l);
    }
    frag.append(w);
  }
  wordsInner.replaceChildren(frag);
  wordsInner.style.transform = "";
  placeCaret();
}

function placeCaret() {
  const l = letters[self.typed];
  if (!l) return;
  const word = l.parentElement!;
  const lineHeight = word.offsetHeight;
  const scroll = Math.max(0, word.offsetTop - lineHeight);
  wordsInner.style.transform = `translateY(${-scroll}px)`;
  const caretTop = word.offsetTop - scroll + (lineHeight - caret.offsetHeight) / 2;
  caret.style.transform = `translate(${l.offsetLeft}px, ${caretTop}px)`;
}

function onCountdown(newText: string, ms: number) {
  status = "countdown";
  text = newText;
  self = createPlayer(me, nameOf(me), text.length);
  cars = new Map(players.map((p) => [p.id, { id: p.id, pos: 0, speed: 0, wpm: 0, slip: false, nitro: false, shown: 0, at: 0 }]));
  $("finish").hidden = true;
  show("race");
  renderWords();
  renderStats();
  wordsEl.classList.add("idle");
  ghost.focus();
  const steps = Math.round(ms / 1000);
  for (let i = 0; i < steps; i++) setTimeout(() => flashCount(String(steps - i)), i * 1000);
  startLoop();
}

function flashCount(label: string) {
  const span = document.createElement("span");
  span.textContent = label;
  countdownEl.replaceChildren(span);
  countSound(label === "go");
}

function onGo() {
  status = "racing";
  flashCount("go");
  startEngine();
  ghost.focus();
}

function onState(list: CarState[]) {
  const now = performance.now();
  for (const s of list) {
    const car = cars.get(s.id);
    if (!car) continue;
    if (s.id === me && s.nitro && !car.nitro) nitroSound();
    Object.assign(car, s, { at: now });
  }
  renderStats();
}

function renderStats() {
  const stats = $("stats");
  stats.replaceChildren(
    ...players.map((p) => {
      const car = cars.get(p.id);
      const el = document.createElement("div");
      el.className = "stat";
      el.innerHTML = `<span class="swatch" style="background:${colorOf(p.id)}"></span><span class="stat-name"></span><span class="stat-wpm">${car?.wpm ?? 0}<small>wpm</small></span>`;
      el.querySelector(".stat-name")!.textContent = p.id === me ? `${p.name} (you)` : p.name;
      return el;
    }),
  );
}

function onFinish(winner: string | null, forfeit: boolean, results: Result[]) {
  status = "finished";
  wordsEl.classList.add("idle");
  ghost.blur();
  stopEngine();
  finishSound(winner === me);
  $("finish-title").textContent = winner === me ? "You won" : `${nameOf(winner ?? "")} won`;
  $("finish-sub").textContent = forfeit ? "The other player left the race." : "";
  const rows = $("finish-rows");
  rows.replaceChildren(
    ...results
      .sort((a, b) => (a.id === winner ? -1 : b.id === winner ? 1 : 0))
      .map((r) => {
        const el = document.createElement("div");
        el.className = "row";
        el.innerHTML = `<span class="swatch" style="background:${colorOf(r.id)}"></span><strong></strong><span>${r.wpm} wpm</span><span>${r.accuracy}%</span><span class="time">${r.time}s</span>`;
        el.querySelector("strong")!.textContent = r.id === me ? `${r.name} (you)` : r.name;
        return el;
      }),
  );
  $("finish").hidden = false;
}

const MARK_CLASS = ["", "done", "wrong", "missed"];

const extraEl = document.createElement("span");
extraEl.className = "extra";

function paint(from: number, to: number) {
  for (let i = Math.max(0, from); i <= Math.min(to, letters.length - 1); i++) {
    letters[i]!.className = MARK_CLASS[self.marks[i]!]!;
  }
  extraEl.textContent = self.extra;
  if (self.extra) letters[self.typed]?.before(extraEl);
  else extraEl.remove();
  wordsEl.classList.remove("idle");
  placeCaret();
}

function flashCaret() {
  caret.classList.remove("over");
  void caret.offsetWidth;
  caret.classList.add("over");
}

function type(ch: string) {
  if (status !== "racing") return;
  const before = self.typed;
  applyKey(text, self, ch, Date.now());
  send({ t: "key", c: ch });
  keySound(self.typed > before && self.marks[self.typed - 1] === MARK_OK);
  if (self.typed === before && ch !== " " && !self.extra) flashCaret();
  paint(before, self.typed);
}

function backspace(wholeWord: boolean) {
  if (status !== "racing") return;
  const before = self.typed;
  applyBackspace(self, wholeWord);
  send({ t: "back", w: wholeWord });
  paint(self.typed, before);
}

ghost.value = "   ";

ghost.addEventListener("keydown", (e) => {
  if (e.key !== "Backspace") return;
  e.preventDefault();
  backspace(e.ctrlKey || e.altKey || e.metaKey);
});

ghost.addEventListener("beforeinput", (e) => {
  e.preventDefault();
  if (e.inputType.startsWith("delete")) backspace(e.inputType.includes("Word"));
  else for (const ch of e.data ?? "") type(ch);
});

wordsEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  ghost.focus();
});

document.addEventListener("keydown", (e) => {
  if ((status === "racing" || status === "countdown") && document.activeElement !== ghost && e.key.length === 1) ghost.focus();
});

let scene: ReturnType<typeof createScene> | null = null;
let hudFrame = 0;

function getScene() {
  if (!scene) {
    try {
      scene = createScene(canvas);
      new ResizeObserver(() => scene?.resize()).observe(canvas);
    } catch {
      $("countdown").textContent = "This race needs WebGL.";
    }
  }
  return scene;
}

window.addEventListener("resize", placeCaret);

function startLoop() {
  cancelAnimationFrame(frame);
  let last = performance.now();
  let finishedFor = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (status === "finished") finishedFor += dt;
    draw(dt, now);
    if (status === "countdown" || status === "racing" || (status === "finished" && finishedFor < 4)) {
      frame = requestAnimationFrame(loop);
    }
  };
  frame = requestAnimationFrame(loop);
}

function draw(dt: number, now: number) {
  const list = players.map((p) => {
    const car = cars.get(p.id)!;
    if (status === "finished") {
      car.pos += car.speed * dt;
      car.speed *= Math.exp(-dt * 0.8);
      car.at = now;
    }
    const ahead = status === "racing" ? car.speed * ((now - car.at) / 1000) : 0;
    const target = status === "racing" ? Math.min(TRACK, car.pos + ahead) : car.pos;
    car.shown += (target - car.shown) * (1 - Math.exp(-dt / 0.08));
    return { pos: car.shown, speed: car.speed, slip: car.slip, nitro: car.nitro, name: p.name, color: colorOf(p.id) };
  });
  const meIndex = Math.max(0, players.findIndex((p) => p.id === me));
  getScene()?.render(dt, list, meIndex);
  const mine = list[meIndex];
  if (mine) updateEngine(Math.min(1, (mine.speed * METERS_PER_UNIT * 3.6) / 350), mine.nitro);
  if (hudFrame++ % 3 === 0) renderHud(list, meIndex);
}

function renderHud(list: SceneCar[], meIndex: number) {
  const mine = list[meIndex];
  if (!mine) return;
  $("hud-kmh").textContent = String(Math.round(mine.speed * METERS_PER_UNIT * 3.6));
  const other = list[1 - meIndex];
  if (other) {
    const gap = Math.round((mine.pos - other.pos) * METERS_PER_UNIT);
    $("hud-place").textContent = gap >= 0 ? "P1" : "P2";
    $("hud-gap").textContent = gap === 0 ? "level" : `${gap > 0 ? "+" : "−"}${Math.abs(gap)} m`;
  }
  list.forEach((c, i) => {
    const dot = document.querySelector<HTMLElement>(`.hud-dot[data-i="${i}"]`);
    if (!dot) return;
    dot.style.left = `${Math.min(100, (c.pos / TRACK) * 100)}%`;
    dot.style.background = c.color;
    dot.classList.toggle("me", i === meIndex);
  });
}

$("lobby-form").addEventListener("submit", (e) => {
  e.preventDefault();
  unlockAudio();
  $("lobby-error").textContent = "";
  connect(roomParam || "NEW");
});

$("start").addEventListener("click", () => {
  unlockAudio();
  send({ t: "start" });
});
$("rematch").addEventListener("click", () => {
  unlockAudio();
  send({ t: "rematch" });
});

const muteBtn = $<HTMLButtonElement>("mute");
function renderMute() {
  muteBtn.setAttribute("aria-pressed", String(isMuted()));
  muteBtn.setAttribute("aria-label", isMuted() ? "Turn sound on" : "Turn sound off");
  muteBtn.classList.toggle("off", isMuted());
}
muteBtn.addEventListener("click", () => {
  unlockAudio();
  setMuted(!isMuted());
  renderMute();
});
renderMute();
$("copy").addEventListener("click", async () => {
  const btn = $("copy");
  try {
    await navigator.clipboard.writeText($("link").textContent ?? "");
    btn.textContent = "Copied";
  } catch {
    btn.textContent = "Copy failed";
  }
  setTimeout(() => (btn.textContent = "Copy link"), 1500);
});
