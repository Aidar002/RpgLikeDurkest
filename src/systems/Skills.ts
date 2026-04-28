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
    name: string;
    short: string; // shown on button: max ~14 chars
    resolveCost: number;
    description: string;
    color: number; // button fill color
    starter: boolean;
}

export const SKILLS: Record<SkillId, SkillDef> = {
    cleave: {
        id: 'cleave',
        name: 'Cleave',
        short: 'Cleave',
        resolveCost: 2,
        description: 'Heavy overhead strike. 1.8x attack + 2 damage.',
        color: 0x5a2d78,
        starter: true,
    },
    bleed_strike: {
        id: 'bleed_strike',
        name: 'Bleed Strike',
        short: 'Bleed',
        resolveCost: 2,
        description: '1.1x attack damage. Inflicts Bleed x2 for 3 turns.',
        color: 0x8a2a2a,
        starter: true,
    },
    parry_stance: {
        id: 'parry_stance',
        name: 'Parry Stance',
        short: 'Parry',
        resolveCost: 2,
        description: 'Gain Guard 4x2 and stun the enemy for 1 turn.',
        color: 0x2a5080,
        starter: false,
    },
    focused_strike: {
        id: 'focused_strike',
        name: 'Focused Strike',
        short: 'Focus',
        resolveCost: 1,
        description: '0.9x attack. Enemy is Marked: your next hit is critical.',
        color: 0x5a5a2d,
        starter: false,
    },
    rupture: {
        id: 'rupture',
        name: 'Rupture',
        short: 'Rupture',
        resolveCost: 3,
        description: 'Damage equal to 22% of enemy max HP (min = attack).',
        color: 0x80366a,
        starter: false,
    },
    adrenaline: {
        id: 'adrenaline',
        name: 'Adrenaline',
        short: 'Rally',
        resolveCost: 2,
        description: 'Restore 6 HP, +1 resolve, gain Focus +1 for 3 turns.',
        color: 0x2a8046,
        starter: false,
    },
    crushing_blow: {
        id: 'crushing_blow',
        name: 'Crushing Blow',
        short: 'Crush',
        resolveCost: 3,
        description: '2.4x attack + 3 damage. Self damage: 3 HP recoil.',
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
