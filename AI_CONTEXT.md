# AI Context

RpgLikeDurkest is a small Phaser 3 / Vite / TypeScript roguelike. The player moves through a procedural room graph, resolves rooms through text-heavy choices and turn combat, then upgrades meta progression after death or victory.

## Run Commands

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

Use `npm.cmd` in PowerShell because `npm.ps1` can be blocked by local execution policy.

## Main Files

### Scenes (`src/scenes/`)

- `BootScene.ts`: Splash + asset boot. Owns the **shared** `Localization` and `SoundManager` instances and passes them into `GameScene` via `scene.start('GameScene', { loc, sfx })`. Restarts preserve language and audio state.
- `GameScene.ts`: Coordinator only. Wires managers/controllers, owns Phaser containers, top HUD (HP, stress, relics), keyboard shortcuts, and the language/sound toggles. Domain logic lives in the controllers below.
- `RoomFlow.ts`: `RoomFlowController`. Owns `enter(node)` and every room handler — treasure, trap, rest, shrine (incl. all five NPC altar paths: Mira/Casimir/Hollow Trader/Veth/Chorister/Kessa), merchant, and empty rooms. Also handles the depth-based whispers (3, 10, 15, 20, final-1, final).
- `CombatHud.ts`: `CombatHudController`. Owns combat UI (action buttons, intel panel, enemy portrait), `refreshButtons`, `performAction`, `handleVictory`, `updateEnemyUI`, `onPlayerHit` (hit flash).

### Systems (`src/systems/`)

- `CombatManager.ts`: Turn combat, enemy intent profiles, status effects, combat rewards. Takes an optional seeded `Rng`. Exposes pub/sub emitters: `enemyUpdate`, `playerStatusChange`, `enemyStatusChange`, `playerHit`, `combatEnd`.
- `DungeonManager.ts`: Current graph position, movement checks, graph mutation.
- `Emitter.ts`: Tiny typed pub/sub primitive (`on / off / emit / clear`) used by every manager. Snapshots listeners during `emit` and isolates listener exceptions.
- `Localization.ts`: RU/EN strings, language persistence in `localStorage`. Keys are semantic — e.g. `combatBossEncounter`, `hudReturnHint`, `roomTreasureName`, `npcMiraPotion`, `shopBeginRun`. **Do not** introduce new mechanical prefixes (`cm_001`, etc.).
- `MapGenerator.ts`: Room graph generation, available room type pool. Takes an optional seeded `Rng`.
- `MapLayout.ts`: Serpentine map coordinates, map centering, edge routing.
- `MetaProgressionManager.ts`: Persistent upgrades, content unlocks, UI unlock state. Limits come from `UPGRADE_DEFINITIONS.maxLevel`.
- `NarrativeManager.ts`: Run memory, room intro/result text, death/victory narrative.
- `Narrator.ts`: Short on-the-beat lines emitted by combat/exploration.
- `PlayerManager.ts`: Player stats, resources, damage, healing, level up, revive state. Exposes pub/sub emitters: `hpChange`, `statsChange`, `resourcesChange`, `levelUp`, `revive`, `death`, `relicsChange`.
- `Relics.ts`, `Skills.ts`, `Npcs.ts`: Catalogs and aggregation logic.
- `Rng.ts`: `Rng` interface, seeded `Mulberry32`, `defaultRng = Math.random`, helpers (`randomInt / chance / pick`). Used by `MapGenerator`, `StressManager`, `CombatManager`, and `rollRelicFor` so any subsystem can be made deterministic for tests.
- `RunTracker.ts`: Per-run stats (peak stress, level reached, …) used by end screens.
- `SoundManager.ts`: Audio playback + ambient loop, persisted mute flag.
- `StatusEffects.ts`: Bleed/guard/mark/focus/stun/weaken state, tick logic, `statusSummary` helper.
- `Stress.ts`: Stress mechanic + Resolve Test. Exposes pub/sub emitters: `valueChange`, `resolutionChange`. Takes an optional seeded `Rng`.

### UI (`src/ui/`)

- `EndScreens.ts`: Victory and death screens, including the meta-shop and reset-confirmation modal. Reads/writes scene state via `EndScreenContext`.
- `EventLog.ts`: Text log component used by both rooms and combat.
- `Layout.ts`: Single source of truth for canvas size (`GAME_WIDTH / GAME_HEIGHT / CENTER_X / CENTER_Y`) and Z-tiers (`Depths.Background … Depths.Tooltip`). **Do not hardcode 800/600 or depth literals.**
- `RoomVisuals.ts`: Pure room → color/icon/sprite/name lookup tables (`Record<RoomTypeValue, …>`).
- `SceneChrome.ts`: Bottom-left sound/language toggles + unlock banner.
- `TextHelpers.ts`: `compactText` and other small text utilities.
- `VFX.ts`: Lightweight Phaser visual effects (vignette, scanlines, hit-flash, float text). Default sizes use `Layout` constants.

### Data (`src/data/`)

`GameConfig.ts`, `Enemies.ts`, `EnemyTextConfig.ts` — see `docs/CONFIG_GUIDE.md` for what to edit.

## Current Architecture

`GameScene` is a coordinator: it constructs the player/stress/combat/dungeon managers, wires up subscriptions on their `Emitter` channels, and delegates room flow and combat UI to the `RoomFlowController` and `CombatHudController`. New room types or combat behaviours should land in those controllers (or in their respective `systems/` manager), not in `GameScene`.

The graph layout is intentionally separated:

- `MapGenerator` decides what nodes and edges exist.
- `MapLayout` decides where nodes appear and how edges are routed.
- `GameScene` draws the returned coordinates with Phaser.

The narrative/language path is also separated:

- Add normal UI strings to `Localization` (with a semantic key like `roomTreasureName`).
- Add authored run flavor to `NarrativeManager`.
- Avoid hardcoding new user-facing gameplay text in `GameScene` / `RoomFlow` / `CombatHud` — they should call `this.loc.t('semanticKey', vars)`.

The event/notification path is `Emitter`-based:

- Managers expose pub/sub emitters (`hpChange`, `combatEnd`, `valueChange`, …) instead of single mutable callback fields.
- Subscribers register with `emitter.on(payload => …)` and (if needed) unsubscribe with the returned disposer or `emitter.off(listener)`.
- Multiple subscribers per emitter are supported. Listener exceptions are caught + logged so one bad listener can't break unrelated UI.

## Conventions For Future Agents

- Keep files UTF-8 (no BOM). Prefer ASCII in docs/code comments unless you are editing actual localized RU strings.
- Use `import type` for TypeScript-only imports. Vite/esbuild can fail if interfaces are imported as runtime values.
- Prefer small modules over expanding `GameScene` further.
- Run `npm run lint && npm test && npm run build` before handing off.
- Localization keys must be semantic (e.g. `combatBossEncounter`), never mechanical (`cm_001`).
- New depth/canvas literals belong in `src/ui/Layout.ts`, not inline.
- Pub/sub: use `Emitter<T>` for any new "something happened" channel, not a mutable `onXxx` callback property.
- Tests: pure-logic systems (RNG, status effects, map gen, stress, combat formulas, meta progression) get Vitest coverage in `tests/`. Don't import Phaser into a unit test — the existing `EventLog`/`PlayerManager` shims show the pattern.
- Preserve user changes. Do not reset or checkout files unless explicitly asked.

## Known Tooling Notes

- The in-app browser can inspect the local dev URL at `http://127.0.0.1:5173/RpgLikeDurkest/`. Browser screenshot capture may time out in this environment; use console logs, visible browser checks, and `npm run build` as fallbacks.
- `vite.config.ts` reads `base` from `VITE_BASE`, so forks don't have to patch the config to deploy to a different GH Pages path. Phaser is split into its own chunk via `manualChunks: { phaser: ['phaser'] }`.
- CI runs `npm ci → lint → test → build` on every PR (`.github/workflows/ci.yml`).
