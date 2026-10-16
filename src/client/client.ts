import { applyBackspace, applyKey, createPlayer, MARK_OK, METERS_PER_UNIT, TRACK, type Player } from "../shared/game";
import { isRaceMode, type RaceMode } from "../shared/challenge";
import { renderDashboard, type Competitions, type RecordEntry } from "./dashboard";
import { renderGarage, startGarage, stopGarage } from "./garage";
import { startHero, stopHero } from "./hero";
import { ordinal, renderHud, renderWatchers, setHudPicker, standingsOf, type HudRacer } from "./hud";
import { initLeaderboard, refreshLeaderboard } from "./leaderboard";
import { initLive, showLive } from "./live";
import { fetchProfile, playerId, renderMe, type Profile } from "./profile";
import { DIFFICULTY, isDifficulty, levelProgress, MAX_RACERS, MIN_RACERS, paintById, type Car, type Difficulty } from "../shared/progress";
import {
  countSound,
  finishSound,
  isMuted,
  joinSound,
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
type Role = "play" | "watch";
type View = "lobby" | "live" | "profile" | "room" | "race";
type CarState = { id: string; pos: number; speed: number; wpm: number; slip: boolean; nitro: boolean; place: number | null; left: boolean };
type SceneCar = { pos: number; body: string; speed: number; slip: boolean; nitro: boolean; name: string; color: string };
type Result = { id: string; name: string; place: number; finished: boolean; left: boolean; wpm: number; accuracy: number; time: number; pos: number };
type Progress = { gained: number; xp: number; level: number; leveledUp: boolean; unlocked: string[]; saved: boolean };

const screens: Record<View, HTMLElement> = { lobby: $("lobby"), live: $("live"), profile: $("profile"), room: $("room"), race: $("race") };
const nameInput = $<HTMLInputElement>("name");
const ghost = $<HTMLInputElement>("ghost");
const wordsEl = $("words");
const wordsInner = $("words-inner");
const caret = $("caret");
const canvas = $<HTMLCanvasElement>("track");
const countdownEl = $("countdown");
const MARK_CLASS = ["", "done", "wrong", "missed"];
let ws: WebSocket | null = null;
let role: Role = "play";
let view: View = "lobby";
let mode: RaceMode = "multiplayer";
let me = "";
let code = "";
let host = "";
let status: Status = "lobby";
let difficulty: Difficulty = "normal";
let players: Info[] = [];
let roster: Info[] = [];
let spectators = 0;
let followId: string | null = null;
let shownSlots = new Set<string>();
let text = "";
let self: Player = createPlayer("", "", 0);
let letters: HTMLSpanElement[] = [];
let cars = new Map<string, CarState & { shown: number; at: number }>();
let graceEndsAt: number | null = null;
let frame = 0;
let profile: Profile | null = null;
let resumeToken = "";
let reconnectUntil = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectionRoom = "";
let firstKeyTracked = false;
let finishTracked = false;
let lastResult: Result | null = null;
let leaderboardReady = false;

const sessionId = crypto.randomUUID();

function track(name: string, detail?: string, elapsedMs?: number) {
  void fetch("/api/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player: playerId, session: sessionId, name, detail, elapsedMs }),
    keepalive: true,
  }).catch(() => {});
}

const params = new URLSearchParams(location.search);
const roomParam = params.get("room")?.toUpperCase() ?? "";
const watchParam = params.get("watch")?.toUpperCase() ?? "";

try {
  nameInput.value = localStorage.getItem("name") ?? "";
} catch {}

void fetchProfile().then((next) => {
  if (!next) return;
  profile = next;
  if (!nameInput.value) nameInput.value = next.name;
  renderMe(next.name, next.xp);
  renderHomeProgress();
});

track("landing", params.get("mode") === "daily" ? "daily" : roomParam ? "room" : "direct", 0);

function setCrumb(text: string) {
  $("crumb").textContent = text;
}

function show(next: View) {
  view = next;
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== next;
  for (const tab of document.querySelectorAll<HTMLAnchorElement>(".tabs a")) {
    const current = tab.dataset.action === "daily"
      ? next === "race" && mode === "daily"
      : tab.dataset.view === "live"
        ? next === "live"
        : next === "lobby" || (next === "race" && mode !== "daily");
    if (current) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  if (next === "lobby") startHero();
  else stopHero();
  if (next !== "race") disposeRaceScene();
  if (next === "room" && role === "play") startGarage();
  else stopGarage();
  showLive(next === "live");
  if (next === "lobby") {
    if (leaderboardReady) void refreshLeaderboard();
    else {
      leaderboardReady = true;
      initLeaderboard();
    }
  }
}

function goLobby(message = "") {
  history.replaceState(null, "", "/");
  $("lobby-btn").textContent = "Create a room";
  setCrumb("");
  $("lobby-error").textContent = message;
  show("lobby");
}

function goLive(message = "") {
  history.replaceState(null, "", "/?view=live");
  setCrumb("");
  show("live");
  if (message) $("live-list").before(Object.assign(el("p", "error fresh", message), { id: "live-error" }));
}

function renderHomeProgress() {
  const card = $("return-card");
  if (!profile?.races) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  $("return-summary").textContent = `${profile.bestWpm} WPM best · ${profile.averageAccuracy}% average accuracy · ${profile.dailyStreak} day daily streak`;
  const ghostButton = $("home-ghost");
  ghostButton.hidden = !profile.ghostReady;
  $("home-profile").classList.toggle("primary", !profile.ghostReady);
}

async function showProfile() {
  if (!leaveRoom()) return;
  role = "play";
  history.replaceState(null, "", "/?view=profile");
  setCrumb("your profile");
  show("profile");
  track("profile_viewed");
  const statusNode = $("profile-status");
  statusNode.hidden = false;
  statusNode.textContent = "Loading your progress…";
  try {
    const [next, response] = await Promise.all([fetchProfile(), fetch(`/api/competitions?id=${playerId}`)]);
    const competitionData = response.ok ? await response.json() : null;
    if (!next) {
      $("profile-dashboard").replaceChildren();
      statusNode.textContent = "Finish a practice race to create your profile and first personal record.";
      return;
    }
    if (!competitionData?.daily || !competitionData?.weekly) throw new Error("Competition data unavailable");
    profile = next;
    renderMe(next.name, next.xp);
    renderHomeProgress();
    renderDashboard($("profile-dashboard"), next, competitionData as Competitions, {
      onPractice: () => startMode("practice"),
      onDaily: () => startMode("daily"),
      onGhost: () => startMode("ghost"),
      onShare: shareRecord,
    });
    statusNode.hidden = true;
  } catch {
    statusNode.textContent = "Your progress could not load. Check your connection and try again.";
  }
}

function startMode(nextMode: Exclude<RaceMode, "multiplayer">) {
  if (!leaveRoom()) return;
  role = "play";
  mode = nextMode;
  code = "";
  lastResult = null;
  history.replaceState(null, "", `/?mode=${nextMode}`);
  setCrumb(nextMode === "daily" ? "today's challenge" : nextMode === "ghost" ? "personal best" : "practice");
  unlockAudio();
  connect("SOLO", "play", nextMode);
}

function leaveRoom() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectUntil = 0;
  resumeToken = "";
  if (!ws) return true;
  if (role === "play" && (status === "racing" || status === "countdown") && !confirm("Leave this race? It counts as a loss for you.")) return false;
  const socket = ws;
  ws = null;
  socket.onclose = null;
  socket.close();
  stopEngine();
  cancelAnimationFrame(frame);
  setResultsOpen(false);
  status = "lobby";
  return true;
}

function mine() {
  return roster.find((p) => p.id === me) ?? players.find((p) => p.id === me);
}

function infoOf(id: string) {
  return roster.find((p) => p.id === id) ?? players.find((p) => p.id === id);
}

function colorOf(id: string) {
  return paintById(infoOf(id)?.car.paint ?? "cobalt")?.color ?? "#2f7bff";
}

function nameOf(id: string) {
  return infoOf(id)?.name ?? "Racer";
}

function send(msg: object) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function watchUrl() {
  return `${location.origin}/?watch=${code}`;
}

function connect(room: string, as: Role, nextMode: RaceMode = "multiplayer", resume = "") {
  role = as;
  mode = nextMode;
  connectionRoom = room;
  const name = nameInput.value.trim();
  if (as === "play" && name) {
    try {
      localStorage.setItem("name", name);
    } catch {}
  }
  document.getElementById("live-error")?.remove();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const query = new URLSearchParams({ room, name, pid: playerId, role: as, mode: nextMode, sid: sessionId });
  if (resume) query.set("resume", resume);
  const socket = new WebSocket(`${proto}://${location.host}/ws?${query}`);
  ws = socket;
  socket.onmessage = (e) => handle(JSON.parse(e.data));
  socket.onclose = (e) => {
    if (ws !== socket) return;
    ws = null;
    const interrupted = as === "play" && Boolean(resumeToken) && (status === "racing" || status === "countdown") && (e.code === 1006 || !e.wasClean);
    if (interrupted && !resume) reconnectUntil = Date.now() + 7500;
    if (interrupted && Date.now() < reconnectUntil) {
      countdownEl.replaceChildren(el("span", "reconnecting", "Reconnecting…"));
      reconnectTimer = setTimeout(() => connect(connectionRoom || room, as, mode, resumeToken), 350);
      return;
    }
    stopEngine();
    cancelAnimationFrame(frame);
    status = "lobby";
    setResultsOpen(false);
    const reason = e.reason || (code ? "Connection to the room was lost. Open the link again to rejoin." : "Unable to reach the server. Check that it's running and try again.");
    if (as === "watch") goLive(reason);
    else if (e.code === 4004 || e.code === 4003 || e.code === 4008 || e.code === 4010) goLobby(reason);
    else {
      show("lobby");
      $("lobby-error").textContent = reason;
    }
  };
}

function handle(msg: any) {
  if (msg.t === "hello") {
    me = msg.you;
    if (isRaceMode(msg.mode)) mode = msg.mode;
    if (typeof msg.resume === "string") {
      resumeToken = msg.resume;
    }
  }
  else if (msg.t === "room") onRoom(msg);
  else if (msg.t === "countdown") onCountdown(msg.roster, msg.ms, msg.text, msg.difficulty, msg.mode);
  else if (msg.t === "resume") onResume(msg);
  else if (msg.t === "sync") onSync(msg);
  else if (msg.t === "go") onGo();
  else if (msg.t === "state") onState(msg.players, msg.graceEndsAt);
  else if (msg.t === "finish") onFinish(msg.winner, msg.forfeit, msg.results, msg.progress);
}

const setDifficulty = bindSeg($("difficulty"), (value) => {
  if (isDifficulty(value)) send({ t: "difficulty", d: value });
});

function onRoom(msg: { code: string; host: string; status: Status; difficulty: Difficulty; spectators: number; players: Info[] }) {
  mode = "multiplayer";
  code = msg.code;
  host = msg.host;
  players = msg.players;
  difficulty = msg.difficulty;
  spectators = msg.spectators;
  renderWatchers(spectators);
  history.replaceState(null, "", role === "watch" ? `/?watch=${code}` : `/?room=${code}`);
  setCrumb(role === "watch" ? `watching ${code}` : `room ${code}`);
  const you = mine();
  if (you) renderMe(you.name, you.xp);
  if (msg.status === "countdown" || msg.status === "racing") return;
  if (msg.status === "finished" && view === "race") return;
  const entering = view !== "room";
  if (!entering && players.some((p) => p.id !== me && !shownSlots.has(p.id))) joinSound();
  status = msg.status;
  setResultsOpen(false);
  if (entering) show("room");
  renderRoom();
}

function renderRoom() {
  const watching = role === "watch";
  $("room").querySelector(".room-grid")!.classList.toggle("spectating", watching);
  $("room-title").textContent = `Racers · ${players.length} of ${MAX_RACERS}`;
  const slots = players.map((p) => {
    const slot = el("div", shownSlots.has(p.id) ? "slot" : "slot enter");
    const swatch = el("span", "swatch");
    swatch.style.background = colorOf(p.id);
    const main = el("div", "slot-main");
    const tags = el("div", "tags");
    for (const tag of [p.id === host && "host", p.id === me && "you"].filter(Boolean) as string[]) tags.append(el("span", "tag", tag));
    main.append(el("span", "slot-name", p.name), tags);
    const level = el("span", "level", String(p.level));
    level.title = `Level ${p.level}`;
    slot.append(swatch, main, level);
    return slot;
  });
  if (players.length < MAX_RACERS) slots.push(el("div", "slot empty", players.length < MIN_RACERS ? "Waiting for racers" : "Room for more racers"));
  $("slots").replaceChildren(...slots);
  shownSlots = new Set(players.map((p) => p.id));

  const isHost = host === me;
  const ready = players.length >= MIN_RACERS;
  setDifficulty(difficulty);
  setSegEnabled($("difficulty"), isHost && !watching);
  $("difficulty-hint").textContent = {
    easy: "Short, common words. Mistakes cost a little.",
    normal: "The 200 most common words.",
    hard: "Long words, capitals and punctuation. Mistakes cost more, XP is higher.",
  }[difficulty];

  $("link").textContent = `${location.origin}/?room=${code}`;
  $("watch-link").textContent = watchUrl();
  $("link").closest(".panel-row")!.toggleAttribute("hidden", watching);
  const start = $<HTMLButtonElement>("start");
  start.hidden = !isHost || watching;
  start.disabled = !ready;
  start.textContent = ready ? `Start race · ${players.length} racers` : "Start race";
  $("room-hint").textContent = watching
    ? `You're watching. The race starts when ${nameOf(host)} is ready.`
    : !ready
      ? `Send the link to friends. Start unlocks at ${MIN_RACERS} racers.`
      : isHost
        ? `${DIFFICULTY[difficulty].label} race. Up to ${MAX_RACERS - players.length} more can join.`
        : `Waiting for ${nameOf(host)} to start.`;

  const you = mine();
  if (you && !watching) renderGarage(you.level, you.car, (car) => send({ t: "car", ...car }));
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

function enterRace(nextRoster: Info[], nextDifficulty: Difficulty) {
  roster = nextRoster;
  difficulty = nextDifficulty;
  followId = null;
  graceEndsAt = null;
  cars = new Map(roster.map((p) => [p.id, { id: p.id, pos: 0, speed: 0, wpm: 0, slip: false, nitro: false, place: null, left: false, shown: 0, at: 0 }]));
  const watching = role === "watch";
  $("race").classList.toggle("spectating", watching);
  wordsEl.hidden = watching;
  $("keys-hint").hidden = watching;
  $("spectate-bar").hidden = !watching;
  $("finished-banner").hidden = true;
  $("race-title").textContent = mode === "daily" ? "Today's typing challenge" : mode === "ghost" ? "Personal best typing race" : mode === "practice" ? "Typing practice" : "Typing race";
  setHudPicker(watching ? pickFollow : null);
  renderFollow();
  setResultsOpen(false);
  show("race");
}

function pickFollow(id: string) {
  followId = id;
  renderFollow();
}

function renderFollow() {
  $("spectate-follow").textContent = followId
    ? `Following ${nameOf(followId)}. Select another racer in the tower to switch.`
    : "Following the leader. Select a racer in the tower to follow them.";
}

function onCountdown(nextRoster: Info[], ms: number, newText: string, nextDifficulty: Difficulty, nextMode?: unknown) {
  if (isRaceMode(nextMode)) mode = nextMode;
  finishTracked = false;
  if (role === "play") track("race_started", mode);
  status = "countdown";
  enterRace(nextRoster, nextDifficulty);
  if (role === "play") {
    text = newText;
    self = createPlayer(me, nameOf(me), text.length, nextDifficulty);
    renderWords();
    wordsEl.classList.add("idle");
    ghost.focus();
  }
  const steps = Math.round(ms / 1000);
  for (let i = 0; i < steps; i++) setTimeout(() => flashCount(String(steps - i)), i * 1000);
  if (steps === 0) countdownEl.replaceChildren(el("span", "ready-copy", "Start typing"));
  startLoop();
}

function onSync(msg: { status: Status; difficulty: Difficulty; roster: Info[]; startsIn: number }) {
  status = msg.status;
  enterRace(msg.roster, msg.difficulty);
  if (msg.status === "countdown" && msg.startsIn > 0) {
    const steps = Math.ceil(msg.startsIn / 1000);
    for (let i = 0; i < steps; i++) setTimeout(() => flashCount(String(steps - i)), msg.startsIn - (steps - i) * 1000);
  }
  startLoop();
}

function onResume(msg: {
  status: Status;
  mode: RaceMode;
  text: string;
  difficulty: Difficulty;
  roster: Info[];
  startsIn: number;
  self: Partial<Player> & { marks?: number[] } | null;
  players: CarState[];
  graceEndsAt: number | null;
}) {
  mode = msg.mode;
  status = msg.status;
  text = msg.text;
  enterRace(msg.roster, msg.difficulty);
  self = createPlayer(me, nameOf(me), text.length, msg.difficulty);
  if (msg.self) {
    const { marks, ...saved } = msg.self;
    Object.assign(self, saved);
    if (marks) self.marks.set(marks.slice(0, self.marks.length));
  }
  renderWords();
  paint(0, self.typed);
  onState(msg.players, msg.graceEndsAt, msg.status !== "countdown");
  if (msg.status === "countdown") {
    const steps = Math.ceil(msg.startsIn / 1000);
    for (let i = 0; i < steps; i++) setTimeout(() => flashCount(String(steps - i)), Math.max(0, msg.startsIn - (steps - i) * 1000));
  } else if (msg.status === "racing") {
    startEngine();
  }
  ghost.focus();
  startLoop();
}

function flashCount(label: string) {
  countdownEl.replaceChildren(el("span", "", label));
  countSound(label === "go");
}

function onGo() {
  status = "racing";
  flashCount("go");
  if (role === "play") {
    startEngine();
    ghost.focus();
  }
}

function onState(list: CarState[], grace: number | null, advance = true) {
  const now = performance.now();
  if (advance && status === "countdown") status = "racing";
  graceEndsAt = grace === null ? null : now + grace;
  for (const s of list) {
    const car = cars.get(s.id);
    if (!car) continue;
    if (s.id === me && s.nitro && !car.nitro) nitroSound();
    Object.assign(car, s, { at: now });
  }
  renderBanner(now);
}

function focusId() {
  if (role === "play") return me;
  if (followId && cars.has(followId)) return followId;
  return standingsOf(hudRacers())[0]?.id ?? roster[0]?.id ?? "";
}

function renderBanner(now: number) {
  const car = cars.get(focusId());
  const banner = $("finished-banner");
  if (!car?.place) {
    banner.hidden = true;
    return;
  }
  const who = role === "play" ? "You" : nameOf(car.id);
  const wait = graceEndsAt ? Math.max(0, Math.ceil((graceEndsAt - now) / 1000)) : 0;
  const next = `${who} finished ${ordinal(car.place)}${wait ? ` · results in ${wait}s` : ""}`;
  if (banner.textContent !== next) banner.textContent = next;
  banner.hidden = false;
}

function setResultsOpen(open: boolean) {
  $("finish").hidden = !open;
  const background = [
    ghost,
    document.querySelector<HTMLElement>(".skip")!,
    $("race").querySelector<HTMLElement>(".track-stage")!,
    wordsEl,
    $("race-tools"),
    $("spectate-bar"),
    document.querySelector<HTMLElement>(".bar")!,
  ];
  for (const node of background) {
    node.inert = open;
  }
}

function onFinish(winner: string | null, forfeit: boolean, results: Result[], progress: Record<string, Progress>) {
  status = "finished";
  wordsEl.classList.add("idle");
  ghost.blur();
  stopEngine();
  $("finished-banner").hidden = true;
  const mineRow = results.find((r) => r.id === me);
  const saved = mineRow ? progress[me] : undefined;
  const previousBest = profile?.bestWpm ?? 0;
  lastResult = mineRow ?? null;
  if (role === "play" && !finishTracked) {
    finishTracked = true;
    track("race_completed", mode);
  }
  if (role === "play") finishSound(mineRow?.place === 1);
  $("finish-title").textContent = role !== "play" || !mineRow
    ? `${nameOf(winner ?? "")} won`
    : mode === "practice"
      ? "Practice complete"
      : mode === "daily"
        ? "Daily challenge complete"
        : mode === "ghost"
          ? winner === me ? "You beat your best" : "Your best held on"
          : mineRow.place === 1 ? "You won" : `You finished ${ordinal(mineRow.place)}`;
  const modeLabel = mode === "daily" ? "Today's shared course" : mode === "ghost" ? "Personal best race" : mode === "practice" ? "Solo practice" : `${results.filter((r) => !r.left).length} racers`;
  $("finish-sub").textContent = forfeit ? "Everyone else left the race." : `${DIFFICULTY[difficulty].label} · ${modeLabel}`;
  const highlight = $("finish-highlight");
  const isPersonalBest = Boolean(mineRow?.finished && saved?.saved && mineRow.wpm > previousBest);
  highlight.hidden = false;
  highlight.textContent = !saved?.saved && role === "play"
    ? "This result could not be saved. Your stats and XP were not changed."
    : isPersonalBest
      ? `New personal best · ${mineRow!.wpm} WPM`
      : mode === "ghost" && winner === me
        ? "You are faster than your previous best."
        : "";
  highlight.hidden = !highlight.textContent;
  $("finish-rows").replaceChildren(
    ...results.map((r, i) => {
      const row = el("div", r.id === me ? "row me" : "row");
      row.style.setProperty("--n", String(i));
      const swatch = el("span", "swatch");
      swatch.style.background = colorOf(r.id);
      const outcome = r.left ? "left" : r.finished ? `${r.time}s` : `${Math.round((r.pos / TRACK) * 100)}%`;
      row.append(
        el("span", "place", ordinal(r.place)),
        swatch,
        el("strong", "", r.id === me ? `${r.name} (you)` : r.name),
        el("span", "", `${r.wpm} wpm`),
        el("span", "", `${r.accuracy}%`),
        el("span", "time", outcome),
      );
      return row;
    }),
  );
  renderXp(role === "play" && mineRow?.finished ? saved : undefined);
  const rematch = $("rematch");
  rematch.hidden = role === "watch";
  rematch.textContent = mode === "daily" ? "Try today again" : mode === "practice" ? "Practice again" : mode === "ghost" ? "Race again" : "Rematch";
  const canRaceBest = role === "play" && Boolean(profile?.ghostReady || (mineRow?.finished && saved?.saved));
  $("race-best").hidden = !canRaceBest;
  $("share-result").hidden = role !== "play" || !mineRow;
  $("to-profile").hidden = role !== "play";
  const preferGhost = canRaceBest && mode === "practice" && isPersonalBest;
  rematch.classList.toggle("primary", !preferGhost);
  $("race-best").classList.toggle("primary", preferGhost);
  $("to-live").hidden = role !== "watch";
  setResultsOpen(true);
  $("finish").querySelector<HTMLElement>(".card")!.focus();
  if (role === "play" && saved?.saved) {
    void fetchProfile().then((next) => {
      if (!next) return;
      profile = next;
      renderMe(next.name, next.xp);
      renderHomeProgress();
      $("race-best").hidden = !next.ghostReady;
    });
  }
}

function renderXp(p: Progress | undefined) {
  const box = $("finish-xp");
  box.hidden = !p?.saved;
  if (!p?.saved) return;
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
    if (!p.leveledUp) return;
    setTimeout(() => {
      badge.textContent = String(after.level);
      replay(badge, "pulse");
      fill.style.transition = "none";
      fill.style.setProperty("--p", "0");
      void fill.offsetWidth;
      fill.style.transition = "";
      fill.style.setProperty("--p", String(after.into / after.needed));
    }, 950);
  });
  const unlock = $("finish-unlock");
  unlock.hidden = !p.leveledUp;
  unlock.textContent = p.unlocked.length ? `Level ${after.level}. Unlocked ${p.unlocked.join(" and ")} in the garage.` : `Level ${after.level}.`;
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
  const acceptsInput = status === "racing" || (status === "countdown" && mode !== "multiplayer");
  if (!acceptsInput || role !== "play" || self.finishedAt !== null || cars.get(me)?.place) return;
  if (!firstKeyTracked) {
    firstKeyTracked = true;
    track("first_keystroke", mode, Math.round(performance.now()));
  }
  const before = self.typed;
  applyKey(text, self, ch, Date.now());
  send({ t: "key", c: ch });
  keySound(self.typed > before && self.marks[self.typed - 1] === MARK_OK);
  if (self.typed === before && ch !== " " && !self.extra) replay(caret, "over");
  paint(before, self.typed);
}

function backspace(wholeWord: boolean) {
  const acceptsInput = status === "racing" || (status === "countdown" && mode !== "multiplayer");
  if (!acceptsInput || role !== "play") return;
  const before = self.typed;
  applyBackspace(self, wholeWord);
  send({ t: wholeWord ? "wordBack" : "back" });
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
  if (role !== "play" || view !== "race") return;
  if ((status === "racing" || status === "countdown") && document.activeElement !== ghost && e.key.length === 1) ghost.focus();
});

function refocus() {
  if (role === "play" && view === "race" && (status === "racing" || status === "countdown")) ghost.focus();
}

let textSize = "m";
try {
  textSize = localStorage.getItem("textSize") ?? "m";
} catch {}
if (!["s", "m", "l"].includes(textSize)) textSize = "m";
document.documentElement.dataset.textSize = textSize;
bindSeg($("text-size"), (value) => {
  document.documentElement.dataset.textSize = value;
  try {
    localStorage.setItem("textSize", value);
  } catch {}
  placeCaret();
  refocus();
})(textSize);

const fsButton = $("fullscreen");
fsButton.hidden = !document.fullscreenEnabled;
fsButton.setAttribute("aria-label", "Full screen");
fsButton.addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});
document.addEventListener("fullscreenchange", () => {
  const on = Boolean(document.fullscreenElement);
  const label = on ? "Exit full screen" : "Full screen";
  document.documentElement.classList.toggle("fs", on);
  fsButton.setAttribute("aria-pressed", String(on));
  fsButton.setAttribute("aria-label", label);
  swapLabel(fsButton, label);
  requestAnimationFrame(placeCaret);
  refocus();
});

type RaceScene = { render: (dt: number, cars: SceneCar[], meIndex: number) => void; resize: () => void; dispose: () => void };

let scene: RaceScene | null = null;
let sceneLoading: Promise<void> | null = null;
let sceneObserver: ResizeObserver | null = null;
let hudFrame = 0;

function getScene() {
  if (!scene && !sceneLoading) {
    sceneLoading = import("./scene")
      .then(({ createScene }) => {
        if (view !== "race") return;
        scene = createScene(canvas);
        sceneObserver = new ResizeObserver(() => scene?.resize());
        sceneObserver.observe(canvas);
      })
      .catch(() => {
        countdownEl.textContent = "This race needs WebGL.";
      })
      .finally(() => {
        sceneLoading = null;
      });
  }
  return scene;
}

function disposeRaceScene() {
  sceneObserver?.disconnect();
  sceneObserver = null;
  scene?.dispose();
  scene = null;
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

function hudRacers(): HudRacer[] {
  return roster.map((p) => {
    const car = cars.get(p.id)!;
    return { id: p.id, name: p.name, color: colorOf(p.id), pos: car.shown, speed: car.speed, wpm: car.wpm, place: car.place, left: car.left };
  });
}

function draw(dt: number, now: number) {
  const list: SceneCar[] = roster.map((p) => {
    const car = cars.get(p.id)!;
    if (status === "finished") {
      car.pos += car.speed * dt;
      car.speed *= Math.exp(-dt * 0.8);
      car.at = now;
    }
    const moving = status === "racing" && !car.place && !car.left;
    const ahead = moving ? car.speed * ((now - car.at) / 1000) : 0;
    const target = status === "racing" ? Math.min(TRACK, car.pos + ahead) : car.pos;
    car.shown += (target - car.shown) * (1 - Math.exp(-dt / 0.08));
    return { pos: car.shown, speed: car.speed, slip: car.slip, nitro: car.nitro, name: p.name, color: colorOf(p.id), body: p.car.body };
  });
  const focus = focusId();
  const focusIndex = Math.max(0, roster.findIndex((p) => p.id === focus));
  getScene()?.render(dt, list, focusIndex);
  const focused = list[focusIndex];
  if (focused && role === "play") updateEngine(Math.min(1, (focused.speed * METERS_PER_UNIT * 3.6) / 350), focused.nitro);
  if (hudFrame++ % 3 === 0) {
    renderHud(hudRacers(), focus, role === "watch");
    renderBanner(now);
  }
}

function navigate(target: "lobby" | "live") {
  if (!leaveRoom()) return;
  role = "play";
  if (target === "live") goLive();
  else goLobby();
}

for (const tab of document.querySelectorAll<HTMLAnchorElement>(".tabs a")) {
  tab.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (tab.dataset.action === "daily") startMode("daily");
    else navigate(tab.dataset.view === "live" ? "live" : "lobby");
  });
}

for (const link of [$("to-live"), $("live").querySelector<HTMLAnchorElement>(".live-head .btn")!]) {
  link.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(link.id === "to-live" ? "live" : "lobby");
  });
}

$("lobby-form").addEventListener("submit", (e) => {
  e.preventDefault();
  unlockAudio();
  $("lobby-error").textContent = "";
  connect(roomParam || "NEW", "play");
});

$("start").addEventListener("click", () => {
  unlockAudio();
  send({ t: "start" });
});

$("leave-room").addEventListener("click", () => navigate("lobby"));
$("to-menu").addEventListener("click", () => navigate("lobby"));
$("practice").addEventListener("click", () => startMode("practice"));
$("daily").addEventListener("click", () => startMode("daily"));
$("home-ghost").addEventListener("click", () => startMode("ghost"));
$("home-profile").addEventListener("click", showProfile);
$("me-chip").addEventListener("click", showProfile);
$("race-best").addEventListener("click", () => startMode("ghost"));
$("to-profile").addEventListener("click", showProfile);

$("rematch").addEventListener("click", () => {
  unlockAudio();
  track("replay", mode);
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

async function copy(button: HTMLElement, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    swapLabel(button, "Copied", 1600);
    return true;
  } catch {
    swapLabel(button, "Copy failed", 1600);
    return false;
  }
}

type SharedResult = Pick<Result, "wpm" | "accuracy"> & { mode: RaceMode };

async function shareRace(result: SharedResult, button?: HTMLElement) {
  const label = result.mode === "daily" ? "today's typing challenge" : result.mode === "ghost" ? "my personal best" : "a typing race";
  const text = `I hit ${result.wpm} WPM with ${result.accuracy}% accuracy on ${label}. Can you beat it?`;
  const url = `${location.origin}/${result.mode === "daily" ? "?mode=daily" : ""}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "type race result", text, url });
      if (button) swapLabel(button, "Shared", 1600);
      track("result_shared", result.mode);
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    if (button) swapLabel(button, "Copied", 1600);
    track("result_shared", result.mode);
    return true;
  } catch {
    if (button) swapLabel(button, "Share failed", 1600);
    return false;
  }
}

async function shareRecord(record: RecordEntry) {
  const shared = await shareRace({ wpm: record.wpm, accuracy: record.accuracy, mode: record.mode });
  if (shared === null) return;
  const statusNode = $("profile-status");
  statusNode.hidden = false;
  statusNode.textContent = shared ? "Personal best copied or shared." : "This browser could not share your result.";
}

$("share-result").addEventListener("click", () => {
  if (lastResult) void shareRace({ wpm: lastResult.wpm, accuracy: lastResult.accuracy, mode }, $("share-result"));
});

$("copy").addEventListener("click", () => copy($("copy"), $("link").textContent ?? ""));
$("copy-watch").addEventListener("click", () => copy($("copy-watch"), watchUrl()));
$("copy-watch-race").addEventListener("click", () => copy($("copy-watch-race"), watchUrl()));

function watch(room: string) {
  if (!leaveRoom()) return;
  code = room;
  connect(room, "watch");
}

initLive(watch);

const modeParam = params.get("mode");
if (watchParam) watch(watchParam);
else if (params.get("view") === "live") show("live");
else if (params.get("view") === "profile") void showProfile();
else if (isRaceMode(modeParam) && modeParam !== "multiplayer") startMode(modeParam);
else {
  if (roomParam) {
    $("lobby-btn").textContent = `Join room ${roomParam}`;
    setCrumb(`room ${roomParam}`);
  }
  show("lobby");
}
