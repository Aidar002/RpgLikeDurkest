# Handoff: trim-redesign PR sequence

This document is written for the next AI (or human) picking up the
**trim + redesign** refactor on `RpgLikeDurkest`. PR #1 (remove Stress)
already shipped — see <https://github.com/Aidar002/RpgLikeDurkest/pull/90>.
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
  - `npm run lint` — 0 errors. (Pre-existing warnings are OK.)
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

Sweep `src/`, `tests/`, and `index.html` once before committing each PR.

---

## PR #2 — Remove the Light system

Targets: dungeon "light" resource, low/high-light combat bonuses, lantern
relics tied to light, all `LIGHT_CONFIG` entries, plus the boss-side
`drainLight` / `capLight` / `cinderlight` plumbing.

### Files to delete entirely

- `src/systems/Light.ts`
- `src/ui/Torchlight.ts` (the on-screen torchlight overlay)
- `tests/Light.test.ts`

### Files to edit

**`src/data/GameConfig.ts`**
- Remove from `EXPEDITION_CONFIG`: `startingLight`, `maxLight`,
  `lightLossPerRoom`, `lowLightThreshold`, `highLightThreshold`.
- Remove from `COMBAT_CONFIG`: `curseLightLoss`,
  `criticalChanceFromHighLight`, `highLightAttackBonus`,
  `lowLightEnemyAttackBonus`, `lowLightRewardMultiplier`.
- Remove from `ROOM_CONFIG.rest`: `recoverLight`.
- Remove from `ROOM_CONFIG.merchant`: `lanternCost`, `lanternLightGain`.
- Remove from `ROOM_CONFIG.empty`: `scoutLightGain`.
- Delete the entire `LIGHT_CONFIG` const.
- Update the JSDoc comment over `RUN_CONFIG` (it still mentions
  "Light / XP scaling … decay interval").

**`src/data/Bosses.ts`**
- `BossActionDef.drainLight?: number` field — drop.
- `BossPhaseDef.onEnter.drainLight?` and `onEnter.capLight?` — drop.
- `BossPassiveId`: drop `'cinderlight'`. Drop the
  `passives: ['cinderlight']` entry on the Lich and any related logic.
- `BossPhaseAction.id` union: drop `'cinder_curse'`.
- Drop every `drainLight: 1` action and the `onEnter: { capLight: 3 }`
  entry on the final-boss data block.

**`src/systems/PlayerManager.ts`**
- Drop `RunResources.light` field.
- Drop `startingLightBonus` from `MetaBonuses` plumbing
  (and its application in `applyMeta()` and the cap-on-meta-changed
  branch around line 380).
- Drop `isLightUnlocked` getter, `hasHighLight`, `hasLowLight`,
  `getEnemyAttackBonusFromLight`, `getRewardMultiplierFromLowLight`.
- Drop `gainLight()` / `spendLight()`.
- Update the attack getter (~line 121): the `light` adder via
  `COMBAT_CONFIG.highLightAttackBonus` is gone.
- Update the crit getter (~line 127): the `criticalChanceFromHighLight`
  adder is gone.

**`src/systems/CombatManager.ts`**
- Drop `LIGHT_CONFIG` import.
- Drop `EnemyRewards.lightRecovered` field (and its emission in
  `buildRewards`).
- Drop the `lowLightRewardMultiplier` term from xp/gold reward math.
- Drop the `player.gainLight(LIGHT_CONFIG.onBossKill)` call on boss
  kills, and the `lightRecovered` field from the resulting
  `EnemyRewards`.
- Drop the `getEnemyAttackBonusFromLight()` calls in damage formulas
  (they're added twice — once in `setupEnemy` enemy attack and once in
  the per-turn enemy strike). Subtract them from the formula.
- Drop the `cinderlight` passive branch and any reference to
  `player.hasLowLight` / `player.hasHighLight`.
- Drop the `onEnter.drainLight` / `onEnter.capLight` handling.
- Drop the `action.drainLight` case in the per-turn boss action loop.

**`src/scenes/RoomFlow.ts`**
- Drop `import { isLightWarning, shouldDecayLight } from '../systems/Light'`.
- Drop the entire light-decay block at the top of the room enter handler
  (the `sparesLight` / `roomsVisitedForLight` / `spendLight(1)` /
  `lightWarning` / `low_light` narrate fork).
- Drop `scene.skipLightSpendThisRoom` reads/writes (and the field
  itself in `GameScene.ts`).
- Drop `scene.player.hasLowLight` branch on room enter.
- Drop `lightGained` from the rest summary; drop `unitLight` reference.
- Drop the `mira_lantern` merchant offer case (`gainLight` /
  `npcMiraLight` log line).
- Drop the `actionLantern` action on the merchant action list (the
  `if (scene.player.isLightUnlocked) { actions.push({ … 'mira_lantern' })`
  block).
- Drop the empty-room scout `lightGain` fork.

**`src/scenes/GameScene.ts`**
- Drop `import { createTorchlightOverlay } from '../ui/Torchlight'`.
- Drop `torchlight`, `torchlightHomeX/Y`, `torchlightSweepPx`,
  `lightTorchIcon`, `lightResStat`, `skipLightSpendThisRoom`,
  `roomsVisitedForLight` fields.
- Drop the entire torchlight setup block (~lines 365-386) and its
  `setVisible` / sweep tween calls.
- Drop the high-light / low-light glyph branch on `lightTorchIcon`
  and the light HUD cell creation + value update + visibility toggle.
- Drop `animateTorchlightSweep` and its callers.
- Drop the torchlight position updates in the room-transition tween.

**`src/systems/MetaProgressionManager.ts`**
- Drop `'resource_light'` from the unlock id list.
- Drop `MetaBonuses.startingLightBonus`.
- Drop `unlocks.showLight`.
- Drop the resource_light unlock entry (description "Start with +N
  light.") and the `preparation` tier that feeds `startingLightBonus`.

**`src/systems/Relics.ts`**
- Drop `'lanterns_oath'` from the `RelicId` union.
- Drop the `lanterns_oath` entry in `RELICS`.
- Drop `'mercy_token'` from `RelicId` and its `RELICS` entry — its
  effect was "Low-light penalties are halved. +1 starting light", both
  gone.
- Drop `RelicAggregate.bonusStartingLight`,
  `RelicAggregate.emptyRoomsSpareLight`,
  `RelicAggregate.lowLightPenaltyMult`.
- Drop their `emptyAggregate()` initializers.
- Drop the `case 'lanterns_oath'` and `case 'mercy_token'` branches in
  `applyRelic`.

**`src/systems/NarrativeManager.ts`**
- `enterDepth(depth: number, lowLight: boolean)` → drop the `lowLight`
  param and its branch. Audit all callers.

**`src/systems/Narrator.ts`**
- Drop `'low_light'` from the `NarrationEvent` union and both of its
  data tables (en + ru low_light arrays).

**`src/ui/HudIcons.ts`**
- Drop `lantern` and `torch` entries from both maps. The header
  comment ("row 1: resolve lantern …") needs a small rewrite.

**`src/ui/HudTheme.ts`**
- Drop `accentLight: 0xf0a050` from the colors object and its
  `accentLight: '#f0a050'` hex variant.

**`src/ui/Layout.ts`**
- Drop `topHud.torchIconY` and the JSDoc that describes it.

**`src/ui/PixelSprite.ts`**
- Drop the `lanternYellow` / `lanternDark` palette entries, the
  `drawLantern()` function, and the `lantern: drawLantern` registry
  entry.

**Locale (`src/systems/locale/en.ts` and `src/systems/locale/ru.ts`)**
- Drop keys: `lightShort`, `lightLower`, `lightWarning`,
  `lightStateHigh`, `lightStateNormal`, `lightStateLow`, `unitLight`,
  `actionLantern`, `buyLantern`, `npcMiraLight`.
- Edit `enemyFallback` ("Something steps into the light." / "Что-то
  входит в свет фонаря.") — replace `light` / `фонар*` with neutral
  copy.
- Edit `curseSuffix` (" and drains {light} light" / " и гасит
  {light} света") — drop entirely or rewrite if any caller still uses
  it.

### Tests

- `tests/Light.test.ts` — delete entirely.
- `tests/BalancePatch.test.ts` — drop the `LIGHT_CONFIG` import, the
  `shouldDecayLight` import, the entire `[FIX-2] Light economy`
  describe block, and the `p.resources.light = EXPEDITION_CONFIG.maxLight`
  setup line in any other block.
- `tests/PlayerManager.test.ts` — drop the `light` resource assertion,
  the `startingLightBonus` meta bonus test, the `caps starting light at
  maxLight` test, the `gainLight is capped at maxLight` test, and the
  `hasHighLight / hasLowLight flip` test.
- Audit `tests/MetaProgression.test.ts`, `tests/Relics.test.ts`,
  `tests/CombatManager.test.ts` for any boss-action / reward-multiplier
  paths that depended on light state.

### Decisions to call out in the PR description

- `cinderlight` (Lich passive) and `cinder_curse` action are gone.
  This makes the Lich noticeably weaker — flag it as a balance follow-up.
- `mercy_token` and `lanterns_oath` relics are removed entirely. Persisted
  meta saves may still reference these ids; verify the load path tolerates
  unknown ids.
- The torchlight overlay being gone is a deliberate visual change — the
  centre stone wall now reads as fully lit. Confirm with the user before
  shipping if you're unsure.

---

## PR #3 — Remove Seals

Targets: per-room "seals" gating used by `MapGenerator`.

**Code to delete:**
- `RoomTemplate.grantsSeal`, `RoomTemplate.sealType` (`MapGenerator.ts`).
- `RUN_CONFIG.seals.*` block in `GameConfig.ts`.
- `MapGenerator.enforceSealCoverage`, `getRequiredSeals`,
  `sealsPerPath`, any seal validation in invariant tests.
- `tests/MapGenerator.test.ts`: drop the seal-coverage `describe` block.
- HUD: any seal counter widget, color (`accentSeal` if present), icon.
- Locale: anything `seal*`, `печат*`.

**Things to keep:** the room-graph, room kinds, exits per room — only
the seal validation pass and the seal-bearing room tags should go.

---

## PR #4 — Remove Shards

Targets: `relicShards` resource — the premium currency used at
merchants/altars/Chorister.

**Code to delete:**
- `RunResources.relicShards`, `gainRelicShards`, `spendRelicShard`
  (in `PlayerManager.ts`).
- `unlocks.showRelicShards` and meta upgrades that reveal / scale
  shards in `MetaProgressionManager`.
- `shardReward` on combat / treasure rewards in `CombatManager.ts` /
  `RoomFlow.ts` / wherever rewards are emitted.
- `premiumShardCost` in `ROOM_CONFIG.shrine` / `ROOM_CONFIG.merchant`
  / altar configs.
- `RoomFlow.ts`: the `merchant_premium` actionRelic block, any altar
  shard-cost path. (Chorister's shard offer was already removed in PR #1.)
- HUD: `shardStat` widget, shard color, shard icon.
- Locale: `*Shard*`, `оск.`, "осколк", any merchant shop dialogue
  about premium relics if you also drop the premium tier.
- `Bosses.ts` / `ROOM_CONFIG.elite` / `ROOM_CONFIG.boss`: any
  `shardReward` field.
- Tests: `Relics.test.ts` shard reward path, `MetaProgression.test.ts`
  shard unlock, any combat reward test that asserts `relicShards` count.

**Decision point:** "premium" merchant offer currently buys a relic for
shards. Without shards, either delete the premium offer entirely or
re-cost it in gold. Recommend: delete (cleaner) and note in the PR
description.

---

## PR #5 — Rename `resolve` → `will` (RU: «Воля»)

This is the biggest mechanical rename. Do it as a single PR, no other
behavior changes, so it's easy to review.

**Code-level renames:**
- `resolve` → `will` (resource field).
- `maxResolve` → `maxWill`.
- `resolveCost` (skill cost) → `willCost`.
- `resolveFromAttack` → `willFromAttack`.
- `resolveFromGuard` → `willFromGuard`.
- `gainResolve` → `gainWill`.
- `spendResolve` → `spendWill`.
- `EXPEDITION_CONFIG.startingResolve` → `startingWill`.
- `PLAYER_CONFIG.maxResolve` → `maxWill`.
- `combatNeedResolveForSkill` locale key → `combatNeedWillForSkill`.
- All English copy that says "resolve" → "will".
- All Russian copy: standardize on «Воля» (nominative) / «воли»
  (genitive). Many strings already use these — audit for stragglers.
- `accentResolve` color: rename to `accentWill` for consistency
  (optional, recommend doing it).

**Helpers:** `rg -l '\bresolve\b' src tests` then walk each file
manually. Do **not** blindly sed — `Promise.resolve()` is also a thing.

**Tests to expect needing edits:** `BalancePatch.test.ts`,
`PlayerManager.test.ts`, `CombatManager.test.ts`,
`MetaProgression.test.ts` (will upgrade tier), `Relics.test.ts`.

---

## PR #6 — MapGenerator: grid + 4 starting exits + no two corridors in a row + lazy lookahead

This is mostly a `MapGenerator.ts` + `DungeonManager.ts` change.

**Targets:**
- Confirm the grid generator (already on master via PR #89) always
  emits exactly **4 exits from the start node**.
- Add an invariant: **no two single-fanout (corridor) rooms in a row**
  on any path. With seals gone (PR #3), there's a clean place to
  insert this validation pass.
- `generateInitialMap` should build only `lookahead = 2` layers ahead
  of the player; `DungeonManager` should call its existing `appendLayer`
  when the player approaches the frontier. The current
  `MAP_CONFIG.initialLookahead` is 5 — drop to 2.

**Tests:**
- Adapt `MapGenerator.test.ts` — drop seal invariants (gone in PR #3),
  add the "no two consecutive corridors" invariant.
- `DungeonManager.test.ts` — assert lazy generation: only `lookahead`
  layers exist after `generateInitialMap`; layers materialize as the
  player advances.
- See PR #9 below for the property-based companion.

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
- `GameScene.ts` (HUD button + handler).
- `MetaProgressionManager.ts` (already has prestige bank;
  expose `convertLevelsToPrestige(level)`).
- Locale: new key `actionEscapeRun` / «Сбежать», hub log line on
  successful escape.
- Sound: optional escape SFX.

**Tests:**
- `MetaProgression.test.ts` — escape path emits the same
  `prestigePoints` delta as the regular run-end path for the same level.

---

## PR #8 — Boss XP multiplier (boss-as-piñata)

**Targets:**
- Add `bossXpMultiplier` to `GameConfig`. Recommend:
  `BOSS_XP_CONFIG = { multiplierByDepth: { 5: 10, 10: 12, … } }`.
- Wire it in `CombatManager.buildRewards` for `kind === 'boss'` /
  `'final_boss'`.
- Bosses should now grant the equivalent of **10–20 levels** at depth.

**Tests:**
- Extend `CombatManager.test.ts` with a "boss XP grants ≥ N levels"
  assertion using `LEVEL_UP_CONFIG.xpForLevel`.
- `BalancePatch.test.ts` can grow a `[FIX-NEW] Boss XP scaling` block.

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
`fast-check` — write a hand-rolled harness with `Mulberry32(seed)`. Keeps
the conflict surface and review burden low.

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

1. `npm install` (only if branch changed deps — PR #1 didn't).
2. `npm run lint && npm test && npm run build`.
3. `npm run dev` → click through one expedition: start → fight → rest
   → merchant → boss → die or win. No console warnings about missing
   locale keys, no broken HUD widgets.

## Known cleanup PR #1 deferred

- `accentVirtue`, `accentAffliction`, `accentStress` colours are gone
  from `HudHex` / `HudColors`. PR #1 already migrated `playerStatusText`
  from `accentVirtue` to `accentResolve`. PR #5 will rename that to
  `accentWill` if you choose to.
- `chorister_relieve` and `chorister_unbind` offers are gone from the
  Chorister; if a future PR rebalances NPCs, they may want a different
  second offer slot (currently only `chorister_resolve`).
- `ossuary_rosary` was the only stress-coupled relic. PR #2 (Light)
  will drop `lanterns_oath` / `mercy_token` similarly.
- Persisted save data may still hold removed relic ids; verify the
  load path tolerates unknown ids without crashing.
