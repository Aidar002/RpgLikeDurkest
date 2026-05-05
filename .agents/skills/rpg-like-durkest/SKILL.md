---
name: rpg-like-durkest
description: Setup, lint/test/build commands, and architectural conventions for the RpgLikeDurkest Phaser-3 roguelike. Use whenever you work on this repo.
---

# RpgLikeDurkest

Browser roguelike built on Phaser 3.90 + TypeScript + Vite. Pure client app
(no backend), shipped as a static bundle.

## Setup

```bash
npm install
```

There is no `.env` and no external secrets needed. All assets ship in
`public/assets/`.

## Daily commands

| What                     | Command                |
| ------------------------ | ---------------------- |
| Dev server (HMR)         | `npm run dev`          |
| Type-check + bundle      | `npm run build`        |
| Lint (eslint 9 flat)     | `npm run lint`         |
| Unit tests (vitest)      | `npm test`             |
| Tests in watch mode      | `npm run test:watch`   |
| Prettier check           | `npm run format`       |
| Prettier auto-fix        | `npm run format:write` |

Before opening a PR, all of `lint`, `test`, `build` must pass. CI runs all
three in parallel on every PR; PRs are not merged unless CI is green.

## TypeScript settings

`tsconfig.json` runs in `strict` mode with `noUnusedLocals` and
`noUnusedParameters` enabled. Don't introduce `any`, `getattr`-style escape
hatches, or `// @ts-ignore`; instead, narrow the type properly. ESLint
flat-config rules also forbid unused vars.

## Architecture overview

Source lives under `src/`:

- `src/main.ts` — Phaser game bootstrap (canvas size, scenes registry).
- `src/scenes/` — `BootScene` (asset preload), `MenuScene`, `GameScene`
  (orchestrator), plus combat/roomflow controllers (`CombatHud`,
  `RoomFlow`).
- `src/systems/` — game-state managers wired to `GameScene` via the
  typed pub/sub `Emitter`:
  - `PlayerManager` (HP, level, revives, light)
  - `DungeonManager` (current floor + node graph)
  - `CombatManager`, `StressManager`, `NarrativeManager`,
    `MapGenerator`, `RunTracker`, `MetaProgressionManager`,
    `MusicManager`, `SoundManager`, `Localization`, `EventLog`,
    `Rng`, `NpcManager`.
- `src/ui/` — pure rendering helpers (no game-state coupling):
  - `Layout.ts` — `GAME_WIDTH/HEIGHT`, `TOP_BAR_H`, `BOTTOM_BAR_H`,
    depth tiers, and `HudLayout` (per-section stat coordinates). Add
    new HUD coordinates here, NOT inline in `GameScene.ts`.
  - `HudFrame.ts` — top/bottom carved bars + free-floating
    `drawCarvedPanel`.
  - `HudCell.ts`, `HudIcons.ts`, `HudTheme.ts` — bottom-bar resource
    cells + spritesheet icons.
  - `AssetGuard.ts` — `hasTexture(scene, key)` /
    `withTexture(scene, key, withImage, withFallback)`. Use these
    instead of inline `scene.textures.exists(...)` so the
    "real spritesheet vs procedural fallback" branching stays in one
    place.
  - `EndScreens.ts`, `SceneChrome.ts`, `VFX.ts`, `RoomVisuals.ts`,
    `PixelSprite.ts`, `VolumePanel.ts`.

Tests live under `tests/` and target pure-logic systems (`Rng`,
`StressManager`, `MapGenerator`, `MetaProgression`, etc.). They run in
node without a Phaser context — keep system files headless-friendly
(no `import phaser` at module top in `src/systems/*`).

## Coordinate conventions

- Canvas: 1024×768.
- Top HUD bar: y=0..96.
- Bottom HUD bar: bottom edge sits at `GAME_HEIGHT − HUD_BOTTOM_OFFSET`,
  height `BOTTOM_BAR_H = 140`.
- Anything anchored to the bottom of the canvas must compute Y from
  `GAME_HEIGHT − BOTTOM_BAR_H − HUD_BOTTOM_OFFSET`, not a hard-coded
  pixel — see `RoomButtons` in `GameScene.ts` and PR #54 for the bug
  this convention prevents.
- Section-specific HUD coordinates live in `HudLayout.topHud.*` /
  `HudLayout.chrome.*` (see `src/ui/Layout.ts`).

## Localization

`src/systems/Localization.ts` wires the player-selectable RU / EN
language. The string tables live alongside it (or in `src/systems/locale/`
once they've been split out). `loc.t('key')` returns the active-language
string; passing `loc` into UI helpers keeps them language-agnostic.

## Common pitfalls

- Phaser's `nineslice` requires the source texture to actually exist —
  always go through `AssetGuard.withTexture(...)` so the procedural
  fallback runs in tests / before BootScene completes.
- `setStrokeStyle` on `Rectangle` resets the stroke; set it once after
  every `setStrokeStyle` change inside hover handlers (see existing
  `pointerover`/`pointerout` pairs).
- `MusicManager` uses `HTMLAudioElement` whose volume is capped at 1.0;
  don't request gain higher than 1.0 without switching to Web Audio.
- When changing animation behavior on map-node visuals, remember the
  fallback (PNG missing) path uses `alpha` tweens on `rect`. Both
  branches must call `tweens.killTweensOf(visual.rect)` before
  re-tweening.
