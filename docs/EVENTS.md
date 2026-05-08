# Emitter Catalog

Every manager-to-scene channel in the game is a typed `Emitter<T>` (see
`src/systems/Emitter.ts`). This document is the single source of truth for:

- which Emitter channels exist,
- what they fire (payload shape),
- who subscribes to them.

Read this **before** adding a new channel — there's a good chance the channel
you want already exists. When you do add a channel, append a row here in the
same PR.

## Conventions

- Channels are exposed as `public readonly` fields on managers, e.g.
  `public readonly hpChange = new Emitter<{ hp: number; max: number }>();`.
- Subscribers register with `emitter.on(payload => …)` and unsubscribe with
  the returned disposer (or `emitter.off(listener)`).
- `emit()` snapshots the listener list before calling, so a listener can
  safely subscribe / unsubscribe during dispatch without mutating the
  current sweep.
- Listener exceptions are caught and logged; one bad listener cannot break
  unrelated UI.
- **Don't** add mutable `onXxx` callback fields. Always use `Emitter<T>` —
  multiple subscribers per channel are intentional.
- Payload `void` means "no value" — call sites use `emitter.emit()` and
  subscribers use `() => …`.

---

## `PlayerManager` (`src/systems/PlayerManager.ts`)

| Channel | Payload | Fires when | Consumers |
| --- | --- | --- | --- |
| `hpChange` | `{ hp: number; max: number }` | HP changes (damage, heal, max-HP increase). | `GameScene.refreshUI()` (HUD HP bar / number); tests. |
| `death` | `void` | HP reaches 0. | `GameScene` death sequence: hide HUD, call `meta.resetProgress()`, zero `runSkillPointsPending`, fade out, show `DeathScreen`. |
| `levelUp` | `{ level: number }` | XP threshold passes (`xpPerLevel = 10`). | `GameScene` (`runSkillPointsPending++`, level toast); tests. |
| `statsChange` | `void` | ATK / DEF / max-HP / light cap recomputed (e.g. relic equipped, level-up bonus, meta upgrade applied at run start). | `GameScene.refreshUI()` (ATK/DEF cells). |
| `resourcesChange` | `void` | Gold / potions / light / relic shards / seal count / kill counters change. | `GameScene` (HUD resource cells + bottom-bar gold/potions/light); tests. |
| `relicsChange` | `void` | Relic added or removed from the player. | `GameScene.refreshUI()`; tests. |

---

## `CombatManager` (`src/systems/CombatManager.ts`)

Type definitions for the typed payloads (`EnemyUpdatePayload`,
`CombatEndPayload`) live in the same file, lines ~130-149.

| Channel | Payload | Fires when | Consumers |
| --- | --- | --- | --- |
| `enemyUpdate` | `EnemyUpdatePayload` = `{ hp, maxHp, color, name, icon }` | Enemy HP / display state changes (after the player or boss acts). | `GameScene` → `combatHud.updateEnemyUI(...)` (portrait + HP bar). |
| `playerStatusChange` | `void` | Player status bag mutated (bleed/guard/mark/focus/stun/weaken applied or ticked). | `GameScene.updatePlayerStatusUI()`. |
| `enemyStatusChange` | `void` | Enemy status bag mutated. | `GameScene.updateEnemyStatusUI()`. |
| `playerHit` | `{ damage: number }` | Enemy attack lands and damages the player (post-mitigation). | `GameScene` → `combatHud.onPlayerHit(damage)` (hit-flash VFX). |
| `combatEnd` | `CombatEndPayload` = `{ enemyName, enemyCanonicalName, kind, rewards, killedByBleed, finalBossDefeated, lightRecovered }` | Combat resolves (enemy dies — by attack or by bleed). | `GameScene` → `combatHud.handleVictory(payload)` (rewards UI, depth advance, boss-kill bookkeeping). |

---

## `Localization` (`src/systems/Localization.ts`)

Localization uses a single mutable callback (`onLanguageChange`), **not** an
`Emitter<T>`. This predates the Emitter pattern. Components that need to
re-render on language flip (e.g. `LocalizedText`) hook into that callback
directly. If you find yourself adding a second consumer, that's a strong
signal to migrate `Localization` to a `change` Emitter and update this doc.

---

## How to add a new channel

1. Pick the manager that owns the state being broadcast (the source of
   truth — see `docs/ARCH_MAP.md` "Owns" column).
2. Declare the field as `public readonly fooChange = new Emitter<Payload>();`.
3. Call `this.fooChange.emit(payload)` from the mutator method, **after**
   the state mutation is complete.
4. Subscribe in `GameScene.create()` (or a controller's setup) with
   `this.foo.fooChange.on(payload => …)`. Keep listeners thin — push real
   work back into a `refreshUI()`-style method.
5. Append a row to the matching table above in the same PR.
