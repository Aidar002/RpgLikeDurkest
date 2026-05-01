# RpgLikeDurkest

A compact Phaser 3 roguelike prototype: procedural map exploration, text-forward rooms, turn combat, meta progression, narrative memory, and RU/EN localization.

## Commands

PowerShell (Windows):

```powershell
npm install
npm.cmd run dev -- --host 127.0.0.1
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

bash (Linux / macOS / WSL):

```bash
npm install
npm run dev -- --host 127.0.0.1
npm run lint
npm test
npm run build
```

The dev server is at `http://127.0.0.1:5173/RpgLikeDurkest/`. The base path comes from `VITE_BASE` (default `/RpgLikeDurkest/`), so a fork can override it without patching `vite.config.ts`.

## Project Map

```
src/
├── scenes/
│   ├── BootScene.ts        # Owns shared Localization + SoundManager, hands them to GameScene
│   ├── GameScene.ts        # Coordinator: HUD, container layering, keyboard, manager wiring
│   ├── RoomFlow.ts         # RoomFlowController: every room handler (treasure / trap / rest / shrine / NPC / merchant / empty)
│   └── CombatHud.ts        # CombatHudController: combat UI, intel, action buttons, hit flash, victory transition
├── systems/
│   ├── CombatManager.ts    # Turn combat + enemy intents (Emitter-based events, seeded Rng)
│   ├── DungeonManager.ts   # Graph position, movement, mutation
│   ├── Emitter.ts          # Typed on/off/emit pub/sub (snapshots listeners, isolates errors)
│   ├── Localization.ts     # Russian + English UI/gameplay strings, semantic keys
│   ├── MapGenerator.ts     # Procedural room graph (seeded Rng)
│   ├── MapLayout.ts        # Serpentine graph coordinates, edge paths
│   ├── MetaProgressionManager.ts  # Persistent upgrades and unlocks
│   ├── NarrativeManager.ts # Authored room/run narrative + memory
│   ├── PlayerManager.ts    # Player stats and resources (Emitter-based events)
│   ├── Relics.ts / Skills.ts / Npcs.ts  # Catalogs
│   ├── Rng.ts              # Mulberry32 seeded RNG + defaultRng = Math.random
│   ├── StatusEffects.ts    # Bleed/guard/mark/focus/stun/weaken
│   └── Stress.ts           # Stress + Resolve Test (Emitter-based events)
├── ui/
│   ├── EndScreens.ts       # Death + victory screens (incl. meta-shop and reset modal)
│   ├── EventLog.ts         # On-screen event log
│   ├── Layout.ts           # GAME_WIDTH / GAME_HEIGHT / CENTER_X / CENTER_Y, Depths.* tiers
│   ├── RoomVisuals.ts      # Room → color/icon/sprite/name lookup tables
│   ├── SceneChrome.ts      # Bottom-left sound/language toggles + unlock banner
│   ├── TextHelpers.ts
│   └── VFX.ts
└── data/                   # Balance constants, enemy catalogs (see docs/CONFIG_GUIDE.md)
```

## Notes For Contributors

`GameScene` is the coordinator — it wires managers to controllers and renders the top HUD, but new gameplay rules belong in `systems/`, new room behaviour belongs in `RoomFlow.ts`, new combat UI belongs in `CombatHud.ts`, and reusable rendering helpers belong in `ui/`. Balance constants and catalogs live in `data/`.

For new visible text:

- UI / gameplay strings → add a **semantic** key to `Localization.ts` (e.g. `roomTreasureName`, `combatBleedTick`, `shopResetConfirm`). Do not introduce new mechanical prefixes like `cm_001`.
- Authored atmosphere → `NarrativeManager.ts` / `Narrator.ts`.

For new manager-to-scene events, expose an `Emitter<T>` field rather than a mutable `onXxx` callback. Subscribers register with `emitter.on(payload => …)` and unsubscribe with the returned disposer.

For new canvas / depth values, import constants from `src/ui/Layout.ts`.

For pure-logic systems (RNG, status effects, map gen, stress, combat formulas, meta progression), add Vitest coverage in `tests/`. CI runs `npm ci → lint → test → build` on every PR.

Keep the project UTF-8 (no BOM) and run `npm run lint && npm test && npm run build` before handoff.
