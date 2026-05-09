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
npm run lint
npm test
npm run build
```

CI runs all three on every PR; PRs are not merged unless CI is green.

PowerShell users: invoke `npm.cmd` instead of `npm`.

## Project layout

```
src/
├── scenes/      Phaser scenes + per-room / per-combat controllers
├── systems/     Headless game-state managers (no Phaser at module top)
├── ui/          Pure rendering helpers + Layout constants
├── data/        Numeric balance + enemy / boss / altar tables
└── main.ts      Phaser game bootstrap

tests/           Vitest pure-logic tests
public/          Static assets (sprites, audio)
```

## Where to put things

| What you want to add        | Where                                                         |
| --------------------------- | ------------------------------------------------------------- |
| New gameplay rule           | `src/systems/`                                                |
| New room behaviour          | `src/scenes/RoomFlow.ts`                                      |
| New combat UI               | `src/scenes/CombatHud.ts`                                     |
| Numeric balance change      | `src/data/GameConfig.ts`                                      |
| Enemy / boss table change   | `src/data/Enemies.ts` / `Bosses.ts` / `EnemyTextConfig.ts`    |
| New visible string          | `src/systems/locale/en.ts` **and** `ru.ts` (both required)    |
| HUD coordinate / Z-tier     | `src/ui/Layout.ts`                                            |
| Manager → scene event       | `Emitter<T>` field (never a mutable `onXxx` callback)         |
| Pure-logic test             | `tests/` (Vitest, no `import phaser`)                         |

## More documentation

- **AI agents working on this repo:** read `.agents/skills/rpg-like-durkest/SKILL.md`. It is the single source of truth for setup, conventions, full module reference, the Emitter catalog, and 13 copy-paste recipes ("add a new room / enemy / boss / skill / relic / NPC / locale string / HUD cell / Emitter channel / unlock / button / status effect / meta upgrade").
- **Adding sprite art** — `docs/ART_GUIDE.md`.
- **Writing room / combat / death text** — `docs/NARRATIVE_DIRECTION.md`.
