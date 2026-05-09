# RpgLikeDurkest

Compact Phaser 3 + TypeScript + Vite roguelike: procedural map exploration, text-forward rooms, turn combat, meta progression, and RU/EN localization. Pure client app — no backend, no `.env`.

## Run

```bash
npm install
npm run dev -- --host 127.0.0.1
```

Dev server: `http://127.0.0.1:5173/RpgLikeDurkest/`. The base path comes from `VITE_BASE` (default `/RpgLikeDurkest/`), so a fork can override it without patching `vite.config.ts`.

## Verify before pushing

```bash
npm run format     # prettier --check
npm run lint       # eslint flat config
npm test           # vitest run
npm run build      # tsc + vite build
```

`npm run typecheck` runs only `tsc --noEmit` if you want a fast type check without bundling.

CI runs the same four on every PR; PRs are not merged unless CI is green. A `husky` pre-commit hook auto-formats and lints staged files so format/lint failures rarely reach CI; tests and build are not run in the hook — keep doing the full pre-push pass yourself.

Node `>=20` is required (`package.json#engines`). PowerShell users: invoke `npm.cmd` instead of `npm`.

## Project layout

```
src/
├── scenes/             Phaser scenes (GameScene coordinator, BootScene, CombatHud, RoomFlow dispatcher)
│   └── controllers/    Per-domain controllers extracted from GameScene (HUD, Map, Room, Overlay)
├── systems/            Headless game-state managers (no Phaser at module top)
│   ├── rooms/          Per-room-type handlers (Treasure, Trap, Rest, Shrine, Merchant, Empty, Encounter)
│   └── locale/         Per-language string tables (en.ts canonical, ru.ts type-checked against it)
├── ui/                 Pure rendering helpers + Layout constants
│   └── end/            Death / victory end-screen overlays
├── data/               Numeric balance + enemy / boss / altar tables
└── main.ts             Phaser game bootstrap

tests/                  Vitest pure-logic tests (no `import phaser`)
public/                 Static assets (sprites, audio)
```

## Where to put things

| What you want to add      | Where                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| New gameplay rule         | `src/systems/`                                                                                                         |
| New room type / behaviour | new handler in `src/systems/rooms/<Name>.ts` + `case` in `src/scenes/RoomFlow.ts` + visuals in `src/ui/RoomVisuals.ts` |
| New combat UI             | `src/scenes/CombatHud.ts` (combat lifecycle in `src/scenes/controllers/` only if it's not combat-specific)             |
| New HUD widget            | `src/scenes/controllers/GameHudController.ts`                                                                          |
| Numeric balance change    | `src/data/GameConfig.ts`                                                                                               |
| Enemy / boss table change | `src/data/Enemies.ts` / `Bosses.ts` / `EnemyTextConfig.ts`                                                             |
| New visible string        | `src/systems/locale/en.ts` **and** `ru.ts` (both required)                                                             |
| HUD coordinate / Z-tier   | `src/ui/Layout.ts`                                                                                                     |
| Manager → scene event     | `Emitter<T>` field (never a mutable `onXxx` callback)                                                                  |
| Pure-logic test           | `tests/` (Vitest, no `import phaser`)                                                                                  |

## More documentation

- **AI agents working on this repo:** read `.agents/skills/rpg-like-durkest/SKILL.md`. It is the single source of truth for setup, conventions, full module reference, the Emitter catalog, and 13 copy-paste recipes ("add a new room / enemy / boss / skill / relic / NPC / locale string / HUD cell / Emitter channel / unlock / button / status effect / meta upgrade"). The skill also explains **when you must update it** — keep it in sync with structural changes.
- **Contributors:** see [`CONTRIBUTING.md`](./CONTRIBUTING.md).
- **Adding sprite art** — `docs/ART_GUIDE.md`.
- **Writing room / combat / death text** — `docs/NARRATIVE_DIRECTION.md`.
