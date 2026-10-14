import type { ServerWebSocket } from "bun";
import index from "./index.html";
import { ensurePlayer, getProfile, leaderboard, recordRace, setCar } from "./db";
import { applyBackspace, applyKey, createRace, FINISH_GRACE_MS, raceOver, results, tick, TRACK, wpm, type Race } from "./game";
import {
  canUse,
  DEFAULT_CARS,
  isDifficulty,
  levelFromXp,
  MAX_RACERS,
  MIN_RACERS,
  raceXp,
  unlockedBetween,
  type Car,
  type Difficulty,
} from "./progress";

const COUNTDOWN_MS = 3000;
const TICK_MS = 50;
const PLAYER_ID = /^[0-9a-f-]{36}$/;
const MAX_SPECTATORS = 50;

type Status = "lobby" | "countdown" | "racing" | "finished";
type Role = "play" | "watch";
type SocketData = { id: string; pid: string | null; name: string; code: string; xp: number; car: Car; role: Role };
type Socket = ServerWebSocket<SocketData>;

type Room = {
  code: string;
  host: string;
  members: Socket[];
  watchers: Socket[];
  roster: ReturnType<typeof playerInfo>[];
  status: Status;
  difficulty: Difficulty;
  race: Race | null;
  timer: Timer | null;
};

const rooms = new Map<string, Room>();

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

function award(room: Room, rows: ReturnType<typeof results>) {
  const progress: Record<string, { gained: number; xp: number; level: number; leveledUp: boolean; unlocked: string[] }> = {};
  const racers = rows.filter((r) => !r.left).length;
  for (const row of rows) {
    const member = room.members.find((m) => m.data.id === row.id);
    if (!member || row.left) continue;
    const place = row.finished ? row.place : racers;
    const gained = raceXp(row.wpm, row.accuracy, room.difficulty, place, racers);
    const before = levelFromXp(member.data.xp);
    member.data.xp += gained;
    const after = levelFromXp(member.data.xp);
    if (member.data.pid) {
      recordRace({
        player: member.data.pid,
        difficulty: room.difficulty,
        wpm: row.wpm,
        accuracy: row.accuracy,
        won: row.place === 1 && row.finished,
        xp: gained,
      });
    }
    progress[row.id] = { gained, xp: member.data.xp, level: after, leveledUp: after > before, unlocked: unlockedBetween(before, after) };
  }
  return progress;
}

function finish(room: Room, forfeit = false) {
  stopTimer(room);
  room.status = "finished";
  const rows = room.race ? results(room.race, Date.now()) : [];
  broadcast(room, {
    t: "finish",
    winner: forfeit ? rows[0]?.id : (room.race?.winner ?? rows[0]?.id),
    forfeit,
    results: rows,
    progress: forfeit ? {} : award(room, rows),
  });
}

function startRace(room: Room) {
  if (room.status !== "lobby" || room.members.length < MIN_RACERS) return;
  const now = Date.now();
  room.race = createRace(
    Math.floor(Math.random() * 2 ** 31),
    room.members.map((m) => m.data),
    now + COUNTDOWN_MS,
    room.difficulty,
  );
  room.status = "countdown";
  room.roster = room.members.map(playerInfo);
  broadcast(room, { t: "countdown", ms: COUNTDOWN_MS, text: room.race.text, difficulty: room.difficulty, roster: room.roster });

  let last = now;
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
    last = t;
    broadcast(room, {
      t: "state",
      players: race.players.map((p) => ({
        id: p.id,
        pos: p.pos,
        speed: p.speed,
        wpm: Math.round(wpm(race, p, t)),
        slip: t < p.slipUntil,
        nitro: t < p.nitroUntil,
        place: p.place,
        left: p.left,
      })),
      graceEndsAt: race.firstFinishAt === null ? null : race.firstFinishAt + FINISH_GRACE_MS - t,
    });
    if (raceOver(race, t)) finish(room);
  }, TICK_MS);
}

function leave(ws: Socket) {
  const room = rooms.get(ws.data.code);
  if (!room) return;
  if (ws.data.role === "watch") {
    room.watchers = room.watchers.filter((w) => w !== ws);
    broadcast(room, roomInfo(room));
    return;
  }
  room.members = room.members.filter((m) => m !== ws);
  if (!room.members.length) {
    stopTimer(room);
    rooms.delete(room.code);
    for (const w of room.watchers) w.close(4005, "Everyone left this race. Pick another from Live races.");
    return;
  }
  if (room.host === ws.data.id) room.host = room.members[0]!.data.id;
  const racing = room.status === "countdown" || room.status === "racing";
  if (racing && room.race) {
    const player = room.race.players.find((p) => p.id === ws.data.id);
    if (player) {
      player.left = true;
      player.speed = 0;
    }
    const active = room.race.players.filter((p) => !p.left);
    if (active.length < MIN_RACERS && !room.race.winner) finish(room, true);
  }
  broadcast(room, roomInfo(room));
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

function changeCar(ws: Socket, room: Room, msg: { paint?: unknown; body?: unknown }) {
  if (room.status !== "lobby" && room.status !== "finished") return;
  const car = { paint: String(msg.paint), body: String(msg.body) } as Car;
  const allowed = ws.data.pid ? setCar(ws.data.pid, car) : canUse(car, levelFromXp(ws.data.xp));
  if (!allowed) return;
  ws.data.car = car;
  broadcast(room, roomInfo(room));
}

export const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": index,
    "/api/leaderboard": (req) => {
      const d = new URL(req.url).searchParams.get("d");
      return Response.json(leaderboard(isDifficulty(d) ? d : "normal"));
    },
    "/api/live": () => Response.json(liveRooms()),
    "/api/profile": (req) => {
      const id = new URL(req.url).searchParams.get("id") ?? "";
      return Response.json(PLAYER_ID.test(id) ? getProfile(id) : null);
    },
  },
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });
    const name = (url.searchParams.get("name") ?? "").trim().slice(0, 16) || "Player";
    const code = (url.searchParams.get("room") ?? "").toUpperCase();
    const pid = url.searchParams.get("pid") ?? "";
    const data: SocketData = {
      id: crypto.randomUUID(),
      pid: PLAYER_ID.test(pid) ? pid : null,
      name,
      code,
      xp: 0,
      car: DEFAULT_CARS[0]!,
      role: url.searchParams.get("role") === "watch" ? "watch" : "play",
    };
    return server.upgrade(req, { data }) ? undefined : new Response("Expected a WebSocket", { status: 400 });
  },
  websocket: {
    open(ws: Socket) {
      if (ws.data.role === "watch") return watch(ws);
      let room = rooms.get(ws.data.code);
      if (ws.data.code === "NEW") {
        ws.data.code = newCode();
        room = {
          code: ws.data.code,
          host: ws.data.id,
          members: [],
          watchers: [],
          roster: [],
          status: "lobby",
          difficulty: "normal",
          race: null,
          timer: null,
        };
        rooms.set(room.code, room);
      }
      if (!room) return ws.close(4004, "Room not found. Check the link or create a new room.");
      if (room.members.length >= MAX_RACERS) return ws.close(4003, `This room is full (${MAX_RACERS} racers). Ask the host for a new link.`);
      if (room.status === "countdown" || room.status === "racing") {
        return ws.close(4009, "This race has already started. Try the link again when it finishes.");
      }
      if (room.status === "finished") {
        room.status = "lobby";
        room.race = null;
      }
      const taken = new Set(room.members.map((m) => m.data.car.paint));
      const fallback = DEFAULT_CARS.find((c) => !taken.has(c.paint)) ?? DEFAULT_CARS[0]!;
      if (ws.data.pid) {
        const profile = ensurePlayer(ws.data.pid, ws.data.name, fallback.paint);
        ws.data.xp = profile.xp;
        ws.data.car = profile.car;
      } else {
        ws.data.car = fallback;
      }
      room.members.push(ws);
      ws.subscribe(room.code);
      send(ws, { t: "hello", you: ws.data.id });
      broadcast(room, roomInfo(room));
    },
    message(ws: Socket, raw) {
      const room = rooms.get(ws.data.code);
      if (!room || ws.data.role === "watch") return;
      let msg: { t?: string; c?: unknown; w?: unknown; d?: unknown; paint?: unknown; body?: unknown };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.t === "start" && room.host === ws.data.id) startRace(room);
      else if (msg.t === "difficulty" && room.host === ws.data.id && room.status === "lobby" && isDifficulty(msg.d)) {
        room.difficulty = msg.d;
        broadcast(room, roomInfo(room));
      } else if (msg.t === "car") changeCar(ws, room, msg);
      else if (msg.t === "rematch" && room.status === "finished") {
        room.status = "lobby";
        room.race = null;
        broadcast(room, roomInfo(room));
      } else if (msg.t === "key" && room.status === "racing" && typeof msg.c === "string" && msg.c.length === 1) {
        const player = room.race!.players.find((p) => p.id === ws.data.id);
        if (player) applyKey(room.race!.text, player, msg.c, Date.now());
      } else if (msg.t === "back" && room.status === "racing") {
        const player = room.race!.players.find((p) => p.id === ws.data.id);
        if (player) applyBackspace(player, msg.w === true);
      }
    },
    close(ws: Socket) {
      leave(ws);
    },
  },
});

console.log(`type-race on http://localhost:${server.port}`);
