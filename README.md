# type-race

A typing race for 2 to 5 players. Both players get the same words and type them on their own screens. Typing speed drives your car through a WebGL night race.

- **Speed** comes from your rolling WPM over the last 3 seconds. The car speeds up and slows down with momentum, and coasts to a stop when you stop typing.
- **Mistakes** don't stop you. Wrong letters show in red and the caret moves on, like monkeytype, and Backspace (or Ctrl+Backspace for the word) fixes them. Each mistake makes the car accelerate more slowly for a moment, and only correct letters count toward speed.
- **Accuracy** below 100% lowers your top speed, so mashing keys loses to clean typing.
- **Nitro**: eight clean words in a row give a short boost.

The host can start once at least two racers are in the room (up to five). After the first racer finishes, the others get 15 seconds to cross the line, and podium places earn bonus XP.

## Spectating

The **Live races** tab lists every race in progress with each racer's progress and the spectator count. Anyone can watch from there, or from the watch link (`/?watch=CODE`) that players and spectators can copy. Spectators follow the leader by default and can pick a racer in the position tower to follow them instead.

## Progression

- **Difficulty**: the host picks Easy (short common words), Normal (the 200 most common words) or Hard (long words, capitals and punctuation). Mistakes cost more on harder races.
- **XP and levels**: every finished race earns XP from your WPM and accuracy, more on harder races, plus a bonus for winning.
- **Garage**: pick a paint and a body (GT, Muscle, Hyper) in the room. New ones unlock as you level.
- **Leaderboard**: best WPM per difficulty, on the landing page.

Profiles live in `data/type-race.sqlite` on the machine running the server, keyed by an id each browser keeps locally. Set `DB_PATH` to use another file.

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
