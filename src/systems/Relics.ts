import type { LocalizedText } from './LocalizedText';
import { lt } from './LocalizedText';
import { defaultRng, type Rng } from './Rng';

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
    name: LocalizedText;
    short: LocalizedText;
    rarity: RelicRarity;
    description: LocalizedText;
}

export const RELICS: Record<RelicId, RelicDef> = {
    bloodied_fang: {
        id: 'bloodied_fang',
        name: lt('Окровавленный клык', 'Bloodied Fang'),
        short: lt('Клык', 'Fang'),
        rarity: 'common',
        description: lt(
            'Обычные атаки накладывают Кровотечение 1 на 2 хода.',
            'Basic attacks also inflict Bleed 1 for 2 turns.'
        ),
    },
    iron_will: {
        id: 'iron_will',
        name: lt('Железная воля', 'Iron Will'),
        short: lt('Воля', 'Iron'),
        rarity: 'common',
        description: lt(
            '+1 к защите. Первое Оглушение в каждом бою не срабатывает.',
            '+1 Defense. You resist the first stun each combat.'
        ),
    },
    embervow: {
        id: 'embervow',
        name: lt('Угольный обет', 'Ember Vow'),
        short: lt('Уголь', 'Ember'),
        rarity: 'rare',
        description: lt(
            '+25% к урону, пока у тебя не больше 33% ОЗ.',
            '+25% damage while at or below 33% HP.'
        ),
    },
    lanterns_oath: {
        id: 'lanterns_oath',
        name: lt('Обет фонаря', "Lantern's Oath"),
        short: lt('Обет', 'Oath'),
        rarity: 'common',
        description: lt(
            'Пустые комнаты не гасят фонарь.',
            'Empty rooms do not drain your light.'
        ),
    },
    gamblers_knuckle: {
        id: 'gamblers_knuckle',
        name: lt('Костяшка игрока', "Gambler's Knuckle"),
        short: lt('Кость', 'Knuck'),
        rarity: 'rare',
        description: lt(
            '+12% к шансу крита. Криты возвращают 1 волю.',
            '+12% crit chance. Your crits restore 1 resolve.'
        ),
    },
    shade_mask: {
        id: 'shade_mask',
        name: lt('Маска тени', 'Shade Mask'),
        short: lt('Маска', 'Mask'),
        rarity: 'rare',
        description: lt(
            'Первая атака врага в каждом бою проходит мимо.',
            'First enemy action each combat is evaded.'
        ),
    },
    thorned_mail: {
        id: 'thorned_mail',
        name: lt('Шипастая кольчуга', 'Thorned Mail'),
        short: lt('Шипы', 'Thorns'),
        rarity: 'common',
        description: lt(
            'Враги получают 2 урона каждый раз, когда попадают по тебе.',
            'Enemies take 2 damage whenever they hit you.'
        ),
    },
    vampiric_sigil: {
        id: 'vampiric_sigil',
        name: lt('Вампирская печать', 'Vampiric Sigil'),
        short: lt('Печать', 'Sigil'),
        rarity: 'rare',
        description: lt(
            'Убийство или крит восстанавливают 2 ОЗ.',
            'Heal 2 HP each time you kill an enemy or crit.'
        ),
    },
    stoneheart: {
        id: 'stoneheart',
        name: lt('Каменное сердце', 'Stoneheart'),
        short: lt('Камень', 'Stone'),
        rarity: 'common',
        description: lt(
            '+8 к макс. ОЗ. Отдых лечит ещё на 3.',
            '+8 Max HP. Heal +3 at every Rest.'
        ),
    },
    rally_standard: {
        id: 'rally_standard',
        name: lt('Стяг сбора', 'Rally Standard'),
        short: lt('Стяг', 'Rally'),
        rarity: 'rare',
        description: lt(
            'В начале боя: Фокус +1 на 3 хода.',
            'Start combat with Focus +1 for 3 turns.'
        ),
    },
    cursed_coin: {
        id: 'cursed_coin',
        name: lt('Проклятая монета', 'Cursed Coin'),
        short: lt('Монета', 'Coin'),
        rarity: 'common',
        description: lt(
            '+50% к золоту. Ловушки наносят тебе +1 урона.',
            '+50% gold gain. You take +1 damage from traps.'
        ),
    },
    ossuary_rosary: {
        id: 'ossuary_rosary',
        name: lt('Костяные чётки', 'Ossuary Rosary'),
        short: lt('Чётки', 'Rosary'),
        rarity: 'common',
        description: lt(
            'Получаемый стресс снижен на 30%.',
            'Stress gain is reduced by 30%.'
        ),
    },
    witchglass: {
        id: 'witchglass',
        name: lt('Ведьмино стекло', 'Witchglass'),
        short: lt('Стекло', 'Glass'),
        rarity: 'rare',
        description: lt(
            'Показывает два следующих слоя комнат.',
            'Always see the next TWO layers of rooms.'
        ),
    },
    pyre_ash: {
        id: 'pyre_ash',
        name: lt('Пепел костра', 'Pyre Ash'),
        short: lt('Пепел', 'Pyre'),
        rarity: 'rare',
        description: lt(
            'Твоё Кровотечение длится на 1 ход дольше и получает +1 заряд.',
            'Bleed you apply lasts +1 turn and has +1 stack.'
        ),
    },
    silent_boots: {
        id: 'silent_boots',
        name: lt('Тихие сапоги', 'Silent Boots'),
        short: lt('Сапоги', 'Boots'),
        rarity: 'common',
        description: lt(
            'Ты всегда ходишь первым. +5% к шансу крита.',
            'Always act first. +5% crit chance.'
        ),
    },
    warden_oath: {
        id: 'warden_oath',
        name: lt('Обет стража', "Warden's Oath"),
        short: lt('Страж', 'Warden'),
        rarity: 'rare',
        description: lt(
            'Защита блокирует ещё 3 урона.',
            'Defending blocks +3 extra damage.'
        ),
    },
    revenants_spite: {
        id: 'revenants_spite',
        name: lt('Злоба ревенанта', "Revenant's Spite"),
        short: lt('Злоба', 'Spite'),
        rarity: 'unique',
        description: lt(
            'Смертельный удар вместо смерти восстанавливает 10 ОЗ. Один раз за забег.',
            'When you would die, instead heal 10 HP. Once per run.'
        ),
    },
    herbalist_kit: {
        id: 'herbalist_kit',
        name: lt('Набор травника', "Herbalist's Kit"),
        short: lt('Травы', 'Herbs'),
        rarity: 'common',
        description: lt(
            'Эликсиры лечат ещё на 4 ОЗ и дают Регенерацию 1 на 3 хода.',
            'Potions heal +4 HP and grant Regen 1 for 3 turns.'
        ),
    },
    mercy_token: {
        id: 'mercy_token',
        name: lt('Жетон милости', 'Mercy Token'),
        short: lt('Милость', 'Mercy'),
        rarity: 'unique',
        description: lt(
            'Штрафы от слабого света вдвое меньше. +1 стартовый свет.',
            'Low-light penalties are halved. +1 starting light.'
        ),
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
    if (kind === 'boss') return rollRelic(owned, 'rare', rng);
    if (kind === 'elite') {
        return rng.next() < 0.3
            ? rollRelic(owned, 'rare', rng)
            : rollRelic(owned, 'common', rng);
    }
    return rollRelic(owned, 'common', rng);
}
