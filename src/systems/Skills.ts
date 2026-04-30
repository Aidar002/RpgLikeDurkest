import type { LocalizedText } from './LocalizedText';
import { lt } from './LocalizedText';

// Skill catalog. A skill is a combat action that spends resolve and produces
// some combination of damage + status + self effects. The player picks a
// loadout of up to 2 skills when an expedition begins. Extra skills unlock
// through meta progression (see MetaProgressionManager.UNLOCK_SKILL_*).

export type SkillId =
    | 'cleave'
    | 'bleed_strike'
    | 'parry_stance'
    | 'focused_strike'
    | 'rupture'
    | 'adrenaline'
    | 'crushing_blow';

export interface SkillDef {
    id: SkillId;
    name: LocalizedText;
    short: LocalizedText; // shown on button: max ~14 chars
    resolveCost: number;
    description: LocalizedText;
    color: number; // button fill color
    starter: boolean;
}

export const SKILLS: Record<SkillId, SkillDef> = {
    cleave: {
        id: 'cleave',
        name: lt('Рубящий удар', 'Cleave'),
        short: lt('Рубка', 'Cleave'),
        resolveCost: 2,
        description: lt(
            'Тяжёлый удар сверху: 1.8x атаки + 2 урона.',
            'Heavy overhead strike. 1.8x attack + 2 damage.'
        ),
        color: 0x5a2d78,
        starter: true,
    },
    bleed_strike: {
        id: 'bleed_strike',
        name: lt('Кровопускание', 'Bleed Strike'),
        short: lt('Кровь', 'Bleed'),
        resolveCost: 2,
        description: lt(
            '1.1x атаки. Накладывает Кровотечение x2 на 3 хода.',
            '1.1x attack damage. Inflicts Bleed x2 for 3 turns.'
        ),
        color: 0x8a2a2a,
        starter: true,
    },
    parry_stance: {
        id: 'parry_stance',
        name: lt('Парирующая стойка', 'Parry Stance'),
        short: lt('Парир.', 'Parry'),
        resolveCost: 2,
        description: lt(
            'Даёт Защиту 4x2 и оглушает врага на 1 ход.',
            'Gain Guard 4x2 and stun the enemy for 1 turn.'
        ),
        color: 0x2a5080,
        starter: false,
    },
    focused_strike: {
        id: 'focused_strike',
        name: lt('Точный удар', 'Focused Strike'),
        short: lt('Точный', 'Focus'),
        resolveCost: 1,
        description: lt(
            '0.9x атаки. Ставит Метку: следующий твой удар будет критическим.',
            '0.9x attack. Enemy is Marked: your next hit is critical.'
        ),
        color: 0x5a5a2d,
        starter: false,
    },
    rupture: {
        id: 'rupture',
        name: lt('Разрыв', 'Rupture'),
        short: lt('Разрыв', 'Rupture'),
        resolveCost: 3,
        description: lt(
            'Наносит урон, равный 22% от максимального ОЗ врага, но не меньше силы атаки.',
            'Damage equal to 22% of enemy max HP (min = attack).'
        ),
        color: 0x80366a,
        starter: false,
    },
    adrenaline: {
        id: 'adrenaline',
        name: lt('Адреналин', 'Adrenaline'),
        short: lt('Адрен.', 'Rally'),
        resolveCost: 2,
        description: lt(
            'Восстанавливает 6 ОЗ, даёт +1 волю и Фокус +1 на 3 хода.',
            'Restore 6 HP, +1 resolve, gain Focus +1 for 3 turns.'
        ),
        color: 0x2a8046,
        starter: false,
    },
    crushing_blow: {
        id: 'crushing_blow',
        name: lt('Сокрушающий удар', 'Crushing Blow'),
        short: lt('Сокруш.', 'Crush'),
        resolveCost: 3,
        description: lt(
            '2.4x атаки + 3 урона. Отдача: 3 ОЗ по себе.',
            '2.4x attack + 3 damage. Self damage: 3 HP recoil.'
        ),
        color: 0x7a2a1a,
        starter: false,
    },
};

export const STARTER_LOADOUT: SkillId[] = ['cleave', 'bleed_strike'];

export const SKILL_ORDER: SkillId[] = [
    'cleave',
    'bleed_strike',
    'parry_stance',
    'focused_strike',
    'rupture',
    'adrenaline',
    'crushing_blow',
];
