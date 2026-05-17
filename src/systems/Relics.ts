import type { LocalizedText } from './LocalizedText';
import { lt } from './LocalizedText';
import { defaultRng, type Rng } from './Rng';
import { DROP_FORMULA } from '../data/GameConfig';

// Relic catalog (Stage [3] of the design-sheet port). 14 items grouped
// into 5 sets, see the design sheet:
//   - wanderer (3 pieces): worn_ring + cracked_shield + tattered_cloak
//   - flesh    (2 pieces): vampire_amulet + dark_chestplate
//   - knight   (3 pieces): knight_sword + knight_armor + knight_helmet
//   - cursed   (2 pieces): cursed_amulet + cursed_ring
//   - sin      (2 pieces): greed_crown + longinus_shard
// (Книга Лжи / Book of Lies is deferred and intentionally NOT in this
// catalog yet; the sin set is reduced to a 2-pc bonus until then.)
//
// Numeric effects are folded into a single RelicAggregate at combat
// time so PlayerManager / CombatManager have one source of truth.

export type RelicId =
    | 'worn_ring'
    | 'cracked_shield'
    | 'tattered_cloak'
    | 'vampire_amulet'
    | 'dark_chestplate'
    | 'four_leaf_clover'
    | 'knight_sword'
    | 'knight_armor'
    | 'knight_helmet'
    | 'cursed_amulet'
    | 'cursed_ring'
    | 'lost_staff'
    | 'greed_crown'
    | 'longinus_shard';

export type RelicRarity = 'common' | 'rare' | 'unique';

export type RelicSetId = 'wanderer' | 'flesh' | 'knight' | 'cursed' | 'sin';

/** Drop table entry: which enemy can drop this item. */
interface RelicDropEntry {
    /** Canonical English enemy `name` (matches GameConfig.ENEMY_TIERS / BOSSES). */
    enemyName: string;
    /**
     * For Stage [4] combat drops this is no longer a probability.
     * It is the WEIGHT used by `rollRelicForEnemy` for the
     * weighted-random pick across the dead enemy's unowned drop
     * entries, AFTER the X+Y+Z+K formula in
     * {@link DROP_FORMULA} gates the roll.
     *
     * Special case: a value `>= 1.0` is reserved for GUARANTEED
     * drops (used by Crown of Greed on Mammon). When any unowned
     * entry for the dead enemy has `chance >= 1.0`,
     * `rollRelicForEnemy` returns it immediately and the formula
     * does not run.
     *
     * The field name is kept (instead of "weight") so the existing
     * data tables and tests stay compatible without touching every
     * call site.
     */
    chance: number;
}

interface RelicDef {
    id: RelicId;
    name: LocalizedText;
    short: LocalizedText;
    rarity: RelicRarity;
    description: LocalizedText;
    set?: RelicSetId;
    /** Drop table — one entry per spec'd source enemy. */
    drops: RelicDropEntry[];
}

export const RELICS: Record<RelicId, RelicDef> = {
    worn_ring: {
        id: 'worn_ring',
        name: lt('Потёртое кольцо', 'Worn Ring'),
        short: lt('Кольцо', 'Ring'),
        rarity: 'common',
        description: lt('+1 урон.', '+1 attack.'),
        set: 'wanderer',
        drops: [
            { enemyName: 'Rat', chance: 0.05 },
            { enemyName: 'Slime', chance: 0.05 },
        ],
    },
    cracked_shield: {
        id: 'cracked_shield',
        name: lt('Треснутый щит', 'Cracked Shield'),
        short: lt('Щит', 'Shield'),
        rarity: 'common',
        description: lt('+2 жизни.', '+2 max HP.'),
        set: 'wanderer',
        drops: [
            { enemyName: 'Bat', chance: 0.05 },
            { enemyName: 'Bee-Butterfly', chance: 0.05 },
        ],
    },
    tattered_cloak: {
        id: 'tattered_cloak',
        name: lt('Потрёпанный плащ', 'Tattered Cloak'),
        short: lt('Плащ', 'Cloak'),
        rarity: 'common',
        description: lt('+2 жизни.', '+2 max HP.'),
        set: 'wanderer',
        drops: [
            { enemyName: 'Giant Toad', chance: 0.05 },
            { enemyName: 'Slime', chance: 0.05 },
        ],
    },
    vampire_amulet: {
        id: 'vampire_amulet',
        name: lt('Амулет вампира', 'Vampire Amulet'),
        short: lt('Амулет', 'Amulet'),
        rarity: 'rare',
        description: lt(
            'Шанс 10% восстановить 2 ОЗ при ударе.',
            '10% chance to restore 2 HP on attack.'
        ),
        set: 'flesh',
        drops: [
            { enemyName: 'Rat Matron', chance: 0.08 },
            { enemyName: 'Skeleton', chance: 0.08 },
        ],
    },
    dark_chestplate: {
        id: 'dark_chestplate',
        name: lt('Нагрудник мрака', 'Dark Chestplate'),
        short: lt('Нагрудник', 'Chest'),
        rarity: 'rare',
        description: lt(
            'Шанс 10% заблокировать 50% входящего урона (округление вниз).',
            '10% chance to block 50% of incoming damage (floor).'
        ),
        set: 'flesh',
        drops: [
            { enemyName: 'Ghoul', chance: 0.08 },
            { enemyName: 'Gelatinous Cube', chance: 0.08 },
        ],
    },
    four_leaf_clover: {
        id: 'four_leaf_clover',
        name: lt('Четырёхлистный клевер', 'Four-Leaf Clover'),
        short: lt('Клевер', 'Clover'),
        rarity: 'rare',
        description: lt('+10% к шансу выпадения реликвий.', '+10% relic drop chance.'),
        drops: [{ enemyName: 'Vampire', chance: 0.05 }],
    },
    knight_sword: {
        id: 'knight_sword',
        name: lt('Меч рыцаря', "Knight's Sword"),
        short: lt('Меч', 'Sword'),
        rarity: 'rare',
        description: lt(
            '+1 урон. Шанс 10% при обычной атаке нанести +5 урона.',
            '+1 attack. 10% chance on regular attack to deal +5 damage.'
        ),
        set: 'knight',
        drops: [
            { enemyName: 'Skeleton Swordsman', chance: 0.1 },
            { enemyName: 'Death Knight', chance: 0.1 },
        ],
    },
    knight_armor: {
        id: 'knight_armor',
        name: lt('Доспех рыцаря', "Knight's Armor"),
        short: lt('Доспех', 'Armor'),
        rarity: 'rare',
        description: lt('+1 защита.', '+1 defense.'),
        set: 'knight',
        drops: [
            { enemyName: 'Lost Adventurer', chance: 0.1 },
            { enemyName: 'Skeleton Swordsman', chance: 0.1 },
        ],
    },
    knight_helmet: {
        id: 'knight_helmet',
        name: lt('Шлем рыцаря', "Knight's Helmet"),
        short: lt('Шлем', 'Helm'),
        rarity: 'rare',
        description: lt(
            '+2 жизни. Шанс 40% восстановить 1 волю при получении удара.',
            '+2 max HP. 40% chance to restore 1 resolve when hit.'
        ),
        set: 'knight',
        drops: [
            { enemyName: 'Death Knight', chance: 0.1 },
            { enemyName: 'Lost Adventurer', chance: 0.1 },
        ],
    },
    cursed_amulet: {
        id: 'cursed_amulet',
        name: lt('Проклятый амулет', 'Cursed Amulet'),
        short: lt('Прокл. амул.', 'Curs. Amul.'),
        rarity: 'unique',
        description: lt('+2 урон, -3 защита.', '+2 attack, -3 defense.'),
        set: 'cursed',
        drops: [{ enemyName: 'Death Knight', chance: 0.15 }],
    },
    cursed_ring: {
        id: 'cursed_ring',
        name: lt('Проклятое кольцо', 'Cursed Ring'),
        short: lt('Прокл. кольцо', 'Curs. Ring'),
        rarity: 'unique',
        description: lt('+2 урон, -2 макс. воли.', '+2 attack, -2 max resolve.'),
        set: 'cursed',
        drops: [{ enemyName: 'Death Knight', chance: 0.15 }],
    },
    lost_staff: {
        id: 'lost_staff',
        name: lt('Посох Заблудшего', 'Lost Staff'),
        short: lt('Посох', 'Staff'),
        rarity: 'rare',
        description: lt(
            '+3 макс. воли. +1 воли после каждой атаки игрока.',
            '+3 max resolve. +1 resolve after every player attack.'
        ),
        drops: [
            { enemyName: 'Lich', chance: 0.1 },
            { enemyName: 'Lost Adventurer', chance: 0.05 },
        ],
    },
    greed_crown: {
        id: 'greed_crown',
        name: lt('Корона Жадности', 'Crown of Greed'),
        short: lt('Корона', 'Crown'),
        rarity: 'unique',
        description: lt('+50% золота из любого источника.', '+50% gold from any source.'),
        set: 'sin',
        drops: [{ enemyName: 'Mammon', chance: 1 }],
    },
    longinus_shard: {
        id: 'longinus_shard',
        name: lt('Осколок копья Лонгина', 'Shard of the Longinus Spear'),
        short: lt('Осколок', 'Shard'),
        rarity: 'unique',
        description: lt('×5 урона по Пророку.', '×5 damage to Prophet.'),
        set: 'sin',
        drops: [
            { enemyName: 'Mammon', chance: 0.25 },
            { enemyName: 'Mime', chance: 0.25 },
            { enemyName: 'Nimrod', chance: 0.25 },
            { enemyName: 'Gilgamesh', chance: 0.25 },
        ],
    },
};

const RELIC_ORDER: RelicId[] = Object.keys(RELICS) as RelicId[];

/**
 * Aggregate numeric effect bag, built by summing relic contributions.
 * Set bonuses that are unconditional (apply for the whole run while
 * the set is complete) are folded in by `applyUnconditionalSetBonuses`;
 * any set bonus that needs live combat state (HP threshold, on-hit
 * chance bumps, etc.) lives in CombatManager.
 */
export interface RelicAggregate {
    bonusAttack: number;
    bonusDefense: number;
    bonusMaxHp: number;
    /**
     * [item: lost_staff] Permanent +N to maxResolve. PlayerManager
     * mirrors aggregate growth into {@link RunResources.maxResolve}
     * the same way `bonusMaxHp` is mirrored into `stats.maxHp`.
     */
    bonusMaxResolve: number;
    /** [item: vampire_amulet] Chance 0..1 to restore HP after each player attack. */
    healOnAttackChance: number;
    healOnAttackAmount: number;
    /**
     * [item: dark_chestplate] Chance 0..1 that an incoming hit gets
     * its damage reduced by `damageReductionPercent` (0..1, e.g. 0.5
     * = block 50%). Floor rounding so 5 → blocks 2 → player takes 3.
     */
    damageReductionChance: number;
    damageReductionPercent: number;
    /**
     * [item: knight_sword] Chance 0..1 that the player's REGULAR
     * attack (not skills, not bleed ticks, not retaliate procs)
     * deals an extra `damageBonusOnAttackAmount` flat damage.
     */
    damageBonusOnAttackChance: number;
    damageBonusOnAttackAmount: number;
    /**
     * [item: knight_helmet] Chance 0..1 to restore N resolve when
     * the player gets hit. Resolved AFTER damage is applied so the
     * chance fires on every landed enemy hit.
     */
    resolveOnHitChance: number;
    resolveOnHitAmount: number;
    /**
     * [item: lost_staff] Flat +N current resolve every time the
     * player takes an attack action (basic strike or skill). Applied
     * via `player.gainResolve` so it caps at maxResolve.
     */
    resolveOnAttackAmount: number;
    /**
     * [item: greed_crown / sin set] Multiplier on every gainGold call.
     * Default 1 (no change). 1.5 = +50%, 2.0 = +100%. Combined with
     * `PlayerManager.metaGoldGainMult` (from MetaProgression) by
     * straight multiplication.
     */
    goldGainMult: number;
    /**
     * [sin set] Multiplier on every gainXp call. Default 1; rises to
     * 2.0 (+100%) when the sin set is complete.
     */
    xpGainMult: number;
    /**
     * [item: longinus_shard] Damage multiplier applied to player
     * damage when the enemy is the Prophet boss. Default 1; rises to
     * 5 with the relic. Applied AFTER all other player-side damage
     * modifiers but BEFORE the death check.
     */
    prophetDamageMult: number;
    /**
     * [item: four_leaf_clover / cursed set] Additive modifier to relic
     * drop chance, e.g. +0.1 from clover, -0.25 from full cursed set.
     *
     * Read in `rollRelicForEnemy` (Stage [4] drop formula). Added on
     * top of the `(X + Y*depth + Z + K*owned)/100` percent term as a
     * raw 0..1 fraction before clamping.
     */
    relicDropChanceMod: number;
    /** [npc Sara: vampire blessing] 25% chance to restore 2 HP on attack. */
    vampireBlessingChance: number;
    vampireBlessingAmount: number;
    /** Set membership. Used for set-bonus evaluation. */
    sets: {
        wanderer: boolean;
        flesh: boolean;
        knight: boolean;
        cursed: boolean;
        sin: boolean;
    };
}

export function emptyAggregate(): RelicAggregate {
    return {
        bonusAttack: 0,
        bonusDefense: 0,
        bonusMaxHp: 0,
        bonusMaxResolve: 0,
        healOnAttackChance: 0,
        healOnAttackAmount: 0,
        damageReductionChance: 0,
        damageReductionPercent: 0,
        damageBonusOnAttackChance: 0,
        damageBonusOnAttackAmount: 0,
        resolveOnHitChance: 0,
        resolveOnHitAmount: 0,
        resolveOnAttackAmount: 0,
        goldGainMult: 1,
        xpGainMult: 1,
        prophetDamageMult: 1,
        relicDropChanceMod: 0,
        vampireBlessingChance: 0,
        vampireBlessingAmount: 0,
        sets: {
            wanderer: false,
            flesh: false,
            knight: false,
            cursed: false,
            sin: false,
        },
    };
}

/**
 * Build the per-run aggregate from a list of owned relics. Stat bumps
 * add additively; chance effects pick the max so the addRelic guard
 * (which already blocks duplicates) keeps stacking sane.
 */
export function aggregateRelics(ids: RelicId[]): RelicAggregate {
    const agg = emptyAggregate();
    ids.forEach((id) => applyRelic(agg, id));
    applyUnconditionalSetBonuses(agg, ids);
    return agg;
}

function applyRelic(agg: RelicAggregate, id: RelicId) {
    switch (id) {
        case 'worn_ring':
            agg.bonusAttack += 1;
            break;
        case 'cracked_shield':
            agg.bonusMaxHp += 2;
            break;
        case 'tattered_cloak':
            agg.bonusMaxHp += 2;
            break;
        case 'vampire_amulet':
            agg.healOnAttackChance = Math.max(agg.healOnAttackChance, 0.1);
            agg.healOnAttackAmount = Math.max(agg.healOnAttackAmount, 2);
            break;
        case 'dark_chestplate':
            agg.damageReductionChance = Math.max(agg.damageReductionChance, 0.1);
            agg.damageReductionPercent = Math.max(agg.damageReductionPercent, 0.5);
            break;
        case 'four_leaf_clover':
            agg.relicDropChanceMod += 0.1;
            break;
        case 'knight_sword':
            agg.bonusAttack += 1;
            agg.damageBonusOnAttackChance = Math.max(agg.damageBonusOnAttackChance, 0.1);
            agg.damageBonusOnAttackAmount = Math.max(agg.damageBonusOnAttackAmount, 5);
            break;
        case 'knight_armor':
            agg.bonusDefense += 1;
            break;
        case 'knight_helmet':
            agg.bonusMaxHp += 2;
            agg.resolveOnHitChance = Math.max(agg.resolveOnHitChance, 0.4);
            agg.resolveOnHitAmount = Math.max(agg.resolveOnHitAmount, 1);
            break;
        case 'cursed_amulet':
            agg.bonusAttack += 2;
            agg.bonusDefense -= 3;
            break;
        case 'cursed_ring':
            agg.bonusAttack += 2;
            agg.bonusMaxResolve -= 2;
            break;
        case 'lost_staff':
            agg.bonusMaxResolve += 3;
            agg.resolveOnAttackAmount = Math.max(agg.resolveOnAttackAmount, 1);
            break;
        case 'greed_crown':
            agg.goldGainMult = Math.max(agg.goldGainMult, 1.5);
            break;
        case 'longinus_shard':
            agg.prophetDamageMult = Math.max(agg.prophetDamageMult, 5);
            break;
    }
}

function applyUnconditionalSetBonuses(agg: RelicAggregate, ids: RelicId[]) {
    const owned = new Set(ids);
    const isFullSet = (set: RelicSetId): boolean =>
        RELIC_ORDER.filter((rid) => RELICS[rid].set === set).every((rid) => owned.has(rid));

    agg.sets.wanderer = isFullSet('wanderer');
    agg.sets.flesh = isFullSet('flesh');
    agg.sets.knight = isFullSet('knight');
    agg.sets.cursed = isFullSet('cursed');
    agg.sets.sin = isFullSet('sin');

    // Wanderer set (3 pieces): +2 attack, +2 max HP.
    if (agg.sets.wanderer) {
        agg.bonusAttack += 2;
        agg.bonusMaxHp += 2;
    }

    // Flesh set (2 pieces): +3 max HP, AND the proc chance of both
    // flesh items rises from 10% → 30%. Only the chances bump; the
    // amounts (2 HP heal, 50% reduction) stay at the base values.
    if (agg.sets.flesh) {
        agg.bonusMaxHp += 3;
        agg.healOnAttackChance = Math.max(agg.healOnAttackChance, 0.3);
        agg.damageReductionChance = Math.max(agg.damageReductionChance, 0.3);
    }

    // Knight set (3 pieces): +3 defense, -3 attack. The negative
    // attack is intentional per the design sheet.
    if (agg.sets.knight) {
        agg.bonusDefense += 3;
        agg.bonusAttack -= 3;
    }

    // Cursed set (2 pieces): +4 attack, +2 max HP, -25% relic drop
    // chance modifier (dormant on the drop side until Stage [4]).
    if (agg.sets.cursed) {
        agg.bonusAttack += 4;
        agg.bonusMaxHp += 2;
        agg.relicDropChanceMod -= 0.25;
    }

    // Sin set (2 pieces, Книга Лжи deferred): +100% xp, AND Crown's
    // gold multiplier rises from 1.5 to 2.0.
    if (agg.sets.sin) {
        agg.xpGainMult = Math.max(agg.xpGainMult, 2);
        agg.goldGainMult = Math.max(agg.goldGainMult, 2);
    }
}

/**
 * Roll a relic drop for the slain enemy under the Stage [4] formula.
 *
 * Pipeline:
 *   1. Filter the global `RELICS` table down to entries whose
 *      `drops` mention `enemyName` AND whose `id` is not in `owned`.
 *   2. If any such entry has `chance >= 1.0`, return it immediately
 *      (guaranteed drop — used by Crown of Greed on Mammon). The
 *      formula is bypassed in that case.
 *   3. Otherwise compute the drop chance:
 *        dropChance = (X + Y*depth + Z + K*owned)/100 + relicMod
 *      where X is a uniform integer in `[xMin..xMax]`, Y/K from
 *      {@link DROP_FORMULA}, Z is `enemyDropMod` (read from the
 *      enemy table by callers via `getEnemyDropMod`), and relicMod
 *      is `aggregate.relicDropChanceMod` (Clover, Cursed set).
 *      Clamped to `[0..1]`.
 *   4. Roll `rng.next() < dropChance`. On miss, return null. On
 *      hit, weighted-random pick across the candidate list using
 *      each entry's per-enemy `chance` as the weight.
 *
 * Returns null when nothing drops or every match is already owned.
 */
export function rollRelicForEnemy(
    enemyName: string,
    owned: RelicId[],
    depth: number,
    relicMod: number,
    enemyDropMod: number,
    rng: Rng = defaultRng
): RelicId | null {
    const ownedSet = new Set(owned);
    // Collect every (relicId, weight) pair whose drop entry matches
    // this enemy and which the player doesn't already have.
    const candidates: { id: RelicId; weight: number }[] = [];
    let guaranteed: RelicId | null = null;
    for (const rid of RELIC_ORDER) {
        if (ownedSet.has(rid)) continue;
        const def = RELICS[rid];
        for (const drop of def.drops) {
            if (drop.enemyName !== enemyName) continue;
            if (drop.chance >= 1) {
                // First guaranteed drop wins; no further candidates
                // are evaluated. Mirrors the design sheet's
                // "guaranteed" semantics for Crown of Greed on Mammon.
                guaranteed = rid;
                break;
            }
            candidates.push({ id: rid, weight: drop.chance });
            break;
        }
        if (guaranteed) break;
    }

    if (guaranteed) return guaranteed;
    if (candidates.length === 0) return null;

    // X term: uniform integer in [xMin..xMax] inclusive.
    const xRange = DROP_FORMULA.xMax - DROP_FORMULA.xMin + 1;
    const x = Math.floor(rng.next() * xRange) + DROP_FORMULA.xMin;
    const y = DROP_FORMULA.perDepth * depth;
    const z = enemyDropMod;
    const k = DROP_FORMULA.perOwnedRelic * owned.length;
    const dropChance = Math.max(0, Math.min(1, (x + y + z + k) / 100 + relicMod));
    if (dropChance <= 0) return null;
    if (rng.next() >= dropChance) return null;

    // Weighted pick across the unowned candidate list. Weights are
    // the per-enemy `chance` field reinterpreted as relative weights
    // under the Stage [4] semantics.
    const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
    if (totalWeight <= 0) {
        // Fall back to uniform pick if every weight is 0 (shouldn't
        // happen with the current data but the math has to be safe).
        return candidates[Math.floor(rng.next() * candidates.length)].id;
    }
    let target = rng.next() * totalWeight;
    for (const c of candidates) {
        target -= c.weight;
        if (target < 0) return c.id;
    }
    // Floating-point guard: return the last candidate if the loop
    // exits without picking (target ≈ 0 right at the boundary).
    return candidates[candidates.length - 1].id;
}

/**
 * Generic fallback drop used by treasure / shrine rooms which are not
 * tied to a specific enemy. Prefers the requested rarity but falls
 * back to any unowned item.
 */
export function rollRelic(
    owned: RelicId[],
    rarityHint: RelicRarity = 'common',
    rng: Rng = defaultRng
): RelicId | null {
    const pool = RELIC_ORDER.filter((id) => !owned.includes(id));
    if (pool.length === 0) return null;
    const preferred = pool.filter((id) => RELICS[id].rarity === rarityHint);
    const target = preferred.length > 0 ? preferred : pool;
    return target[Math.floor(rng.next() * target.length)];
}

export function rollRelicFor(
    owned: RelicId[],
    kind: 'normal' | 'elite' | 'boss',
    rng: Rng = defaultRng
): RelicId | null {
    if (kind === 'boss') return rollRelic(owned, 'unique', rng);
    if (kind === 'elite') return rollRelic(owned, 'rare', rng);
    return rollRelic(owned, 'common', rng);
}
