// Relic catalog. Relics are permanent modifiers for the current run.
// They stack additively. Relics are acquired from boss rooms, elite rooms,
// treasure rooms (small chance), merchants (via shards), and shrines.
//
// All effects are evaluated via accumulated "aggregate" at combat time so
// the math stays centralized in CombatManager / PlayerManager.

export type RelicId =
    | 'bloodied_fang'
    | 'iron_will'
    | 'embervow'
    | 'lanterns_oath'
    | 'gamblers_knuckle'
    | 'shade_mask'
    | 'thorned_mail'
    | 'vampiric_sigil'
    | 'stoneheart'
    | 'rally_standard'
    | 'cursed_coin'
    | 'ossuary_rosary'
    | 'witchglass'
    | 'pyre_ash'
    | 'silent_boots'
    | 'warden_oath'
    | 'revenants_spite'
    | 'herbalist_kit'
    | 'mercy_token';

export type RelicRarity = 'common' | 'rare' | 'unique';

export interface RelicDef {
    id: RelicId;
    name: string;
    short: string;
    rarity: RelicRarity;
    description: string;
}

export const RELICS: Record<RelicId, RelicDef> = {
    bloodied_fang: {
        id: 'bloodied_fang',
        name: 'Bloodied Fang',
        short: 'Fang',
        rarity: 'common',
        description: 'Basic attacks also inflict Bleed 1 for 2 turns.',
    },
    iron_will: {
        id: 'iron_will',
        name: 'Iron Will',
        short: 'Iron',
        rarity: 'common',
        description: '+1 Defense. You resist the first stun each combat.',
    },
    embervow: {
        id: 'embervow',
        name: 'Ember Vow',
        short: 'Ember',
        rarity: 'rare',
        description: '+25% damage while at or below 33% HP.',
    },
    lanterns_oath: {
        id: 'lanterns_oath',
        name: "Lantern's Oath",
        short: 'Oath',
        rarity: 'common',
        description: 'Empty rooms do not drain your light.',
    },
    gamblers_knuckle: {
        id: 'gamblers_knuckle',
        name: "Gambler's Knuckle",
        short: 'Knuck',
        rarity: 'rare',
        description: '+12% crit chance. Your crits restore 1 resolve.',
    },
    shade_mask: {
        id: 'shade_mask',
        name: 'Shade Mask',
        short: 'Mask',
        rarity: 'rare',
        description: 'First enemy action each combat is evaded.',
    },
    thorned_mail: {
        id: 'thorned_mail',
        name: 'Thorned Mail',
        short: 'Thorns',
        rarity: 'common',
        description: 'Enemies take 2 damage whenever they hit you.',
    },
    vampiric_sigil: {
        id: 'vampiric_sigil',
        name: 'Vampiric Sigil',
        short: 'Sigil',
        rarity: 'rare',
        description: 'Heal 2 HP each time you kill an enemy or crit.',
    },
    stoneheart: {
        id: 'stoneheart',
        name: 'Stoneheart',
        short: 'Stone',
        rarity: 'common',
        description: '+8 Max HP. Heal +3 at every Rest.',
    },
    rally_standard: {
        id: 'rally_standard',
        name: 'Rally Standard',
        short: 'Rally',
        rarity: 'rare',
        description: 'Start combat with Focus +1 for 3 turns.',
    },
    cursed_coin: {
        id: 'cursed_coin',
        name: 'Cursed Coin',
        short: 'Coin',
        rarity: 'common',
        description: '+50% gold gain. You take +1 damage from traps.',
    },
    ossuary_rosary: {
        id: 'ossuary_rosary',
        name: 'Ossuary Rosary',
        short: 'Rosary',
        rarity: 'common',
        description: 'Stress gain is reduced by 30%.',
    },
    witchglass: {
        id: 'witchglass',
        name: 'Witchglass',
        short: 'Glass',
        rarity: 'rare',
        description: 'Always see the next TWO layers of rooms.',
    },
    pyre_ash: {
        id: 'pyre_ash',
        name: 'Pyre Ash',
        short: 'Pyre',
        rarity: 'rare',
        description: 'Bleed you apply lasts +1 turn and has +1 stack.',
    },
    silent_boots: {
        id: 'silent_boots',
        name: 'Silent Boots',
        short: 'Boots',
        rarity: 'common',
        description: 'Always act first. +5% crit chance.',
    },
    warden_oath: {
        id: 'warden_oath',
        name: "Warden's Oath",
        short: 'Warden',
        rarity: 'rare',
        description: 'Defending blocks +3 extra damage.',
    },
    revenants_spite: {
        id: 'revenants_spite',
        name: "Revenant's Spite",
        short: 'Spite',
        rarity: 'unique',
        description: 'When you would die, instead heal 10 HP. Once per run.',
    },
    herbalist_kit: {
        id: 'herbalist_kit',
        name: "Herbalist's Kit",
        short: 'Herbs',
        rarity: 'common',
        description: 'Potions heal +4 HP and grant Regen 1 for 3 turns.',
    },
    mercy_token: {
        id: 'mercy_token',
        name: 'Mercy Token',
        short: 'Mercy',
        rarity: 'unique',
        description: 'Low-light penalties are halved. +1 starting light.',
    },
};

export const RELIC_ORDER: RelicId[] = Object.keys(RELICS) as RelicId[];

/** Aggregate numeric effect bag, built by summing relic contributions. */
export interface RelicAggregate {
    bonusDefense: number;
    bonusMaxHp: number;
    bonusStartingLight: number;
    bonusAttack: number;
    critChanceBonus: number;
    thornsDamage: number;
    lowHpDamageBonus: number; // fraction, e.g. 0.25
    lowHpThreshold: number; // fraction of maxHp
    lifestealOnKill: number;
    lifestealOnCrit: number;
    goldMultiplier: number;
    trapDamageMod: number;
    stressReductionPct: number; // e.g. 0.3 means -30%
    bleedOnAttackStacks: number;
    bleedOnAttackTurns: number;
    bleedStackBonus: number;
    bleedTurnBonus: number;
    defendExtraBlock: number;
    startCombatFocus: number; // turns of focus+1 at combat start
    evadeFirstHit: boolean;
    emptyRoomsSpareLight: boolean;
    resistFirstStun: boolean;
    reviveOnce: boolean;
    alwaysActFirst: boolean;
    mapRevealLayers: number; // additional layers to reveal
    potionHealBonus: number;
    potionRegenTurns: number;
    lowLightPenaltyMult: number; // 1 = normal, 0.5 = halved
    restHealBonus: number;
    critResolveGain: number; // resolve restored per crit
}

export function emptyAggregate(): RelicAggregate {
    return {
        bonusDefense: 0,
        bonusMaxHp: 0,
        bonusStartingLight: 0,
        bonusAttack: 0,
        critChanceBonus: 0,
        thornsDamage: 0,
        lowHpDamageBonus: 0,
        lowHpThreshold: 0,
        lifestealOnKill: 0,
        lifestealOnCrit: 0,
        goldMultiplier: 1,
        trapDamageMod: 0,
        stressReductionPct: 0,
        bleedOnAttackStacks: 0,
        bleedOnAttackTurns: 0,
        bleedStackBonus: 0,
        bleedTurnBonus: 0,
        defendExtraBlock: 0,
        startCombatFocus: 0,
        evadeFirstHit: false,
        emptyRoomsSpareLight: false,
        resistFirstStun: false,
        reviveOnce: false,
        alwaysActFirst: false,
        mapRevealLayers: 1,
        potionHealBonus: 0,
        potionRegenTurns: 0,
        lowLightPenaltyMult: 1,
        restHealBonus: 0,
        critResolveGain: 0,
    };
}

export function aggregateRelics(ids: RelicId[]): RelicAggregate {
    const agg = emptyAggregate();
    ids.forEach((id) => applyRelic(agg, id));
    return agg;
}

function applyRelic(agg: RelicAggregate, id: RelicId) {
    switch (id) {
        case 'bloodied_fang':
            agg.bleedOnAttackStacks = Math.max(agg.bleedOnAttackStacks, 1);
            agg.bleedOnAttackTurns = Math.max(agg.bleedOnAttackTurns, 2);
            break;
        case 'iron_will':
            agg.bonusDefense += 1;
            agg.resistFirstStun = true;
            break;
        case 'embervow':
            agg.lowHpDamageBonus += 0.25;
            agg.lowHpThreshold = Math.max(agg.lowHpThreshold, 0.33);
            break;
        case 'lanterns_oath':
            agg.emptyRoomsSpareLight = true;
            break;
        case 'gamblers_knuckle':
            agg.critChanceBonus += 0.12;
            agg.critResolveGain += 1;
            break;
        case 'shade_mask':
            agg.evadeFirstHit = true;
            break;
        case 'thorned_mail':
            agg.thornsDamage += 2;
            break;
        case 'vampiric_sigil':
            agg.lifestealOnKill += 2;
            agg.lifestealOnCrit += 2;
            break;
        case 'stoneheart':
            agg.bonusMaxHp += 8;
            agg.restHealBonus += 3;
            break;
        case 'rally_standard':
            agg.startCombatFocus = Math.max(agg.startCombatFocus, 3);
            break;
        case 'cursed_coin':
            agg.goldMultiplier *= 1.5;
            agg.trapDamageMod += 1;
            break;
        case 'ossuary_rosary':
            agg.stressReductionPct = Math.max(agg.stressReductionPct, 0.3);
            break;
        case 'witchglass':
            agg.mapRevealLayers = Math.max(agg.mapRevealLayers, 2);
            break;
        case 'pyre_ash':
            agg.bleedStackBonus += 1;
            agg.bleedTurnBonus += 1;
            break;
        case 'silent_boots':
            agg.alwaysActFirst = true;
            agg.critChanceBonus += 0.05;
            break;
        case 'warden_oath':
            agg.defendExtraBlock += 3;
            break;
        case 'revenants_spite':
            agg.reviveOnce = true;
            break;
        case 'herbalist_kit':
            agg.potionHealBonus += 4;
            agg.potionRegenTurns = Math.max(agg.potionRegenTurns, 3);
            break;
        case 'mercy_token':
            agg.lowLightPenaltyMult = Math.min(agg.lowLightPenaltyMult, 0.5);
            agg.bonusStartingLight += 1;
            break;
    }
}

export function rollRelic(
    owned: RelicId[],
    rarityHint: RelicRarity = 'common'
): RelicId | null {
    const pool = RELIC_ORDER.filter((id) => !owned.includes(id));
    if (pool.length === 0) return null;

    const preferred = pool.filter((id) => RELICS[id].rarity === rarityHint);
    const target = preferred.length > 0 ? preferred : pool;
    return target[Math.floor(Math.random() * target.length)];
}

export function rollRelicFor(owned: RelicId[], kind: 'normal' | 'elite' | 'boss'): RelicId | null {
    if (kind === 'boss') return rollRelic(owned, 'rare');
    if (kind === 'elite') {
        return Math.random() < 0.3 ? rollRelic(owned, 'rare') : rollRelic(owned, 'common');
    }
    return rollRelic(owned, 'common');
}
