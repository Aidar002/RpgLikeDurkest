export type EnemyProfile = 'brute' | 'stalker' | 'mage' | 'boss';

export interface EnemyDef {
    name: string;
    description: string;
    icon: string;
    hp: number;
    attack: number;
    xp: number;
    gold: number;
    color: number;
    profile: EnemyProfile;
}

export const PLAYER_CONFIG = {
    maxHp: 22,
    hp: 22,
    attack: 4,
    defense: 1,
    level: 1,
    xp: 0,
    maxResolve: 3,
} as const;

export const LEVEL_UP_CONFIG = {
    xpPerLevel: 12,
    hpGainPerLevel: 4,
    attackGainPerLevel: 1,
    defenseEveryNLevels: 3,
    resolveEveryNLevels: 4,
    healOnLevelUp: true,
} as const;

export const EXPEDITION_CONFIG = {
    startingGold: 18,
    startingPotions: 1,
    startingResolve: 1,
    startingLight: 7,
    maxLight: 10,
    lightLossPerRoom: 1,
    lowLightThreshold: 3,
    highLightThreshold: 8,
} as const;

export const COMBAT_CONFIG = {
    minDamage: 1,
    defendBlock: 4,
    resolveFromAttack: 1,
    resolveFromGuard: 1,
    skillCost: 2,
    skillMultiplier: 1.8,
    skillBonus: 2,
    potionHeal: 10,
    randomVariance: 1,
    heavyIntentBonus: 3,
    chargeIntentBonus: 2,
    curseLightLoss: 1,
    criticalChanceFromHighLight: 0.08,
    criticalMultiplier: 1.6,
    highLightAttackBonus: 1,
    lowLightEnemyAttackBonus: 1,
    lowLightRewardMultiplier: 1.1,
    eliteHpMultiplier: 1.45,
    eliteAttackMultiplier: 1.25,
    eliteRewardMultiplier: 1.7,
    bossRewardMultiplier: 2.1,
} as const;

export const MAP_CONFIG = {
    initialLookahead: 5,
    lookaheadBuffer: 3,
    bossEveryNDepths: 8,
    branchRolls: {
        one: 0.22,
        two: 0.56,
        three: 0.22,
    },
    roomTypeWeights: {
        ENEMY: 0.28,
        EMPTY: 0.1,
        TREASURE: 0.14,
        TRAP: 0.12,
        REST: 0.13,
        SHRINE: 0.09,
        MERCHANT: 0.08,
        ELITE: 0.06,
    },
    edgeProbability: 0.72,
    safeDepths: 1,
} as const;

export const ROOM_CONFIG = {
    treasure: {
        goldMin: 12,
        goldMax: 18,
        xpReward: 3,
        potionChance: 0.25,
    },
    trap: {
        rushDamageMin: 3,
        rushDamageMax: 4,
        disarmChance: 0.6,
        disarmGoldMin: 6,
        disarmGoldMax: 10,
        disarmFailDamageMin: 5,
        disarmFailDamageMax: 7,
    },
    rest: {
        recoverHeal: 8,
        recoverLight: 1,
        focusResolve: 1,
        focusXp: 4,
    },
    shrine: {
        prayBlessChance: 0.7,
        prayAttackBonus: 1,
        prayDamage: 4,
        prayResolveGain: 2,
        offerGoldCost: 20,
        offerMaxHpBonus: 4,
        premiumShardCost: 1,
        premiumMaxHpBonus: 6,
        premiumResolveBonus: 1,
    },
    merchant: {
        potionCost: 14,
        lanternCost: 10,
        armorCost: 24,
        lanternLightGain: 3,
        armorDefenseGain: 1,
        premiumShardCost: 1,
        premiumAttackBonus: 2,
        premiumPotionBonus: 1,
    },
    empty: {
        scoutLightGain: 1,
        scoutGoldChance: 0.3,
        scoutGoldMin: 4,
        scoutGoldMax: 8,
        steadyResolveGain: 1,
    },
    elite: {
        bonusAttack: 1,
        bonusPotions: 1,
        bonusGold: 12,
        shardReward: 1,
    },
    boss: {
        shardReward: 2,
    },
} as const;

export const ENEMY_TIERS: { minDepth: number; pool: EnemyDef[] }[] = [
    {
        minDepth: 0,
        pool: [
            {
                name: 'Ash Rat',
                description: 'A scavenger with a fast bite and no fear.',
                icon: 'R',
                hp: 8,
                attack: 2,
                xp: 4,
                gold: 4,
                color: 0x4b5a32,
                profile: 'stalker',
            },
            {
                name: 'Rot Walker',
                description: 'Slow, stubborn, and harder to put down than it looks.',
                icon: 'Z',
                hp: 10,
                attack: 2,
                xp: 5,
                gold: 6,
                color: 0x455544,
                profile: 'brute',
            },
            {
                name: 'Grave Bat',
                description: 'It dives from the dark and forces quick choices.',
                icon: 'B',
                hp: 9,
                attack: 3,
                xp: 4,
                gold: 5,
                color: 0x36463f,
                profile: 'stalker',
            },
        ],
    },
    {
        minDepth: 3,
        pool: [
            {
                name: 'Bone Warden',
                description: 'Rusted armor gives it time to grind you down.',
                icon: 'S',
                hp: 16,
                attack: 4,
                xp: 8,
                gold: 8,
                color: 0x75664f,
                profile: 'brute',
            },
            {
                name: 'Gloom Adept',
                description: 'Its curses punish long fights and weak nerves.',
                icon: 'M',
                hp: 13,
                attack: 5,
                xp: 9,
                gold: 9,
                color: 0x394678,
                profile: 'mage',
            },
            {
                name: 'Hollow Hound',
                description: 'Fast enough to make every potion feel late.',
                icon: 'H',
                hp: 14,
                attack: 4,
                xp: 7,
                gold: 7,
                color: 0x6a4831,
                profile: 'stalker',
            },
        ],
    },
    {
        minDepth: 6,
        pool: [
            {
                name: 'Catacomb Veteran',
                description: 'A disciplined brute that forces careful defense.',
                icon: 'G',
                hp: 21,
                attack: 5,
                xp: 12,
                gold: 12,
                color: 0x8a785f,
                profile: 'brute',
            },
            {
                name: 'Shade Hunter',
                description: 'It turns low health into a real liability.',
                icon: 'K',
                hp: 18,
                attack: 6,
                xp: 13,
                gold: 13,
                color: 0x364856,
                profile: 'stalker',
            },
            {
                name: 'Ossuary Arcanist',
                description: 'A patient caster that punishes greedy turns.',
                icon: 'C',
                hp: 19,
                attack: 5,
                xp: 11,
                gold: 14,
                color: 0x54465f,
                profile: 'mage',
            },
        ],
    },
    {
        minDepth: 10,
        pool: [
            {
                name: 'Dread Knight',
                description: 'A sealed champion that wins if the fight drags.',
                icon: 'D',
                hp: 28,
                attack: 7,
                xp: 18,
                gold: 18,
                color: 0x6d3939,
                profile: 'brute',
            },
            {
                name: 'Void Channeler',
                description: 'It turns every mistake into a full-room collapse.',
                icon: 'V',
                hp: 25,
                attack: 8,
                xp: 18,
                gold: 19,
                color: 0x3d2d56,
                profile: 'mage',
            },
            {
                name: 'Night Talon',
                description: 'A relentless predator that checks weak preparations.',
                icon: 'T',
                hp: 24,
                attack: 8,
                xp: 17,
                gold: 17,
                color: 0x31454d,
                profile: 'stalker',
            },
        ],
    },
];

export const BOSSES: { depth: number; def: EnemyDef }[] = [
    {
        depth: 0,
        def: {
            name: 'Necromancer Regent',
            description: 'A patient tyrant who tests whether your whole run was honest.',
            icon: 'N',
            hp: 48,
            attack: 7,
            xp: 24,
            gold: 16,
            color: 0x34145c,
            profile: 'boss',
        },
    },
    {
        depth: 16,
        def: {
            name: 'The Lich of Cinders',
            description: 'It demands a deep run, not just a lucky one.',
            icon: 'L',
            hp: 72,
            attack: 10,
            xp: 30,
            gold: 22,
            color: 0x22183f,
            profile: 'boss',
        },
    },
    {
        depth: 24,
        def: {
            name: 'Nameless Maw',
            description: 'The dungeon itself looking back and asking for more.',
            icon: 'O',
            hp: 112,
            attack: 14,
            xp: 40,
            gold: 30,
            color: 0x170f24,
            profile: 'boss',
        },
    },
];
