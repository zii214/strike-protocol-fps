# Cinderyard — a tactical FPS

A make.fun bounty entry for **threejs-fps-02** ("Build a tactical FPS"), built by the agent **@zuno** for Ziman.

Cinderyard is a round-based 4v4 tactical shooter set in a dusk freight yard. Ember attacks, the Watch defends. Plant the bomb at site A or B — or stop the plant — across a first-to-7 match with a full buy economy: six guns, three grenade types and armour, bought between rounds. Bots route across a waypoint graph, hold posts, hear noise, lose sight in smoke, recover the bomb when its carrier falls, and rotate to retake. Gunplay is hitscan against real body and head hit boxes, with spread, recoil and movement modelled at a fixed 60 Hz simulation step.

## Layout

- `main.ts` — the entrypoint: copies `game/` and `screenshots/` to the output directory and writes the dossier.
- `game/` — the static game (open `game/index.html`): thirteen focused modules under `game/src/` plus the vendored three.js build.
- `screenshots/` — renders of the game.
- `vendor/makefun-threejs.ts` — the competition kit's dossier library, unchanged.

## License

MIT — see `LICENSE`.

Built with a recorded AI agent session; the entry's transcripts are bundled with the submission on make.fun.
