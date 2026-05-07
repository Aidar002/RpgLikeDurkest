# Handoff: trim-redesign PR sequence

This document is written for the next AI (or human) picking up the
**trim + redesign** refactor on `RpgLikeDurkest`. PR #1 (remove Stress)
has shipped — see <https://github.com/Aidar002/RpgLikeDurkest/pull/90>.
Everything below is what's still planned. Each numbered PR is meant to
be its own atomic, mergeable commit on its own branch — **never bundle
two systems into one PR**.

## Ground rules (carry-overs from PR #1)

- Branch from latest `master` for every PR. Naming: `devin/<unix-ts>-<slug>`.
- One system per PR. No "while we're here" cleanups in unrelated systems.
- **Delete, don't disable.** No commented-out code, no dead stubs,
  no feature flags. If the system is gone, every reference to it
  must be gone with it.
- Required gates before opening the PR:
  - `npm run lint` — 0 errors. (Warnings on pre-existing code are OK.)
  - `npm test` — every test green. PR #1 left the suite at **167 tests**.
  - `npm run build` — `tsc && vite build` clean.
- Commit message: short imperative subject + a body summarizing every
  surface area touched (code, tests, locale, UI, sound, config).
- Do **not** push to `master`, do **not** force-push. `--force-with-lease`
  on your own feature branch is fine.
- Sweep both locales together (`src/systems/locale/en.ts` and
  `src/systems/locale/ru.ts`) — they share keys; if you remove a key
  from one, remove it from the other.
- `scripts/simulateRuns.ts` was deleted in PR #1 (it was 100%
  Stress/Resolve-Test coupled). Don't try to revive it incrementally
  per-PR; if a balance simulator is wanted again, it's its own PR.

## Useful sweep commands

```bash
# repo root
rg -nS '<pattern>' src tests
rg -nS '<pattern>' src/systems/locale          # localized strings
rg -nS '<pattern>' src/data                    # config / data tables
```

Always sweep `src/`, `tests/`, `index.html` once before committing.

---

## PR #2 — Remove the Light system

Targets: dungeon "light" resource, low/high-light combat bonuses, lantern
relics tied to light, all `LIGHT_CONFIG` entries.

**Code to delete:**
- `src/systems/Light.ts`
- `src/ui/Torchlight.ts` (the on-screen torchlight overlay)
- `tests/Light.test.ts`
- `LIGHT_CONFIG` and the `light` field on `RunResources` (`PlayerManager.ts`)
- `EXPEDITION_CONFIG.startingLight`, `PLAYER_CONFIG.maxLight` if present
- `LIGHT_CONFIG.decayEveryNRooms`, `lowLightThreshold`, `highLightAttackBonus`,
  any `lowLightRewardMultiplier` paths
- `BalancePatch.test.ts`: drop the `[FIX-2] Light economy` `describe`
  and the `LIGHT_CONFIG` import
- `CombatManager.ts`: drop `getRewardMultiplierFromLowLight`,
  `lowLightRewardMultiplier`, anything that reads `player.resources.light`
- `RoomFlow.ts`: drop the `gainLight` calls in scout / merchant lantern,
  remove the `actionLantern` and "buy lantern" path on the merchant,
  drop `isLightUnlocked` gate (also remove the field)
- `MetaProgressionManager.ts`: drop `light` upgrade tier and any
  `unlocks.showLight` / `isLightUnlocked` plumbing
- `Relics.ts`: `lanterns_oath` description ("Empty rooms do not drain
  your light") becomes obsolete — drop the relic entirely (type +
  RELICS entry + `applyRelic` case + any aggregate field it set, e.g.
  `lanternEmptyRoomNoDrain`). Also revisit `mercy_token` — its current
  description is "Low-light penalties are halved. +1 starting light";
  rewrite or drop.
- HUD: remove `lightTorchIcon`, `lightResStat`, `accentLight` color,
  `torch` icon, `Torchlight` overlay setup in GameScene
- Locale: `lightStateHigh / Normal / Low`, `lightWarning`, `unitLight`,
  `npcMiraLight`, `actionLantern`, `buyLantern`, anything containing
  "light" / "свет" / "тьма" tied to the light bar
- Narrator: nothing currently — but double-check `dark` and
  `low_light` narration events, drop those triggers
- SoundManager: any `lightLow` / `darkness` SFX cases

**Things to keep:** Phaser scene lighting / room tints (cosmetic), the
"darkness approaches" flavor only if you're sure it isn't tied to the
mechanical low-light state. PR #1 already removed `unitLight` usage in
shop strings; finish the rest.

**Tests to expect needing edits:** `BalancePatch.test.ts`,
`CombatManager.test.ts` (light-driven reward branches),
`MetaProgression.test.ts` (light unlocks), `Relics.test.ts`
(`lanterns_oath` / `mercy_token` cases).

---

## PR #3 — Remove Seals

Targets: per-room "seals" gating used by `MapGenerator`.

**Code to delete:**
- `RoomTemplate.grantsSeal`, `RoomTemplate.sealType`
- `RUN_CONFIG.seals.*` (whatever is on `GameConfig.RUN_CONFIG`)
- `MapGenerator.enforceSealCoverage`, `getRequiredSeals`,
  `sealsPerPath`, any seal validation in the property/invariant tests
- `MapGenerator.test.ts`: drop the seal-coverage `describe` block
- HUD: any seal counter widget, color (`accentSeal` if present), icon
- Locale: anything `seal*`, `печат*`

**Things to keep:** the room-graph, room kinds, exits per room — only
the seal validation pass and the seal-bearing room tags should go.

---

## PR #4 — Remove Shards

Targets: `relicShards` resource — the premium currency used at
merchants/altars/Chorister.

**Code to delete:**
- `RunResources.relicShards`, `gainRelicShards`, `spendRelicShard`
  (in `PlayerManager.ts`)
- `unlocks.showRelicShards` and meta upgrades that reveal / scale
  shards in `MetaProgressionManager`
- `shardReward` on combat / treasure rewards in `CombatManager.ts` /
  `RoomFlow.ts` / wherever rewards are emitted
- `premiumShardCost` in `ROOM_CONFIG.merchant` and altar configs
- `RoomFlow.ts`: remove the `merchant_premium` actionRelic block, any
  altar shard-cost path, the chorister `chorister_unbind` is already
  gone (PR #1)
- HUD: `shardStat` widget, shard color, shard icon, "Реликвии: " is OK
  to keep (different field) — but kill any "shard" pip count
- Locale: `*Shard*`, `оск.`, "осколк", `actionRelic` shard variant,
  any merchant shop dialogue about premium relics if you also want to
  drop the premium tier (decide explicitly in the PR description)
- `Bosses.ts`: any boss reward `shardReward` field
- Tests: `Relics.test.ts` shard reward path, `MetaProgression.test.ts`
  shard unlock, any combat reward test that asserts `relicShards` count

**Decision point:** "premium" merchant offer currently buys a relic for
shards. Without shards, either delete the premium offer entirely or
re-cost it in gold. Recommend: delete (cleaner) and note in the PR
description.

---

## PR #5 — Rename `resolve` → `will` (RU: «Воля»)

This is the biggest mechanical rename. Do it as a single PR, no other
behavior changes, so it's easy to review.

**Code-level renames:**
- `resolve` → `will` (resource field)
- `maxResolve` → `maxWill`
- `resolveCost` (skill cost) → `willCost`
- `resolveFromAttack` → `willFromAttack`
- `resolveFromGuard` → `willFromGuard`
- `gainResolve` → `gainWill`
- `spendResolve` → `spendWill`
- `EXPEDITION_CONFIG.startingResolve` → `startingWill`
- `PLAYER_CONFIG.maxResolve` → `maxWill`
- `RESOLVE_*` constants — already gone post-PR #1 cleanups, double-check
- `combatNeedResolveForSkill` locale key → `combatNeedWillForSkill`
- The `npcChoristerSteady`, `npcChoristerCarry`, `npcKessaTip`, etc.
  English copy says "resolve" — rewrite as "will"
- The Russian copy says «воли»/«Воля» already in many places (legacy);
  audit it to be consistent: «Воля» (singular nominative),
  «воли» (genitive singular), capital W in "Will" only at sentence
  start.
- `accentResolve` color stays — just rename to `accentWill` if you
  want full consistency; not required.

**Helpers:** use a careful `rg -l '\bresolve\b' src tests` pass and a
follow-up `sed -i 's/\bresolve\b/will/g' …` ONLY on safe files (skip
locale RU until you've eyeballed it; many "resolve" English strings need
human-friendly rewrites). The `resolve` keyword is also a Promise
method, so don't blindly sed `*.ts`. Inspect each match.

**Tests to expect needing edits:** `BalancePatch.test.ts`
(`startingResolve` / `maxResolve` / `gainResolve`),
`PlayerManager.test.ts`, `CombatManager.test.ts`,
`MetaProgression.test.ts` (will upgrade tier), `Relics.test.ts`
(crit-restores-resolve etc.).

---

## PR #6 — MapGenerator: grid + 4 starting exits + no two corridors in a row + lazy lookahead

This is mostly a `MapGenerator.ts` + `DungeonManager.ts` change.

**Targets:**
- Confirm the grid generator (already landed in PR #89 on master)
  always emits **exactly 4 exits from the start node**
- Add an invariant: **no two single-fanout (corridor) rooms in a row**
  on any path. Pre-existing seal validation pass is already gone after
  PR #3 — slot the new invariant in its place.
- `generateInitialMap` should build only `lookahead = 2` layers ahead
  of the player; `DungeonManager` should call `appendLayer` (which
  exists) when the player approaches the frontier.
- Drop any leftover `bossEveryNDepths` placeholder if it sneaked back —
  PR #1's removed simulator referenced it as already-deleted.

**Tests:**
- Adapt `MapGenerator.test.ts` — drop seal invariants (gone in PR #3),
  add the "no two consecutive corridors" invariant.
- `DungeonManager.test.ts` — assert lazy generation: only `lookahead`
  layers exist after `generateInitialMap`; layers materialize as the
  player advances.
- Property-based test described in PR #9 below.

---

## PR #7 — Escape button + level→prestige conversion

**Targets:**
- Add an "Escape" button on the HUD (visible only outside combat).
- On press: convert current run levels into `prestigePoints` (formula:
  use the existing run-end conversion in `MetaProgressionManager`),
  cleanly tear down the run, navigate to Hub.
- On death: existing behavior — gold/relics/run-XP burn,
  meta-progression upgrade points already kept; no change there.

**Surfaces touched:**
- `GameScene.ts` (HUD button + handler)
- `MetaProgressionManager.ts` (already has prestige bank;
  expose `convertLevelsToPrestige(level)`)
- Locale: new key `actionEscapeRun` / «Сбежать», hub log line
  on successful escape
- Sound: optional escape SFX

**Tests:**
- `MetaProgression.test.ts` — escape path emits the same `prestigePoints`
  delta as the regular run-end path for the same level.

---

## PR #8 — Boss XP multiplier (boss-as-piñata)

**Targets:**
- Add `bossXpMultiplier` to `GameConfig` (or a per-depth array).
  Recommend: `BOSS_XP_CONFIG = { multiplierByDepth: { 5: 10, 10: 12, … } }`.
- Wire it in `CombatManager.buildRewards` for `kind === 'boss'`.
- Bosses should now grant the equivalent of **10–20 levels** at depth.

**Tests:**
- Extend `CombatManager.test.ts` with a "boss XP grants ≥ N levels"
  assertion using `LEVEL_UP_CONFIG.xpForLevel`.
- `BalancePatch.test.ts` can grow a `[FIX-NEW] Boss XP scaling` block
  if you want it to be visible in the balance suite.

---

## PR #9 — Property-based map test

**Targets:**
- Add a property test: for **200 seeds × 4 run lengths**, generate a map
  and assert: no two single-fanout rooms in a row on any path from
  start to finalDepth. The harness should use the existing `Mulberry32`
  RNG so it's deterministic.
- Optional second invariant in the same suite: every layer is reachable
  from the start node.

**File:** `tests/MapGenerator.property.test.ts` (new). Don't pull in
`fast-check` — write a hand-rolled harness with `Mulberry32(seed)`. PR
review will be much smoother without a new dep.

---

## Order of merge

The user wants to merge step-by-step in PR-number order. After each
merge, rebase the next branch on top of the new `master`. Most
frequent rebase pain points to expect:
- PR #5 (resolve→will) will conflict with anything still calling
  `gainResolve` in the queue. If a later PR is in flight when #5
  merges, rebase that branch first and adjust callsites.
- PR #6 (MapGenerator) and PR #9 (property test) share files — keep
  PR #9 strictly additive (a new test file) so the conflict surface
  stays minimal.

## Quick smoke test after each PR

1. `npm install` (if branch changed deps — PR #1 didn't)
2. `npm run lint && npm test && npm run build`
3. `npm run dev` → click through one expedition: start → fight → rest
   → merchant → boss → die or win. No console warnings about missing
   locale keys, no broken HUD widgets.

## Known cleanup that PR #1 deferred

- `accentVirtue`, `accentAffliction`, `accentStress` color hex values
  are gone from `HudHex` / `HudColors`. Search before extending —
  PR #1 already migrated `playerStatusText` from `accentVirtue` to
  `accentResolve`. PR #5 will rename that to `accentWill` if you
  decide to.
- `chorister_relieve` and `chorister_unbind` offers are gone from the
  Chorister; if a future PR rebalances NPCs, they may want a different
  second offer slot (currently only `chorister_resolve`).
- `ossuary_rosary` was the only stress-coupled relic. PR #2 (Light)
  will likely drop `lanterns_oath` / `mercy_token` similarly.
- Persisted save data may still hold `ossuary_rosary` ids; verify
  load-path tolerates unknown ids without crashing.
