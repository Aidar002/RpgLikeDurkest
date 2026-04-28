# RpgLikeDurkest

A compact Phaser 3 roguelike prototype with procedural map exploration, text-forward rooms, turn combat, meta progression, narrative memory, and RU/EN localization.

## Commands

```powershell
npm install
npm.cmd run dev -- --host 127.0.0.1
npm.cmd run build
```

The app is served at `http://127.0.0.1:5173/RpgLikeDurkest/` during development.

## Project Map

- `src/scenes/GameScene.ts`: Main game orchestration and Phaser object ownership.
- `src/systems/MapGenerator.ts`: Procedural room graph generation.
- `src/systems/MapLayout.ts`: Serpentine graph coordinates and edge paths.
- `src/systems/CombatManager.ts`: Turn combat and enemy intents.
- `src/systems/NarrativeManager.ts`: Room/run narrative text and memory.
- `src/systems/Localization.ts`: Russian and English UI/gameplay strings.
- `src/systems/MetaProgressionManager.ts`: Persistent upgrades and unlocks.
- `src/systems/PlayerManager.ts`: Player stats and resources.
- `src/ui/EventLog.ts`: On-screen event log.
- `src/ui/VFX.ts`: Small visual effects helpers.
- `src/data/`: Balance and enemy data.

## Notes For Contributors

`GameScene` is intentionally treated as the coordinator. Add new durable gameplay rules to `systems/`, reusable rendering helpers to `ui/`, and balance constants or catalogs to `data/`.

For new visible text, prefer `Localization` for UI/game text and `NarrativeManager` for authored atmosphere. Keep the project UTF-8 and run `npm.cmd run build` before handoff.
