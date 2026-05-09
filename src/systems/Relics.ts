import type { LocalizedText } from './LocalizedText';
import { lt } from './LocalizedText';
import { defaultRng, type Rng } from './Rng';

// Relic catalog. Items are permanent run modifiers that mostly bump
// stats with a few chance-based on-hit effects. They are grouped into
// four sets; owning every item in a set unlocks a SET BONUS that is
// evaluated per attack so HP-conditional bonuses can swap mid-combat.
//
// Numeric effects are folded into a single RelicAggregate at combat
// time so PlayerManager / CombatManager have one source of truth.

export type RelicId =
    | 'worn_ring'
    | 'cracked_shield'
    | 'tattered_cloak'
    | 'cracked_amulet'
    | 'holey_chestplate'
    | 'simple_sword'
    | 'simple_chestplate'
    | 'simple_helmet'
    | 'cursed_amulet'
    | 'cursed_ring';

export type RelicRarity = 'common' | 'rare' | 'unique';

type RelicSetId = 'wanderer' | 'flesh' | 'recruit' | 'minor_cursed';

/** Drop table entry: which enemy drops this item with what chance (0..1). */
interface RelicDropEntry {
    /** Canonical English enemy `name` (matches GameConfig.ENEMY_TIERS / BOSSES). */
    enemyName: string;
    /** Probability the item drops on that enemy's death. */
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
            { enemyName: 'Rat', chance: 0.2 },
            { enemyName: 'Slime', chance: 0.2 },
        ],
    },
    cracked_shield: {
        id: 'cracked_shield',
        name: lt('Треснутый щит', 'Cracked Shield'),
        short: lt('Щит', 'Shield'),
        rarity: 'common',
        description: lt('+1 защита.', '+1 defense.'),
        set: 'wanderer',
        drops: [{ enemyName: 'Skeleton', chance: 0.2 }],
    },
    tattered_cloak: {
        id: 'tattered_cloak',
        name: lt('Потрёпанный плащ', 'Tattered Cloak'),
        short: lt('Плащ', 'Cloak'),
        rarity: 'common',
        description: lt('+1 жизнь.', '+1 max HP.'),
        set: 'wanderer',
        drops: [{ enemyName: 'Skeleton', chance: 0.2 }],
    },
    cracked_amulet: {
        id: 'cracked_amulet',
        name: lt('Треснутый амулет', 'Cracked Amulet'),
        short: lt('Амулет', 'Amulet'),
        rarity: 'rare',
        description: lt(
            '+1 жизнь. Шанс 15% восстановить 1 ОЗ при ударе.',
            '+1 max HP. 15% chance to restore 1 HP on attack.'
        ),
        set: 'flesh',
        drops: [{ enemyName: 'Bat', chance: 0.2 }],
    },
    holey_chestplate: {
        id: 'holey_chestplate',
        name: lt('Дырявый нагрудник', 'Holey Chestplate'),
        short: lt('Нагрудник', 'Chest'),
        rarity: 'rare',
        description: lt(
            '+1 жизнь. Шанс 15% заблокировать 2 урона.',
            '+1 max HP. 15% chance to block 2 damage.'
        ),
        set: 'flesh',
        drops: [{ enemyName: 'Ghoul', chance: 0.3 }],
    },
    simple_sword: {
        id: 'simple_sword',
        name: lt('Обычный меч', 'Simple Sword'),
        short: lt('Меч', 'Sword'),
        rarity: 'common',
        description: lt('+3 урон.', '+3 attack.'),
        set: 'recruit',
        drops: [{ enemyName: 'Skeleton Swordsman', chance: 0.3 }],
    },
    simple_chestplate: {
        id: 'simple_chestplate',
        name: lt('Обычный нагрудник', 'Simple Chestplate'),
        short: lt('Бронь', 'Plate'),
        rarity: 'common',
        description: lt('+3 защита.', '+3 defense.'),
        set: 'recruit',
        drops: [{ enemyName: 'Steel Lynx', chance: 0.3 }],
    },
    simple_helmet: {
        id: 'simple_helmet',
        name: lt('Обычный шлем', 'Simple Helmet'),
        short: lt('Шлем', 'Helm'),
        rarity: 'common',
        description: lt('+5 жизней.', '+5 max HP.'),
        set: 'recruit',
        drops: [{ enemyName: 'Skeleton Swordsman', chance: 0.3 }],
    },
    cursed_amulet: {
        id: 'cursed_amulet',
        name: lt('Проклятый амулет', 'Cursed Amulet'),
        short: lt('Прокл. амул.', 'Curs. Amul.'),
        rarity: 'unique',
        description: lt(
            '+6 урон. Шанс 10% промахнуться при атаке.',
            '+6 attack. 10% chance to miss on attack.'
        ),
        set: 'minor_cursed',
        drops: [{ enemyName: 'Death Knight', chance: 0.5 }],
    },
    cursed_ring: {
        id: 'cursed_ring',
        name: lt('Проклятое кольцо', 'Cursed Ring'),
        short: lt('Прокл. кольцо', 'Curs. Ring'),
        rarity: 'unique',
        description: lt(
            '+3 защита, +3 жизни. Шанс 10% применить обычный удар вместо способности.',
            '+3 defense, +3 max HP. 10% chance a skill becomes a basic attack.'
        ),
        set: 'minor_cursed',
        drops: [{ enemyName: 'Death Knight', chance: 0.5 }],
    },
};

const RELIC_ORDER: RelicId[] = Object.keys(RELICS) as RelicId[];

/** Aggregate numeric effect bag, built by summing relic contributions. */
export interface RelicAggregate {
    bonusAttack: number;
    bonusDefense: number;
    bonusMaxHp: number;
    /** [item: cracked_amulet] Chance 0..1 to restore HP on a basic attack. */
    healOnAttackChance: number;
    healOnAttackAmount: number;
    /** [item: holey_chestplate] Chance 0..1 to block N damage on incoming hit. */
    blockOnHitChance: number;
    blockOnHitAmount: number;
    /** [item: cursed_amulet] Chance 0..1 to whiff a basic attack. */
    missChance: number;
    /** [item: cursed_ring] Chance 0..1 a Will-skill resolves as a basic strike. */
    skillToBasicChance: number;
    /** [npc Sara: vampire blessing] 25% chance to restore 2 HP on attack. */
    vampireBlessingChance: number;
    vampireBlessingAmount: number;
    /** Set membership. Used for set-bonus evaluation. */
    sets: {
        wanderer: boolean;
        flesh: boolean;
        recruit: boolean;
        minor_cursed: boolean;
    };
}

export function emptyAggregate(): RelicAggregate {
    return {
        bonusAttack: 0,
        bonusDefense: 0,
        bonusMaxHp: 0,
        healOnAttackChance: 0,
        healOnAttackAmount: 0,
        blockOnHitChance: 0,
        blockOnHitAmount: 0,
        missChance: 0,
        skillToBasicChance: 0,
        vampireBlessingChance: 0,
        vampireBlessingAmount: 0,
        sets: {
            wanderer: false,
            flesh: false,
            recruit: false,
            minor_cursed: false,
        },
    };
}

/**
 * Build the per-run aggregate from a list of owned relics. Stat bumps
 * add additively; chance effects pick the max so the addRelic guard
 * (which already blocks duplicates) keeps stacking sane.
 *
 * Set bonuses are folded in here for the unconditional pieces. The
 * conditional pieces (flesh "below 50% HP", minor-cursed coin flip
 * on every attack) live in CombatManager so they can react to live
 * combat state.
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
            agg.bonusDefense += 1;
            break;
        case 'tattered_cloak':
            agg.bonusMaxHp += 1;
            break;
        case 'cracked_amulet':
            agg.bonusMaxHp += 1;
            agg.healOnAttackChance = Math.max(agg.healOnAttackChance, 0.15);
            agg.healOnAttackAmount = Math.max(agg.healOnAttackAmount, 1);
            break;
        case 'holey_chestplate':
            agg.bonusMaxHp += 1;
            agg.blockOnHitChance = Math.max(agg.blockOnHitChance, 0.15);
            agg.blockOnHitAmount = Math.max(agg.blockOnHitAmount, 2);
            break;
        case 'simple_sword':
            agg.bonusAttack += 3;
            break;
        case 'simple_chestplate':
            agg.bonusDefense += 3;
            break;
        case 'simple_helmet':
            agg.bonusMaxHp += 5;
            break;
        case 'cursed_amulet':
            agg.bonusAttack += 6;
            agg.missChance = Math.max(agg.missChance, 0.1);
            break;
        case 'cursed_ring':
            agg.bonusDefense += 3;
            agg.bonusMaxHp += 3;
            agg.skillToBasicChance = Math.max(agg.skillToBasicChance, 0.1);
            break;
    }
}

function applyUnconditionalSetBonuses(agg: RelicAggregate, ids: RelicId[]) {
    const owned = new Set(ids);
    const isFullSet = (set: RelicSetId): boolean =>
        RELIC_ORDER.filter((rid) => RELICS[rid].set === set).every((rid) => owned.has(rid));

    agg.sets.wanderer = isFullSet('wanderer');
    agg.sets.flesh = isFullSet('flesh');
    agg.sets.recruit = isFullSet('recruit');
    agg.sets.minor_cursed = isFullSet('minor_cursed');

    if (agg.sets.wanderer) {
        agg.bonusAttack += 1;
        agg.bonusMaxHp += 1;
    }
    if (agg.sets.recruit) {
        agg.bonusDefense += 2;
        agg.bonusMaxHp += 2;
        agg.bonusAttack += 2;
    }
    // Flesh and minor_cursed bonuses are evaluated per turn / per
    // attack in CombatManager and intentionally do not land here.
}

/**
 * Roll a relic drop for the slain enemy. Each entry in the enemy's
 * drop table is rolled independently; if multiple succeed, one is
 * picked uniformly. Returns null when nothing drops or every match
 * is already owned.
 */
export function rollRelicForEnemy(
    enemyName: string,
    owned: RelicId[],
    rng: Rng = defaultRng
): RelicId | null {
    const ownedSet = new Set(owned);
    const candidates: RelicId[] = [];
    for (const rid of RELIC_ORDER) {
        if (ownedSet.has(rid)) continue;
        const def = RELICS[rid];
        for (const drop of def.drops) {
            if (drop.enemyName !== enemyName) continue;
            if (rng.next() < drop.chance) {
                candidates.push(rid);
                break;
            }
        }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(rng.next() * candidates.length)];
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
