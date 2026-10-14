<div align="center">

# type race

**Type fast. Drive fast.**

A multiplayer typing race where your words per minute are your car's speed.
2 to 5 racers, the same words, one neon track.

[![MIT license](https://img.shields.io/badge/license-MIT-fbd530?style=flat-square&labelColor=1a1a1a)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-fbd530?style=flat-square&labelColor=1a1a1a)](https://bun.sh)
[![three.js](https://img.shields.io/badge/WebGL-three.js-fbd530?style=flat-square&labelColor=1a1a1a)](https://threejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-fbd530?style=flat-square&labelColor=1a1a1a)](CONTRIBUTING.md)

<img src="docs/landing.webp" alt="The type race landing page: a night city highway with two cars racing behind the headline Type fast. Drive fast." width="860">

</div>

## How a race works

1. Create a room and send the link to your friends.
2. Pick your paint and body in the garage while everyone joins.
3. The host starts once at least two racers are in. Everyone gets the same words.
4. Type. The faster and cleaner you type, the faster your car goes.

<p align="center">
  <img src="docs/race.webp" alt="A race in progress: the leading blue car at 333 km/h, a progress strip with every racer, a position tower and the words being typed below" width="860">
</p>

## What's in the box

| | |
| --- | --- |
| **Typing that drives** | Your speed comes from your rolling WPM over the last 3 seconds. The car has momentum: it builds speed as you type and coasts down when you stop. |
| **Mistakes cost, they don't stop you** | Wrong letters show in red and the caret keeps going, like monkeytype. Each mistake slows your acceleration for a moment, and accuracy under 100% lowers your top speed. |
| **Nitro** | Eight clean words in a row give you a short boost. |
| **2 to 5 racers** | After the first car crosses the line, everyone else gets 15 seconds to finish. Podium places earn bonus XP. |
| **Spectating** | The Live races tab lists every race running. Watch from there or from a watch link, follow the leader or any racer you pick. |
| **Levels and a garage** | XP from every race. New paints and the Muscle and Hyper bodies unlock as you level. |
| **Difficulty** | Easy, Normal or Hard words. Mistakes cost more on harder races. |
| **Leaderboard** | Best WPM per difficulty, right on the landing page. |
| **Sound** | Quiet synthesized engine, key ticks and countdown beeps, with a mute button. |

<table>
  <tr>
    <td width="50%"><img src="docs/room.webp" alt="The room screen: a blue GT car on a garage turntable, three racers in the lobby and invite links for racers and spectators"></td>
    <td width="50%"><img src="docs/results.webp" alt="The results card: 1st, 2nd and 3rd place with WPM, accuracy and time, plus XP gained and a new paint unlocked"></td>
  </tr>
  <tr>
    <td align="center"><sub>Garage, racers and invite links</sub></td>
    <td align="center"><sub>Places, XP and unlocks</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/spectate.webp" alt="Spectating a race, following the leader, with a bar to copy the watch link"></td>
    <td width="50%"><img src="docs/live.webp" alt="The Live races tab listing a race with each racer's progress and one spectator"></td>
  </tr>
  <tr>
    <td align="center"><sub>Spectating</sub></td>
    <td align="center"><sub>Live races</sub></td>
  </tr>
</table>

## Run it

You need [Bun](https://bun.sh) 1.2.3 or newer.

```sh
bun install
bun run dev
```

Open http://localhost:3000, create a room and open the room link in a second tab to race yourself.

## Play with friends from your machine

Install [cloudflared](https://developers.cloudflare.com/cloudflared/downloads/), then:

```sh
bun run share
```

This starts the server and a Cloudflare quick tunnel and prints a public `https://….trycloudflare.com` link. Open it, create a room and send the room link to your friends. The link changes every time you run it and stops working when you press Ctrl+C.

## Deploy on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Nuu-maan/type-race)

`render.yaml` sets up one free web service built from the `Dockerfile`. Rooms live in memory, so keep it at one instance.

Render's free tier sleeps after 15 minutes without traffic. The `Keep alive` workflow pings the server every 10 minutes once you set the repo variable `APP_URL` to your Render address:

```sh
gh variable set APP_URL --body https://<your-service>.onrender.com
```

The free tier has no persistent disk, so profiles and the leaderboard reset whenever the service restarts or redeploys.

## Controls

| Key | What it does |
| --- | --- |
| Letters | Type the next letter. Wrong ones show red and still move you on. |
| Space | Next word. Pressing it mid-word skips the rest of the word. |
| Backspace | Fix the last letter in the current word. |
| Ctrl+Backspace | Clear the current word. |
| Arrow keys | Turn the car in the garage. |

## Under the hood

- **Server**: one Bun process. It serves the page, runs every room over WebSockets and keeps profiles in SQLite. It is the source of truth: clients send keys, and the server runs the race at 20 ticks a second and broadcasts every car.
- **Client**: plain TypeScript and three.js, no framework. The car scene, garage and landing hero are WebGL, the rest is HTML and CSS.
- **Shared logic**: `game.ts` holds the speed model and runs on both sides, so your own car reacts the moment you type.

| File | What it holds |
| --- | --- |
| `game.ts` | Speed model, typing rules, places and race end. Tuning constants sit at the top. |
| `server.ts` | Rooms, spectators, the race loop and the HTTP API. |
| `words.ts` | Word lists and the seeded text generator for each difficulty. |
| `progress.ts` | Levels, XP, paints, bodies and unlocks. |
| `db.ts` | SQLite profiles, race history and the leaderboard. |
| `scene.ts` | The WebGL track, cars, garage and effects. |
| `client.ts` | Screens, typing, the room and race flow. |
| `hud.ts`, `live.ts`, `garage.ts`, `leaderboard.ts` | The race HUD, live races list, garage pickers and leaderboard. |
| `sound.ts` | Synthesized sound effects. |

Profiles live in `data/type-race.sqlite` on the machine running the server, keyed by an id each browser keeps. Set `DB_PATH` to use another file and `PORT` to use another port.

## Checks

```sh
bun run check
bun test
```

## Contributing

Bug reports, ideas and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before you open one.

## License

[MIT](LICENSE) © Numan Khan
