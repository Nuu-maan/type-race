import { server } from "./server";

const tunnel = Bun.spawn(["cloudflared", "tunnel", "--no-autoupdate", "--url", `http://localhost:${server.port}`], {
  stderr: "pipe",
  stdout: "ignore",
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    tunnel.kill();
    process.exit(0);
  });
}

let found = false;
const decoder = new TextDecoder();
for await (const chunk of tunnel.stderr) {
  const url = decoder.decode(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (url && !found) {
    found = true;
    console.log(`\nShare this link with your friend:\n\n  ${url}\n\nCreate a room there and send them the room link. Ctrl+C stops sharing.\n`);
  }
}

console.error("cloudflared exited. Is it installed? https://developers.cloudflare.com/cloudflared/");
process.exit(1);
