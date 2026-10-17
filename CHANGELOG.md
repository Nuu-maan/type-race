# Changelog

Every update to type race, newest first. The same notes appear on the site at `/changelog`.

## 0.10.0 · 2026-10-17 · A new home page and this changelog

The home page is rebuilt around the three ways to play, and every update now gets written up here.

### New
- A redesigned home page: the night race runs behind the headline, three ways to play with real screenshots, the rules of speed at a glance, a cleaner leaderboard and the latest updates.
- This changelog, at `/changelog` and in the repo as `CHANGELOG.md`.
- A footer with links to every part of the site and the source code.

### Improved
- Phones see a still of the race behind the headline instead of an empty box.

## 0.9.1 · 2026-10-17 · Ghost race fix and daily link previews

### Fixed
- Racing your personal best could mark both cars as finished early and stop your typing. A car now finishes only when it actually crosses the line, and the right one takes first place.
- The analytics limit of 60 events per minute could be skipped by faking an address. It now uses the address Cloudflare reports.

### New
- Daily challenge links show their own preview card when shared.

## 0.9.0 · 2026-10-16 · Practice, daily challenge and your profile

You no longer need a friend to race. Practice on your own, take the daily challenge and race your best run.

### New
- **Practice now.** No lobby and no countdown: the clock starts with your first key.
- **Today's challenge.** One course a day, the same for everyone, with daily standings and a weekly table built from your best daily scores.
- **Race your best.** Your fastest run is saved with its exact words, and a violet ghost car replays it.
- **Your profile.** Personal best per difficulty, average accuracy, daily streak, your last 12 races and three goals for today.
- Share a result or a personal record with one press.

### Improved
- The result screen calls out a new personal best, tells you whether you beat your ghost and fits screens as narrow as 320 pixels.
- The site starts with 48 KB of code. The 3D scene loads only when it's needed and pauses when it's off screen.
- If your connection drops for a moment, you rejoin the same race where you left off.

### Fixed
- A retried result can no longer award XP twice.

## 0.8.0 · 2026-10-15 · Progress that sticks

### Improved
- XP, levels, records and the leaderboard are saved in a Postgres database, so they survive every update.
- The server stays awake, so you no longer wait for it to wake up.

## 0.7.0 · 2026-10-14 · Full screen and better sound

### New
- A full screen race view with the words floating over the track.
- Small, medium or large text for the words.
- A Leave room button, and Back to menu next to Race again on the results card.
- A soft chime when someone joins your room.

### Improved
- The engine now climbs through the gears. Key clicks, the countdown, nitro and the finish sound fuller.
- Rooms close after 10 minutes without activity.

### Fixed
- The Live races page flickered once a second.

## 0.6.0 · 2026-10-14 · Online for everyone

### New
- type race is online for anyone to play, no install needed.
- Invite, watch and live race links show their own preview when shared.
- The source is open under the MIT license, with a contributing guide.

## 0.5.0 · 2026-10-14 · Up to five racers and spectating

### New
- Rooms take up to five racers, and a race can start with two.
- A Live races tab where you can watch any race, plus watch links to share with friends.
- A new race display with every racer on a progress strip, a position list with the gaps, and a spectator count.

### Improved
- Text colors were measured and raised so everything is easy to read.

## 0.4.0 · 2026-10-13 · Levels, garage and leaderboard

### New
- XP and levels. Every race earns XP, with a bonus for a podium finish.
- A garage with paints and three car bodies that unlock as you level.
- A leaderboard of best speeds for each difficulty.
- Easy, Normal and Hard word lists.
- The whole site now wears the night race theme.

## 0.3.0 · 2026-10-13 · Sound and a home page

### New
- Quiet synthesized sounds for the engine, keys, countdown, nitro and finish, with a mute button.
- A home page with the race running behind the headline.

## 0.2.0 · 2026-10-13 · The night race

### New
- A 3D track with a neon city, cars and a chase camera.

### Improved
- A wrong letter no longer stops your car. It shows in red, you keep going and you pick up speed more slowly for a moment.

## 0.1.0 · 2026-10-13 · First race

### New
- Two racers type the same words, and typing speed drives each car.
- The server runs the race, so both screens always agree.
- Share a room link with a friend and start when you're both in.
