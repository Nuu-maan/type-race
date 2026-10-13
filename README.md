# type-race

A two-player typing race. Both players get the same words and type them on their own screens. Typing speed drives your car.

- **Speed** comes from your rolling WPM over the last 3 seconds. The car speeds up and slows down with momentum, and coasts to a stop when you stop typing.
- **Mistakes** don't move the caret, and each one makes your car skid for a moment.
- **Accuracy** below 100% lowers your top speed, so mashing keys loses to clean typing.
- **Nitro**: eight clean words in a row give a short boost.

The race starts once both players are in the room and the host presses Start.

## Run

```sh
bun install
bun run dev
```

Open http://localhost:3000, create a room and open the room link in a second tab.

## Play with a friend from your machine

Needs [cloudflared](https://developers.cloudflare.com/cloudflared/downloads/).

```sh
bun run share
```

This starts the server and a Cloudflare quick tunnel, then prints a public `https://….trycloudflare.com` link. Open it, create a room and send your friend the room link. The link changes each time you run it, and stops working when you press Ctrl+C.

## Check

```sh
bun run check
bun test
```

Tuning lives in the constants at the top of `game.ts`.
