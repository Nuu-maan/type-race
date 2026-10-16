import type { ServerWebSocket } from "bun";
import {
  bestGhost,
  competitions,
  dailyChallenge,
  databaseReady,
  ensurePlayer,
  EVENT_NAMES,
  getProfile,
  leaderboard,
  logEvent,
  recordAttempt,
  recordRace,
  setCar,
} from "./db";
import { OG_IMAGES, originOf, pageFor, robots, sitemap, withHead } from "./meta";
import { applyBackspace, applyKey, createRace, FINISH_GRACE_MS, raceOver, results, tick, TRACK, wpm, type Race } from "../shared/game";
import { dayKey, ghostFinishAt, isRaceMode, tracePosition, type RaceMode, type RaceTrace } from "../shared/challenge";
import {
  canUse,
  DEFAULT_CARS,
  effortXp,
  isDifficulty,
  levelFromXp,
  MAX_RACERS,
  MIN_RACERS,
  raceXp,
  unlockedBetween,
  type Car,
  type Difficulty,
} from "../shared/progress";
import { acceptControl, acceptInput, inputRate, parseClientMessage, parseInputMessage, type InputRate } from "./socket-guard";

const COUNTDOWN_MS = 3000;
const TICK_MS = 50;
const PLAYER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SPECTATORS = 50;
const RECONNECT_MS = 8000;
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS ?? 10 * 60_000);
const production = process.env.NODE_ENV === "production";
const clientDirectory = `${import.meta.dir}/../../dist/client`;
const productionShell = Bun.file(`${clientDirectory}/index.html`);
const shellRoute = production ? productionShell : (await import("../client/index.html")).default;

if (production && !(await productionShell.exists())) throw new Error("Client assets are missing. Run bun run build first.");

type Status = "lobby" | "countdown" | "racing" | "finished";
type Role = "play" | "watch";
type SocketData = {
  id: string;
  pid: string | null;
  name: string;
  code: string;
  xp: number;
  car: Car;
  role: Role;
  mode: RaceMode;
  session: string | null;
  connectedAt: number;
  firstKeyAt: number | null;
  rate: InputRate;
  controlRate: InputRate;
  eligible: boolean;
  resume: string;
};
type Socket = ServerWebSocket<SocketData>;

type Ghost = NonNullable<Awaited<ReturnType<typeof bestGhost>>> & { id: string; name: string; car: Car };

type Room = {
  code: string;
  host: string;
  members: Socket[];
  watchers: Socket[];
  roster: ReturnType<typeof playerInfo>[];
  status: Status;
  mode: RaceMode;
  difficulty: Difficulty;
  seed: number;
  challengeKey: string | null;
  race: Race | null;
  ghost: Ghost | null;
  traces: Map<string, RaceTrace>;
  runId: string;
  settling: boolean;
  final: object | null;
  timer: Timer | null;
  active: number;
};

const rooms = new Map<string, Room>();
const reconnects = new Map<string, { room: string; player: string; timer: Timer }>();

function createRoom(code: string, host: string, mode: RaceMode): Room {
  return {
    code,
    host,
    mode,
    members: [],
    watchers: [],
    roster: [],
    status: "lobby",
    difficulty: "normal",
    seed: 0,
    challengeKey: null,
    race: null,
    ghost: null,
    traces: new Map(),
    runId: crypto.randomUUID(),
    settling: false,
    final: null,
    timer: null,
    active: Date.now(),
  };
}

function newCode() {
  let code: string;
  do code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
  while (rooms.has(code));
  return code;
}

function send(ws: Socket, msg: object) {
  ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: object) {
  server.publish(room.code, JSON.stringify(msg));
}

function playerInfo(m: Socket) {
  return { id: m.data.id, name: m.data.name, xp: m.data.xp, level: levelFromXp(m.data.xp), car: m.data.car };
}

function roomInfo(room: Room) {
  return {
    t: "room",
    code: room.code,
    host: room.host,
    status: room.status,
    mode: room.mode,
    difficulty: room.difficulty,
    max: MAX_RACERS,
    min: MIN_RACERS,
    spectators: room.watchers.length,
    players: room.members.map(playerInfo),
  };
}

function liveRooms() {
  const order: Record<Status, number> = { racing: 0, countdown: 1, lobby: 2, finished: 3 };
  return [...rooms.values()]
    .filter((room) => room.mode === "multiplayer")
    .sort((a, b) => order[a.status] - order[b.status])
    .map((room) => ({
      code: room.code,
      status: room.status,
      difficulty: room.difficulty,
      spectators: room.watchers.length,
      racers: (room.race && room.status !== "lobby" ? room.roster : room.members.map(playerInfo)).map((p) => {
        const racer = room.race?.players.find((r) => r.id === p.id);
        return { name: p.name, paint: p.car.paint, progress: racer ? racer.pos / TRACK : 0, place: racer?.place ?? null, left: racer?.left ?? false };
      }),
    }));
}

function stopTimer(room: Room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
}

type ResultRow = ReturnType<typeof results>[number];

function rowsWithGhost(room: Room, now: number): ResultRow[] {
  const rows = room.race ? results(room.race, now) : [];
  if (!room.ghost || !room.race || !rows[0]) return rows;
  const elapsed = Math.max(0, now - room.race.startedAt);
  const human = rows[0];
  const humanTime = room.race.players[0]?.finishedAt ? room.race.players[0]!.finishedAt! - room.race.startedAt : Infinity;
  const humanWon = humanTime <= room.ghost.durationMs;
  human.place = humanWon ? 1 : 2;
  const ghost: ResultRow = {
    id: room.ghost.id,
    name: room.ghost.name,
    place: humanWon ? 2 : 1,
    finished: elapsed >= room.ghost.durationMs,
    left: false,
    wpm: room.ghost.wpm,
    accuracy: room.ghost.accuracy,
    time: Math.round(room.ghost.durationMs / 100) / 10,
    pos: tracePosition(room.ghost.trace, elapsed),
  };
  return humanWon ? [human, ghost] : [ghost, human];
}

function captureTrace(room: Room, now: number) {
  if (!room.race || room.status !== "racing") return;
  const elapsed = Math.max(0, now - room.race.startedAt);
  for (const player of room.race.players) {
    const trace = room.traces.get(player.id);
    if (!trace) continue;
    const last = trace.at(-1);
    if (last && elapsed - last[0] < 250 && player.pos < TRACK) continue;
    const point: [number, number] = [elapsed, Math.round(player.pos * 10) / 10];
    if (trace.length < 600) trace.push(point);
    else if (player.pos >= TRACK) trace[trace.length - 1] = point;
  }
}

function statePlayers(room: Room, now: number) {
  const race = room.race!;
  const players = race.players.map((p) => ({
    id: p.id,
    pos: p.pos,
    speed: p.speed,
    wpm: Math.round(wpm(race, p, now)),
    slip: now < p.slipUntil,
    nitro: now < p.nitroUntil,
    place: p.place,
    left: p.left,
  }));
  if (room.ghost) {
    const elapsed = Math.max(0, now - race.startedAt);
    const pos = tracePosition(room.ghost.trace, elapsed);
    const previous = tracePosition(room.ghost.trace, Math.max(0, elapsed - TICK_MS));
    players.push({
      id: room.ghost.id,
      pos,
      speed: ((pos - previous) / TICK_MS) * 1000,
      wpm: room.ghost.wpm,
      slip: false,
      nitro: false,
      place: pos >= TRACK ? 1 : null,
      left: false,
    });
    players
      .slice()
      .sort((a, b) => b.pos - a.pos)
      .forEach((player, index) => {
        player.place = index + 1;
      });
  }
  return players;
}

async function award(room: Room, rows: ResultRow[]) {
  const racers = rows.filter((r) => !r.left).length;
  const entries = await Promise.all(rows.map(async (row) => {
    const member = room.members.find((m) => m.data.id === row.id);
    if (!member || row.left) return null;
    const place = row.finished ? row.place : racers;
    const requested = !row.finished ? 0 : room.mode === "multiplayer"
      ? raceXp(row.wpm, row.accuracy, room.difficulty, place, racers)
      : effortXp(row.wpm, row.accuracy, room.difficulty);
    let awarded = 0;
    let saved = false;
    if (member.data.pid && member.data.eligible) {
      const entry = {
        runId: `${room.runId}:${member.data.id}`,
        player: member.data.pid,
        mode: room.mode,
        difficulty: room.difficulty,
        seed: room.seed,
        challengeKey: room.challengeKey,
        wpm: row.wpm,
        accuracy: row.accuracy,
        durationMs: Math.round(row.time * 1000),
        finished: row.finished,
        won: row.place === 1 && row.finished,
        xp: requested,
        firstKeyMs: member.data.firstKeyAt ? member.data.firstKeyAt - member.data.connectedAt : null,
        trace: room.traces.get(member.data.id),
        text: room.race?.text,
      };
      try {
        const outcome = room.mode === "multiplayer" ? await recordRace(entry) : await recordAttempt(entry);
        member.data.xp = outcome.xp;
        awarded = outcome.awarded;
        saved = true;
      } catch (error) {
        console.error("Could not save race:", error);
      }
    }
    const before = levelFromXp(member.data.xp - awarded);
    const after = levelFromXp(member.data.xp);
    return [row.id, {
      gained: awarded,
      xp: member.data.xp,
      level: after,
      leveledUp: after > before,
      unlocked: unlockedBetween(before, after),
      saved,
    }] as const;
  }));
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}

async function finish(room: Room, forfeit = false) {
  if (room.status === "finished" || room.settling) return;
  stopTimer(room);
  const now = Date.now();
  captureTrace(room, now);
  room.settling = true;
  const rows = rowsWithGhost(room, now);
  const winner = room.ghost ? rows[0]?.id : forfeit ? rows[0]?.id : (room.race?.winner ?? rows[0]?.id);
  const progress = forfeit ? {} : await award(room, rows);
  room.status = "finished";
  room.settling = false;
  room.final = {
    t: "finish",
    winner,
    forfeit,
    results: rows,
    progress,
  };
  broadcast(room, room.final);
}

function startTimer(room: Room) {
  let last = room.race!.startedAt;
  room.timer = setInterval(() => {
    const race = room.race!;
    const t = Date.now();
    if (t < race.startedAt) return;
    if (room.status === "countdown") {
      room.status = "racing";
      last = race.startedAt;
      broadcast(room, { t: "go" });
    }
    tick(race, (t - last) / 1000, t);
    if (room.ghost && race.firstFinishAt === null) race.firstFinishAt = ghostFinishAt(race.startedAt, room.ghost.durationMs, t);
    last = t;
    captureTrace(room, t);
    broadcast(room, {
      t: "state",
      players: statePlayers(room, t),
      graceEndsAt: race.firstFinishAt === null ? null : race.firstFinishAt + FINISH_GRACE_MS - t,
    });
    if (raceOver(race, t)) void finish(room);
  }, TICK_MS);
}

function startRace(room: Room) {
  if (room.mode !== "multiplayer" || room.status !== "lobby" || room.members.length < MIN_RACERS) return;
  const now = Date.now();
  room.seed = Math.floor(Math.random() * 2 ** 31);
  room.race = createRace(room.seed, room.members.map((m) => m.data), now + COUNTDOWN_MS, room.difficulty);
  room.status = "countdown";
  room.roster = room.members.map(playerInfo);
  room.traces = new Map(room.members.map((member) => [member.data.id, [[0, 0]] as RaceTrace]));
  broadcast(room, { t: "countdown", ms: COUNTDOWN_MS, text: room.race.text, difficulty: room.difficulty, roster: room.roster, mode: room.mode });
  startTimer(room);
}

async function armSolo(room: Room) {
  const member = room.members[0];
  if (!member || room.mode === "multiplayer") return;
  let text: string | undefined;
  if (room.mode === "daily") {
    const challenge = await dailyChallenge();
    room.seed = challenge.seed;
    room.challengeKey = challenge.key;
    room.difficulty = challenge.difficulty;
    text = challenge.text;
  } else if (room.mode === "ghost") {
    const saved = member.data.pid ? await bestGhost(member.data.pid) : null;
    if (!saved) {
      rooms.delete(room.code);
      return member.close(4010, "Finish a practice race before racing your best.");
    }
    room.seed = saved.seed;
    room.difficulty = saved.difficulty;
    text = saved.text;
    room.ghost = { ...saved, id: `ghost:${member.data.id}`, name: "Personal best", car: { paint: "violet", body: member.data.car.body } };
  } else {
    room.seed = Math.floor(Math.random() * 2 ** 31);
  }
  room.race = createRace(room.seed, [member.data], 0, room.difficulty, text);
  room.status = "countdown";
  room.roster = [playerInfo(member)];
  if (room.ghost) room.roster.push({ id: room.ghost.id, name: room.ghost.name, xp: 0, level: 1, car: room.ghost.car });
  room.traces = new Map([[member.data.id, [[0, 0]]]]);
  broadcast(room, { t: "countdown", ms: 0, text: room.race.text, difficulty: room.difficulty, roster: room.roster, mode: room.mode });
}

function startSolo(room: Room, now: number) {
  if (room.mode === "multiplayer" || room.status !== "countdown" || !room.race) return;
  room.race.startedAt = now;
  room.status = "racing";
  broadcast(room, { t: "go" });
  startTimer(room);
}

function resetRoom(room: Room) {
  stopTimer(room);
  room.status = "lobby";
  room.race = null;
  room.ghost = null;
  room.seed = 0;
  room.challengeKey = null;
  room.traces.clear();
  room.runId = crypto.randomUUID();
  room.settling = false;
  room.final = null;
  for (const member of room.members) {
    member.data.firstKeyAt = null;
    member.data.eligible = true;
    member.data.rate = inputRate();
    member.data.controlRate = inputRate();
  }
}

async function rearmSolo(room: Room) {
  try {
    await armSolo(room);
  } catch (error) {
    console.error("Could not start solo race:", error);
    rooms.delete(room.code);
    for (const member of room.members) member.close(1011, "This race could not start. Try again.");
  }
}

function removeMember(room: Room, id: string) {
  room.members = room.members.filter((member) => member.data.id !== id);
  if (!room.members.length) {
    stopTimer(room);
    rooms.delete(room.code);
    for (const w of room.watchers) w.close(4005, "Everyone left this race. Pick another from Live races.");
    return;
  }
  if (room.host === id) room.host = room.members[0]!.data.id;
  const racing = room.status === "countdown" || room.status === "racing";
  if (racing && room.race) {
    const player = room.race.players.find((candidate) => candidate.id === id);
    if (player) {
      player.left = true;
      player.speed = 0;
    }
    const active = room.race.players.filter((p) => !p.left);
    if (active.length < MIN_RACERS && !room.race.winner) void finish(room, true);
  }
  broadcast(room, roomInfo(room));
}

function leave(ws: Socket) {
  const room = rooms.get(ws.data.code);
  if (!room) return;
  if (ws.data.role === "watch") {
    room.watchers = room.watchers.filter((watcher) => watcher !== ws);
    broadcast(room, roomInfo(room));
    return;
  }
  if (room.status === "countdown" || room.status === "racing" || room.status === "finished" || room.settling) {
    const existing = reconnects.get(ws.data.resume);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      reconnects.delete(ws.data.resume);
      const current = rooms.get(room.code);
      if (current?.members.some((member) => member.data.id === ws.data.id)) removeMember(current, ws.data.id);
    }, RECONNECT_MS);
    reconnects.set(ws.data.resume, { room: room.code, player: ws.data.id, timer });
    return;
  }
  removeMember(room, ws.data.id);
}

function watch(ws: Socket) {
  const room = rooms.get(ws.data.code);
  if (!room) return ws.close(4004, "That race has ended. Pick another from Live races.");
  if (room.watchers.length >= MAX_SPECTATORS) return ws.close(4003, "This race has as many spectators as it can take. Try again soon.");
  room.watchers.push(ws);
  ws.subscribe(room.code);
  send(ws, { t: "hello", you: ws.data.id, role: "watch" });
  broadcast(room, roomInfo(room));
  if (room.status === "countdown" || room.status === "racing") {
    send(ws, {
      t: "sync",
      status: room.status,
      difficulty: room.difficulty,
      roster: room.roster,
      startsIn: Math.max(0, (room.race?.startedAt ?? 0) - Date.now()),
    });
  }
}

async function changeCar(ws: Socket, room: Room, msg: { paint?: unknown; body?: unknown }) {
  if (room.status !== "lobby" && room.status !== "finished") return;
  const car = { paint: String(msg.paint), body: String(msg.body) } as Car;
  const allowed = ws.data.pid
    ? await setCar(ws.data.pid, car).catch((error) => {
        console.error("Could not save car:", error);
        return canUse(car, levelFromXp(ws.data.xp));
      })
    : canUse(car, levelFromXp(ws.data.xp));
  if (!allowed || !room.members.includes(ws)) return;
  ws.data.car = car;
  broadcast(room, roomInfo(room));
}

function closeIdleRooms() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.settling) continue;
    if (now - room.active < ROOM_IDLE_MS) continue;
    stopTimer(room);
    rooms.delete(room.code);
    for (const ws of [...room.members, ...room.watchers]) {
      ws.close(4008, "This room closed after 10 minutes without activity. Create a new one to race again.");
    }
  }
}

setInterval(closeIdleRooms, Math.min(30_000, ROOM_IDLE_MS));

if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => fetch(`${process.env.RENDER_EXTERNAL_URL}/api/live`).catch(() => {}), 10 * 60_000);
}

let shellHtml: Promise<string> | null = null;

function shell() {
  if (!shellHtml || process.env.NODE_ENV !== "production") {
    shellHtml = fetch(`http://127.0.0.1:${server.port}/_shell`)
      .then((res) => res.text())
      .catch((error) => {
        shellHtml = null;
        throw error;
      });
  }
  return shellHtml;
}

async function asset(name: string) {
  if (!/^[a-z0-9_-]+\.(?:css|js)$/i.test(name)) return new Response("Not found", { status: 404 });
  const file = Bun.file(`${clientDirectory}/${name}`);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, { headers: { "cache-control": "public, max-age=31536000, immutable" } });
}

function hostName(code: string) {
  const room = rooms.get(code);
  return room?.members.find((m) => m.data.id === room.host)?.data.name;
}

function resumeSocket(ws: Socket) {
  const pending = reconnects.get(ws.data.resume);
  if (!pending) return false;
  const room = rooms.get(pending.room);
  const index = room?.members.findIndex((member) => member.data.id === pending.player) ?? -1;
  if (!room || index < 0) {
    clearTimeout(pending.timer);
    reconnects.delete(ws.data.resume);
    return false;
  }
  const previous = room.members[index]!;
  clearTimeout(pending.timer);
  reconnects.delete(ws.data.resume);
  Object.assign(ws.data, previous.data);
  room.members[index] = ws;
  room.active = Date.now();
  ws.subscribe(room.code);
  send(ws, { t: "hello", you: ws.data.id, mode: room.mode, resume: ws.data.resume, reconnected: true });
  const player = room.race?.players.find((candidate) => candidate.id === ws.data.id);
  send(ws, {
    t: "resume",
    status: room.status,
    mode: room.mode,
    text: room.race?.text ?? "",
    difficulty: room.difficulty,
    roster: room.roster,
    startsIn: Math.max(0, (room.race?.startedAt ?? 0) - Date.now()),
    self: player ? {
      typed: player.typed,
      wordStart: player.wordStart,
      extra: player.extra,
      marks: Array.from(player.marks),
      recent: player.recent,
      totalKeys: player.totalKeys,
      correctKeys: player.correctKeys,
      streak: player.streak,
      wordClean: player.wordClean,
      finishedAt: player.finishedAt,
    } : null,
    players: room.race ? statePlayers(room, Date.now()) : [],
    graceEndsAt: room.race?.firstFinishAt == null ? null : Math.max(0, room.race.firstFinishAt + FINISH_GRACE_MS - Date.now()),
  });
  if (room.final) send(ws, room.final);
  return true;
}

async function join(ws: Socket) {
  if (ws.data.role === "play" && resumeSocket(ws)) return;
  if (ws.data.role === "watch") return watch(ws);
  let room: Room | undefined;
  if (ws.data.mode !== "multiplayer") {
    ws.data.code = `solo:${ws.data.id}`;
    room = createRoom(ws.data.code, ws.data.id, ws.data.mode);
    rooms.set(room.code, room);
  } else {
    room = rooms.get(ws.data.code);
    if (ws.data.code === "NEW") {
      ws.data.code = newCode();
      room = createRoom(ws.data.code, ws.data.id, "multiplayer");
      rooms.set(room.code, room);
    }
  }
  if (!room) return ws.close(4004, "Room not found. Check the link or create a new room.");
  if (room.members.length >= MAX_RACERS) return ws.close(4003, `This room is full (${MAX_RACERS} racers). Ask the host for a new link.`);
  if (room.status === "countdown" || room.status === "racing") {
    return ws.close(4009, "This race has already started. Try the link again when it finishes.");
  }
  if (room.status === "finished" || room.settling) return ws.close(4009, "This race has finished. Ask the host to start a rematch.");
  const taken = new Set(room.members.map((member) => member.data.car.paint));
  const fallback = DEFAULT_CARS.find((car) => !taken.has(car.paint)) ?? DEFAULT_CARS[0]!;
  ws.data.car = fallback;
  room.members.push(ws);
  room.active = Date.now();
  ws.subscribe(room.code);
  send(ws, { t: "hello", you: ws.data.id, mode: room.mode, resume: ws.data.resume });
  if (ws.data.pid) {
    try {
      const profile = await ensurePlayer(ws.data.pid, ws.data.name, fallback.paint);
      if (!room.members.includes(ws)) return;
      ws.data.xp = profile.xp;
      ws.data.car = profile.car;
    } catch (error) {
      console.error("Could not load profile:", error);
    }
  }
  if (room.mode === "multiplayer") broadcast(room, roomInfo(room));
  else await rearmSolo(room);
}

async function eventResponse(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 1024) return new Response("Event too large", { status: 413 });
  let value: unknown;
  try {
    const body = await req.text();
    if (new TextEncoder().encode(body).byteLength > 1024) return new Response("Event too large", { status: 413 });
    value = JSON.parse(body);
  } catch {
    return new Response("Invalid event", { status: 400 });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Response("Invalid event", { status: 400 });
  const event = value as Record<string, unknown>;
  const player = typeof event.player === "string" && PLAYER_ID.test(event.player) ? event.player : null;
  const session = typeof event.session === "string" && PLAYER_ID.test(event.session) ? event.session : "";
  const name = typeof event.name === "string" && EVENT_NAMES.includes(event.name as (typeof EVENT_NAMES)[number])
    ? event.name as (typeof EVENT_NAMES)[number]
    : null;
  const elapsedMs = Number.isInteger(event.elapsedMs) && Number(event.elapsedMs) >= 0 && Number(event.elapsedMs) <= 86_400_000
    ? Number(event.elapsedMs)
    : null;
  const detail = typeof event.detail === "string" && /^[a-z0-9_-]{1,32}$/i.test(event.detail) ? event.detail : null;
  if (!session || !name) return new Response("Invalid event", { status: 400 });
  await logEvent({ player, session, name, elapsedMs, detail }).catch((error) => console.error("Could not save event:", error));
  return new Response(null, { status: 204 });
}

export const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: !production,
  routes: {
    "/_shell": shellRoute,
    "/assets/:name": (req) => asset(req.params.name),
    "/": async (req) => {
      const html = withHead(await shell(), pageFor(new URL(req.url), hostName), originOf(req));
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
    "/og/:name": (req) => {
      if (!OG_IMAGES.has(req.params.name)) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(`${import.meta.dir}/../../public/og/${req.params.name}`), {
        headers: { "cache-control": "public, max-age=86400" },
      });
    },
    "/robots.txt": (req) => new Response(robots(originOf(req))),
    "/sitemap.xml": (req) => new Response(sitemap(originOf(req)), { headers: { "content-type": "application/xml" } }),
    "/api/leaderboard": async (req) => {
      const d = new URL(req.url).searchParams.get("d");
      return Response.json(await leaderboard(isDifficulty(d) ? d : "normal").catch(() => []));
    },
    "/api/live": () => Response.json(liveRooms()),
    "/api/health": async () => {
      const ok = await databaseReady().catch(() => false);
      return Response.json({ ok }, { status: ok ? 200 : 503 });
    },
    "/api/competitions": async (req) => {
      const id = new URL(req.url).searchParams.get("id") ?? "";
      return Response.json(await competitions(PLAYER_ID.test(id) ? id : undefined).catch(() => ({ daily: null, weekly: null })));
    },
    "/api/event": { POST: eventResponse },
    "/api/profile": async (req) => {
      const id = new URL(req.url).searchParams.get("id") ?? "";
      return Response.json(PLAYER_ID.test(id) ? await getProfile(id).catch(() => null) : null);
    },
  },
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });
    const name = (url.searchParams.get("name") ?? "").trim().slice(0, 16) || "Player";
    const code = (url.searchParams.get("room") ?? "").toUpperCase();
    const pid = url.searchParams.get("pid") ?? "";
    const role: Role = url.searchParams.get("role") === "watch" ? "watch" : "play";
    const requestedMode = url.searchParams.get("mode");
    const mode = role === "watch" ? "multiplayer" : isRaceMode(requestedMode) ? requestedMode : "multiplayer";
    const session = url.searchParams.get("sid") ?? "";
    const resume = url.searchParams.get("resume") ?? "";
    const now = Date.now();
    const data: SocketData = {
      id: crypto.randomUUID(),
      pid: PLAYER_ID.test(pid) ? pid : null,
      name,
      code,
      xp: 0,
      car: DEFAULT_CARS[0]!,
      role,
      mode,
      session: PLAYER_ID.test(session) ? session : null,
      connectedAt: now,
      firstKeyAt: null,
      rate: inputRate(now),
      controlRate: inputRate(now),
      eligible: true,
      resume: PLAYER_ID.test(resume) ? resume : crypto.randomUUID(),
    };
    return server.upgrade(req, { data }) ? undefined : new Response("Expected a WebSocket", { status: 400 });
  },
  websocket: {
    open(ws: Socket) {
      void join(ws);
    },
    message(ws: Socket, raw) {
      const room = rooms.get(ws.data.code);
      if (!room || ws.data.role === "watch") return;
      room.active = Date.now();
      let msg = parseClientMessage(raw);
      if (!msg) return;
      if (typeof msg.t === "string" && ["key", "back", "wordBack", "start"].includes(msg.t)) {
        const input = parseInputMessage(raw);
        if (!input || !acceptInput(ws.data.rate)) {
          ws.data.eligible = false;
          return;
        }
        msg = input;
      } else if (!acceptControl(ws.data.controlRate)) return;
      if (msg.t === "start" && room.host === ws.data.id) startRace(room);
      else if (msg.t === "difficulty" && room.host === ws.data.id && room.status === "lobby" && isDifficulty(msg.d)) {
        room.difficulty = msg.d;
        broadcast(room, roomInfo(room));
      } else if (msg.t === "car") void changeCar(ws, room, msg);
      else if (msg.t === "rematch" && room.status === "finished") {
        resetRoom(room);
        if (room.mode === "multiplayer") broadcast(room, roomInfo(room));
        else void rearmSolo(room);
      } else if (msg.t === "key" && typeof msg.c === "string") {
        const now = Date.now();
        if (room.mode === "daily" && room.challengeKey !== dayKey(now)) {
          resetRoom(room);
          void rearmSolo(room);
          return;
        }
        if (room.status === "countdown" && room.mode !== "multiplayer") startSolo(room, now);
        if (room.status !== "racing") return;
        ws.data.firstKeyAt ??= now;
        const player = room.race!.players.find((p) => p.id === ws.data.id);
        if (player) applyKey(room.race!.text, player, msg.c, now);
      } else if ((msg.t === "back" || msg.t === "wordBack") && room.status === "racing") {
        const player = room.race!.players.find((p) => p.id === ws.data.id);
        if (player) applyBackspace(player, msg.t === "wordBack");
      }
    },
    close(ws: Socket) {
      leave(ws);
    },
    maxPayloadLength: 1024,
  },
});

console.log(`type-race on http://localhost:${server.port}`);
