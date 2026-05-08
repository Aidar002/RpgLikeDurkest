# Architecture Map

One-page reference for AI agents and humans entering this codebase. For each
module, lists its **role** (one-line summary), what it **emits** (Emitter
channels — see `docs/EVENTS.md` for full payloads), what it **depends on**
(major collaborators), and what it **owns** (state / side effects).

Read this **before** opening files. Combined with `AI_CONTEXT.md` and
`docs/EVENTS.md`, it should be enough to plan most edits without grepping
through the whole tree.

## Conventions

- "Owns" means: this module is the source of truth for the listed state. If
  you need to read or mutate it, route through this module.
- "Emits" lists `Emitter<T>` channels exposed as public fields. Events are
  push-only — callers cannot ask "what was the last value", they subscribe.
- "Depends on" lists imported managers / pure helpers. Type-only imports
  (`import type { … }`) are skipped.

## Scenes (`src/scenes/`)

| File | Role | Emits | Depends on | Owns |
| --- | --- | --- | --- | --- |
| `BootScene.ts` | Splash + asset preload, then hands off to `GameScene`. | — | `Localization`, `SoundManager`, `MusicManager` | The **shared** `Localization` / `SoundManager` / `MusicManager` instances passed to all later scenes. |
| `GameScene.ts` | Coordinator. Wires every manager + controller, owns Phaser containers, top HUD, keyboard shortcuts, restart-confirm modal, escape modal, end-screen routing. | — (consumes everything) | All `systems/*`, `ui/*`, both controllers | Phaser containers (`mapContainer`, `roomContainer`, `uiContainer`), HUD widget refs, scene-local run state (`runSkillPointsPending`, `runBestDepth`, `runBossKills`, `escaped`, `dead`). |
| `RoomFlow.ts` (`RoomFlowController`) | Per-room handlers (treasure / trap / rest / shrine / NPC / merchant / empty) + depth whispers. | — | `GameScene` (back-ref), `CombatManager`, `PlayerManager`, `NarrativeManager`, `Narrator`, `NpcManager`, `Localization` | Current room result text, room-button bindings while a room is open. |
| `CombatHud.ts` (`CombatHudController`) | Combat UI (action buttons, intel panel, enemy portrait, hit flash, victory transition). | — (subscribes to `CombatManager`) | `GameScene`, `CombatManager`, `PlayerManager`, `Localization`, `VFX` | Combat-only UI widgets and their event subscriptions. |

## Systems (`src/systems/`)

| File | Role | Emits | Depends on | Owns |
| --- | --- | --- | --- | --- |
| `CombatManager.ts` | Turn combat: enemy intents, status effects, rewards, boss phase machine. | `enemyUpdate`, `playerStatusChange`, `enemyStatusChange`, `playerHit`, `combatEnd` | `PlayerManager`, `StatusEffects`, `Enemies`, `Bosses`, `EnemyTextConfig`, `Rng`, `Localization`, `Narrator` | Active enemy snapshot, boss phase state, skill cooldown table, prepare/windup state. |
| `DungeonManager.ts` | Graph position, movement validation, graph mutation. | — | `MapGenerator` types | Current node + visited-node set. |
| `Emitter.ts` | Tiny typed pub/sub primitive (`on / off / emit / clear`). | — | — | Listener list per `Emitter` instance. |
| `Light.ts` | Light-economy helpers (decay interval per `runLength`, low/high thresholds). | — | — | Pure functions, no state. |
| `Localization.ts` + `LocalizedText.ts` + `locale/en.ts` / `locale/ru.ts` | RU/EN string lookup; canonical typing comes from `en.ts` so missing RU keys break the build. | `change` (language flip) | `localStorage` | Active language flag. |
| `MapGenerator.ts` | Procedural room graph: layer build, boss placement, seal coverage, weighted room rolls. | — | `Rng`, `MapConfig`, room-pool config | Owned graph (`MapNode[]`), seal counts, available-room set. |
| `MapLayout.ts` | Serpentine map coordinates + edge routing. | — | `Layout` constants | Pure layout math. |
| `MetaProgressionManager.ts` | Persistent skill-points bank + 4 upgrades + content-unlock state (`localStorage["rpglikedurkest-meta-v4"]`). | — | `localStorage`, `UPGRADE_DEFINITIONS` | Persisted profile (skill points, upgrade levels, unlocks). `bankSkillPoints(...)` is **escape-only**; `resetProgress()` is called on death. |
| `MusicManager.ts` | Music playback + cross-fade. Shares the persistent mute flag with `SoundManager`. | — | `Phaser.Sound`, `localStorage` | Active track / queued track. |
| `NarrativeManager.ts` | Authored room/run text + run memory (recurring lines). | — | `Localization`, `Rng` | Run-memory map. |
| `Narrator.ts` | Short on-the-beat lines emitted from combat/exploration. | — | `Localization` | Per-key cooldown to avoid spam. |
| `NpcManager.ts` + `Npcs.ts` | NPC altar offer rolling and post-pick state. | — | `Rng`, `Npcs` catalog | Active offer per NPC, "already picked" flags. |
| `PlayerManager.ts` | Player stats (HP, atk, def, light, gold), level/XP, status, relics, skills. | `hpChange`, `statsChange`, `resourcesChange`, `levelUp`, `death`, `relicsChange` | `MetaProgressionManager.getBonuses().player`, `StatusEffects` | All mutable player state. **No revives** (removed PR #110). |
| `Relics.ts` | Catalog + `rollRelicFor(...)` / `rollRelicForEnemy(...)`. | — | `Rng` | Relic definitions. |
| `Skills.ts` | Skill catalog + starter loadout. | — | — | Skill definitions. |
| `Rng.ts` | `Rng` interface, seeded `Mulberry32`, `defaultRng = Math.random`, helpers (`randomInt`, `chance`, `pick`). | — | — | Per-instance seed state (Mulberry32 only). |
| `RunTracker.ts` | Per-run stats (peak depth, level reached, kills, …) for end screens. | — | — | Run-scoped counters. |
| `SoundManager.ts` | SFX bank + ambient loop, persisted mute flag. | — | `Phaser.Sound`, `localStorage` | SFX cache, ambient track. |
| `StatusEffects.ts` | Bleed / guard / mark / focus / stun / weaken state, tick logic, `statusSummary` helper. | — | — | Pure functions over a passed-in status bag. |

## UI (`src/ui/`)

| File | Role | Emits | Depends on | Owns |
| --- | --- | --- | --- | --- |
| `EndScreens.ts` | Barrel re-export → `end/DeathScreen`, `end/VictoryScreen`. | — | — | — |
| `end/DeathScreen.ts` | Death modal. Reused for escape: 4-card meta-shop renders **only** when `runState.escaped === true`. | — | `EndScreenContext`, `bankSkillPointsOnce`, `MetaProgressionManager` | Modal Phaser widgets. |
| `end/VictoryScreen.ts` | Final-boss artifact-collected modal. | — | `EndScreenContext`, `bankSkillPointsOnce` | Victory modal widgets. |
| `end/shared.ts` | `bankSkillPointsOnce` (idempotent — banks **only** when escaped), `hideLiveContainers`. | — | `MetaProgressionManager` | — (utility) |
| `end/types.ts` | `EndScreenContext` + `RunEndState` type definitions. | — | — | — |
| `EventLog.ts` | Text log component used by both rooms and combat. | — | `Localization` | Log line buffer. |
| `Layout.ts` | `GAME_WIDTH/HEIGHT/CENTER_X/CENTER_Y`, `Depths.*` Z-tiers, `HudLayout.topHud.*` / `HudLayout.chrome.*` HUD coordinates. | — | — | Compile-time constants. **Never hardcode 800/600 or depth literals — import from here.** |
| `HudCell.ts` / `HudFrame.ts` / `HudIcons.ts` / `HudTheme.ts` | Bottom-bar resource cells, top/bottom carved frame, icon spritesheet bindings, palette. | — | `Phaser.GameObjects`, `AssetGuard` | HUD widget factories. |
| `MapView.ts` | Map node visuals + tweens + pointer interaction. | — | `MapLayout`, `RoomVisuals`, `Phaser` | Node sprites, edge graphics, hover/pulse tweens. |
| `RoomButtons.ts` | Room action button factory + `RoomButtonAction` / `RoomButtonVariant` types. | — | `Phaser.GameObjects` | Button widget references. |
| `RoomVisuals.ts` | Pure room → `{ color, icon, sprite, name }` lookup. | — | — | Static lookup table. |
| `SceneChrome.ts` | Bottom-left sound/language toggles + unlock banner. | — | `SoundManager`, `Localization` | Chrome widget refs. |
| `Torchlight.ts` / `StoneBackdrop.ts` / `VolumePanel.ts` | Atmospheric overlays + volume slider panel. | — | `Phaser` | Decorative widgets. |
| `PixelSprite.ts` | Procedural pixel-art fallback when a real spritesheet hasn't loaded. | — | `Phaser` | Generated `Phaser.Textures.CanvasTexture` instances. |
| `AssetGuard.ts` | `hasTexture(scene, key)` + `withTexture(scene, key, withImage, withFallback)`. **Always go through this** so the "real spritesheet vs procedural fallback" branching stays in one place. | — | `Phaser.Textures` | — (utility) |
| `TextHelpers.ts` | `compactText` and other small text utilities. | — | — | — |
| `VFX.ts` | Vignette, scanlines, hit-flash, float-text helpers. Default sizes use `Layout`. | — | `Phaser`, `Layout` | Effect widget refs. |

## Data (`src/data/`)

| File | Role |
| --- | --- |
| `GameConfig.ts` | All numeric balance constants — `EXPEDITION_CONFIG`, `ROOM_CONFIG`, `XP_CONFIG.xpPerLevel`, per-enemy XP rewards, light economy. |
| `Enemies.ts` | Non-boss enemy definitions (HP, attack, intent profiles). |
| `Bosses.ts` | Boss phase definitions, prepare/windup actions. |
| `EnemyTextConfig.ts` | Enemy intent / attack labels keyed by enemy id. |

See `docs/CONFIG_GUIDE.md` for what to edit when balance numbers change.

## Tests (`tests/`)

Vitest, run with `npm test`. Pure-logic systems only — `Phaser` must not be
imported in unit tests. The two existing patterns:

- `tests/PlayerManager.test.ts` — passes a hand-rolled scene/log shim into
  `PlayerManager` to avoid pulling Phaser.
- `tests/MetaProgression.test.ts` — defines an in-file `MemoryStorage` shim
  on `globalThis.window.localStorage` before constructing
  `MetaProgressionManager`. Copy this pattern when testing anything that
  hits `localStorage`.
