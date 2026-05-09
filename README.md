# RpgLikeDurkest

A compact Phaser 3 roguelike prototype: procedural map exploration, text-forward rooms, turn combat, meta progression, and RU/EN localization.

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
│   ├── GameScene.ts        # Coordinator: HUD, container layering, keyboard, manager wiring, restart-confirm modal
│   ├── RoomFlow.ts         # RoomFlowController: every room handler (treasure / trap / rest / shrine / NPC / merchant / empty)
│   └── CombatHud.ts        # CombatHudController: combat UI, intel, action buttons, hit flash, victory transition
├── systems/
│   ├── CombatManager.ts    # Turn combat + enemy intents (Emitter-based events, seeded Rng)
│   ├── DungeonManager.ts   # Graph position, movement, mutation
│   ├── Emitter.ts          # Typed on/off/emit pub/sub (snapshots listeners, isolates errors)
│   ├── Localization.ts     # RU + EN string lookup; locale/en.ts is canonical
│   ├── locale/             # locale/en.ts + locale/ru.ts (semantic LocaleKey)
│   ├── LocalizedText.ts    # Phaser text helper that re-renders on language change
│   ├── MapGenerator.ts     # Procedural room graph (seeded Rng)
│   ├── MapLayout.ts        # Serpentine graph coordinates, edge paths
│   ├── MetaProgressionManager.ts  # Skill-points bank + 4 upgrades (v4 schema, escape-only banking, death = full wipe)
│   ├── MusicManager.ts     # Music + cross-fade (shares mute flag with SoundManager)
│   ├── Narrator.ts         # Short on-the-beat lines
│   ├── NpcManager.ts / Npcs.ts  # NPC altar offers + catalog
│   ├── PlayerManager.ts    # Player stats and resources (Emitter-based events)
│   ├── Relics.ts / Skills.ts    # Catalogs
│   ├── Rng.ts              # Mulberry32 seeded RNG + defaultRng = Math.random
│   ├── RunTracker.ts       # Per-run stats for end screens
│   ├── SoundManager.ts     # SFX bank + ambient loop, persisted mute flag
│   └── StatusEffects.ts    # Bleed/guard/mark/focus/stun/weaken
├── ui/
│   ├── EndScreens.ts       # Barrel re-export → end/DeathScreen + end/VictoryScreen
│   ├── end/
│   │   ├── DeathScreen.ts  # Death modal; reused for escape (4-card meta-shop only when escaped)
│   │   ├── VictoryScreen.ts# Final boss artifact-collected modal
│   │   ├── shared.ts       # bankSkillPointsOnce (escape-only, idempotent), hideLiveContainers
│   │   └── types.ts        # EndScreenContext + RunEndState
│   ├── EventLog.ts         # On-screen event log
│   ├── Layout.ts           # GAME_WIDTH / GAME_HEIGHT, Depths.* tiers, HudLayout coordinates
│   ├── HudCell.ts / HudFrame.ts / HudIcons.ts / HudTheme.ts  # HUD bar, cells, icons, palette
│   ├── MapView.ts          # Map node visuals + interactions
│   ├── RoomButtons.ts      # Room action button factory
│   ├── RoomVisuals.ts      # Room → color/icon/sprite/name lookup
│   ├── SceneChrome.ts      # Bottom-left sound/language toggles + unlock banner
│   ├── Torchlight.ts / StoneBackdrop.ts / VolumePanel.ts  # Atmosphere
│   ├── PixelSprite.ts      # Procedural pixel-art fallback sprites
│   ├── AssetGuard.ts       # hasTexture / withTexture helpers (real spritesheet vs fallback)
│   ├── TextHelpers.ts
│   └── VFX.ts
└── data/                   # GameConfig.ts, Enemies.ts, Bosses.ts, EnemyTextConfig.ts (see docs/CONFIG_GUIDE.md)
```

For a one-page architectural map (file → role → emits / depends on / owns), see `docs/ARCH_MAP.md`. For the full Emitter producer→payload→consumer table, see `docs/EVENTS.md`. For walkthroughs of common edits ("add a new room / enemy / boss / skill / relic / NPC / locale string / HUD cell / Emitter channel / unlock / button / status effect / meta upgrade"), see `docs/RECIPES.md`.

## Notes For Contributors

`GameScene` is the coordinator — it wires managers to controllers and renders the top HUD, but new gameplay rules belong in `systems/`, new room behaviour belongs in `RoomFlow.ts`, new combat UI belongs in `CombatHud.ts`, and reusable rendering helpers belong in `ui/`. Balance constants and catalogs live in `data/`.

For new visible text:

- UI / gameplay strings → add a **semantic** `LocaleKey` to `src/systems/locale/en.ts` (and the matching `ru.ts` translation). `en.ts` is canonical, so a missing `ru.ts` translation will fail typecheck. Do not introduce new mechanical prefixes like `cm_001`.
- Authored atmosphere → `Narrator.ts`.

For new manager-to-scene events, expose an `Emitter<T>` field rather than a mutable `onXxx` callback. Subscribers register with `emitter.on(payload => …)` and unsubscribe with the returned disposer.

For new canvas / depth / HUD coordinates, import constants from `src/ui/Layout.ts`.

For pure-logic systems (RNG, status effects, map gen, combat formulas, meta progression), add Vitest coverage in `tests/`. CI runs `npm ci → lint → test → build` on every PR.

Keep the project UTF-8 (no BOM) and run `npm run lint && npm test && npm run build` before handoff.
