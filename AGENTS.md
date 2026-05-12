# AGENTS

AI-agent onboarding for this repo. Read these in order:

1. **[`.agents/skills/rpg-like-durkest/SKILL.md`](.agents/skills/rpg-like-durkest/SKILL.md)** — single source of truth.
   Per-file module map, the `Emitter<T>` catalog with payloads, 13 copy-paste recipes
   ("add a new room / enemy / boss / skill / relic / NPC / locale string / HUD cell / Emitter channel / content unlock / room-button variant / status effect / meta upgrade"),
   common pitfalls, coordinate / Z-tier / localization conventions.
2. **[`CONTRIBUTING.md`](./CONTRIBUTING.md)** — layer boundaries, TypeScript rules, when to update the SKILL.
3. **[`README.md`](./README.md)** — high-level project layout + "Where to put things" table.

## Hard rules (will fail CI or break determinism if ignored)

- Run all four before pushing: `npm run format && npm run lint && npm test && npm run build` (Node `>=20`).
- New user-visible string → add to **both** `src/systems/locale/en.ts` and `src/systems/locale/ru.ts`. `tests/Locale.consistency.test.ts` enforces parity.
- Random rolls in gameplay paths → `defaultRng` or an injected seeded `Rng` (`src/systems/Rng.ts`). Never `Math.random()` in `src/systems/` or anything that affects a run.
- Manager → scene communication → `Emitter<T>` channels (`src/systems/Emitter.ts`). Never mutable `onXxx` callbacks.
- Layer order: `data → systems → ui → scenes`. `systems/` must not `import phaser` at module top. `data/` must not import from `systems/` / `ui/` / `scenes/` (`type`-only is OK if unavoidable).
- Phaser is pinned to **3.x**; do not bump to 4.x without explicit approval.

## When to update the SKILL

In the **same PR** as the code change, whenever you:

- add / remove / rename a module under `src/`,
- add / remove / rename an `Emitter<T>` channel or change its payload,
- change the procedure for any of the 13 recipes,
- change `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `package.json` scripts, or `.github/workflows/`.

A stale SKILL sends the next agent in the wrong direction and wastes their tokens.
