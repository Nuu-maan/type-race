import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FINISH_GRACE_MS } from "../shared/game";

const directory = mkdtempSync(join(tmpdir(), "type-race-server-"));
const databasePath = join(directory, "test.sqlite");
const port = 32_000 + Math.floor(Math.random() * 10_000);
const base = `http://127.0.0.1:${port}`;
const root = join(import.meta.dir, "../..");
const fastGhostPlayer = "11111111-1111-4111-8111-111111111111";
const slowGhostPlayer = "22222222-2222-4222-8222-222222222222";
const slowGhostText = "type ".repeat(240).trim();
let child: ReturnType<typeof Bun.spawn> | null = null;

type Message = Record<string, any>;

function inbox(url: string) {
  const socket = new WebSocket(url);
  const queued: Message[] = [];
  const waiting: ((message: Message) => void)[] = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else queued.push(message);
  });
  return {
    socket,
    async next(type: string) {
      const found = queued.findIndex((message) => message.t === type);
      if (found >= 0) return queued.splice(found, 1)[0]!;
      while (true) {
        const message = await Promise.race([
          new Promise<Message>((resolve) => waiting.push(resolve)),
          Bun.sleep(3000).then(() => { throw new Error(`Timed out waiting for ${type}`); }),
        ]);
        if (message.t === type) return message;
        queued.push(message);
      }
    },
  };
}

beforeAll(async () => {
  const seed = Bun.spawn([
    process.execPath,
    "-e",
    `const db = await import('./src/server/db.ts'); await db.ensurePlayer('${fastGhostPlayer}', 'Fast ghost', 'cobalt'); await db.recordAttempt({runId:'fast-ghost-fixture',player:'${fastGhostPlayer}',mode:'practice',difficulty:'normal',seed:1,wpm:80,accuracy:98,durationMs:500,won:true,xp:80,trace:[[0,0],[500,999]],text:'one two three four five six seven eight nine ten'}); await db.ensurePlayer('${slowGhostPlayer}', 'Slow ghost', 'cobalt'); await db.recordAttempt({runId:'slow-ghost-fixture',player:'${slowGhostPlayer}',mode:'practice',difficulty:'normal',seed:2,wpm:80,accuracy:98,durationMs:25000,won:true,xp:80,trace:[[0,0],[25000,999]],text:${JSON.stringify(slowGhostText)}});`,
  ], {
    cwd: root,
    env: { ...process.env, DB_PATH: databasePath, DATABASE_URL: "" },
    stdout: "ignore",
    stderr: "pipe",
  });
  if (await seed.exited) throw new Error(`Could not seed ghost fixture: ${await new Response(seed.stderr).text()}`);
  const serverProcess = Bun.spawn([process.execPath, "src/server/server.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DB_PATH: databasePath, DATABASE_URL: "" },
    stdout: "ignore",
    stderr: "pipe",
  });
  child = serverProcess;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await Bun.sleep(20);
  }
  throw new Error(`Test server did not start: ${await new Response(serverProcess.stderr).text()}`);
});

afterAll(() => {
  child?.kill();
  rmSync(directory, { recursive: true, force: true });
});

test("practice starts on the first key and reconnects through the result grace", async () => {
  const player = crypto.randomUUID();
  const session = crypto.randomUUID();
  const race = inbox(`ws://127.0.0.1:${port}/ws?room=SOLO&mode=practice&pid=${player}&sid=${session}`);
  const hello = await race.next("hello");
  const ready = await race.next("countdown");
  expect(ready).toMatchObject({ mode: "practice", ms: 0 });
  expect(await (await fetch(`${base}/api/live`)).json()).toEqual([]);

  race.socket.send("null");
  race.socket.send(JSON.stringify({ t: "key", c: ready.text[0] }));
  await race.next("go");
  const state = await race.next("state");
  expect(state.players[0].id).toBe(hello.you);
  race.socket.close();
  await Bun.sleep(FINISH_GRACE_MS + 100);

  const resumed = inbox(`ws://127.0.0.1:${port}/ws?room=SOLO&mode=practice&pid=${player}&sid=${session}&resume=${hello.resume}`);
  expect(await resumed.next("hello")).toMatchObject({ you: hello.you, reconnected: true });
  expect(await resumed.next("resume")).toMatchObject({ mode: "practice", self: { typed: 1 } });
  resumed.socket.close();
}, FINISH_GRACE_MS + 5000);

test("multiplayer still waits for two racers", async () => {
  const host = inbox(`ws://127.0.0.1:${port}/ws?room=NEW&name=Host&pid=${crypto.randomUUID()}`);
  await host.next("hello");
  const firstRoom = await host.next("room");
  host.socket.send(JSON.stringify({ t: "start" }));
  await Bun.sleep(100);

  const guest = inbox(`ws://127.0.0.1:${port}/ws?room=${firstRoom.code}&name=Guest&pid=${crypto.randomUUID()}`);
  await guest.next("hello");
  let room = await host.next("room");
  while (room.players.length < 2) room = await host.next("room");
  host.socket.send(JSON.stringify({ t: "start" }));
  expect(await host.next("countdown")).toMatchObject({ mode: "multiplayer", ms: 3000 });
  host.socket.close();
  guest.socket.close();
});

test("ghost racers stay active until their recorded time elapses", async () => {
  const race = inbox(`ws://127.0.0.1:${port}/ws?room=SOLO&mode=ghost&pid=${fastGhostPlayer}&sid=${crypto.randomUUID()}`);
  const hello = await race.next("hello");
  const ready = await race.next("countdown");
  expect(ready).toMatchObject({ mode: "ghost", ms: 0 });
  race.socket.send(JSON.stringify({ t: "key", c: ready.text[0] }));
  await race.next("go");
  let state = await race.next("state");
  expect(state.players).toHaveLength(2);
  expect(state.players.find((player: Message) => player.id === hello.you)?.place).toBeNull();
  expect(state.players.find((player: Message) => player.id.startsWith("ghost:"))?.place).toBeNull();
  while (state.players.find((player: Message) => player.id.startsWith("ghost:"))?.place === null) state = await race.next("state");
  expect(state.players.find((player: Message) => player.id === hello.you)?.place).toBeNull();
  expect(state.players.find((player: Message) => player.id.startsWith("ghost:"))?.place).toBe(1);
  race.socket.close();
});

test("a racer who beats their ghost takes first place", async () => {
  const race = inbox(`ws://127.0.0.1:${port}/ws?room=SOLO&mode=ghost&pid=${slowGhostPlayer}&sid=${crypto.randomUUID()}`);
  const hello = await race.next("hello");
  const ready = await race.next("countdown");
  race.socket.send(JSON.stringify({ t: "key", c: ready.text[0] }));
  await race.next("go");
  let typing = true;
  const finishTyping = (async () => {
    for (const char of ready.text.slice(1)) {
      if (!typing) return;
      race.socket.send(JSON.stringify({ t: "key", c: char }));
      await Bun.sleep(15);
    }
  })();
  let state = await race.next("state");
  while (state.players.find((player: Message) => player.id === hello.you)?.place === null) state = await race.next("state");
  typing = false;
  await finishTyping;
  expect(state.players.find((player: Message) => player.id === hello.you)?.place).toBe(1);
  expect(state.players.find((player: Message) => player.id.startsWith("ghost:"))?.place).toBeNull();
  race.socket.close();
}, 30_000);

test("telemetry rejects unknown and oversized events", async () => {
  const headers = { "content-type": "application/json" };
  const invalid = await fetch(`${base}/api/event`, {
    method: "POST",
    headers,
    body: JSON.stringify({ session: crypto.randomUUID(), name: "raw_keys" }),
  });
  expect(invalid.status).toBe(400);
  const oversized = await fetch(`${base}/api/event`, { method: "POST", headers, body: JSON.stringify({ data: "x".repeat(1100) }) });
  expect(oversized.status).toBe(413);
  const statuses = [];
  for (let i = 0; i < 65; i++) {
    const response = await fetch(`${base}/api/event`, {
      method: "POST",
      headers,
      body: JSON.stringify({ session: crypto.randomUUID(), name: "profile_viewed" }),
    });
    statuses.push(response.status);
  }
  expect(statuses).toContain(204);
  expect(statuses).toContain(429);
});
