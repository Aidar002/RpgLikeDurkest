# Contributing

Thanks for working on RpgLikeDurkest. The full developer / AI-agent
reference lives in
[`.agents/skills/rpg-like-durkest/SKILL.md`](.agents/skills/rpg-like-durkest/SKILL.md):
setup, conventions, full module map, the Emitter catalog, and 13
copy-paste recipes for the most common edits. Read it before you
start a non-trivial change.

## Quick start

```bash
npm install
npm run dev -- --host 127.0.0.1
```

Dev server: `http://127.0.0.1:5173/RpgLikeDurkest/`.
Node `>=20` is required (see `package.json#engines`).

## Verify before pushing

```bash
npm run format     # prettier --check
npm run lint       # eslint flat config
npm test           # vitest run
npm run build      # tsc + vite build
```

`npm run typecheck` runs only `tsc --noEmit` if you want a fast
type check without bundling.

CI runs the same four steps on every PR; PRs are not merged unless
CI is green. A `husky` pre-commit hook auto-formats and lints
staged files via `lint-staged`, so format/lint failures rarely
reach CI.

## Layer rules (enforced by tests + reviews)

```
src/data/       pure constants — no imports from systems/ui/scenes
src/systems/    headless managers — no `import phaser` at module top
src/ui/         pure rendering helpers + Layout constants
src/scenes/     the only layer allowed to wire systems + ui + Phaser
```

If you find yourself importing Phaser from `systems/` or game state
from `ui/`, stop and re-read the SKILL — the boundary is part of why
unit tests can run without jsdom mocking the engine.

## Conventions worth knowing

- TypeScript runs in `strict` mode with `noUnusedLocals` and
  `noUnusedParameters`. No `any`, no `// @ts-ignore`. Use
  `import type` for type-only imports.
- All visible strings live in `src/systems/locale/en.ts` (canonical)
  - `ru.ts` (type-checked against `en.ts`). Adding only one of the
    two will fail the build.
- Manager → scene communication goes through `Emitter<T>` channels
  (see `src/systems/Emitter.ts`). Never use a mutable `onXxx`
  callback property — multiple subscribers must be possible.
- Random rolls go through `defaultRng` (or a passed-in seeded
  `Rng`). Never reintroduce `Math.random()` in gameplay paths.
- Phaser is pinned to **3.x**. Do not bump to 4.x without an
  explicit go-ahead — see the "Phaser version policy" section of
  the SKILL.

## Keep the SKILL up to date

The SKILL is the single source of truth for AI agents. **Update it
in the same PR** whenever you:

- Add / remove / rename a module under `src/`.
- Add / remove / rename an `Emitter<T>` channel (or change its
  payload).
- Change the procedure for any of the 13 recipes.
- Change `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`,
  any `package.json` script, or the CI workflow.
- Significantly grow / shrink a major module cited in the
  "Common pitfalls" section.

A stale SKILL sends the next agent in the wrong direction and
wastes their tokens. The SKILL itself has a "Keeping this skill up
to date" section at the bottom that spells this out.
