---
name: rpg-like-durkest
description: Single-source AI reference for the RpgLikeDurkest Phaser-3 roguelike. Covers setup, conventions, file-by-file architecture, the Emitter catalog, and 13 copy-paste recipes. Read this whenever you work on this repo.
---

# RpgLikeDurkest — AI Reference

Browser roguelike: **Phaser 3.90 + TypeScript + Vite**. Pure client app
(no backend, no `.env`, no external secrets). Ships as a static bundle.

> This file is the single onboarding doc. `README.md` is the quick
> human-facing index that points here. The only other doc files are
> `docs/ART_GUIDE.md` (asset / sprite workflow) and
> `docs/NARRATIVE_DIRECTION.md` (writing voice for room and combat
> text). All previous AI-facing files (`AI_CONTEXT.md`,
> `docs/ARCH_MAP.md`, `docs/EVENTS.md`, `docs/RECIPES.md`,
> `docs/CONFIG_GUIDE.md`) were merged into this skill. Don't grep for
> them.

## Setup

```bash
npm install
```

No env vars. All assets ship in `public/`.

## Daily commands

| What                   | Command                |
| ---------------------- | ---------------------- |
| Dev server (HMR)       | `npm run dev`          |
| Type-check only (fast) | `npm run typecheck`    |
| Type-check + bundle    | `npm run build`        |
| Lint (eslint 9 flat)   | `npm run lint`         |
| Unit tests (vitest)    | `npm test`             |
| Tests in watch mode    | `npm run test:watch`   |
| Prettier check         | `npm run format`       |
| Prettier auto-fix      | `npm run format:write` |

The dev server is at `http://127.0.0.1:5173/RpgLikeDurkest/`. The base
path comes from `VITE_BASE` (default `/RpgLikeDurkest/`); a fork can
override it without patching `vite.config.ts`.

CI (`.github/workflows/ci.yml`) runs
`npm ci → format → lint → test → build` on every PR. PRs are not
merged unless CI is green. Always run all four locally before
pushing (the `husky` pre-commit hook auto-formats staged files but
does not run the test/build step).

Required Node version: **>=20** (declared in `package.json` →
`engines`). CI uses `lts/*`. Older Node versions are not supported
because the pinned Vite/Vitest majors require it.

PowerShell users: invoke `npm.cmd` instead of `npm` (the `.ps1`
shim can be blocked by execution policy).

## TypeScript settings

`tsconfig.json` runs in `strict` mode with `noUnusedLocals` and
`noUnusedParameters` enabled. No `any`, no `// @ts-ignore`, no
`getattr`-style escape hatches — narrow the type properly. ESLint
flat-config rules also forbid unused vars.

Use `import type` for type-only imports — Vite/esbuild can fail if
interfaces are imported as runtime values.

Files are UTF-8 (no BOM). Comments are ASCII unless they're literal
RU strings being escaped.

## High-level architecture

```
src/
├── scenes/         Phaser scenes + per-room / per-combat controllers
├── systems/        Game-state managers (no Phaser at module top); sub-folders: `rooms/` (per-room handlers), `map/` (split MapGenerator helpers), `locale/` (en/ru tables)
├── ui/             Pure rendering helpers + layout constants; sub-folder: `end/` (run-end screens)
├── data/           Numeric balance + enemy / boss tables + pure type defs (e.g. `MapTypes.ts`)
└── main.ts         Phaser game bootstrap (canvas, scene registry)

tests/              Vitest pure-logic tests (no Phaser import)
public/             Static assets (sprites, audio) copied to dist/
```

Three-layer rule:

- `data/` is pure constants (no imports from `systems/` / `ui/` /
  `scenes/`).
- `systems/` are headless managers (no `import phaser` at module top —
  tests import them directly).
- `ui/` is pure rendering (no game-state mutations; takes everything
  via parameters).
- `scenes/` is the only layer allowed to wire `systems/` + `ui/` +
  Phaser together.

`GameScene` is the coordinator: it constructs every manager, wires
their `Emitter` channels, owns the top HUD and keyboard, and delegates
room flow to `RoomFlowController` and combat UI to
`CombatHudController`. New gameplay rules belong in `systems/`, new
room behaviour belongs in `RoomFlow.ts`, new combat UI belongs in
`CombatHud.ts`, and reusable rendering helpers belong in `ui/`.

## Module reference

For each module: **role** (one-liner), **emits** (Emitter channels —
see "Emitter catalog" below for payloads), **depends on** (major
collaborators), **owns** (state / side effects).

### Scenes (`src/scenes/`)

| File                                   | Role                                                                                                                                               | Emits                             | Depends on                                                                                         | Owns                                                                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BootScene.ts`                         | Splash + asset preload, hands off to `GameScene`.                                                                                                  | —                                 | `Localization`, `SoundManager`, `MusicManager`                                                     | The **shared** `Localization`, `SoundManager`, `MusicManager` instances passed to all later scenes. Restarts preserve language and audio state.                                          |
| `GameScene.ts`                         | Coordinator. Wires every manager + controller, owns Phaser containers, top HUD, keyboard, restart-confirm modal, escape modal, end-screen routing. | — (consumes everything)           | All `systems/*`, `ui/*`, both controllers                                                          | Phaser containers (`mapContainer`, `roomContainer`, `uiContainer`), HUD widget refs, scene-local run state (`runSkillPointsPending`, `runBestDepth`, `runBossKills`, `escaped`, `dead`). |
| `RoomFlow.ts` (`RoomFlowController`)   | Per-room handlers (treasure / trap / rest / shrine / NPC / merchant / empty) + depth whispers (3, 10, 15, 20, final-1, final).                     | —                                 | `GameScene` (back-ref), `CombatManager`, `PlayerManager`, `Narrator`, `NpcManager`, `Localization` | Current room result text, room-button bindings while a room is open.                                                                                                                     |
| `CombatHud.ts` (`CombatHudController`) | Combat UI (action buttons, intel panel, enemy portrait, hit flash, victory transition).                                                            | — (subscribes to `CombatManager`) | `GameScene`, `CombatManager`, `PlayerManager`, `Localization`, `VFX`                               | Combat-only UI widgets and their event subscriptions.                                                                                                                                    |

There is **no** separate `MenuScene` — the start screen is built inside
`BootScene.create()`. Don't grep for `MenuScene`.

### Systems (`src/systems/`)

| File                                                                     | Role                                                                                                                                                                                                                                                                                                                                                         | Emits                                                                                                                                     | Depends on                                                                                                                 | Owns                                                                                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `CombatManager.ts`                                                       | Turn combat: enemy intents, status effects, rewards, boss phase machine. Takes an optional seeded `Rng`.                                                                                                                                                                                                                                                     | `enemyUpdate`, `playerStatusChange`, `enemyStatusChange`, `playerHit`, `combatEnd`                                                        | `PlayerManager`, `StatusEffects`, `Enemies`, `Bosses`, `EnemyTextConfig`, `Rng`, `Localization`, `Narrator`, `BossRuntime` | Active enemy snapshot, boss phase state, skill cooldown table, prepare/windup state.                                                     |
| `BossRuntime.ts`                                                         | Six pure helpers extracted from `CombatManager` for boss phase resolution (PR #125).                                                                                                                                                                                                                                                                         | —                                                                                                                                         | `Bosses`, `EnemyTextConfig`                                                                                                | — (pure functions)                                                                                                                       |
| `DungeonManager.ts`                                                      | Graph position, movement validation, graph mutation.                                                                                                                                                                                                                                                                                                         | —                                                                                                                                         | `data/MapTypes`                                                                                                            | Current node + visited-node set.                                                                                                         |
| `Emitter.ts`                                                             | Tiny typed pub/sub primitive (`on / off / emit / clear`).                                                                                                                                                                                                                                                                                                    | —                                                                                                                                         | —                                                                                                                          | Listener list per `Emitter` instance. Snapshots listeners during `emit`; isolates listener exceptions.                                   |
| `Localization.ts` + `LocalizedText.ts` + `locale/en.ts` / `locale/ru.ts` | RU/EN string lookup. `en.ts` is canonical (`Record<LocaleKey, string>` so missing RU keys break the build). `tests/Locale.consistency.test.ts` also asserts both sides have identical keys + identical `{placeholder}` tokens at runtime.                                                                                                                    | `change` (language flip) — single mutable callback, not an `Emitter<T>` (predates the pattern; if you add a second consumer, migrate it). | `localStorage`                                                                                                             | Active language flag.                                                                                                                    |
| `MapGenerator.ts`                                                        | Procedural room graph: layer build, boss placement, seal coverage, weighted room rolls. Takes an optional seeded `Rng`. Imports types from `data/MapTypes`, the seal budget + post-major-recovery pool from `map/seals`, and the per-path scoring helpers from `map/validate`.                                                                               | —                                                                                                                                         | `Rng`, `MapConfig`, `data/MapTypes`, `map/seals`, `map/validate`                                                           | Owned graph (`MapNode[]`), seal counts, available-room set.                                                                              |
| `map/seals.ts`                                                           | `getRequiredSeals(runLength)` and `POST_MAJOR_RECOVERY_POOL` — the two leaves shared by `MapGenerator` and `map/validate`. Lives in its own module so the two siblings have no circular dep.                                                                                                                                                                 | —                                                                                                                                         | `data/MapTypes`, `data/GameConfig`                                                                                         | Pure constants + a tiny pure helper.                                                                                                     |
| `map/validate.ts`                                                        | `validateMap` (post-build invariant report) + `formatMapDebug` + the four per-path scoring helpers (`computeMinSealsPerPath`, `pickBestSealPromotion`, `pickRegularNodeToPromoteToMini`, `computePerPathStat`) used by both the generator and the report. Re-exported from `MapGenerator` for back-compat.                                                   | —                                                                                                                                         | `data/MapTypes`, `map/seals`                                                                                               | No instance state — all functions are pure.                                                                                              |
| `MetaProgressionManager.ts`                                              | Persistent skill-points bank + 4 upgrades + content-unlock state. Storage key `localStorage["rpglikedurkest-meta-v4"]`; pre-v4 keys dropped on load — **no migration**.                                                                                                                                                                                      | —                                                                                                                                         | `localStorage`, `UPGRADE_DEFINITIONS`                                                                                      | Persisted profile. `bankSkillPoints(...)` is **escape-only**; on death the scene calls `resetProgress()` which wipes the entire profile. |
| `MusicManager.ts`                                                        | Music playback + cross-fade. Shares the persistent mute flag with `SoundManager`.                                                                                                                                                                                                                                                                            | —                                                                                                                                         | `Phaser.Sound`, `localStorage`                                                                                             | Active track / queued track.                                                                                                             |
| `Narrator.ts`                                                            | Short on-the-beat lines emitted from combat/exploration.                                                                                                                                                                                                                                                                                                     | —                                                                                                                                         | `Localization`                                                                                                             | Per-key cooldown to avoid spam.                                                                                                          |
| `NpcManager.ts` + `Npcs.ts`                                              | NPC altar offer rolling and post-pick state.                                                                                                                                                                                                                                                                                                                 | —                                                                                                                                         | `Rng`, `Npcs` catalog                                                                                                      | Active offer per NPC, "already picked" flags.                                                                                            |
| `PlayerManager.ts`                                                       | Player stats (HP, atk, def, gold), level/XP, status, relics (capped at `MAX_RELICS = 5`), skills. `addRelic` returns `'added' \| 'duplicate' \| 'full'`; on `'full'` the caller routes through the `relicOffer` emitter so the HUD can put up the swap modal instead of silently dropping. Constructor accepts `MetaProgressionManager.getBonuses().player`. | `hpChange`, `statsChange`, `resourcesChange`, `levelUp`, `death`, `relicsChange`, `relicOffer`                                            | `MetaProgressionManager.getBonuses().player`, `StatusEffects`                                                              | All mutable player state. **No revives** (removed PR #110).                                                                              |
| `Relics.ts`                                                              | Catalog + `rollRelicFor(...)` / `rollRelicForEnemy(...)`.                                                                                                                                                                                                                                                                                                    | —                                                                                                                                         | `Rng`                                                                                                                      | Relic definitions.                                                                                                                       |
| `Skills.ts`                                                              | Skill catalog + starter loadout.                                                                                                                                                                                                                                                                                                                             | —                                                                                                                                         | —                                                                                                                          | Skill definitions.                                                                                                                       |
| `Rng.ts`                                                                 | `Rng` interface, seeded `Mulberry32`, `defaultRng = Math.random`, helpers (`randomInt`, `chance`, `pick`).                                                                                                                                                                                                                                                   | —                                                                                                                                         | —                                                                                                                          | Per-instance seed state (Mulberry32 only).                                                                                               |
| `RunTracker.ts`                                                          | Per-run stats (peak depth, level reached, kills, …) for end screens.                                                                                                                                                                                                                                                                                         | —                                                                                                                                         | —                                                                                                                          | Run-scoped counters.                                                                                                                     |
| `SoundManager.ts`                                                        | SFX bank + ambient loop, persisted mute flag.                                                                                                                                                                                                                                                                                                                | —                                                                                                                                         | `Phaser.Sound`, `localStorage`                                                                                             | SFX cache, ambient track.                                                                                                                |
| `StatusEffects.ts`                                                       | Bleed / guard / mark / focus / stun / weaken state, tick logic, `statusSummary` helper.                                                                                                                                                                                                                                                                      | —                                                                                                                                         | —                                                                                                                          | Pure functions over a passed-in status bag.                                                                                              |

The `StressManager` and `NarrativeManager` systems were removed in
earlier refactors — there is no such file or test. Don't grep for
them.

### UI (`src/ui/`)

| File                                                         | Role                                                                                                                                                                                                                                                                                                                                                         | Owns                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `EndScreens.ts`                                              | Barrel re-export → `end/DeathScreen`, `end/VictoryScreen`.                                                                                                                                                                                                                                                                                                   | —                                                                         |
| `end/DeathScreen.ts`                                         | Death modal. Reused for escape: 4-card meta-shop renders **only** when `runState.escaped === true`.                                                                                                                                                                                                                                                          | Modal Phaser widgets.                                                     |
| `end/VictoryScreen.ts`                                       | Final-boss artifact-collected modal.                                                                                                                                                                                                                                                                                                                         | Victory modal widgets.                                                    |
| `end/shared.ts`                                              | `bankSkillPointsOnce` (idempotent — banks **only** when escaped), `hideLiveContainers`.                                                                                                                                                                                                                                                                      | —                                                                         |
| `end/types.ts`                                               | `EndScreenContext` + `RunEndState` type definitions.                                                                                                                                                                                                                                                                                                         | —                                                                         |
| `EventLog.ts`                                                | Text log component used by both rooms and combat.                                                                                                                                                                                                                                                                                                            | Log line buffer.                                                          |
| `Layout.ts`                                                  | `GAME_WIDTH/HEIGHT/CENTER_X/CENTER_Y`, `Depths.*` Z-tiers, `HudLayout.topHud.*` / `HudLayout.chrome.*` HUD coordinates, `RoomLayout.{logX,logWidth,panelX,panelWidth,panelCenterX}` 35/65 left-log-vs-right-combat split.                                                                                                                                    | Compile-time constants. **Never hardcode 800/600 or `setDepth(99)`.**     |
| `HudCell.ts` / `HudFrame.ts` / `HudIcons.ts` / `HudTheme.ts` | Bottom-bar resource cells, top/bottom carved frame, icon spritesheet bindings, palette.                                                                                                                                                                                                                                                                      | HUD widget factories.                                                     |
| `MapView.ts`                                                 | Map node visuals + tweens + pointer interaction.                                                                                                                                                                                                                                                                                                             | Node sprites, edge graphics, hover/pulse tweens.                          |
| `RelicSlots.ts`                                              | Inline 5-cell relic display in the bottom HUD bar with hover tooltips (name + description + rarity badge). Owns its own `relicsChange` subscription; built once in `GameHudController.buildRelicSlots`.                                                                                                                                                      | Slot/tooltip widget refs.                                                 |
| `RelicSwapModal.ts`                                          | Modal that pops on `PlayerManager.relicOffer` (cap reached) so the player can drop one of the equipped five for the candidate relic, or skip the candidate. Clicks call back into `removeRelic` + `addRelic` on the player.                                                                                                                                  | Modal widget refs + candidate id.                                         |
| `RoomButtons.ts`                                             | Room action button factory + `RoomButtonAction` (public) and the file-private `RoomButtonVariant` style union.                                                                                                                                                                                                                                               | Button widget references.                                                 |
| `RoomVisuals.ts`                                             | Pure room → `{ color, icon, sprite, name }` lookup.                                                                                                                                                                                                                                                                                                          | Static lookup table.                                                      |
| `SceneChrome.ts`                                             | Bottom-left sound/language toggles + unlock banner.                                                                                                                                                                                                                                                                                                          | Chrome widget refs.                                                       |
| `Torchlight.ts` / `StoneBackdrop.ts` / `VolumePanel.ts`      | Atmospheric overlays + volume slider panel.                                                                                                                                                                                                                                                                                                                  | Decorative widgets.                                                       |
| `BootTorch.ts`                                               | `createBootTorch(scene, x, y, opts)` — animated wall torch with intro sequence (hidden → procedural `torchIgnite` SFX + warm additive halo → looping flame anim). Spritesheet key `boot_torch` loaded by `BootScene.preload` (horizontal strip, square frames, count auto-detected). Falls back to a small placeholder + glow + sound if the PNG is missing. | `Phaser.GameObjects.Sprite` + glow `Image` + tweens; cached glow texture. |
| `PixelSprite.ts`                                             | Procedural pixel-art fallback when a real spritesheet isn't loaded.                                                                                                                                                                                                                                                                                          | Generated `Phaser.Textures.CanvasTexture` instances.                      |
| `AssetGuard.ts`                                              | `hasTexture(scene, key)` + `withTexture(scene, key, withImage, withFallback)`. **Always go through this** so the "real spritesheet vs procedural fallback" branching stays in one place.                                                                                                                                                                     | — (utility)                                                               |
| `TextHelpers.ts`                                             | `compactText` and other small text utilities.                                                                                                                                                                                                                                                                                                                | —                                                                         |
| `VFX.ts`                                                     | Vignette, scanlines, hit-flash, float-text helpers. Default sizes use `Layout`.                                                                                                                                                                                                                                                                              | Effect widget refs.                                                       |

### Data (`src/data/`)

All numeric / catalog tables. Edit here when balance changes.

| File                 | What's inside                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GameConfig.ts`      | `PLAYER_CONFIG` (start HP/atk/def/level/resolve), `LEVEL_UP_CONFIG` (xp curve + per-level bumps), `EXPEDITION_CONFIG` (start gold/potions/resolve), `COMBAT_CONFIG`, `MAP_CONFIG` (final depth, weights, branching), `ROOM_CONFIG` (rewards, prices, trap damage, rest/shrine/merchant), `ENEMY_TIERS` (per-depth pools), `BOSSES`, `ALTAR_EFFECTS`, `XP_CONFIG`. |
| `MapTypes.ts`        | Pure type definitions for the dungeon graph: `RoomType` (const-object enum), `BossKind`, `SealType`, `MapNode` interface. Imported by `MapGenerator`, `DungeonManager`, `MapView`, `RoomVisuals`, `RoomFlow`, `GameMapController`, and tests. `MapGenerator.ts` re-exports these for back-compat with old import paths.                                           |
| `Enemies.ts`         | Non-boss enemy intent profiles; `assertBossMapping()` validates `BOSSES` at module load.                                                                                                                                                                                                                                                                          |
| `Bosses.ts`          | `BOSS_BLUEPRINT_BY_NAME` — phase script, `prepareActions`, `windupActions`.                                                                                                                                                                                                                                                                                       |
| `EnemyTextConfig.ts` | Per-enemy `name` (RU display) + `description` keyed by canonical English name.                                                                                                                                                                                                                                                                                    |

`name` on each `EnemyDef` is the **canonical English** string and
serves as the lookup key for `EnemyTextConfig` and relic drop tables.
Renaming it breaks lookups silently — keep that key stable.

### Tests (`tests/`)

Vitest, run with `npm test`. Pure-logic systems only — `Phaser` must
not be imported in unit tests. Two existing patterns:

- `tests/PlayerManager.test.ts` — passes a hand-rolled scene/log
  shim into `PlayerManager` to avoid pulling Phaser.
- `tests/MetaProgression.test.ts` — defines an in-file
  `MemoryStorage` shim on `globalThis.window.localStorage` before
  constructing `MetaProgressionManager`. Copy this when testing
  anything that hits `localStorage`.

`tests/Locale.consistency.test.ts` runs three runtime `en.ts ↔ ru.ts`
assertions: identical key set, identical `{placeholder}` token sets,
and an orphan-key check that fails when an `EN_STRINGS` key has no
string-literal call site under `src/` (excluding `src/systems/locale/`).
The orphan-key assertion uses
`import.meta.glob('../src/**/*.{ts,tsx}', { query: '?raw', eager: true })`
to inline every source file's raw contents at transform time, so it
needs no `fs` / `path` (and no `@types/node`). See the test docstring
for the runtime-template caveat: if you ever introduce a template-literal
key like `loc.t` of `` `prefix_${x}` ``, you must also spell every
reachable key as a string literal somewhere under `src/` (e.g. inside a
typed lookup map) — otherwise the assertion will flag those keys as
orphans even though they are dynamically reachable.

## Emitter catalog

Every manager-to-scene channel in the game is a typed `Emitter<T>`
(see `src/systems/Emitter.ts`). Append a row here whenever you add a
channel — tests and `GameScene.refreshUI()` rely on this catalog.

### Conventions

- Channels are exposed as `public readonly` fields on managers, e.g.
  `public readonly hpChange = new Emitter<{ hp: number; max: number }>();`.
- Subscribers register with `emitter.on(payload => …)` and unsubscribe
  with the returned disposer (or `emitter.off(listener)`).
- `emit()` snapshots the listener list before calling, so a listener
  can safely subscribe / unsubscribe during dispatch without mutating
  the current sweep.
- Listener exceptions are caught and logged; one bad listener cannot
  break unrelated UI.
- **Don't** add mutable `onXxx` callback fields. Always use
  `Emitter<T>` — multiple subscribers per channel are intentional.
- Payload `void` means "no value" — call sites use `emitter.emit()`
  and subscribers use `() => …`.

### `PlayerManager` (`src/systems/PlayerManager.ts`)

| Channel           | Payload                       | Fires when                                                                                         | Consumers                                                                                                                      |
| ----------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `hpChange`        | `{ hp: number; max: number }` | HP changes (damage, heal, max-HP increase).                                                        | `GameScene.refreshUI()` (HUD HP bar / number); tests.                                                                          |
| `death`           | `void`                        | HP reaches 0.                                                                                      | `GameScene` death sequence: hide HUD, call `meta.resetProgress()`, zero `runSkillPointsPending`, fade out, show `DeathScreen`. |
| `levelUp`         | `{ level: number }`           | XP threshold passes (`xpPerLevel = 10`).                                                           | `GameScene` (`runSkillPointsPending++`, level toast); tests.                                                                   |
| `statsChange`     | `void`                        | ATK / DEF / max-HP recomputed (relic equipped, level-up bonus, meta upgrade applied at run start). | `GameScene.refreshUI()` (ATK/DEF cells).                                                                                       |
| `resourcesChange` | `void`                        | Gold / potions / resolve / relic shards / seal count / kill counters change.                       | `GameScene` (HUD resource cells); tests.                                                                                       |
| `relicsChange`    | `void`                        | Relic added or removed from the player.                                                            | `GameScene.refreshUI()`; `RelicSlots` repaint; tests.                                                                          |
| `relicOffer`      | `{ id: RelicId }`             | `addRelic` was called while the inventory was already at `MAX_RELICS`; the relic was NOT added.    | `GameHudController` opens the `RelicSwapModal` so the player can drop one of the equipped five or skip the candidate.          |

### `CombatManager` (`src/systems/CombatManager.ts`)

Type definitions for the typed payloads (`EnemyUpdatePayload`,
`CombatEndPayload`) live in the same file.

| Channel              | Payload                                                                                                   | Fires when                                                                        | Consumers                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `enemyUpdate`        | `EnemyUpdatePayload` = `{ hp, maxHp, color, name, icon }`                                                 | Enemy HP / display state changes (after the player or boss acts).                 | `GameScene` → `combatHud.updateEnemyUI(...)` (portrait + HP bar).                                    |
| `playerStatusChange` | `void`                                                                                                    | Player status bag mutated (bleed/guard/mark/focus/stun/weaken applied or ticked). | `GameScene.updatePlayerStatusUI()`.                                                                  |
| `enemyStatusChange`  | `void`                                                                                                    | Enemy status bag mutated.                                                         | `GameScene.updateEnemyStatusUI()`.                                                                   |
| `playerHit`          | `{ damage: number }`                                                                                      | Enemy attack lands and damages the player (post-mitigation).                      | `GameScene` → `combatHud.onPlayerHit(damage)` (hit-flash VFX).                                       |
| `combatEnd`          | `CombatEndPayload` = `{ enemyName, enemyCanonicalName, kind, rewards, killedByBleed, finalBossDefeated }` | Combat resolves (enemy dies — by attack or by bleed).                             | `GameScene` → `combatHud.handleVictory(payload)` (rewards UI, depth advance, boss-kill bookkeeping). |

### Adding a new channel

1. Pick the manager that owns the state being broadcast (the source of
   truth — see "Owns" column in module reference).
2. Declare the field as `public readonly fooChange = new Emitter<Payload>();`.
3. Call `this.fooChange.emit(payload)` from the mutator method,
   **after** the state mutation is complete (never mid-mutation).
4. Subscribe in `GameScene.create()` (or a controller's setup) with
   `this.foo.fooChange.on(payload => …)`. Keep listeners thin — push
   real work back into a `refreshUI()`-style method.
5. Append a row to the matching table above in the same PR.

## Coordinate conventions

- Canvas: 1024 × 768.
- Top HUD bar: `y = 0..96`.
- Bottom HUD bar: bottom edge sits at `GAME_HEIGHT − HUD_BOTTOM_OFFSET`,
  height `BOTTOM_BAR_H = 140`.
- Anything anchored to the bottom of the canvas computes Y from
  `GAME_HEIGHT − BOTTOM_BAR_H − HUD_BOTTOM_OFFSET`, not a hard-coded
  pixel — see `RoomButtons` in `GameScene.ts` and PR #54 for the bug
  this convention prevents.
- Section-specific HUD coordinates live in `HudLayout.topHud.*` /
  `HudLayout.chrome.*` (see `src/ui/Layout.ts`). New HUD coordinates
  go there, NOT inline in `GameScene.ts`.

## Localization

`src/systems/Localization.ts` is the loader/runtime; the per-language
tables live in `src/systems/locale/en.ts` (canonical) and
`src/systems/locale/ru.ts` (`Record<LocaleKey, string>` so missing
translations fail the build). `loc.t('key')` returns the
active-language string; passing `loc` into UI helpers keeps them
language-agnostic.

To add a new visible string:

1. Add `mySemanticKey: 'English text'` to `src/systems/locale/en.ts`.
2. Add the matching translation to `src/systems/locale/ru.ts`.
3. Use `this.loc.t('mySemanticKey', { var: value })` at the call site.

Keys are **semantic** — `combatBossEncounter`, `roomTreasureName`,
`npcMiraPotion`, `shopBeginRun`. Do **not** introduce mechanical
prefixes (`cm_001`, etc.). Don't drop the `{placeholder}` tokens —
`tests/Locale.consistency.test.ts` will fail.

## Meta progression (v4 — skill points)

`src/systems/MetaProgressionManager.ts` owns the persistent profile.
Storage key: `localStorage["rpglikedurkest-meta-v4"]`. Pre-v4 keys
(v1/v2/v3, "rpglikedurkest-prestige", etc.) are dropped on load —
**there is no migration**.

- Currency: **skill points**. `+1` is granted per `levelUp` and held
  in scene-local `runSkillPointsPending` (NOT in the persistent bank
  yet).
- `bankSkillPoints(points, runDepth)` is called **only when the player
  escapes** (via the escape modal in `GameScene`). On death the scene
  calls `meta.resetProgress()` instead, which wipes the entire profile
  (bank + all upgrades + all content unlocks) so the next run starts
  as a first launch.
- 4 permanent upgrades, paid out of the bank:
  - `damage` — 7 levels, costs `1 / 2 / 4 / 8 / 16 / 32 / 64`
  - `hp` — 8 levels, costs `1 / 2 / 4 / 5 / 8 / 9 / 16 / 17`
  - `defense` — 4 levels, costs `5 / 10 / 20 / 40`
  - `goldGain` — 4 levels, costs `5 / 10 / 20 / 40`, `+5%` per level
- `getBonuses()` → `{ player: { maxHp, attack, defenseBonus,
goldGainMult } }` is consumed by the `PlayerManager` constructor.

## End screens

`src/ui/EndScreens.ts` is a re-export barrel; the actual overlays live
under `src/ui/end/`:

- `end/DeathScreen.ts` — death modal. Shows the death summary and a
  **Reset soul progress** button. The 4-card meta-shop only renders
  when `runState.escaped === true` (the escape flow reuses this
  screen).
- `end/VictoryScreen.ts` — single-screen artifact-collected modal
  (final boss).
- `end/shared.ts` — `bankSkillPointsOnce` (idempotent — banks ONLY
  when `runState.escaped === true`; on death it is a no-op),
  `hideLiveContainers`.
- `end/types.ts` — `EndScreenContext`, `RunEndState`
  (`pendingSkillPoints`, `skillPointsBanked`, `skillPointsBankedFlag`,
  `escaped`).

Restart UX (`GameScene`): the **Начать заново / Restart** button
opens a confirmation modal ("весь прогресс обнулится"). "Yes" calls
`meta.resetProgress()` and reboots into `BootScene`; "Cancel" closes
the modal. Both Restart and Escape are HUD-only — they are hidden
inside any room (combat, shrine, merchant, …) and only shown on the
map.

## Recipes

Token-cheap walkthroughs for the most common edits. Each recipe lists
**every file** an AI agent needs to touch. "Add to […]" means _append_
an entry; never reorder existing entries because some are referenced
positionally (e.g. milestone tables). All locale changes require
**both** `en.ts` (canonical) **and** `ru.ts` — TypeScript fails the
build if either is missing.

Verify after every recipe: `npm run lint && npm test && npm run build`.

### 1. Add a new room type

1. **Enum** — `src/data/MapTypes.ts`
   - Append the new variant to the `RoomType` const-object **at the
     end** (don't reorder; positional callers exist). The matching
     `RoomType` type alias is derived automatically.
2. **Pool + weights** — `src/systems/MapGenerator.ts`
   - Add it to `BASE_ROOM_POOL` (and any depth-restricted pool) with
     a weight in `getWeight()`.
   - If unlock-gated, add a new literal to the `UnlockId` union in
     `MetaProgressionManager.ts` and reference it in
     `MapGenerator.getAllowedRoomTypes()`. (`UnlockId` replaces the
     historical `ALL_UNLOCK_IDS` runtime array — there is no longer a
     value-level enumeration to append to.)
3. **Visuals** — `src/ui/RoomVisuals.ts`
   - Add a `{ color, icon, sprite, name }` row keyed by the new
     `RoomType` value. The lookup is exhaustive — TypeScript will
     fail the build if you miss it.
4. **Handler module** — `src/systems/rooms/YourRoom.ts`
   - Export a single `handleYourRoom(scene: GameScene): void` function
     mirroring the existing handlers in that folder (`Treasure.ts`,
     `Trap.ts`, `Rest.ts`, `Shrine.ts`, `Merchant.ts`, `Empty.ts`).
   - Use `scene.showRoomCard(...)` and `scene.setRoomButtons([...])`
     to render the UI; never instantiate Phaser objects directly here.
   - Use `defaultRng` (or accept an injected seeded `Rng`) for any
     randomness — never `Math.random()`.
5. **Dispatch** — `src/scenes/RoomFlow.ts`
   - Import the handler and add a `case RoomType.YOUR_ROOM:` branch
     in `enter()` that calls it. The `default: never` guard at the
     bottom of `enter()` will flag the gap if you forget.
6. **Localization** — `src/systems/locale/en.ts` + `ru.ts`
   - At minimum `roomXxxName`, `roomXxxDesc`, `roomXxxHint`.
7. **Test** — `tests/MapGenerator.test.ts` if depth/frequency
   matters; `tests/Smoke.run.test.ts` already exercises every
   handler in the dispatch table, so missing branches surface there.

### 2. Add a new (non-boss) enemy

1. **Definition** — `src/data/GameConfig.ts`
   - Append an `EnemyDef` to the matching `ENEMY_TIERS[i].pool`. Set
     `name` (canonical English — used as the relic-drop key + the
     `EnemyTextConfig` key), `hp`, `attack`, `xpReward`, `goldReward`,
     `intentProfile` (sprite category — does NOT change behaviour
     after PR #129).
2. **Localized name + flavor** — `src/data/EnemyTextConfig.ts`
   - Add `[<canonical>]: { name: 'Русское имя', description: '…' }`.
3. **Drop table (optional)** — `src/systems/Relics.ts`
   - Add the canonical `name` to the `enemyName` field of any relic's
     `drops: RelicDropEntry[]`.
4. **Test** — `tests/CombatManager.test.ts` if a new combat dynamic.

Enemy _pool selection_ now goes through the seeded `Rng` — see
`getEnemyForDepth(depth, rng)`. Pass `Mulberry32(seed)` into a fresh
`CombatManager` for deterministic tests.

### 3. Add a new boss (with phases)

1. **Boss definition** — `src/data/GameConfig.ts`
   - Append to `BOSSES` with `{ depth, def: EnemyDef }`. Depth must be
     unique. If the depth lands on a canonical milestone, add it to
     `EXPECTED_BOSS_NAMES` in `src/data/Enemies.ts` so
     `assertBossMapping()` validates the table at module load.
2. **Phase script** — `src/data/Bosses.ts`
   - Add `BOSS_BLUEPRINT_BY_NAME[<canonical name>]` with `phases`,
     `prepareActions`, `windupActions`. Lookup key is the boss's
     **English** `name` from `GameConfig.BOSSES`.
3. **Localization** — `src/systems/locale/en.ts` + `ru.ts`
   - Per-action labels if the script references new `intentLabel` /
     `prepareName` / `windupName` ids.
4. **Combat wiring** — `src/systems/CombatManager.ts`
   - Usually nothing. The `runBossTurn` / `resolvePrepare` /
     `resolveBossWindupAction` machinery reads the blueprint
     generically. Edit only for a brand-new action kind.
5. **Test** — `tests/CombatManager.test.ts`
   - Drive a `Mulberry32`-seeded fight; assert phase transitions and
     final reward shape.

### 4. Add a new skill

1. **ID** — `src/systems/Skills.ts`
   - Add to the `SkillId` union and the `SKILLS` record (with
     `LocalizedText` `name` / `short` / `description`, `resolveCost`,
     `color`, `starter`).
   - Set `starter: false` if the skill is locked behind meta progress;
     also add a matching `'skill_<id>'` literal to the `UnlockId`
     union in `MetaProgressionManager.ts` and surface it via
     `getUnlockedExtraSkills()`.
2. **Effect** — `src/systems/CombatManager.ts`
   - Add a branch in `handlePlayerSkill(skillId)`. Use
     `applyPlayerDamage(...)` for damage, status helpers for buffs.
3. **Localization** — already covered if you used `lt(ru, en)` in
   step 1.
4. **Test** — `tests/CombatManager.test.ts`
   - Cover damage / status / cooldown. The existing `'cleave'` and
     `'bleed_strike'` tests are good templates.

### 5. Add a new relic

1. **ID + def** — `src/systems/Relics.ts`
   - Add to `RelicId`, then to `RELICS` with `name`, `description`,
     `rarity`, `set` (or `null`), per-stat aggregate fields, and a
     `drops: RelicDropEntry[]` listing canonical enemy `name`s and
     their `chance`.
   - Set bag rarity via `RelicRarity` (`common`/`rare`/`unique`).
     Rare/unique are gated by `getRelicRarityPool()` until their
     unlock fires.
2. **Aggregation (only for new effect kinds)** — `src/systems/Relics.ts`
   - If the relic introduces a new numeric channel (e.g. lifesteal),
     extend `RelicAggregate`, `emptyAggregate`, `applyRelic`, and
     wherever `CombatManager` reads from the aggregate.
3. **Localization** — `lt(ru, en)` covers it in step 1.
4. **Test** — `tests/Relics.test.ts` (drop chance) + a `CombatManager`
   test if a new effect kind is wired.

### 6. Add a new NPC

1. **Catalog** — `src/systems/Npcs.ts`
   - Add an `NpcId` and an entry in `NPCS` with `role`, `voice`
     lines, beats, optional `offer` template.
2. **Memory** — `src/systems/NpcManager.ts`
   - If the NPC needs persistent state (already-met / chosen-offer
     flags), append to `NpcMemoryMap` defaults in
     `makeDefaultNpcMemoryMap()`. The sanitizer drops unknown ids.
3. **Hookup** — `src/scenes/RoomFlow.ts`
   - If the NPC should appear in shrines/empty rooms, add it to the
     relevant `npcs.pickForRole(...)` call. For altars, follow the
     `presentSaraAdviceChoice` / `presentGogiPayChoice` pattern —
     every NPC altar lives in `RoomFlow`, not `GameScene`.
4. **Localization** — covered by `lt(ru, en)` in step 1.

### 7. Add a new locale string

1. `src/systems/locale/en.ts` — add `mySemanticKey: 'English text'`.
2. `src/systems/locale/ru.ts` — add the matching Russian translation.
3. Use `this.loc.t('mySemanticKey', { var: value })` at the call site.

**Never** introduce mechanical prefixes (`cm_001`, etc.). Keys must
read like English (`combatBossEncounter`, `roomTreasureName`).

### 8. Add a new HUD cell

1. **Layout constants** — `src/ui/Layout.ts`
   - Add an x/y/width entry under `HudLayout.topHud.*` or pick a slot
     in the bottom bar. Never inline literals.
2. **Cell creation** — `src/scenes/GameScene.setupGlobalUI()`
   - Use `createHudCell(...)` (bottom bar) or
     `createHudInlineSlot(...)` (top bar) and store the handle on a
     scene field.
3. **Refresh** — `src/scenes/GameScene.refreshUI()`
   - Set the cell's `value` text on every refresh. The cell handle
     exposes `setValue` / `setLabel` / `setIcon`.
4. **Visibility (optional)** — gate the cell on a meta unlock by
   reading `this.meta.getUiUnlockState()` in `refreshUI()`.

### 9. Add a new Emitter channel

See "Adding a new channel" above under the Emitter catalog.

### 10. Add a new content unlock (milestone reward)

1. **Unlock id** — `src/systems/MetaProgressionManager.ts`
   - Append a new literal to the `UnlockId` union. The id is a stable
     string used in persisted profiles, so it is permanent.
   - Reflect it in defaults (`DEFAULT_CONTENT_UNLOCKS`) — `false` for
     gated content, `true` if you're retroactively flipping a
     historical id on for old saves.
2. **Trigger** — same file
   - Add to `DEPTH_MILESTONES` (depth-based) or
     `FIRST_BOSS_MILESTONE` (first boss kill) so the unlock banner
     can fire. Or call `meta.unlockContent('your_id')` from the
     relevant handler.
3. **Effect** — wire the consumer to read `meta.isUnlocked('your_id')`
   or `meta.getUiUnlockState()` and gate the feature accordingly.
4. **Localization** — `unlockBannerYourId` (`{ key, value }` style)
   for the banner text in `setupSceneChrome`.
5. **Test** — `tests/MetaProgression.test.ts`. The `MemoryStorage`
   shim pattern is at the top of the file.

### 11. Add a new room-action button variant

1. **Variant id** — `src/ui/RoomButtons.ts`
   - Add to `RoomButtonVariant` union. The factory's switch is
     exhaustive; TypeScript will fail the build if you miss the
     style mapping.
2. **Style** — `src/ui/RoomButtons.ts` `styleByVariant` table.
3. **Caller** — usually `src/scenes/RoomFlow.ts`. Pass `variant:
'your_variant'` in the `RoomButtonAction` literal.

### 12. Add a new status effect

1. **Definition** — `src/systems/StatusEffects.ts`
   - Add the effect to the `StatusState` shape (`emptyStatusState()`
     defaults + the `tickTurn()` decay block) and surface a setter /
     clearer (`applyXxx(s, ...)`) if needed.
   - Add the new id to the `StatusId` union if you're going to refer
     to it as a typed string anywhere outside `StatusEffects.ts`.
2. **Apply** — most effects are applied from
   `src/systems/CombatManager.handlePlayerSkill` or
   `applyPlayerDamage` / `resolveEnemyTurn`. Use the existing
   `applyStatus(...)` helper.
3. **Display** — `statusSummary(status, language)` is the single
   source of truth for the player/enemy status pill text. Add a
   branch there.
4. **Test** — `tests/StatusEffects.test.ts`. Unit-test pure tick
   logic before wiring it into combat.

### 13. Wire a new meta-progression upgrade

The existing 4 upgrades (`damage`, `hp`, `defense`, `goldGain`) cover
flat-stat bumps. Adding a new card:

1. **Upgrade id** — `src/systems/MetaProgressionManager.ts`
   - Add to `UpgradeId` union. Add a `UPGRADE_DEFINITIONS[<id>]` entry with `maxLevel`, `costForLevel(level)`, `apply(level, bonuses)`, `description`, `title`.
2. **Bonuses shape** — same file
   - If the upgrade affects a new player stat, extend
     `PlayerMetaBonuses` and adjust `PlayerManager`'s constructor.
3. **Card UI** — `src/ui/end/DeathScreen.ts`
   - The 4-card meta-shop reads from `meta.getUpgradeCards()` so no
     UI change is needed for a 5th card _unless_ you're past the
     hardcoded 4-slot 2x2 grid. The grid is built inline near the
     `CARD_W` / `CARD_H` / `CARD_GAP_Y` constants and the
     `positions: { x, y }[]` array — extend the array (or add a row)
     and the rest of the rendering loop scales.
4. **Test** — `tests/MetaProgression.test.ts`. Cover the upgrade's
   cost curve and `apply` math.

## Common pitfalls

- Phaser's `nineslice` requires the source texture to actually exist
  — always go through `AssetGuard.withTexture(...)` so the procedural
  fallback runs in tests / before BootScene completes.
- `setStrokeStyle` on `Rectangle` resets the stroke; set it once after
  every `setStrokeStyle` change inside hover handlers (see existing
  `pointerover`/`pointerout` pairs).
- `MusicManager` uses `HTMLAudioElement` whose volume is capped at
  1.0; don't request gain higher than 1.0 without switching to Web
  Audio.
- When changing animation behavior on map-node visuals, remember the
  fallback (PNG missing) path uses `alpha` tweens on `rect`. Both
  branches must call `tweens.killTweensOf(visual.rect)` before
  re-tweening.
- Random rolls go through `defaultRng` (or a passed-in seeded `Rng`).
  The audit closed off `Math.random()` in gameplay paths so the
  determinism envelope is whole — don't reintroduce `Math.random()`.
- `GameScene` is now a thin coordinator (~450 lines) that delegates
  to per-domain controllers (`GameHudController`, `GameMapController`,
  `GameOverlayController`, `GameRoomController`, `RoomFlowController`,
  `CombatHudController`) and to per-room handlers in
  `src/systems/rooms/*`. The largest module is now
  `src/systems/MapGenerator.ts` (~850 lines: room pools + graph +
  boss-pressure pass; types live in `src/data/MapTypes.ts`, validation
  - per-path scoring helpers live in `src/systems/map/validate.ts`).
    New gameplay rules belong in `systems/`, new room behaviour as a
    `case` in `RoomFlow.ts` plus a handler module under
    `systems/rooms/`, new combat UI in `CombatHud.ts`. Keep the
    coordinator thin.

## Phaser version policy

The project pins **Phaser 3.x** (currently `3.90.0`). Phaser 4 is a
major version with breaking API changes (containers, input, audio
all touched). Do **not** bump Phaser to 4.x without an explicit
go-ahead from the maintainer — open an issue/PR proposing the
migration first. `npm outdated` will flag `phaser` as out-of-date;
that is intentional.

## Keeping this skill up to date

This file is the single source of truth for AI agents working on
the repo. **You must update it in the same PR whenever you make a
change that invalidates anything documented here.** A stale skill
sends future agents in the wrong direction and wastes their tokens
hunting down ghosts.

Update SKILL.md when your PR:

- Adds, removes, or renames a module under `src/scenes/`,
  `src/scenes/controllers/`, `src/systems/`, `src/systems/rooms/`,
  `src/systems/locale/`, `src/ui/`, `src/ui/end/`, or `src/data/`
  → fix the **Module reference** tables.
- Adds, removes, or renames an `Emitter<T>` channel, or changes its
  payload shape → fix the **Emitter catalog**.
- Renames a top-level identifier referenced from this file (e.g. the
  `ALL_UNLOCK_IDS` → `UnlockId` migration in #156) → fix every
  recipe that mentions the old name. The orphan-key vitest assertion
  in `tests/Locale.consistency.test.ts` will catch missed locale-key
  references but not missed recipe references — those are the
  reviewer's responsibility.
- Changes the procedure for any of the 13 recipes (e.g. a new file
  must be touched, an old one no longer exists, an enforcement
  changes) → fix the relevant **Recipe**.
- Changes `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`,
  any `package.json` script, the CI workflow, or the layer rules
  → fix **Setup / Daily commands / TypeScript settings /
  High-level architecture** as appropriate.
- Significantly grows or shrinks a major module (the "largest file"
  bullet under **Common pitfalls** and any size figure cited
  elsewhere) → keep the figures roughly accurate (±20% tolerance,
  no need to chase every line).
- Adds a new pitfall worth warning future agents about → append to
  **Common pitfalls**.

`README.md` is the human-facing index that points here. If you
restructure folders or introduce a new top-level area, update both
this file _and_ the "Project layout" / "Where to put things"
sections of the README.

## Topical references

- `docs/ART_GUIDE.md` — adding hand-authored sprite assets (room
  icons, enemy portraits) and the procedural-fallback workflow.
- `docs/NARRATIVE_DIRECTION.md` — voice for room cards, combat log
  lines, intent text, and death lines.
