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

Compact map of `src/` — one line per module so this section stays under
~10 KB. For Emitter channel payloads see the **Emitter catalog** below;
for full collaborator / owned-state lists open the file itself (each
non-trivial module has a header comment).

### Scenes (`src/scenes/`)

| File                                   | Role                                                                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BootScene.ts`                         | Splash + asset preload + title screen (animated door, flanking torches, Start button). Silences music on entry, plays `startTorchAmbient`, stops it before fade to `GameScene`. Hosts shared loc / sfx / music.        |
| `GameScene.ts`                         | Coordinator. Wires managers + controllers, owns Phaser containers (`mapContainer`, `roomContainer`, `uiContainer`), keyboard, restart-confirm modal, escape modal, end-screen routing. Consumes Emitters; never emits. |
| `RoomFlow.ts` (`RoomFlowController`)   | Per-room handlers (treasure / trap / rest / shrine / NPC / merchant / empty) + depth whispers at 3, 10, 15, 20, final-1, final.                                                                                        |
| `CombatHud.ts` (`CombatHudController`) | Combat UI: action buttons, intel panel, enemy portrait, hit flash, victory transition. Subscribes to `CombatManager` Emitters; large `scene.*` surface (~135 refs) — long-term candidate for a typed scene port.       |

### Scene controllers (`src/scenes/controllers/`)

| File                       | Role                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GameHudController.ts`     | Owns the global HUD: top + bottom bars, escape/restart buttons, restart-confirm modal, torchlight overlay, refresh + player-event wiring, relic slot row. **~1100 lines** — biggest controller. |
| `GameMapController.ts`     | Owns the map view + node clicks + content-unlock milestones triggered on first reach of a depth.                                                                                                |
| `GameOverlayController.ts` | Builds the `EndScreenContext` shared by victory/death screens; fires either screen + runs `safeRestart` teardown.                                                                               |
| `GameRoomController.ts`    | Room-panel container setup + room-fade transitions; thin shim between `RoomFlow` and the room Phaser container.                                                                                 |

### Systems (`src/systems/`)

| File                                                                     | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CombatManager.ts`                                                       | Turn combat: enemy intents, status effects, rewards, boss phase machine. Takes optional seeded `Rng`. Emits `enemyUpdate`, `playerStatusChange`, `enemyStatusChange`, `playerHit`, `combatEnd`. **~1 360 lines** — orchestration only; player-side handlers, relic on-attack hooks, and Mime/Mammon helpers live in `combat/` sub-modules. The file header carries a `[FIX-N]` dictionary explaining every `[FIX-1] / [FIX-5] / [FIX-10] / [FIX-13]` tag scattered through the body.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `combat/PlayerActions.ts`                                                | Player-side action handlers extracted from CombatManager (`handlePlayerAttack`, `handlePlayerDefend`, `handlePlayerSkill`, `handlePlayerPotion`, `applyPlayerDamage`, `rollPlayerAttack`). Pure functions taking a `PlayerActionsDeps` + `PlayerActionsState` bundle. ~390 lines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `combat/RelicHooks.ts`                                                   | Relic on-attack proc resolvers (`applyOnAttackRelics`, `tryHealOnAttack`, `tryVampireBlessingOnAttack`, `applyResolveOnAttack`). Pure. ~90 lines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `combat/MimeChaos.ts`                                                    | Mime "Chaos Lord's Laughter" + Mammon "Greed Lord" relic-theft helpers (`applyRandomMimeStatus`, `stealRandomRelic`). Pure. ~125 lines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `BossRuntime.ts`                                                         | Six pure helpers extracted from `CombatManager` for boss phase resolution (PR #125). No state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `EnemyTurn.ts`                                                           | Pure enemy-turn resolver: applies the active intent against the player + tracks status/passive side effects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EnemyPicker.ts`                                                         | `getEnemyForDepth(depth, rng)` and `getBossForDepth(depth, rng)` — pick a normal-tier enemy from `ENEMY_TIERS` or a boss from `BOSSES` (the RNG picks between equal-depth candidates). Lives here (not in `data/`) because both consume an `Rng` and the `data → systems → ui → scenes` rule forbids value-imports out of `systems/` from `data/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `DungeonManager.ts`                                                      | Graph position, movement validation, graph mutation. Owns current node + visited set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Emitter.ts`                                                             | Typed pub/sub primitive (`on / off / emit / clear`). Snapshots listeners during `emit`, isolates exceptions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Localization.ts` + `LocalizedText.ts` + `locale/en.ts` + `locale/ru.ts` | RU/EN string lookup. `en.ts` is canonical (`Record<LocaleKey, string>` so missing RU keys break the build). Has a single mutable `change` callback (predates Emitter); migrate if a second consumer appears.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `MapGenerator.ts`                                                        | Procedural room graph: layer build, boss placement, weighted room rolls. Takes optional seeded `Rng`. Re-exports `MapTypes` for back-compat.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `map/validate.ts`                                                        | `validateMap` (post-build invariant report) + `formatMapDebug`. All pure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `MetaProgressionManager.ts`                                              | Persistent skill-points bank + 4 upgrades + content-unlock state. Storage key `localStorage["rpglikedurkest-meta-v4"]`. `bankSkillPoints(...)` is **escape-only** — never call after death.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `MusicManager.ts`                                                        | Music playback + cross-fade. Shares the persistent mute flag with `SoundManager`. Owns active / queued track.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Narrator.ts`                                                            | Short on-the-beat lines emitted from combat/exploration. Per-key cooldown. ⚠️ Currently calls `Math.random()` directly — should take `Rng` for determinism.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `NpcManager.ts` + `Npcs.ts`                                              | NPC altar offer rolling and post-pick state. Constructor takes an optional `Rng` (defaults to `defaultRng`) so `pickForRole` / `pickLowHpRecall` stay deterministic under a seeded run. `pickBossIntro` was removed — bosses no longer print an NPC flavor line on appearance or defeat.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `PlayerManager.ts`                                                       | Player stats (HP, atk, def, gold), level/XP, status, relics (capped at `MAX_RELICS`). Emits `hpChange`, `statsChange`, `resourcesChange`, `levelUp`, `defeat`, `relicsChange`, `relicOffer` (`'duplicate'` / `'full'`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Relics.ts`                                                              | Catalog + `rollRelicFor(...)` / `rollRelicForEnemy(...)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `RelicDrops.ts`                                                          | `maybeDropRelic` helper that wraps `rollRelicForEnemy` + adds to inventory; shared by elite/boss kills.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Skills.ts`                                                              | Skill catalog + `STARTER_LOADOUT`. Every catalog entry is currently in `STARTER_LOADOUT`; gating happens externally via `'skill_<id>'` unlocks on `MetaProgressionManager.UnlockId` + `getUnlockedExtraSkills()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Rng.ts`                                                                 | `Rng` interface, seeded `Mulberry32`, `defaultRng = Math.random`, helpers (`randomInt`, `chance`, `pick`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Lockpick.ts`                                                            | Headless mini-game logic for the locked-chest variant. Exports `LockpickGame` (3 spinning rings with stick alignment, `update(deltaMs)` + `attemptDescend()`), `pickLockpickDifficulty(depth, rng)` (depth-banded weights from `LOCKPICK_CONFIG.difficultyWeights`), and the `STICK_ANGLE_DEG` constant. Pure module — no Phaser import. The visual layer lives in `src/ui/LockpickOverlay.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `RunTracker.ts`                                                          | Per-run stats (peak depth, level, kills…) for end screens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `SoundManager.ts`                                                        | **Thin façade (~110 lines)** over six submodules under `src/systems/audio/`. Owns one instance each of `AudioCore` (singleton AudioContext + master gain + persisted mute/volume), `SamplePlayback` (preload + sampled UI / torch / door cues), `FootstepsLoop` (room-transition steps), `DungeonAmbient` (depth-aware drone), `TorchAmbient` (boot-screen crackle). `play(id: SoundId)` delegates to `audio/ProceduralSfx.ts`. Public API unchanged from the pre-split monolith — all 24 call-sites still use `SoundManager` as before. UI + torch SFX are sampled (`public/audio/ui_hover.ogg`, `ui_click.ogg`, `torch_ignite.mp3`, `torch_loop.mp3`, `door_in_dungeon2.mp3`, `show_name.ogg`, preloaded in `BootScene.create()` via `preloadUiSfx`); `buttonHover` / `roomHover` share `ui_hover.ogg`; `buttonClick` / `nodeSelect` share `ui_click.ogg`. `startTorchAmbient(fadeMs)` layers two loop sources at different offsets + playback rates when the sample is available, otherwise falls back to procedural noise+pops crackle. |
| `audio/AudioCore.ts`                                                     | Owns the singleton `AudioContext` + master gain + persisted `_muted` / `_volume`. `ensure()` lazily creates the context on first use; `toggleMute()` / `setVolume()` persist to `localStorage["dd_sound_muted"]` / `["dd_sound_volume"]`. Passed by reference to every other audio submodule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `audio/WebAudio.ts`                                                      | Pure helpers — `osc()`, `noise()`, `env()`, `sweep()`. Take `ctx` + `master` as explicit args. No state. Used by `ProceduralSfx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `audio/SamplePlayback.ts`                                                | `class SamplePlayback`. `preload()` (memoised), `play(key, gain)`, `playWithFade(key, gain, fadeMs)`, `getBuffer(key)`. Owns the `Map<SampleKey, AudioBuffer>` cache.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `audio/ProceduralSfx.ts`                                                 | `type SoundId` union (27 ids) + `playSfx(deps, id)` dispatch + all `playXxx` functions. **Adding a new SFX:** extend `SoundId`, write a `playXxx({ core, samples })` function, add a `case` to the dispatch switch. Do NOT add procedural methods to `SoundManager` itself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `audio/FootstepsLoop.ts`                                                 | `class FootstepsLoop` — `start(fadeInMs)` / `stop(fadeOutMs)`. Uses an `HTMLAudioElement` wrapped in a `MediaElementSource` so it shares the SFX bus. Owns a RAF-driven fade.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `audio/Ambient.ts`                                                       | `class DungeonAmbient` (`start(depth)` / `updateDepth(depth)` / `stop()`) for the in-game drone, and `class TorchAmbient` (`start(fadeMs)` / `stop(fadeMs)`) for the boot-screen crackle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `StatusEffects.ts`                                                       | `StatusState` shape (`bleed / poison / stun / attackBan / weaken / armorBreak / mark / guard / regen`), per-effect `applyXxx(s, ...)` setters, `tickTurn(s)` decay/damage, `statusSummary(s, lang)` HUD helper. Pure functions over a passed-in status bag. **Pair-coupled semantics (B11):** `applyPoison` / `applyWeaken` / `applyArmorBreak` treat the `(amount, turns)` pair as a single unit — strictly stronger replaces both fields, equal refreshes turns, strictly weaker is a no-op. `applyBleed` stacks intentionally (capped, default ceiling 8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `DevSeed.ts`                                                             | Dev-mode seed override (query string / localStorage) used to make runs reproducible during testing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Room handlers (`src/systems/rooms/`)

Per-room logic, mounted by `RoomFlowController`. Each handler builds
the room body, wires `RoomButtonAction[]`, and calls back into
managers. Empty/Trap/Rest/Treasure/Shrine/Merchant are self-contained;
`Encounter.ts` is shared NPC/dialog plumbing reused by Merchant + NPC
altars.

### UI (`src/ui/`)

| File                                                         | Role                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Layout.ts`                                                  | `GAME_WIDTH/HEIGHT/CENTER_*`, `Depths.*` Z-tiers, `HudLayout.*`, `RoomLayout.{logX,logWidth,panelX,panelWidth,panelCenterX}` 35/65 split. **Never hardcode 800/600 or `setDepth(99)`.**                                                                                                                                                                              |
| `HudCell.ts` / `HudFrame.ts` / `HudIcons.ts` / `HudTheme.ts` | Bottom-bar cells, top/bottom carved frame, icon spritesheet, palette. `HudTheme.ts` exports `HUD_FONT` (JetBrains Mono) + `BODY_FONT` (EB Garamond) — files in `public/fonts/`, `@font-face` in `src/style.css`, boot blocks on `document.fonts.ready`. **Never inline a fontFamily literal — import the constant.**                                                 |
| `MapView.ts`                                                 | Map node visuals + tweens + pointer interaction. **~930 lines.** Wired to `roomHover` SFX on reachable-node `pointerover`.                                                                                                                                                                                                                                           |
| `RelicSlots.ts`                                              | Inline 5-cell relic display in the bottom HUD bar with hover tooltips + rarity badge. Each cell is a `panel_small.png` nine-slice with rarity stroke; empty slots paint low-alpha. Owns `relicsChange` subscription.                                                                                                                                                 |
| `RelicSwapModal.ts`                                          | Modal triggered by `PlayerManager.relicOffer` when at `MAX_RELICS`; drop-one-or-skip flow. Calls back into `removeRelic` + `addRelic`.                                                                                                                                                                                                                               |
| `LockpickOverlay.ts`                                         | Modal mini-game opened by `handleTreasureRoom` for the locked-chest variant. Constructed once by `GameRoomController.build` and reached via `scene.showLockpickModal({ difficulty, onResolve })`. Owns its own headless `LockpickGame` (`src/systems/Lockpick.ts`); plays `lockpickClick` per ring and `lockpickBreak` on miss.                                      |
| `RoomButtons.ts`                                             | Room action button factory + `RoomButtonAction` (public) and file-private `RoomButtonVariant` style union.                                                                                                                                                                                                                                                           |
| `RoomVisuals.ts`                                             | Pure room → `{ color, icon, sprite, name }` lookup.                                                                                                                                                                                                                                                                                                                  |
| `SceneChrome.ts`                                             | Bottom-left sound/language toggles + unlock banner.                                                                                                                                                                                                                                                                                                                  |
| `Torchlight.ts` / `StoneBackdrop.ts` / `VolumePanel.ts`      | Atmospheric overlays + volume slider panel.                                                                                                                                                                                                                                                                                                                          |
| `BootTorch.ts`                                               | `createBootTorch(scene, x, y, opts)` — animated wall torch with ignition sequence + warm halo. Spritesheet `boot_torch`; falls back to placeholder + glow + sound when PNG missing.                                                                                                                                                                                  |
| `UiButton.ts`                                                | `drawUiButton` — six `btn_*` carved-stone variants as nine-slice + centered label, with procedural fallback when texture missing. Pass `sfx: SoundManager` in opts to auto-bind `buttonHover` (pointerover) + `buttonClick` (pointerdown); `autoSfx: false` opts out per-button.                                                                                     |
| `UiPanel.ts`                                                 | `drawPanel` / `drawCarvedPanel` — textured nine-slice helpers around `panel_small.png` + `hud_bottom_bar` with procedural fallbacks.                                                                                                                                                                                                                                 |
| `PixelSprite.ts`                                             | Procedural pixel-art fallback when a real spritesheet isn't loaded.                                                                                                                                                                                                                                                                                                  |
| `AssetGuard.ts`                                              | `hasTexture(scene, key)` + `withTexture(scene, key, withImage, withFallback)`. **Always go through this** so the texture-vs-fallback branching stays in one place.                                                                                                                                                                                                   |
| `TextHelpers.ts`                                             | `compactText` + small text utilities.                                                                                                                                                                                                                                                                                                                                |
| `EventLog.ts`                                                | Text log component used by both rooms and combat.                                                                                                                                                                                                                                                                                                                    |
| `RestartConfirmModal.ts`                                     | "Are you sure?" modal used by both top-bar restart and escape-room button.                                                                                                                                                                                                                                                                                           |
| `VFX.ts`                                                     | Vignette, scanlines, hit-flash, float-text helpers. Default sizes from `Layout`.                                                                                                                                                                                                                                                                                     |
| `LevelUpBanner.ts`                                           | `showLevelUpBanner(scene, prev, next, title, transition)` — centred celebration popup (carved panel + gold rim + halo + spark ring) for the `PlayerManager.levelUp` event. Renders at `Depths.NotificationBanner + 2/3`, animates in with `Back.out` scale-bounce, idles ~1.2 s, glides out and self-destroys (~1.8 s total). Purely cosmetic; does not block input. |
| `EndScreens.ts`                                              | Barrel re-export → `end/DeathScreen`, `end/VictoryScreen`.                                                                                                                                                                                                                                                                                                           |
| `end/DeathScreen.ts`                                         | Death modal. Reused for escape: 4-card meta-shop + discovery-progress rows + reset-confirm modal + run-log overlay all live in this one file. Renders only when `runState.escaped === true`. **~910 lines.**                                                                                                                                                         |
| `end/VictoryScreen.ts`                                       | Final-boss artifact-collected modal.                                                                                                                                                                                                                                                                                                                                 |
| `end/shared.ts`                                              | `bankSkillPointsOnce` (idempotent — banks **only** when escaped), `hideLiveContainers`.                                                                                                                                                                                                                                                                              |
| `end/types.ts`                                               | `EndScreenContext` + `RunEndState` type definitions.                                                                                                                                                                                                                                                                                                                 |

### Data (`src/data/`)

All numeric / catalog tables. Edit here when balance changes.

| File                 | What's inside                                                                                                                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GameConfig.ts`      | `PLAYER_CONFIG`, `LEVEL_UP_CONFIG`, `EXPEDITION_CONFIG`, `COMBAT_CONFIG`, `MAP_CONFIG`, `ROOM_CONFIG`, `ENEMY_TIERS`, `BOSSES`, `ALTAR_EFFECTS`, `XP_CONFIG`, `LOCKPICK_CONFIG` (ring speeds + gap width per difficulty, depth-band weights, lock chance, failure damage, descent ms).                                                      |
| `MapTypes.ts`        | `RoomType` (const-object enum), `BossKind`, `MapNode`, `POST_MAJOR_RECOVERY_POOL`. Re-exported by `MapGenerator` for back-compat.                                                                                                                                                                                                           |
| `Enemies.ts`         | `EXPECTED_BOSS_NAMES` (depth -> set of canonical boss names) and `assertBossMapping()` (validates `BOSSES` at module load). The actual `getBossForDepth(depth, rng)` lookup lives in `systems/EnemyPicker.ts` because it needs an `Rng` to pick between equal-depth boss candidates. Non-boss enemy pools live in `GameConfig.ENEMY_TIERS`. |
| `Bosses.ts`          | `BOSS_BLUEPRINT_BY_NAME` — phase script, `prepareActions`, `windupActions`.                                                                                                                                                                                                                                                                 |
| `EnemyTextConfig.ts` | Per-enemy display `name` + `description`, keyed by canonical English name.                                                                                                                                                                                                                                                                  |

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

| Channel           | Payload                       | Fires when                                                                                                                                              | Consumers                                                                                                                      |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `hpChange`        | `{ hp: number; max: number }` | HP changes (damage, heal, max-HP increase).                                                                                                             | `GameScene.refreshUI()` (HUD HP bar / number); tests.                                                                          |
| `death`           | `void`                        | HP reaches 0.                                                                                                                                           | `GameScene` death sequence: hide HUD, call `meta.resetProgress()`, zero `runSkillPointsPending`, fade out, show `DeathScreen`. |
| `levelUp`         | `{ level: number }`           | XP threshold passes (`xpPerLevel = 10`).                                                                                                                | `GameScene` (`runSkillPointsPending++`, level toast); tests.                                                                   |
| `statsChange`     | `void`                        | ATK / DEF / max-HP recomputed (relic equipped, level-up bonus, meta upgrade applied at run start).                                                      | `GameScene.refreshUI()` (ATK/DEF cells).                                                                                       |
| `resourcesChange` | `void`                        | Gold / potions / resolve / relic shards / seal count / kill counters change.                                                                            | `GameScene` (HUD resource cells); tests.                                                                                       |
| `relicsChange`    | `void`                        | Relic added or removed from the player.                                                                                                                 | `GameScene.refreshUI()`; `RelicSlots` repaint; tests.                                                                          |
| `relicGained`     | `{ id: RelicId }`             | `addRelic` actually appended a new relic (the `'added'` branch). Distinct from `relicsChange`, which also fires on `removeRelic` / aggregate recompute. | `GameHudController` plays a one-shot pickup VFX anchored to the new relic's HUD cell (`RelicSlots`).                           |
| `relicOffer`      | `{ id: RelicId }`             | `addRelic` was called while the inventory was already at `MAX_RELICS`; the relic was NOT added.                                                         | `GameHudController` opens the `RelicSwapModal` so the player can drop one of the equipped five or skip the candidate.          |

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
`getEnemyForDepth(depth, rng)` in `src/systems/EnemyPicker.ts`. Pass
`Mulberry32(seed)` into a fresh `CombatManager` for deterministic
tests.

### 3. Add a new boss (with phases)

1. **Boss definition** — `src/data/GameConfig.ts`
   - Append to `BOSSES` with `{ depth, def: EnemyDef }`. Multiple
     entries may share the same depth — `getBossForDepth` then picks
     one with the combat RNG. If the depth lands on a canonical
     milestone, add the new boss's canonical name to the array in
     `EXPECTED_BOSS_NAMES` (in `src/data/Enemies.ts`) so
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
     `color`).
   - If the skill should be available from run 1, append it to
     `STARTER_LOADOUT`. Otherwise leave it out of the starter array
     and add a matching `'skill_<id>'` literal to the `UnlockId`
     union in `MetaProgressionManager.ts`, then surface it via
     `getUnlockedExtraSkills()` so the run-start loadout picker
     finds it once unlocked.
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
   - Add an `NpcId` and an entry in `NPCS` with `role`, beats,
     optional `offer` template.
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
2. **Cell creation** — `src/scenes/controllers/GameHudController.build()`
   - Pick the right helper from `src/ui/HudCell.ts` and store the
     handle on a controller field:
     - `createHudInlineSlot(...)` — single-row `icon | label | value`
       (used by the ATK/DEF column in the top bar).
     - `createHudStackedSlot(...)` — centred icon stacked over an
       optional ALL-CAPS label and a value (used by the
       gold/potion/will and depth/kills/bosses trios in the top
       bar — three slots side by side, each `iconSize` 36 px,
       `valueFontSize` 18 px). Omit `label` to collapse to a
       two-row icon + value stack.
3. **Refresh** — `GameHudController.refresh()`
   - Set the cell's `value` text on every refresh. Both handles
     expose `setValue` and `setLabel` (`setLabel` on a stacked
     slot is a no-op when `label` was omitted).
4. **Visibility (optional)** — gate the cell on a meta unlock by
   reading `this.scene.meta.getUiUnlockState()` in `refresh()`.

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
   - Add the effect to the `StatusState` shape, mirror the default
     in `emptyStatusState()`, and add a decay/damage branch to
     `tickTurn()`.
   - Add a per-effect setter `applyXxx(s, ...)`. **Pair-coupled
     `(amount, turns)` effects (B11):** treat the pair as one unit —
     strictly stronger replaces both fields, equal-strength refreshes
     turns (`max(old, new)`), strictly weaker is a no-op. See
     `applyPoison` / `applyWeaken` / `applyArmorBreak` for the
     template. **Stacking** effects (e.g. `applyBleed`) instead sum
     stacks and take `max(turns)`; pick the model deliberately.
   - Add the new id to the `StatusId` union if you're going to refer
     to it as a typed string anywhere outside `StatusEffects.ts`.
2. **Apply** — most effects are applied from
   `src/systems/CombatManager.handlePlayerSkill` /
   `combat/PlayerActions.applyPlayerDamage` or from
   `EnemyTurn.resolveEnemyTurn`. Call the matching `applyXxx(s, ...)`
   setter directly — there is **no** umbrella `applyStatus()` helper.
3. **Display** — `statusSummary(status, language)` (and the
   `STATUS_LABELS` table for both `en` / `ru`) is the single source
   of truth for the player/enemy status pill text. Add a branch
   there and matching label rows in both languages.
4. **Test** — `tests/StatusEffects.test.ts`. Unit-test pure tick
   logic + reapply semantics (strictly stronger / equal / strictly
   weaker for pair-coupled effects) before wiring it into combat.

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
- `GameScene` is now a thin coordinator (~460 lines) that delegates
  to per-domain controllers (`GameHudController`, `GameMapController`,
  `GameOverlayController`, `GameRoomController`, `RoomFlowController`,
  `CombatHudController`) and to per-room handlers in
  `src/systems/rooms/*`. The largest single module is now
  `src/systems/CombatManager.ts` (~1 360 lines: orchestration +
  state-machine; `BossRuntime`, `EnemyTurn`, `combat/PlayerActions`,
  `combat/RelicHooks`, and `combat/MimeChaos` are factored out next
  to it). Second-largest is `src/ui/end/DeathScreen.ts` (~1 150 lines:
  `showDeathScreen` is the orchestrator; the seven `build*` helpers
  below it own backdrop, header, banner, upgrade grid, discovery
  progress, action buttons, log modal + reset modal, plus a
  `runEntryFadeIn` tween). `src/scenes/BootScene.ts` (~830 lines:
  `preload` is half the file; `create` is a thin orchestrator that
  calls `setupBootContext`, `buildTitleLayout`, `runIgnitionSequence`,
  `wireLanguageToggle`, `wireStartHandler`, `buildHudChrome`).
  `src/systems/MapGenerator.ts` (~790 lines: room pools + graph +
  boss-pressure pass; types live in `src/data/MapTypes.ts`,
  validation + per-path scoring helpers live in
  `src/systems/map/validate.ts`). Audio used to be a 1 239-line
  monolith — it now sits in `src/systems/audio/` (`AudioCore`,
  `WebAudio`, `SamplePlayback`, `ProceduralSfx`, `FootstepsLoop`,
  `Ambient`) behind a thin `SoundManager` façade. New gameplay
  rules belong in `systems/`, new room behaviour as a `case` in
  `RoomFlow.ts` plus a handler module under `systems/rooms/`, new
  combat UI in `CombatHud.ts`. Keep the coordinator thin.

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

## Removed: seal-economy prototype

The dungeon generator briefly carried a "seal economy" prototype
(PR-3, removed before player-side wiring landed). It was gated by
`FEATURES.seals = false` the whole time it lived in the repo and
was never reachable from gameplay. If a future task reinstates
the design, the original constraints were:

- `requiredSeals = clamp(round(runLength / 20), 1, 4)` — the
  budget the player needs to clear the final boss. So 25→1,
  35→2, 50→3, 75→4.
- `miniSealOdds = 0.5` — every major boss tagged
  `grantsSeal=true` with `sealType='major'`; each mini boss
  rolled `Rng.next() < 0.5` for `sealType='mini'`. Final-boss
  and non-boss nodes never granted a seal.
- A `MapNode` carried `grantsSeal: boolean` and
  `sealType: 'major' | 'mini' | null` set at node creation.
- Post-build pass `enforceSealCoverage` walked the DAG and
  promoted mini bosses (or, as a fallback, regular rooms past
  the pressure window) to grant a seal until every full
  START→final path traversed ≥ `requiredSeals` seal-granting
  nodes. The promotion was deterministic for a given seed
  (ties broken by id).
- `validateMap` reported `requiredSeals`,
  `sealOpportunityCount`, `sealsPerPath {min,max,avg}`, and
  `pathMeetsRequiredSeals` so the validator could refuse to
  ship a seed whose worst path was seal-starved.
- Gameplay side (player inventory, HUD readout, final-boss
  gate) was **never implemented** — the feature flag stayed
  off because shipping the generator half on its own would
  inflate mid-run boss counts for an invisible system.

To resurrect: re-introduce the fields on `MapNode`, restore
`enforceSealCoverage` + the three helpers
(`computeMinSealsPerPath`, `pickBestSealPromotion`,
`pickRegularNodeToPromoteToMini`) into `systems/map/validate.ts`
or a new `systems/map/seals.ts`, gate the generator pass on a
fresh flag, AND ship the combat-side pickup + gate at the same
time. Removing the flag-gated dead code (this PR) was the
cleanup; the design intent is preserved here.
