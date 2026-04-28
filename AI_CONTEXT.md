# AI Context

RpgLikeDurkest is a small Phaser 3 / Vite / TypeScript roguelike. The player moves through a procedural room graph, resolves rooms through text-heavy choices and turn combat, then upgrades meta progression after death or victory.

## Run Commands

- Install deps: `npm install`
- Dev server on Windows: `npm.cmd run dev -- --host 127.0.0.1`
- Build check on Windows: `npm.cmd run build`

Use `npm.cmd` in PowerShell because `npm.ps1` can be blocked by local execution policy.

## Main Files

- `src/main.ts`: Phaser bootstrap and canvas configuration.
- `src/scenes/BootScene.ts`: Minimal boot scene.
- `src/scenes/GameScene.ts`: Main orchestration layer. It wires managers, owns Phaser objects, room flow, combat UI, map visuals, death/victory screens, and global HUD.
- `src/data/GameConfig.ts`: Balance constants.
- `src/data/Enemies.ts`: Enemy catalog and reward ranges.
- `src/systems/CombatManager.ts`: Turn combat, enemy intent profiles, combat rewards, and combat end payloads.
- `src/systems/DungeonManager.ts`: Current graph position, movement checks, and graph mutation.
- `src/systems/Localization.ts`: RU/EN strings and language persistence in local storage.
- `src/systems/MapGenerator.ts`: Room graph generation and available room type pool.
- `src/systems/MapLayout.ts`: Serpentine map coordinates, map centering, and edge routing.
- `src/systems/MetaProgressionManager.ts`: Persistent upgrades, content unlocks, and UI unlock state.
- `src/systems/NarrativeManager.ts`: Run memory, room intro/result text, death/victory narrative.
- `src/systems/PlayerManager.ts`: Player stats, resources, damage, healing, level up, revive state.
- `src/ui/EventLog.ts`: Text log component.
- `src/ui/VFX.ts`: Lightweight Phaser visual effects.

## Current Architecture

`GameScene` is still large, but it should mostly coordinate rather than own new domain logic. Put durable rules in `systems/`, reusable UI helpers in `ui/`, and static balance data in `data/`.

The graph layout is intentionally separated:

- `MapGenerator` decides what nodes and edges exist.
- `MapLayout` decides where nodes appear and how edges are routed.
- `GameScene` draws the returned coordinates with Phaser.

The narrative/language path is also separated:

- Add normal UI strings to `Localization`.
- Add authored run flavor to `NarrativeManager`.
- Avoid hardcoding new user-facing gameplay text in `GameScene` unless it is temporary debug text.

## Conventions For Future Agents

- Keep files UTF-8. Prefer ASCII in docs/code comments unless you are editing actual localized RU strings.
- Use `import type` for TypeScript-only imports. Vite/esbuild can fail if interfaces are imported as runtime values.
- Prefer small modules over expanding `GameScene` further.
- Build with `npm.cmd run build` before handing off.
- Preserve user changes. Do not reset or checkout files unless explicitly asked.

## Good Next Refactors

- Split room handlers out of `GameScene` into a `RoomFlow` or `RoomHandlers` system.
- Split combat HUD creation/refresh into a UI helper.
- Split death/victory/meta upgrade screens into focused view helpers.
- Consider splitting `Localization` data into smaller files if the string table grows much more.

## Known Tooling Notes

The in-app browser can inspect the local dev URL at `http://127.0.0.1:5173/RpgLikeDurkest/`. Browser screenshot capture may time out in this environment; use console logs, visible browser checks, and `npm.cmd run build` as fallbacks.
