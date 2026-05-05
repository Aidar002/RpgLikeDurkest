export type EnemyProfile =
    | 'brute'
    | 'stalker'
    | 'mage'
    | 'boss'
    | 'final_boss'
    | 'bleeder'
    | 'disruptor';

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
    /** Optional inherent per-turn bleed application on basic attack. */
    inflictBleed?: { stacks: number; turns: number; chance: number };
    /** Optional stress caused by merely facing this enemy. */
    stressAura?: number;
}

export const PLAYER_CONFIG = {
    maxHp: 24,
    hp: 24,
    attack: 4,
    defense: 1,
    level: 1,
    xp: 0,
    // [FIX-3] Start with 2 resolve so the player can use a starter skill on
    // turn 1; max stays at 3 (raised by level-ups via LEVEL_UP_CONFIG).
    maxResolve: 3,
} as const;

export const LEVEL_UP_CONFIG = {
    xpPerLevel: 12,
    hpGainPerLevel: 4,
    attackGainPerLevel: 1,
    defenseEveryNLevels: 3,
    resolveEveryNLevels: 4,
    healOnLevelUp: true,
    // [FIX-9] Hard level ceiling. Past this level, gainXp() / level-up are
    // no-ops and the HUD shows "MAX" instead of an XP bar.
    levelCap: 10,
    // Wisdom XP bonus stops applying at this level (FIX-9).
    wisdomXpBonusUpToLevel: 8,
} as const;

export const EXPEDITION_CONFIG = {
    startingGold: 20,
    startingPotions: 2,
    // [FIX-3] startingResolve raised 1 -> 2 so a 2-cost skill is available
    // on turn 1.
    startingResolve: 2,
    startingLight: 7,
    maxLight: 10,
    /** @deprecated kept for legacy call sites; light decay is now driven by
     *  LIGHT_CONFIG.decayEveryNRooms (FIX-2). */
    lightLossPerRoom: 1,
    lowLightThreshold: 4,
    highLightThreshold: 8,
} as const;

// [FIX-2] Light economy. Light now ticks down every 2 rooms instead of
// every room, with a +3 recovery on boss kills. Thresholds are sourced
// from EXPEDITION_CONFIG via the helpers in src/systems/Light.ts.
export const LIGHT_CONFIG = {
    decayEveryNRooms: 2,
    onBossKill: 3,
    /** Players see a warning when light is at this value or lower. */
    warningThreshold: 4,
} as const;

export const COMBAT_CONFIG = {
    minDamage: 1,
    defendBlock: 3,
    resolveFromAttack: 1,
    resolveFromGuard: 1,
    baseCritChance: 0.06,
    skillCost: 2,
    skillMultiplier: 1.8,
    skillBonus: 2,
    potionHeal: 10,
    randomVariance: 2,
    heavyIntentBonus: 3,
    chargeIntentBonus: 2,
    curseLightLoss: 1,
    criticalChanceFromHighLight: 0.1,
    criticalMultiplier: 1.7,
    highLightAttackBonus: 1,
    lowLightEnemyAttackBonus: 1,
    lowLightRewardMultiplier: 1.15,
    eliteHpMultiplier: 1.45,
    eliteAttackMultiplier: 1.25,
    eliteRewardMultiplier: 1.7,
    bossRewardMultiplier: 2.1,
} as const;

export const STRESS_CONFIG = {
    onCritReceived: 10,
    onLowHp: 5,
    onLowLightRoom: 4,
    onBossStart: 20,
    onEliteStart: 12,
    onPlayerHit: 2,
    onEnemyEnrage: 5,
    onEmptyRoomHighLight: -2,
    onRestMeditate: 25,
    onBossKill: -15,
    onEliteKill: -8,
    onTreasure: 4,
    onShrineOfferVirtue: 6,
} as const;

export const MAP_CONFIG = {
    initialLookahead: 5,
    lookaheadBuffer: 3,
    bossEveryNDepths: 5,
    /** The boss at this depth guards the Wish Artifact. Defeating it wins the run. */
    finalDepth: 25,
    branchRolls: {
        one: 0.18,
        two: 0.52,
        three: 0.3,
    },
    roomTypeWeights: {
        ENEMY: 0.34,
        EMPTY: 0.11,
        TREASURE: 0.13,
        TRAP: 0.09,
        REST: 0.12,
        SHRINE: 0.09,
        MERCHANT: 0.06,
        ELITE: 0.06,
    },
    edgeProbability: 0.7,
    safeDepths: 1,
} as const;

export const ROOM_CONFIG = {
    treasure: {
        goldMin: 12,
        goldMax: 20,
        xpReward: 3,
        potionChance: 0.3,
        relicChance: 0.18,
    },
    trap: {
        rushDamageMin: 3,
        rushDamageMax: 5,
        disarmChance: 0.6,
        disarmGoldMin: 6,
        disarmGoldMax: 12,
        disarmFailDamageMin: 5,
        disarmFailDamageMax: 7,
    },
    rest: {
        recoverHeal: 9,
        // [FIX-2] Rest now restores +2 light (was +1).
        recoverLight: 2,
        focusResolve: 1,
        focusXp: 4,
        meditateStressRelief: 25,
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
        relicChance: 0.3,
    },
    merchant: {
        potionCost: 14,
        // [FIX-2] Merchant lantern: cost 10 -> 12, +3 light -> +4 light.
        lanternCost: 12,
        armorCost: 24,
        lanternLightGain: 4,
        armorDefenseGain: 1,
        premiumShardCost: 1,
        premiumAttackBonus: 2,
        premiumPotionBonus: 1,
        relicGoldCost: 40,
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
        bonusGold: 14,
        shardReward: 1,
        relicChance: 0.6,
    },
    boss: {
        shardReward: 2,
        relicChance: 1,
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
                hp: 9,
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
                hp: 12,
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
            {
                name: 'Fen Leech',
                description: 'A bloated slug whose bite keeps opening.',
                icon: 'L',
                hp: 10,
                attack: 2,
                xp: 5,
                gold: 4,
                color: 0x3e4936,
                profile: 'bleeder',
                inflictBleed: { stacks: 1, turns: 3, chance: 0.45 },
            },
            {
                name: 'Crawling Vow',
                description: 'A forgotten prayer in the shape of a beast.',
                icon: 'V',
                hp: 8,
                attack: 3,
                xp: 4,
                gold: 6,
                color: 0x515045,
                profile: 'disruptor',
                stressAura: 1,
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
                hp: 18,
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
                hp: 14,
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
                hp: 15,
                attack: 4,
                xp: 7,
                gold: 7,
                color: 0x6a4831,
                profile: 'stalker',
            },
            {
                name: 'Shard Fiend',
                description: 'Shards of bone erupt from its wounds at every hit.',
                icon: 'F',
                hp: 16,
                attack: 3,
                xp: 8,
                gold: 8,
                color: 0x4e3a5c,
                profile: 'bleeder',
                inflictBleed: { stacks: 2, turns: 2, chance: 0.55 },
            },
            {
                name: 'Whispering Priest',
                description: 'Every sentence it mutters costs you something.',
                icon: 'P',
                hp: 13,
                attack: 4,
                xp: 9,
                gold: 10,
                color: 0x50406a,
                profile: 'disruptor',
                stressAura: 2,
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
                hp: 23,
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
                hp: 20,
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
                hp: 21,
                attack: 5,
                xp: 11,
                gold: 14,
                color: 0x54465f,
                profile: 'mage',
            },
            {
                name: 'Tomb Siren',
                description: 'Her song fractures composure before the first blow.',
                icon: 'Y',
                hp: 18,
                attack: 5,
                xp: 13,
                gold: 15,
                color: 0x3f3360,
                profile: 'disruptor',
                stressAura: 3,
            },
            {
                name: 'Splinter Lord',
                description: 'Every wound it gives festers and grows.',
                icon: 'J',
                hp: 22,
                attack: 4,
                xp: 13,
                gold: 12,
                color: 0x6d3a3a,
                profile: 'bleeder',
                inflictBleed: { stacks: 2, turns: 3, chance: 0.6 },
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
                hp: 30,
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
                hp: 27,
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
                hp: 26,
                attack: 8,
                xp: 17,
                gold: 17,
                color: 0x31454d,
                profile: 'stalker',
            },
            {
                name: 'Nameless Screamer',
                description: 'It does not kill. It unmakes.',
                icon: 'W',
                hp: 24,
                attack: 6,
                xp: 20,
                gold: 20,
                color: 0x331f4d,
                profile: 'disruptor',
                stressAura: 4,
            },
            {
                name: 'Carrion Matron',
                description: 'The wounds she opens never stop speaking.',
                icon: 'Q',
                hp: 28,
                attack: 6,
                xp: 19,
                gold: 18,
                color: 0x5e2737,
                profile: 'bleeder',
                inflictBleed: { stacks: 3, turns: 3, chance: 0.7 },
            },
        ],
    },
];

// [FIX-1, FIX-4] Boss mapping is keyed by exact depth bucket (every
// MAP_CONFIG.bossEveryNDepths floors), so depth 25 cannot fall back to
// the depth-20 boss. The depth=0 entry is the safety fallback if a
// caller ever asks before the first boss bucket. See
// src/data/Enemies.ts and src/data/Bosses.ts.
export const BOSSES: { depth: number; def: EnemyDef }[] = [
    {
        depth: 5,
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
        depth: 10,
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
        depth: 15,
        def: {
            name: 'Splintered Oracle',
            description: 'Every wound it takes becomes a wound it gives.',
            icon: 'O',
            hp: 88,
            attack: 11,
            xp: 36,
            gold: 26,
            color: 0x4b1d3a,
            profile: 'boss',
            inflictBleed: { stacks: 3, turns: 3, chance: 0.85 },
        },
    },
    {
        depth: 20,
        def: {
            name: 'Nameless Maw',
            description: 'The dungeon itself looking back and asking for more.',
            icon: 'M',
            hp: 112,
            attack: 14,
            xp: 40,
            gold: 30,
            color: 0x170f24,
            profile: 'boss',
            stressAura: 5,
        },
    },
    {
        // [FIX-1] depth 25 — final boss. Resolves to The Undying Wound
        // and ends the run on victory.
        depth: 25,
        def: {
            name: 'The Undying Wound',
            description: 'A wish made flesh that refuses to be unmade.',
            icon: '\u2620',
            hp: 140,
            attack: 15,
            xp: 50,
            gold: 40,
            color: 0x2a0814,
            profile: 'final_boss',
            stressAura: 6,
        },
    },
];

// ---------------------------------------------------------------------------
// FIX-5: Rupture skill — cooldown + per-target damage cap. The cap is
// applied after `max(playerATK, percentDamage)` is computed so the skill
// stays useful against weak elites but stops one-shotting bosses.
// ---------------------------------------------------------------------------
export const RUPTURE_CONFIG = {
    cooldownTurns: 2,
    /** Fraction of enemy maxHP. Applied per encounter kind. */
    capByKind: {
        normal: 0.22,
        elite: 0.18,
        boss: 0.15,
        final_boss: 0.15,
    },
} as const;

// ---------------------------------------------------------------------------
// FIX-6: Adrenaline can fire at most once per combat. Tracked on
// CombatManager and reset in setupEnemy().
// ---------------------------------------------------------------------------
export const ADRENALINE_CONFIG = {
    maxUsesPerCombat: 1,
    /** HP healed when Adrenaline fires. */
    heal: 6,
    /** Resolve restored alongside the heal. */
    resolveGain: 1,
    /** Focus stack amount applied. */
    focusAmount: 1,
    /** Turns the Focus stack persists. */
    focusTurns: 3,
} as const;

// ---------------------------------------------------------------------------
// FIX-7: Stress bands and Resolve-Test reweighting. Bands are open at
// the bottom and closed at the top: e.g. Strained covers [40, 70).
// ---------------------------------------------------------------------------
export const STRESS_BAND_CONFIG = {
    strainedMin: 40,
    breakingMin: 70,
    overwhelmedMin: 100,
    /** Stress gain bonus while in Strained or Breaking. */
    bandGainBonus: 1,
    /** Outgoing damage modifier while in Breaking. */
    breakingOutgoingDamage: -1,
} as const;

/**
 * [FIX-7] Resolve Test weighting. Plain `number` typing (no `as const`)
 * so consumers can mutate/clamp the running chance against
 * min/max bounds without TS rejecting the assignment.
 */
export const RESOLVE_TEST_CONFIG: {
    baseVirtueChance: number;
    highLightVirtueBonus: number;
    lowLightVirtueMalus: number;
    eliteKilledVirtueBonus: number;
    afflictionActiveVirtueMalus: number;
    minVirtueChance: number;
    maxVirtueChance: number;
    stressAfterTest: number;
} = {
    baseVirtueChance: 0.3,
    highLightVirtueBonus: 0.1,
    lowLightVirtueMalus: -0.1,
    eliteKilledVirtueBonus: 0.05,
    afflictionActiveVirtueMalus: -0.15,
    minVirtueChance: 0.1,
    maxVirtueChance: 0.45,
    stressAfterTest: 50,
};

// ---------------------------------------------------------------------------
// FIX-11: Stun resistance percentages by enemy class. The higher the
// pct, the more often a stun is fully resisted (instead of half-duration
// like the v0.1 boss handling).
// ---------------------------------------------------------------------------
export const STUN_RESIST_CONFIG = {
    normal: 0,
    elite: 0.5,
    boss: 0.7,
    finalBoss: 0.95,
    /** Per-boss override map, indexed by EnemyDef.name. */
    bossByName: {
        'Necromancer Regent': 0.7,
        'The Lich of Cinders': 0.75,
        'Splintered Oracle': 0.8,
        'Nameless Maw': 0.9,
        'The Undying Wound': 0.95,
    } as Record<string, number>,
} as const;

// ---------------------------------------------------------------------------
// FIX-13: Relic safety caps. CombatManager / PlayerManager read these
// to prevent runaway compounding interactions.
// ---------------------------------------------------------------------------
export const RELIC_CAP_CONFIG = {
    /** Total crit chance can never exceed 45% even with stacking. */
    gamblersCritCap: 0.45,
    /** Per-turn resolve refund from Gambler's Knuckle. */
    gamblersResolvePerTurn: 1,
    /** Per-turn heal triggers from Vampiric Sigil (kill OR crit). */
    vampiricHealPerTurn: 1,
    /** Hard cap on Thorned Mail reflection per incoming hit. */
    thornedMailReflectionCap: 6,
    /** Ember Vow low-HP damage bonus is hard-capped here (fraction). */
    emberVowLowHpBonusCap: 0.5,
    /** Pyre Ash bleed stack/turn boosts can never exceed these caps. */
    pyreAshBleedStacksCap: 2,
    pyreAshBleedTurnsCap: 2,
    /** Cursed Coin's stacking gold multiplier hard ceiling. */
    cursedCoinGoldMultiplierCap: 2.0,
} as const;
