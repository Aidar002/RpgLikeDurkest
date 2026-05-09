# AI Context

RpgLikeDurkest is a small Phaser 3 / Vite / TypeScript roguelike. The player moves through a procedural room graph, resolves rooms through text-heavy choices and turn combat, then upgrades **skill-points** meta progression after escaping the dungeon.

> **Reading order for AI agents (cheapest plan path).**
>
> 1. **This file** — project overview + conventions.
> 2. **`docs/RECIPES.md`** — copy-paste walkthroughs for the 13 most
>    common edits ("add a new room / enemy / boss / skill / relic /
>    NPC / locale string / HUD cell / Emitter channel / unlock /
>    button / status effect / meta upgrade"). If your task is on
>    that list, **start here, not in the source.**
> 3. **`docs/ARCH_MAP.md`** — one-pager: file → role / emits /
>    depends on / owns. Use to find the right module.
> 4. **`docs/EVENTS.md`** — Emitter producer → payload → consumer
>    table. Use when wiring a new event or chasing one across files.
>
> Skip `docs/CONFIG_GUIDE.md` unless you're touching `src/data/`.

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
- `GameScene.ts`: Coordinator only. Wires managers/controllers, owns Phaser containers, top HUD (HP, ATK/DEF, gold, depth), keyboard shortcuts, the language/sound toggles, and the restart-confirmation modal. Domain logic lives in the controllers below.
- `RoomFlow.ts`: `RoomFlowController`. Owns `enter(node)` and every room handler — treasure, trap, rest, shrine, merchant, and empty rooms. Also handles the depth-based whispers (3, 10, 15, 20, final-1, final).
- `CombatHud.ts`: `CombatHudController`. Owns combat UI (action buttons, intel panel, enemy portrait), `refreshButtons`, `performAction`, `handleVictory`, `updateEnemyUI`, `onPlayerHit` (hit flash).

### Systems (`src/systems/`)

- `CombatManager.ts`: Turn combat, enemy intent profile (sprite-only category), status effects, combat rewards. Takes an optional seeded `Rng`. Exposes pub/sub emitters: `enemyUpdate`, `playerStatusChange`, `enemyStatusChange`, `playerHit`, `combatEnd`.
- `DungeonManager.ts`: Current graph position, movement checks, graph mutation.
- `Emitter.ts`: Tiny typed pub/sub primitive (`on / off / emit / clear`) used by every manager. Snapshots listeners during `emit` and isolates listener exceptions.
- `Localization.ts` + `LocalizedText.ts` + `locale/en.ts` / `locale/ru.ts`: RU/EN strings, language persistence in `localStorage`. `en.ts` is canonical (`Record<LocaleKey, string>`) so missing RU keys fail the build. Keys are semantic — e.g. `combatBossEncounter`, `hudReturnHint`, `roomTreasureName`, `npcMiraPotion`, `shopBeginRun`. **Do not** introduce mechanical prefixes (`cm_001`, etc.).
- `MapGenerator.ts`: Room graph generation, available room type pool. Takes an optional seeded `Rng`.
- `MapLayout.ts`: Serpentine map coordinates, map centering, edge routing.
- `MetaProgressionManager.ts`: Persistent skill-points bank + 4 permanent upgrades. Stored in `localStorage["rpglikedurkest-meta-v4"]`. Pre-v4 keys are dropped on load — there is **no migration**.
  - `+1 skill point` per `levelUp` (held in scene-local `runSkillPointsPending`).
  - `bankSkillPoints(points, runDepth)` is called **only on escape**; on death the scene calls `resetProgress()` which wipes the entire profile (bank + upgrades + content unlocks) as if it were a first launch.
  - Upgrades: `damage` (10 levels), `hp` (10 levels), `defense` (4 levels), `goldGain` (4 levels, +5% per level).
  - `getBonuses()` → `{ player: { maxHp, attack, defenseBonus, goldGainMult } }` consumed by `PlayerManager` constructor.
- `MusicManager.ts`: Music playback + cross-fade. Shares the persistent mute flag with `SoundManager`.
- `Narrator.ts`: Short on-the-beat lines emitted by combat/exploration.
- `NpcManager.ts` + `Npcs.ts`: NPC altar offers, post-pick state, catalog.
- `PlayerManager.ts`: Player stats, resources, damage, healing, level-up. Constructor accepts `MetaProgressionManager.getBonuses().player`. Exposes pub/sub emitters: `hpChange`, `statsChange`, `resourcesChange`, `levelUp`, `death`, `relicsChange`. (No `revive` — the revive system was removed in PR #110.)
- `Relics.ts`, `Skills.ts`: Catalogs and aggregation logic.
- `Rng.ts`: `Rng` interface, seeded `Mulberry32`, `defaultRng = Math.random`, helpers (`randomInt / chance / pick`). Used by `MapGenerator`, `CombatManager`, and `rollRelicFor` so any subsystem can be made deterministic for tests.
- `RunTracker.ts`: Per-run stats (peak depth, level reached, kills, …) used by end screens.
- `SoundManager.ts`: SFX bank + ambient loop, persisted mute flag.
- `StatusEffects.ts`: Bleed/guard/mark/focus/stun/weaken state, tick logic, `statusSummary` helper.

### UI (`src/ui/`)

- `EndScreens.ts`: Barrel re-export. Actual overlays live in `src/ui/end/`:
  - `end/DeathScreen.ts` — death modal. Shows the death summary and a **Reset soul progress** button. The 4-card meta-shop only renders when `runState.escaped === true` (i.e. when the screen is reused for the escape flow).
  - `end/VictoryScreen.ts` — single-screen artifact-collected modal.
  - `end/shared.ts` — `bankSkillPointsOnce` (idempotent — banks only when escaped), `hideLiveContainers`.
  - `end/types.ts` — `EndScreenContext`, `RunEndState` (`pendingSkillPoints`, `skillPointsBanked`, `skillPointsBankedFlag`, `escaped`).
- `EventLog.ts`: Text log component used by both rooms and combat.
- `Layout.ts`: Single source of truth for canvas size (`GAME_WIDTH / GAME_HEIGHT / CENTER_X / CENTER_Y`), Z-tiers (`Depths.Background … Depths.Tooltip`), and per-section HUD coordinates (`HudLayout.topHud.*`, `HudLayout.chrome.*`). **Do not hardcode 800/600 or depth literals.**
- `HudCell.ts`, `HudFrame.ts`, `HudIcons.ts`, `HudTheme.ts`: Bottom-bar resource cells, top/bottom carved bars, spritesheet icons, palette.
- `MapView.ts`: Map node visuals, node tweens, pointer interactions.
- `RoomButtons.ts`: Room action button factory + types (`RoomButtonAction`, `RoomButtonVariant`).
- `RoomVisuals.ts`: Pure room → color/icon/sprite/name lookup tables (`Record<RoomTypeValue, …>`).
- `SceneChrome.ts`: Bottom-left sound/language toggles + unlock banner.
- `Torchlight.ts`, `StoneBackdrop.ts`, `VolumePanel.ts`, `PixelSprite.ts`, `VFX.ts`: Atmospheric/visual helpers. `VFX` exposes vignette/scanlines/hit-flash/float-text.
- `AssetGuard.ts`: `hasTexture(scene, key)` / `withTexture(scene, key, withImage, withFallback)`. Use these instead of inline `scene.textures.exists(...)` so the "real spritesheet vs procedural fallback" branching stays in one place.
- `TextHelpers.ts`: `compactText` and other small text utilities.

### Data (`src/data/`)

`GameConfig.ts`, `Enemies.ts`, `Bosses.ts`, `EnemyTextConfig.ts` — see `docs/CONFIG_GUIDE.md` for what to edit.

## Current Architecture

`GameScene` is a coordinator: it constructs the player/combat/dungeon/meta managers, wires up subscriptions on their `Emitter` channels, and delegates room flow and combat UI to the `RoomFlowController` and `CombatHudController`. New room types or combat behaviours should land in those controllers (or in their respective `systems/` manager), not in `GameScene`.

The graph layout is intentionally separated:

- `MapGenerator` decides what nodes and edges exist.
- `MapLayout` decides where nodes appear and how edges are routed.
- `MapView` (in `ui/`) draws the returned coordinates with Phaser.

The narrative/language path is also separated:

- Add normal UI strings to `Localization` (with a semantic key like `roomTreasureName`).
- Avoid hardcoding new user-facing gameplay text in `GameScene` / `RoomFlow` / `CombatHud` — they should call `this.loc.t('semanticKey', vars)`.

The event/notification path is `Emitter`-based:

- Managers expose pub/sub emitters (`hpChange`, `combatEnd`, `levelUp`, …) instead of single mutable callback fields.
- Subscribers register with `emitter.on(payload => …)` and (if needed) unsubscribe with the returned disposer or `emitter.off(listener)`.
- Multiple subscribers per emitter are supported. Listener exceptions are caught + logged so one bad listener can't break unrelated UI.
- See `docs/EVENTS.md` for the full producer → payload → consumer table.

## Conventions For Future Agents

- Keep files UTF-8 (no BOM). Prefer ASCII in docs/code comments unless you are editing actual localized RU strings.
- Use `import type` for TypeScript-only imports. Vite/esbuild can fail if interfaces are imported as runtime values.
- Prefer small modules over expanding `GameScene` further.
- Run `npm run lint && npm test && npm run build` before handing off.
- Localization keys must be semantic (e.g. `combatBossEncounter`), never mechanical (`cm_001`).
- New depth/canvas/HUD literals belong in `src/ui/Layout.ts`, not inline.
- Pub/sub: use `Emitter<T>` for any new "something happened" channel, not a mutable `onXxx` callback property.
- Tests: pure-logic systems (RNG, status effects, map gen, combat formulas, meta progression) get Vitest coverage in `tests/`. Don't import Phaser into a unit test — the existing `EventLog`/`PlayerManager` shims show the pattern.
- `MetaProgressionManager` mutates `localStorage`. Tests must polyfill `globalThis.window.localStorage` (see `tests/MetaProgression.test.ts` for the in-file `MemoryStorage` shim).
- Preserve user changes. Do not reset or checkout files unless explicitly asked.

## Known Tooling Notes

- The in-app browser can inspect the local dev URL at `http://127.0.0.1:5173/RpgLikeDurkest/`. Browser screenshot capture may time out in this environment; use console logs, visible browser checks, and `npm run build` as fallbacks.
- `vite.config.ts` reads `base` from `VITE_BASE`, so forks don't have to patch the config to deploy to a different GH Pages path. Phaser is split into its own chunk via `manualChunks: { phaser: ['phaser'] }`.
- CI runs `npm ci → lint → test → build` on every PR (`.github/workflows/ci.yml`).
