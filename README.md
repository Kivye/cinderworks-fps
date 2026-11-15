# Cinderworks v3 — Foundry-Yard Tactical FPS

Original round-based tactical FPS for the make.fun threejs-fps-02 bounty.
Single-player 5v5 vs bots, three.js 0.187.0, static files, no build step, no network.

## Play

Open `game/index.html` via a static server (`node serve.ts` → http://localhost:8080)
and click to lock the mouse.

- **Objective:** plant the charge at Furnace (A) or Crane Dock (B), or eliminate the
  defending team. Defenders win by stopping the plant, defusing, or running the clock out.
- **Controls:** WASD move · mouse aim · click fire · R reload · E hold to plant /
  defuse / pick up the dropped charge · G frag grenade · H smoke grenade ·
  B buy menu (buy phase) · 1–5 switch weapon · Ctrl crouch · right-click ADS ·
  Tab scoreboard · Shift walk slow.
- **Economy:** $800 start, +$300 per kill, +$300 plant, +$3,250 round win,
  loss bonus $1,900 + $500 per loss in the streak (cap $3,400). Bots buy role
  loadouts every round (`pickBotLoadout` in `game/src/state.js`).
- **Gunplay:** 5 weapons (pistol / SMG / shotgun / rifle / marksman) + frag + smoke,
  deterministic per-weapon recoil tables, capsule head/body hit detection with
  headshot multipliers, damage falloff, spread that grows while moving, ADS zoom.
- **Bots:** 4 ally roles (carrier / entry / support / holder) + 5 defenders
  (site holders / roamers), A* pathfinding over a waypoint graph with LOS
  smoothing and stuck recovery, vision cones, hearing-free but smoke-blocked
  sight, grenade throws, plant/defuse behaviour, short team comms.
- **HUD:** health, armour, ammo, round timer, score, money, weapon slots,
  live minimap (drawn from the real colliders/waypoints), killfeed, hurt-direction
  indicator, plant/defuse progress, buy menu, match-end scoreboard.
- **Map:** bright daylight foundry yard — 3 lanes, 2 sites, procedural canvas
  textures (brick / concrete / metal / hazard strips), giant A/B site decals,
  furnace glow, crane, work lamps.

## Layout

- `main.ts` — entrypoint: copies `game/` + `screenshots/` to the output dir and
  writes `dossier.json` via `vendor/makefun-threejs.ts`.
- `game/index.html` — single import map (`three` → vendored three.module.min.js).
- `game/src/main.js` — bootstrap, fixed-step (60 Hz) sim separate from render.
- `game/src/state.js` — state, weapons, recoil tables, roles, economy.
- `game/src/weapons.js` — ray-vs-capsule hits, falloff, grenade flight.
- `game/src/nav.js` — A*, LOS smoothing, stuck recovery.
- `game/src/bots.js` — bot AI: roles, vision, bursts, plant/defuse.
- `game/src/world.js` — map, colliders, waypoint graph, props, lights.
- `game/src/textures.js` — procedural canvas textures + name tags.
- `game/src/hud.js` — DOM HUD, minimap, buy menu, scoreboard.
- `game/src/audio.js` — WebAudio synth SFX (no audio files).
- `game/vendor/three/` — three.js 0.187.0, byte-identical to the kit.

## Screenshots

`?shot=start|play|plant|end&seed=7` stages the four shots (buy phase, open fight,
planted charge, match-end scoreboard); `window.__game` exposes live state for
headless playtests.

## License

MIT — see `LICENSE`.
