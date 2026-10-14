# Contributing to type race

Thanks for wanting to make the race better. Bug fixes, new tracks, cars, word lists, sounds and ideas are all welcome.

## Before you start

- **Found a bug?** Open an issue with the steps to reproduce it, what you expected and what happened. A screenshot or the browser console output helps a lot.
- **Have an idea?** Open an issue first for anything bigger than a small fix, so we can agree on it before you spend time building it.
- **Want something to work on?** Look at the [open issues](https://github.com/Nuu-maan/type-race/issues). Comment on one before you start so two people don't build the same thing.

## Set up

```sh
git clone https://github.com/Nuu-maan/type-race.git
cd type-race
bun install
bun run dev
```

Open http://localhost:3000 and open the room link in a second tab to race against yourself.

## Rules

### Pull requests

1. Fork the repo and branch off `main`. Name the branch after the change, like `fix/caret-on-wrap` or `feat/rain-track`.
2. One change per pull request. A bug fix and a new feature go in two PRs.
3. Never push to `main`. Everything goes through a pull request and gets reviewed.
4. Fill in the PR description: what changed, why, and how you tested it.
5. Add before and after screenshots, or a short clip, for anything you can see on screen. Check it at desktop width and at 390px.
6. Link the issue it closes (`Closes #12`).

### Commits

- Keep commits small, one logical change each.
- Write the subject as a short sentence in the imperative: `Fix caret jumping when a line wraps`, not `fixed stuff`.
- Add a body only when the reason isn't obvious from the diff.

### Code

- `bun run check` and `bun test` must pass.
- Changes to the speed model or typing rules in `src/shared/game.ts` come with a test in `src/shared/game.test.ts`.
- The server decides the race. Don't move race results, speed or places into the client.
- Match the code around you. Clear names and small functions over comments; add a comment only when leaving it out would let someone break something by accident.
- No new dependencies without talking about it in an issue first.
- Don't commit `data/`, `.env` files, keys, logs or build output.

### Design

- The whole site wears the night-race theme. Reuse the color tokens in `src/client/style.css` instead of adding new colors.
- No gradients on buttons, the logo, badges or bars. The 3D scene has its own art direction.
- Every control gets press feedback and respects `prefers-reduced-motion`.
- Text has to stay readable: check contrast when you change a color.
- Copy is short and plain. No em dashes. Errors say how to fix them.

## Be kind

Be respectful in issues, reviews and PRs. Critique the code, not the person. Harassment or personal attacks get you removed from the project.

## License

By contributing, you agree that your work is released under the [MIT License](LICENSE).
