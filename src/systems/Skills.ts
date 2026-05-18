import type { LocalizedText } from './LocalizedText';
import { lt } from './LocalizedText';

// Skill catalog. A skill is a combat action that spends resolve and produces
// some combination of damage + status + self effects. The player picks a
// loadout of up to 2 skills when an expedition begins. Extra skills unlock
// through meta progression: each gated skill needs a matching `'skill_<id>'`
// literal on `MetaProgressionManager.UnlockId` + a branch in
// `getUnlockedExtraSkills()`.

export type SkillId = 'cleave' | 'bleed_strike' | 'preparation';

interface SkillDef {
    id: SkillId;
    name: LocalizedText;
    short: LocalizedText; // shown on button: max ~14 chars
    resolveCost: number;
    description: LocalizedText;
    color: number; // button fill color
}

export const SKILLS: Record<SkillId, SkillDef> = {
    cleave: {
        id: 'cleave',
        name: lt('Рубка', 'Cleave'),
        short: lt('Рубка', 'Cleave'),
        resolveCost: 2,
        description: lt('Урон +50% (минимум +1 урон).', 'Damage +50% (min +1 damage).'),
        color: 0x5a2d78,
    },
    bleed_strike: {
        id: 'bleed_strike',
        name: lt('Кровавый разрез', 'Bleed Strike'),
        short: lt('Кровь', 'Bleed'),
        resolveCost: 2,
        description: lt(
            'Наносит обычный урон. Кровотечение: 20% от урона игрока на 3 хода (мин. 1).',
            'Normal attack damage. Bleed: 20% of player damage for 3 turns (min 1).'
        ),
        color: 0x8a2a2a,
    },
    preparation: {
        id: 'preparation',
        name: lt('Подготовка', 'Preparation'),
        short: lt('Подгот.', 'Prep'),
        resolveCost: 1,
        description: lt(
            'Следующий удар +1 урон. Следующая защита +1 защита.',
            'Next attack +1 damage. Next defense +1 defense.'
        ),
        color: 0x2a5080,
    },
};

export const STARTER_LOADOUT: SkillId[] = ['cleave', 'bleed_strike', 'preparation'];
