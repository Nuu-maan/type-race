import { TRACK } from "./game";

type Info = { id: string; name: string };
type Status = "lobby" | "countdown" | "racing" | "finished";
type CarState = { id: string; pos: number; speed: number; wpm: number; skid: boolean; nitro: boolean };
type Result = { id: string; name: string; wpm: number; accuracy: number; time: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = { lobby: $("lobby"), room: $("room"), race: $("race") };
const nameInput = $<HTMLInputElement>("name");
const ghost = $<HTMLInputElement>("ghost");
const wordsEl = $("words");
const wordsInner = $("words-inner");
const caret = $("caret");
const canvas = $<HTMLCanvasElement>("track");
const ctx = canvas.getContext("2d")!;
const countdownEl = $("countdown");
const CAR_COLORS = ["#5b7fa6", "#c0736f"];

let ws: WebSocket | null = null;
let me = "";
let code = "";
let host = "";
let status: Status = "lobby";
let players: Info[] = [];
let shownSlots = new Set<string>();
let text = "";
let typed = 0;
let letters: HTMLSpanElement[] = [];
let cars = new Map<string, CarState & { shown: number; at: number }>();
let roadOffset = 0;
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
  const l = letters[typed];
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
  typed = 0;
  cars = new Map(players.map((p) => [p.id, { id: p.id, pos: 0, speed: 0, wpm: 0, skid: false, nitro: false, shown: 0, at: 0 }]));
  roadOffset = 0;
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
}

function onGo() {
  status = "racing";
  flashCount("go");
  ghost.focus();
}

function onState(list: CarState[]) {
  const now = performance.now();
  for (const s of list) {
    const car = cars.get(s.id);
    if (car) Object.assign(car, s, { at: now });
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

function type(ch: string) {
  if (status !== "racing" || typed >= text.length) return;
  send({ t: "key", c: ch });
  const l = letters[typed]!;
  if (text[typed] === ch) {
    l.classList.remove("wrong");
    l.classList.add("done");
    typed++;
    wordsEl.classList.remove("idle");
    placeCaret();
  } else {
    l.classList.remove("wrong");
    void l.offsetWidth;
    l.classList.add("wrong");
  }
}

ghost.addEventListener("beforeinput", (e) => {
  e.preventDefault();
  for (const ch of e.data ?? "") type(ch);
});

wordsEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  ghost.focus();
});

document.addEventListener("keydown", (e) => {
  if ((status === "racing" || status === "countdown") && document.activeElement !== ghost && e.key.length === 1) ghost.focus();
});

function resize() {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(0);
}

new ResizeObserver(resize).observe(canvas);
window.addEventListener("resize", placeCaret);

function startLoop() {
  cancelAnimationFrame(frame);
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    draw(dt);
    if (status === "countdown" || status === "racing" || [...cars.values()].some((c) => Math.abs(c.pos - c.shown) > 0.5)) {
      frame = requestAnimationFrame(loop);
    }
  };
  frame = requestAnimationFrame(loop);
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function draw(dt: number) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const pad = 20;
  const startX = 64;
  const finishX = w - 40;
  const laneH = (h - pad * 2) / 2;
  const mine = cars.get(me);
  roadOffset = (roadOffset + (mine?.speed ?? 0) * dt * 4) % 40;

  for (let i = 0; i < 2; i++) {
    const y = pad + i * laneH;
    ctx.fillStyle = "#e9e9e9";
    roundRect(12, y + 4, w - 24, laneH - 8, 16);
    ctx.fill();
  }

  ctx.strokeStyle = "#d6d6d6";
  ctx.lineWidth = 2;
  ctx.setLineDash([16, 24]);
  ctx.lineDashOffset = roadOffset;
  ctx.beginPath();
  ctx.moveTo(20, h / 2);
  ctx.lineTo(w - 20, h / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#cfcfcf";
  ctx.beginPath();
  ctx.moveTo(startX, pad + 8);
  ctx.lineTo(startX, h - pad - 8);
  ctx.stroke();

  const cell = 6;
  for (let y = pad + 4; y < h - pad - 4; y += cell) {
    for (let c = 0; c < 2; c++) {
      ctx.fillStyle = (Math.floor((y - pad) / cell) + c) % 2 ? "#171717" : "#ffffff";
      ctx.fillRect(finishX + c * cell, y, cell, Math.min(cell, h - pad - 4 - y));
    }
  }

  const now = performance.now();
  players.forEach((p, i) => {
    const car = cars.get(p.id);
    if (!car) return;
    const target = Math.min(TRACK, car.pos + car.speed * ((now - car.at) / 1000) * (status === "racing" ? 1 : 0));
    car.shown += (target - car.shown) * (1 - Math.exp(-dt / 0.08));
    if (!dt) car.shown = target;
    const x = startX + (car.shown / TRACK) * (finishX - startX - 44);
    const y = pad + i * laneH + laneH / 2;
    drawCar(x, y, CAR_COLORS[i]!, car, p.id === me, p.name);
  });
}

function drawCar(x: number, y: number, color: string, car: CarState, isMe: boolean, name: string) {
  const shake = car.skid ? (Math.random() - 0.5) * 3 : 0;
  ctx.save();
  ctx.translate(x, y + shake);
  if (car.skid) ctx.rotate((Math.random() - 0.5) * 0.08);

  if (car.nitro) {
    const flame = 14 + Math.random() * 8;
    const g = ctx.createLinearGradient(-flame, 0, 0, 0);
    g.addColorStop(0, "rgba(251,146,60,0)");
    g.addColorStop(1, "rgba(251,146,60,0.9)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(-flame, 0);
    ctx.lineTo(0, 5);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(0,0,0,0.08)";
  roundRect(1, -9, 44, 20, 7);
  ctx.fill();
  ctx.fillStyle = "#262626";
  for (const [wx, wy] of [[6, -12], [30, -12], [6, 8], [30, 8]] as const) {
    roundRect(wx, wy, 9, 4, 2);
    ctx.fill();
  }
  ctx.fillStyle = color;
  roundRect(0, -10, 44, 20, 7);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  roundRect(24, -7, 8, 14, 3);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  roundRect(10, -6, 10, 12, 3);
  ctx.fill();

  ctx.font = `500 12px "Public Sans", sans-serif`;
  ctx.fillStyle = isMe ? "#171717" : "#8a8a8a";
  ctx.textBaseline = "bottom";
  ctx.fillText(isMe ? "you" : name, 0, -15);
  ctx.restore();
}

$("lobby-form").addEventListener("submit", (e) => {
  e.preventDefault();
  $("lobby-error").textContent = "";
  connect(roomParam || "NEW");
});

$("start").addEventListener("click", () => send({ t: "start" }));
$("rematch").addEventListener("click", () => send({ t: "rematch" }));
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
