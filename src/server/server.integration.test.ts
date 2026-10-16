import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FINISH_GRACE_MS } from "../shared/game";

const directory = mkdtempSync(join(tmpdir(), "type-race-server-"));
const port = 32_000 + Math.floor(Math.random() * 10_000);
const base = `http://127.0.0.1:${port}`;
const child = Bun.spawn([process.execPath, "src/server/server.ts"], {
  cwd: join(import.meta.dir, "../.."),
  env: { ...process.env, PORT: String(port), DB_PATH: join(directory, "test.sqlite"), DATABASE_URL: "" },
  stdout: "ignore",
  stderr: "pipe",
});

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
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await Bun.sleep(20);
  }
  throw new Error(`Test server did not start: ${await new Response(child.stderr).text()}`);
});

afterAll(() => {
  child.kill();
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
  for (let i = 0; i < 35; i++) {
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
