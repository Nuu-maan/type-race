import { applyBackspace, applyKey, createPlayer, MARK_OK, TRACK, type Player } from "./game";
import { renderGarage, startGarage, stopGarage } from "./garage";
import { startHero, stopHero } from "./hero";
import { initLeaderboard, refreshLeaderboard } from "./leaderboard";
import { fetchProfile, playerId, renderMe } from "./profile";
import { DIFFICULTY, isDifficulty, levelProgress, paintById, type Car, type Difficulty } from "./progress";
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
import { $, bindSeg, countUp, el, replay, setSegEnabled, swapLabel } from "./ui";

type Info = { id: string; name: string; xp: number; level: number; car: Car };
type Status = "lobby" | "countdown" | "racing" | "finished";
type CarState = { id: string; pos: number; speed: number; wpm: number; slip: boolean; nitro: boolean };
type Result = { id: string; name: string; wpm: number; accuracy: number; time: number };
type Progress = { gained: number; xp: number; level: number; leveledUp: boolean; unlocked: string[] };

const screens = { lobby: $("lobby"), room: $("room"), race: $("race") };
const nameInput = $<HTMLInputElement>("name");
const ghost = $<HTMLInputElement>("ghost");
const wordsEl = $("words");
const wordsInner = $("words-inner");
const caret = $("caret");
const canvas = $<HTMLCanvasElement>("track");
const countdownEl = $("countdown");
const MARK_CLASS = ["", "done", "wrong", "missed"];

let ws: WebSocket | null = null;
let me = "";
let code = "";
let host = "";
let status: Status = "lobby";
let difficulty: Difficulty = "normal";
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

void fetchProfile().then((profile) => {
  if (!profile) return;
  if (!nameInput.value) nameInput.value = profile.name;
  renderMe(profile.name, profile.xp);
});

function show(screen: keyof typeof screens) {
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== screen;
  if (screen === "lobby") startHero();
  else stopHero();
  if (screen === "room") startGarage();
  else stopGarage();
  if (screen === "lobby") void refreshLeaderboard();
}

function mine() {
  return players.find((p) => p.id === me);
}

function colorOf(id: string) {
  const car = players.find((p) => p.id === id)?.car;
  return paintById(car?.paint ?? "cobalt")?.color ?? "#2f7bff";
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
  ws = new WebSocket(`${proto}://${location.host}/ws?room=${room}&name=${encodeURIComponent(name)}&pid=${playerId}`);
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
  else if (msg.t === "finish") onFinish(msg.winner, msg.forfeit, msg.results, msg.progress);
}

const setDifficulty = bindSeg($("difficulty"), (value) => {
  if (isDifficulty(value)) send({ t: "difficulty", d: value });
});

function onRoom(msg: { code: string; host: string; status: Status; difficulty: Difficulty; players: Info[] }) {
  code = msg.code;
  host = msg.host;
  players = msg.players;
  difficulty = msg.difficulty;
  history.replaceState(null, "", `/?room=${code}`);
  $("crumb").textContent = `room ${code}`;
  const you = mine();
  if (you) renderMe(you.name, you.xp);
  if (msg.status !== "lobby") return;
  const entering = status !== "lobby" || screens.room.hidden;
  status = "lobby";
  $("finish").hidden = true;
  if (entering) show("room");
  renderRoom();
}

function renderRoom() {
  $("slots").replaceChildren(
    ...[0, 1].map((i) => {
      const p = players[i];
      if (!p) return el("div", "slot empty", "Waiting for a friend");
      const slot = el("div", shownSlots.has(p.id) ? "slot" : "slot enter");
      const swatch = el("span", "swatch");
      swatch.style.background = colorOf(p.id);
      const main = el("div", "slot-main");
      const tags = el("div", "tags");
      for (const tag of [p.id === host && "host", p.id === me && "you"].filter(Boolean) as string[]) tags.append(el("span", "tag", tag));
      main.append(el("span", "slot-name", p.name), tags);
      slot.append(swatch, main, el("span", "level", String(p.level)));
      return slot;
    }),
  );
  shownSlots = new Set(players.map((p) => p.id));

  const isHost = host === me;
  const full = players.length === 2;
  setDifficulty(difficulty);
  setSegEnabled($("difficulty"), isHost);
  $("difficulty-hint").textContent = {
    easy: "Short, common words. Mistakes cost a little.",
    normal: "The 200 most common words.",
    hard: "Long words, capitals and punctuation. Mistakes cost more, XP is higher.",
  }[difficulty];

  $("link").textContent = `${location.origin}/?room=${code}`;
  const start = $<HTMLButtonElement>("start");
  start.hidden = !isHost;
  start.disabled = !full;
  $("room-hint").textContent = !full
    ? "Send the link to a friend. Start unlocks when they join."
    : isHost
      ? `Both players are in. ${DIFFICULTY[difficulty].label} race.`
      : `Waiting for ${nameOf(host)} to start.`;

  const you = mine();
  if (you) renderGarage(you.level, you.car, (car) => send({ t: "car", ...car }));
}

function renderWords() {
  letters = [];
  const frag = document.createDocumentFragment();
  for (const word of text.split(/(?<= )/)) {
    const w = el("span", "word");
    for (const ch of word) {
      const l = el("span", "", ch);
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
  countdownEl.replaceChildren(el("span", "", label));
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
  $("stats").replaceChildren(
    ...players.map((p) => {
      const stat = el("div", "stat");
      const swatch = el("span", "swatch");
      swatch.style.background = colorOf(p.id);
      const wpm = el("span", "stat-wpm", String(cars.get(p.id)?.wpm ?? 0));
      wpm.append(el("small", "", "wpm"));
      stat.append(swatch, el("span", "stat-name", p.id === me ? `${p.name} (you)` : p.name), wpm);
      return stat;
    }),
  );
}

function onFinish(winner: string | null, forfeit: boolean, results: Result[], progress: Record<string, Progress>) {
  status = "finished";
  wordsEl.classList.add("idle");
  ghost.blur();
  stopEngine();
  finishSound(winner === me);
  $("finish-title").textContent = winner === me ? "You won" : `${nameOf(winner ?? "")} won`;
  $("finish-sub").textContent = forfeit ? "The other player left the race." : `${DIFFICULTY[difficulty].label} race`;
  $("finish-rows").replaceChildren(
    ...results
      .sort((a, b) => (a.id === winner ? -1 : b.id === winner ? 1 : 0))
      .map((r) => {
        const row = el("div", "row");
        const swatch = el("span", "swatch");
        swatch.style.background = colorOf(r.id);
        row.append(
          swatch,
          el("strong", "", r.id === me ? `${r.name} (you)` : r.name),
          el("span", "", `${r.wpm} wpm`),
          el("span", "", `${r.accuracy}%`),
          el("span", "time", `${r.time}s`),
        );
        return row;
      }),
  );
  renderXp(progress[me]);
  $("finish").hidden = false;
}

function renderXp(p: Progress | undefined) {
  const box = $("finish-xp");
  box.hidden = !p;
  if (!p) return;
  const before = levelProgress(p.xp - p.gained);
  const after = levelProgress(p.xp);
  const fill = $("finish-xp-fill");
  const badge = $("finish-level");
  badge.textContent = String(before.level);
  fill.style.transition = "none";
  fill.style.setProperty("--p", String(before.into / before.needed));
  void fill.offsetWidth;
  fill.style.transition = "";
  countUp($("finish-xp-gain"), p.gained, (n) => `+${n} XP`);
  requestAnimationFrame(() => {
    fill.style.setProperty("--p", p.leveledUp ? "1" : String(after.into / after.needed));
    if (p.leveledUp) {
      setTimeout(() => {
        badge.textContent = String(after.level);
        replay(badge, "pulse");
        fill.style.transition = "none";
        fill.style.setProperty("--p", "0");
        void fill.offsetWidth;
        fill.style.transition = "";
        fill.style.setProperty("--p", String(after.into / after.needed));
      }, 950);
    }
  });
  const unlock = $("finish-unlock");
  unlock.hidden = !p.leveledUp;
  unlock.textContent = p.unlocked.length
    ? `Level ${after.level}. Unlocked ${p.unlocked.join(" and ")} in the garage.`
    : `Level ${after.level}.`;
  const you = mine();
  if (you) {
    you.xp = p.xp;
    you.level = p.level;
    renderMe(you.name, p.xp);
  }
}

const extraEl = el("span", "extra");

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

function type(ch: string) {
  if (status !== "racing") return;
  const before = self.typed;
  applyKey(text, self, ch, Date.now());
  send({ t: "key", c: ch });
  keySound(self.typed > before && self.marks[self.typed - 1] === MARK_OK);
  if (self.typed === before && ch !== " " && !self.extra) replay(caret, "over");
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
      countdownEl.textContent = "This race needs WebGL.";
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
  const list: SceneCar[] = players.map((p) => {
    const car = cars.get(p.id)!;
    if (status === "finished") {
      car.pos += car.speed * dt;
      car.speed *= Math.exp(-dt * 0.8);
      car.at = now;
    }
    const ahead = status === "racing" ? car.speed * ((now - car.at) / 1000) : 0;
    const target = status === "racing" ? Math.min(TRACK, car.pos + ahead) : car.pos;
    car.shown += (target - car.shown) * (1 - Math.exp(-dt / 0.08));
    return { pos: car.shown, speed: car.speed, slip: car.slip, nitro: car.nitro, name: p.name, color: colorOf(p.id), body: p.car.body };
  });
  const meIndex = Math.max(0, players.findIndex((p) => p.id === me));
  getScene()?.render(dt, list, meIndex);
  const mineCar = list[meIndex];
  if (mineCar) updateEngine(Math.min(1, (mineCar.speed * METERS_PER_UNIT * 3.6) / 350), mineCar.nitro);
  if (hudFrame++ % 3 === 0) renderHud(list, meIndex);
}

function renderHud(list: SceneCar[], meIndex: number) {
  const mineCar = list[meIndex];
  if (!mineCar) return;
  $("hud-kmh").textContent = String(Math.round(mineCar.speed * METERS_PER_UNIT * 3.6));
  const other = list[1 - meIndex];
  if (other) {
    const gap = Math.round((mineCar.pos - other.pos) * METERS_PER_UNIT);
    $("hud-place").textContent = gap >= 0 ? "P1" : "P2";
    $("hud-gap").textContent = gap === 0 ? "level" : `${gap > 0 ? "+" : "−"}${Math.abs(gap)} m`;
  }
  list.forEach((c, i) => {
    const dot = document.querySelector<HTMLElement>(`.hud-dot[data-i="${i}"]`);
    if (!dot) return;
    dot.style.left = `${Math.min(100, (c.pos / TRACK) * 100)}%`;
    dot.style.background = c.color;
    dot.style.color = c.color;
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
  try {
    await navigator.clipboard.writeText($("link").textContent ?? "");
    swapLabel($("copy"), "Copied", 1600);
  } catch {
    swapLabel($("copy"), "Copy failed", 1600);
  }
});

initLeaderboard();
startHero();
