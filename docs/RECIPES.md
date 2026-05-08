# Recipes

Token-cheap walkthroughs for the most common edits. Each recipe lists
**every file** an AI agent needs to touch, so a single read of this doc
plus `AI_CONTEXT.md` is enough to plan the change.

If you don't see your task here, fall back to `docs/ARCH_MAP.md`
(file → role) and `docs/EVENTS.md` (Emitter producer → consumer).

> **Convention.** "Add to [...]" means *append* an entry; never reorder
> existing entries because some are referenced positionally (e.g.
> milestone tables). All locale changes require **both** `en.ts` (canonical)
> **and** `ru.ts` — TypeScript fails the build if either is missing.

---

## 1. Add a new room type

Adds a procedurally placeable room kind (treasure / trap / shrine / …).

1. **Enum + pool** — `src/systems/MapGenerator.ts`
   - Append the new variant to the `RoomType` const-object **at the end**
     (don't reorder; positional callers exist).
   - Add it to `BASE_ROOM_POOL` (and any depth-restricted pool) with a
     weight in `getWeight()`.
   - If it should be unlock-gated, add an entry to
     `MetaProgressionManager.ALL_UNLOCK_IDS` and reference it in
     `getAllowedRoomTypes()`.
2. **Visuals** — `src/ui/RoomVisuals.ts`
   - Add a `{ color, icon, sprite, name }` row keyed by the new
     `RoomType` value. The lookup is exhaustive — TypeScript will
     fail the build if you miss it.
3. **Handler** — `src/scenes/RoomFlow.ts`
   - Add a `case RoomType.YOUR_ROOM:` branch in `enter()` that calls a
     new private `showYourRoomOptions()` method. The `default: never`
     guard at the bottom of `enter()` will flag the gap if you forget.
   - Use `scene.showRoomCard(...)` and `scene.setRoomButtons([...])` to
     render the UI; never instantiate Phaser objects directly here.
4. **Localization** — `src/systems/locale/en.ts` + `ru.ts`
   - Add at minimum `roomXxxName`, `roomXxxDesc`, `roomXxxHint` keys.
5. **Test** — `tests/MapGenerator.test.ts`
   - If the room must appear at a certain depth/frequency, add a
     coverage test similar to the existing room-pool tests.

Verify: `npm run lint && npm test && npm run build`.

---

## 2. Add a new (non-boss) enemy

1. **Definition** — `src/data/GameConfig.ts`
   - Append an `EnemyDef` to the matching `ENEMY_TIERS[i].pool`. Set
     `name` (canonical English — used as the relic-drop key), `hp`,
     `attack`, `xpReward`, `goldReward`, `intentProfile`.
2. **Localization (optional)** — `src/systems/locale/en.ts` + `ru.ts`
   - Only needed if you want a non-English display name. Add an
     `enemyName_<canonical>` key and reference it in
     `Localization.enemyName(...)`.
3. **Drop table (optional)** — `src/systems/Relics.ts`
   - Add the canonical English `name` to the `enemyName` field of any
     relic's `drops: RelicDropEntry[]` you want it to roll.
4. **Test** — `tests/CombatManager.test.ts` if the intent profile is new.

Note: enemy *pool selection* now goes through the seeded `Rng`
(see `getEnemyForDepth(depth, rng)`). If you're testing
deterministically, pass `Mulberry32(seed)` into a fresh `CombatManager`.

---

## 3. Add a new boss (with phases)

1. **Boss definition** — `src/data/GameConfig.ts`
   - Append to `BOSSES` with `{ depth, def: EnemyDef }`. The depth
     must be unique.
   - If the depth lands on a canonical milestone, add it to
     `EXPECTED_BOSS_NAMES` in `src/data/Enemies.ts` so
     `assertBossMapping()` validates the table at module load.
2. **Phase script** — `src/data/Bosses.ts`
   - Add a `BOSS_BLUEPRINT_BY_NAME[<canonical name>]` entry with
     `phases`, `prepareActions`, `windupActions`. The lookup key is
     the boss's English `name` from `GameConfig.BOSSES`, not its
     localised display string.
3. **Localization** — `src/systems/locale/en.ts` + `ru.ts`
   - Add per-action label keys if the phase script references new
     `intentLabel` / `prepareName` / `windupName` ids.
4. **Combat wiring** — `src/systems/CombatManager.ts`
   - Usually nothing. The `runBossTurn` / `resolvePrepare` /
     `resolveBossWindupAction` machinery reads the blueprint
     generically. Only edit here if the boss needs a brand-new action
     kind.
5. **Test** — `tests/CombatManager.test.ts`
   - Drive a `Mulberry32`-seeded fight; assert the phase transitions
     and final reward shape.

---

## 4. Add a new skill

1. **ID** — `src/systems/Skills.ts`
   - Add to the `SkillId` union, the `SKILLS` record (with
     `LocalizedText` `name` / `short` / `description`, `resolveCost`,
     `color`, `starter`), and `SKILL_ORDER`.
   - Set `starter: false` if the skill is locked behind meta progress;
     also add a matching `'skill_<id>'` to `ALL_UNLOCK_IDS` in
     `MetaProgressionManager.ts` and surface it via
     `getUnlockedExtraSkills()`.
2. **Effect** — `src/systems/CombatManager.ts`
   - Add a branch in `handlePlayerSkill(skillId)`. Use
     `applyPlayerDamage(...)` for damage, status helpers for buffs.
3. **Localization** — already covered if you used `lt(ru, en)` in step 1.
4. **Test** — `tests/CombatManager.test.ts`
   - Cover damage / status / cooldown behaviour. The existing
     `'cleave'` and `'bleed_strike'` tests are good templates.

---

## 5. Add a new relic

1. **ID + def** — `src/systems/Relics.ts`
   - Add to `RelicId`, then to `RELICS` with `name`, `description`,
     `rarity`, `set` (or `null`), per-stat aggregate fields, and a
     `drops: RelicDropEntry[]` listing which canonical enemy `name`s
     drop it and at what `chance`.
   - Set bag rarity using `RelicRarity` (`common`/`rare`/`unique`).
     Rare/unique items are gated by `getRelicRarityPool()` until their
     unlock fires.
2. **Aggregation (only for new effect kinds)** — `src/systems/Relics.ts`
   - If the relic introduces a new numeric channel (e.g. lifesteal),
     extend `RelicAggregate`, `emptyAggregate`, `applyRelic`, and
     wherever `CombatManager` reads from the aggregate.
3. **Localization** — covered by `lt(ru, en)` in step 1.
4. **Test** — `tests/Relics.test.ts` (drop chance) + a `CombatManager`
   test if a new effect kind is wired.

---

## 6. Add a new NPC

1. **Catalog** — `src/systems/Npcs.ts`
   - Add an `NpcId` and an entry in `NPCS` with `role`, `voice`
     lines, beats, optional `offer` template.
2. **Memory** — `src/systems/NpcManager.ts`
   - If the NPC needs persistent state (already-met / chosen-offer
     flags), append to `NpcMemoryMap` defaults in
     `makeDefaultNpcMemoryMap()`. The sanitizer drops unknown ids.
3. **Hookup** — `src/scenes/RoomFlow.ts`
   - If the NPC should appear in shrines/empty rooms, add it to the
     relevant `npcs.pickForRole(...)` call. For altars, follow the
     existing `presentSaraAdviceChoice` / `presentGogiPayChoice`
     pattern — every NPC altar lives in `RoomFlow`, not `GameScene`.
4. **Localization** — already covered by `lt(ru, en)` in step 1.

---

## 7. Add a new locale string

1. `src/systems/locale/en.ts` — add `mySemanticKey: 'English text'`.
2. `src/systems/locale/ru.ts` — add the matching Russian translation.
3. Use `this.loc.t('mySemanticKey', { var: value })` at the call site.

**Never** introduce mechanical prefixes (`cm_001`, etc.). Keys must
read like English (e.g. `combatBossEncounter`, `roomTreasureName`).

---

## 8. Add a new HUD cell

1. **Layout constants** — `src/ui/Layout.ts`
   - Add an x/y/width entry under `HudLayout.topHud.*` or pick a slot
     in the bottom bar. Never inline literals.
2. **Cell creation** — `src/scenes/GameScene.setupGlobalUI()`
   - Use `createHudCell(...)` (bottom bar) or
     `createHudInlineSlot(...)` (top bar) and store the handle on a
     scene field.
3. **Refresh** — `src/scenes/GameScene.refreshUI()`
   - Set the cell's `value` text on every refresh. The cell handle
     exposes `setValue` / `setLabel` / `setIcon`.
4. **Visibility (optional)** — gate the cell on a meta unlock by
   reading `this.meta.getUiUnlockState()` in `refreshUI()`.

---

## 9. Add a new Emitter channel

1. **Producer** — pick the manager that owns the state.
   - Add `public readonly somethingHappened = new Emitter<Payload>();`
     as a public field. `Payload` is a structural type — `void` is
     allowed for "no data".
   - Call `this.somethingHappened.emit(payload)` after the state
     change has settled (never mid-mutation).
2. **Consumer** — wherever the scene/UI needs to react.
   - Subscribe with `producer.somethingHappened.on(payload => ...)`.
     Save the disposer if you need to detach.
3. **Documentation** — `docs/EVENTS.md`
   - Add a row: producer, channel, payload shape, consumers. The
     audit relies on this catalog being accurate.
4. **Tests** — most managers have a counter-based listener pattern
   (`tests/PlayerManager.test.ts`). Mirror it.

> Do **not** add a mutable `onXxx` callback property. The whole repo
> is on `Emitter<T>`; mixed patterns force AI agents to read both.

---

## 10. Add a new content unlock (milestone reward)

1. **Unlock id** — `src/systems/MetaProgressionManager.ts`
   - Append to `ALL_UNLOCK_IDS`. The id is a stable string used in
     persisted profiles, so it is permanent.
   - Reflect it in defaults (`DEFAULT_CONTENT_UNLOCKS`) — `false` for
     gated content, `true` if you're retroactively flipping a
     historical id on for old saves.
2. **Trigger** — same file
   - Add to `DEPTH_MILESTONES` (depth-based) or `FIRST_BOSS_MILESTONE`
     (first boss kill) so the unlock banner can fire.
   - Or call `meta.unlockContent('your_id')` directly from the relevant
     handler.
3. **Effect** — wire the consumer to read `meta.isUnlocked('your_id')`
   or `meta.getUiUnlockState()` and gate the feature accordingly.
4. **Localization** — `unlockBannerYourId` (`{ key, value }` style) for
   the banner text in `setupSceneChrome`.
5. **Test** — `tests/MetaProgression.test.ts`. The `MemoryStorage`
   shim pattern is at the top of the file.

---

## 11. Add a new room-action button variant

1. **Variant id** — `src/ui/RoomButtons.ts`
   - Add to `RoomButtonVariant` union. The factory's switch is
     exhaustive; TypeScript will fail the build if you miss the
     style mapping.
2. **Style** — `src/ui/RoomButtons.ts` `styleByVariant` table.
3. **Caller** — usually `src/scenes/RoomFlow.ts`. Pass `variant:
   'your_variant'` in the `RoomButtonAction` literal.

---

## 12. Add a new status effect

1. **Definition** — `src/systems/StatusEffects.ts`
   - Add the effect to the `StatusBag` shape and the tick logic.
   - Surface a setter / clearer if needed.
2. **Apply** — most effects are applied from
   `src/systems/CombatManager.handlePlayerSkill` or `applyPlayerDamage`
   / `resolveEnemyTurn`. Use the existing `applyStatus(...)` helper.
3. **Display** — `statusSummary(status, language)` is the single
   source of truth for the player/enemy status pill text. Add a
   branch there.
4. **Test** — `tests/StatusEffects.test.ts`. Unit-test pure tick
   logic before wiring it into combat.

---

## 13. Wire a new meta-progression upgrade

The existing 4 upgrades (`damage`, `hp`, `defense`, `goldGain`) cover
flat-stat bumps. Adding a new card:

1. **Upgrade id** — `src/systems/MetaProgressionManager.ts`
   - Add to `UpgradeId` union. Add a `UPGRADE_DEFINITIONS[<id>]` entry
     with `maxLevel`, `costForLevel(level)`, `apply(level, bonuses)`,
     `description`, `title`.
2. **Bonuses shape** — same file
   - If the upgrade affects a new player stat, extend
     `PlayerMetaBonuses` and adjust `PlayerManager`'s constructor.
3. **Card UI** — `src/ui/end/DeathScreen.ts`
   - The 4-card meta-shop reads from `meta.getUpgradeCards()` so
     no UI change is needed for a 5th card *unless* you're past the
     hardcoded 4-slot grid layout. In that case, adjust
     `END_SCREEN_CARD_LAYOUT` in `src/ui/end/types.ts`.
4. **Test** — `tests/MetaProgression.test.ts`. Cover the upgrade's
   cost curve and `apply` math.

---

## When in doubt

- **Run tests first** to confirm a clean baseline:
  `npm run lint && npm test && npm run build`.
- **Pure-logic systems** get unit tests in `tests/`. Don't import
  Phaser into a unit test — see `tests/PlayerManager.test.ts` for the
  scene/log shim pattern, or `tests/MetaProgression.test.ts` for the
  `localStorage` shim.
- **Layout / depth literals** belong in `src/ui/Layout.ts`. Never
  inline `800`, `600`, or a `setDepth(99)`.
- **User-facing text** goes through `Localization.t(...)`. Never
  hardcode display strings outside of `locale/` and `NarrativeManager`.
- **Random rolls** go through `defaultRng` (or a passed-in seeded
  `Rng`). The audit closed off `Math.random()` in gameplay paths so
  the determinism envelope is whole.
