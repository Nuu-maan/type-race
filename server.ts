import type { ServerWebSocket } from "bun";
import index from "./index.html";
import { applyKey, createRace, results, tick, wpm, type Race } from "./game";

const COUNTDOWN_MS = 3000;
const TICK_MS = 50;

type Status = "lobby" | "countdown" | "racing" | "finished";
type Socket = ServerWebSocket<{ id: string; name: string; code: string }>;

type Room = {
  code: string;
  host: string;
  members: Socket[];
  status: Status;
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

function roomInfo(room: Room) {
  return {
    t: "room",
    code: room.code,
    host: room.host,
    status: room.status,
    players: room.members.map((m) => ({ id: m.data.id, name: m.data.name })),
  };
}

function stopTimer(room: Room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
}

function finish(room: Room, winner: string | null, forfeit = false) {
  stopTimer(room);
  room.status = "finished";
  broadcast(room, {
    t: "finish",
    winner,
    forfeit,
    results: room.race ? results(room.race, Date.now()) : [],
  });
}

function startRace(room: Room) {
  if (room.status !== "lobby" || room.members.length !== 2) return;
  const now = Date.now();
  room.race = createRace(
    Math.floor(Math.random() * 2 ** 31),
    room.members.map((m) => m.data),
    now + COUNTDOWN_MS,
  );
  room.status = "countdown";
  broadcast(room, { t: "countdown", ms: COUNTDOWN_MS, text: room.race.text });

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
        skid: t < p.skidUntil,
        nitro: t < p.nitroUntil,
      })),
    });
    if (race.winner) finish(room, race.winner);
  }, TICK_MS);
}

function leave(ws: Socket) {
  const room = rooms.get(ws.data.code);
  if (!room) return;
  room.members = room.members.filter((m) => m !== ws);
  if (!room.members.length) {
    stopTimer(room);
    rooms.delete(room.code);
    return;
  }
  if (room.host === ws.data.id) room.host = room.members[0]!.data.id;
  if (room.status === "countdown" || room.status === "racing") finish(room, room.members[0]!.data.id, true);
  else if (room.status === "finished") room.status = "lobby";
  broadcast(room, roomInfo(room));
}

export const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: { "/": index },
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });
    const name = (url.searchParams.get("name") ?? "").trim().slice(0, 16) || "Player";
    const code = (url.searchParams.get("room") ?? "").toUpperCase();
    const ok = server.upgrade(req, { data: { id: crypto.randomUUID(), name, code } });
    return ok ? undefined : new Response("Expected a WebSocket", { status: 400 });
  },
  websocket: {
    open(ws: Socket) {
      let room = rooms.get(ws.data.code);
      if (ws.data.code === "NEW") {
        ws.data.code = newCode();
        room = { code: ws.data.code, host: ws.data.id, members: [], status: "lobby", race: null, timer: null };
        rooms.set(room.code, room);
      }
      if (!room) return ws.close(4004, "Room not found");
      if (room.members.length >= 2) return ws.close(4003, "Room is full");
      room.members.push(ws);
      ws.subscribe(room.code);
      send(ws, { t: "hello", you: ws.data.id });
      broadcast(room, roomInfo(room));
    },
    message(ws: Socket, raw) {
      const room = rooms.get(ws.data.code);
      if (!room) return;
      let msg: { t?: string; c?: unknown };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.t === "start" && room.host === ws.data.id) startRace(room);
      else if (msg.t === "rematch" && room.status === "finished") {
        room.status = "lobby";
        room.race = null;
        broadcast(room, roomInfo(room));
      } else if (msg.t === "key" && room.status === "racing" && typeof msg.c === "string" && msg.c.length === 1) {
        const player = room.race!.players.find((p) => p.id === ws.data.id);
        if (player) applyKey(room.race!, player, msg.c, Date.now());
      }
    },
    close(ws: Socket) {
      leave(ws);
    },
  },
});

console.log(`type-race on http://localhost:${server.port}`);
