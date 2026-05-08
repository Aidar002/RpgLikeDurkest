/**
 * Feature flags. Toggle individual game systems on/off without removing
 * their logic. When `false`, the corresponding system is hidden from
 * the UI and skipped at all call sites, but the underlying code stays
 * intact so a feature can be re-enabled later by flipping the flag.
 */
export const FEATURES = {
    /** Light economy (decay, low/high light bonuses, lantern shops). */
    light: false,
    /** Boss / mini-boss `grantsSeal` tagging and seal-coverage validation. */
    seals: false,
    /** Relic shards currency + premium shrine/merchant offers. */
    shards: false,
} as const;

// Enemy profile is purely a visual / sprite category. Mob behaviour
// comes from per-mob `passive` and `prepare` blocks below — there is no
// extra mechanic attached to the profile field.
export type EnemyProfile =
    | 'brute'
    | 'stalker'
    | 'bleeder'
    | 'boss';

/**
 * "Prepare" mechanic: enemy telegraphs an action for `turns` turns,
 * then resolves it on the matching player turn. If the player chose
 * Defend on the resolution turn, the special instead either does
 * `defenseBackDamage` (rebound), leaks a small fixed amount through
 * the guard, or just lets the raw damage through with no rider
 * effect, depending on `defenseRule`.
 *
 * Spec mapping:
 *  - bat:   1-turn windup -> 3 dmg, Defense -> bat takes 1 dmg back
 *  - ghoul: 2-turn windup -> 2 dmg + poison, Defense -> 1 dmg seeps
 *           through the guard (poison is still cancelled). Decay
 *           cannot be fully blocked.
 *  - lynx:  1-turn windup -> 3 dmg + bleed, Defense -> the damage
 *           still lands but the bleed is cancelled
 */
export interface EnemyPrepareDef {
    /** Localisation key used to look up the windup intent line. */
    nameEn: string;
    nameRu: string;
    /** Turns the enemy spends winding up (1 = next turn, 2 = +2 turns). */
    turns: number;
    /** Damage delivered on resolution. */
    damage: number;
    /** Bleed rider added when not defended. */
    bleed?: { stacks: number; turns: number };
    /** Poison rider added when not defended. */
    poison?: { damage: number; turns: number };
    /** What the player's Defend action does to this prepared hit. */
    defenseRule: 'damageBack' | 'cancelRiders' | 'leakOnDefend';
    /** Damage the enemy takes when defenseRule === 'damageBack'. */
    defenseBackDamage?: number;
    /**
     * Damage the player takes (true damage, bypasses block / defense)
     * when defenseRule === 'leakOnDefend'. Riders are still cancelled.
     */
    defenseLeakDamage?: number;
}

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
    /**
     * Optional per-turn passive trigger.
     *  - kind: 'extraDamageOnHit' (rat — 20% deal +1 dmg)
     *  - kind: 'thornsOnTakeHit'  (slime — 30% deal 1 dmg back when hit)
     *  - kind: 'damageReduction'  (skeleton — 10% take −1 incoming dmg)
     */
    passive?: EnemyPassive;
    /** Mid-combat windup ability the enemy resolves after N turns. */
    prepare?: EnemyPrepareDef;
}

export type EnemyPassive =
    | { kind: 'extraDamageOnHit'; chance: number; bonus: number }
    | { kind: 'thornsOnTakeHit'; chance: number; damage: number }
    | { kind: 'damageReduction'; chance: number; reduction: number };

export const PLAYER_CONFIG = {
    maxHp: 5,
    hp: 5,
    attack: 1,
    defense: 0,
    level: 1,
    xp: 0,
    // [FIX-3] Start with 2 resolve so the player can use a starter skill on
    // turn 1; max stays at 3 (raised by level-ups via LEVEL_UP_CONFIG).
    maxResolve: 3,
} as const;

export const LEVEL_UP_CONFIG = {
    xpPerLevel: 10,
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
    // Per design: every run begins resourceless. Gold, potions and
    // resolve all reset to zero on a fresh PlayerManager so the player
    // earns them in-run rather than starting with a kit. Light still
    // starts full because the lantern economy is decay-driven.
    startingGold: 0,
    startingPotions: 0,
    startingResolve: 0,
    startingLight: 7,
    maxLight: 10,
    /** @deprecated kept for legacy call sites; light decay is now driven by
     *  LIGHT_CONFIG.decayEveryNRooms (FIX-2). */
    lightLossPerRoom: 1,
    lowLightThreshold: 4,
    highLightThreshold: 8,
} as const;

// [FIX-2] Light economy. Light ticks down every N rooms (was every room
// in pre-FIX-2 builds), with a +3 recovery on boss kills. Thresholds are
// sourced from EXPEDITION_CONFIG via the helpers in src/systems/Light.ts.
//
// Decay interval is now runLength-derived through
// {@link getLightDecayInterval} so longer runs don't drain Light too fast:
//
//   decayInterval = max(decayIntervalFloor, round(runLength / decayIntervalFactor))
//
// Empirical onsets at startingLight=7 and lowLightThreshold=4 (no recovery):
//   runLength=25  → interval=2 → low-light at room  8 (~32 % of run)
//   runLength=35  → interval=3 → low-light at room 12 (~34 %)
//   runLength=50  → interval=4 → low-light at room 16 (~32 %)
//   runLength=75  → interval=6 → low-light at room 24 (~32 %)
//
// (Spec quoted "≈ 60-70 % onset". That target assumes a fully-recovering
// player; with no recovery the onset clamps to ~32 % across all lengths
// because the (startingLight - lowLightThreshold) drop count is fixed.
// See PR notes for the calibration table.)
export const LIGHT_CONFIG = {
    /** @deprecated kept only for the legacy `BalancePatch` test
     *  assertion. New code should call
     *  {@link getLightDecayInterval} (which reads
     *  `decayIntervalFactor` / `decayIntervalFloor`). */
    decayEveryNRooms: 2,
    /** Divisor for the runLength-scaled decay interval. */
    decayIntervalFactor: 12,
    /** Lower bound: even very short runs decay no faster than this. */
    decayIntervalFloor: 2,
    /** Light gained on a Rest room. Currently runLength-independent. */
    restLightGain: 2,
    /** Light gained on a boss kill (mid-run majors and minis). */
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
    /**
     * Boss-only XP "piñata" multiplier. Stacks on top of
     * {@link bossRewardMultiplier} for `kind === 'boss'` encounters
     * (mid-run majors AND final boss). Tuned so a depth-tier boss
     * dumps ~10–20 levels' worth of XP in one kill at the legacy
     * runLength=25 / levelCap=10 calibration.
     *
     * Examples (xpPerLevel=10, after bossRewardMultiplier=2.1):
     *   depth 25 (Death Knight, 50 base xp): 50 * 2.1 * 4 ≈ 420 xp ≈ 42 levels
     */
    bossXpMultiplier: 4,
} as const;

/**
 * Top-level run shape. Everything time-dependent (map length,
 * eventual boss pacing, Light / XP scaling) must derive
 * from {@link RUN_CONFIG.runLength} so a run can be stretched or
 * shortened without rewriting the generator.
 *
 * Examples:
 *  - 25 — short / current legacy length
 *  - 35 — medium
 *  - 50 — long
 *  - 75 — extended
 *
 * TODO (post map-gen stabilization): wire runLength-derived
 * formulas for:
 *  - LEVEL_UP_CONFIG.levelCap targets per runLength
 *      25→8-10, 35→10-12, 50→12-15, 75→15-18
 *  - phase boundaries (early/mid/late/final) at 0/30/70/95% of runLength
 *
 * Done:
 *  - Light decay interval — see `LIGHT_CONFIG.decayIntervalFactor`
 *    and {@link getLightDecayInterval}.
 *
 * Until the rest land, runLength affects map shape + Light only;
 * the combat curve stays tuned to the legacy ~25-depth baseline.
 */
export const RUN_CONFIG = {
    runLength: 25,
    /**
     * Pacing controls for the bossPressure pass (PR-2). Boss
     * placement uses a "steps since the last boss along this
     * branch" counter, derived from the **max** of all incoming
     * parents' counters so a long-pressure path can never be
     * masked by a short-pressure cross-link.
     *
     *  - `windowStartFactor` * runLength is the earliest step at
     *    which a mid-run boss may appear in a branch.
     *  - `windowEndFactor` * runLength is the step at which a
     *    boss is *guaranteed* — pressure has built up too long.
     *  - `targetMajorFactor` and `targetMiniFactor` set the
     *    scaling rate for the mid-run boss budgets:
     *      targetMajor = clamp(round(runLength / targetMajorFactor), 1, majorCap)
     *      targetMini  = clamp(round(runLength / targetMiniFactor),  1, miniCap)
     *  - `majorOddsInWindow` is the chance that a boss roll inside
     *    the pressure window upgrades from MINI to MAJOR (capped
     *    by the remaining major budget).
     */
    bossPressure: {
        windowStartFactor: 0.10,
        // Pressure-window floor was bumped from 4 to 6 when the
        // generator switched to the grid-cell layout: the START
        // room now hands out four 90° exits, so the lookahead now
        // reaches depth 5 deterministically. Holding the boss
        // window back one extra layer keeps the initial map
        // boss-free regardless of seed and aligns with
        // {@link MAP_CONFIG.initialLookahead}.
        windowStartFloor: 6,
        windowEndFactor: 0.20,
        windowEndFloor: 8,
        targetMajorFactor: 18,
        targetMajorMin: 1,
        targetMajorMax: 4,
        targetMiniFactor: 12,
        targetMiniMin: 1,
        targetMiniMax: 6,
        majorOddsInWindow: 0.3,
        majorOddsAtForcedEnd: 0.5,
    },
    /**
     * Seal-economy controls (PR-3). Major bosses and a fraction
     * of mini bosses tag their rooms as `grantsSeal` — these are
     * the "seal opportunities" the player has on a run.
     *
     *  - `requiredSealsFactor` * runLength is the divisor for the
     *    requiredSeals budget. Clamped to [`requiredSealsMin`,
     *    `requiredSealsMax`].
     *      requiredSeals = clamp(round(runLength / requiredSealsFactor), min, max)
     *  - `miniSealOdds` is the chance that a mini-boss room ALSO
     *    gets `grantsSeal`. Major bosses always grant a seal.
     *  - `pathSealMargin` is how many extra seal opportunities
     *    over `requiredSeals` we want to see on the *worst* full
     *    path. Used by the validation report so we can flag a
     *    run that's technically beatable but unforgivingly tight.
     *
     * Player-side seal inventory and the requiredSeals gate at
     * the final boss are intentionally NOT implemented yet — see
     * `TODO(seals)` markers in the combat code for follow-ups.
     */
    seals: {
        requiredSealsFactor: 20,
        requiredSealsMin: 1,
        requiredSealsMax: 4,
        miniSealOdds: 0.5,
        pathSealMargin: 1,
    },
} as const;

export const MAP_CONFIG = {
    /**
     * Number of map layers built up-front by `generateInitialMap`.
     * Set deliberately low so the dungeon is *streamed* — the rest
     * of the run is materialised one layer at a time as the player
     * approaches (see `DungeonManager.lookaheadBuffer`). Keep this
     * ≥ 2 so the player can always see at least the next two
     * choice-layers from the START hub.
     */
    initialLookahead: 2,
    lookaheadBuffer: 3,
    /**
     * The depth of the final-boss layer. Every node at this depth
     * is a final-boss room (`bossKind: 'final'`); victory over any
     * of them ends the run. Mirrors {@link RUN_CONFIG.runLength}
     * so combat-side lookups (`getBossForDepth`, narrative gating,
     * etc.) keep matching the actual final layer when runLength
     * changes.
     */
    finalDepth: RUN_CONFIG.runLength,
    /**
     * Distribution of how many *new rooms* a layer adds. The actual
     * layer width is `max(rolledCount, parents)` so a layer never
     * shrinks under what's needed to keep every parent connected.
     *
     * Now includes 4-wide layers (PR map-gen branch fanout): the
     * old "capped at 3" justification was tied to the legacy
     * forced PRE-BOSS convergence which PR-1 removed. With the
     * boss-pressure model every layer is plain fan-out routing,
     * so 4 spread-out parents can fan onto 4 children without
     * forced collapse. Distribution biased toward 3-4 (avg ~3.05)
     * so the player feels meaningful directional choice instead
     * of being funneled.
     */
    branchRolls: {
        one: 0.05,
        two: 0.20,
        three: 0.40,
        four: 0.35,
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
    /**
     * Distribution of *outgoing edges per parent room* (i.e. how
     * many of the next layer's rooms a player can pick from this
     * room). The actual count is clamped against the number of
     * available children in the next layer and capped at
     * {@link maxEdgesPerNode}, so dense parts of the run get 1–4
     * paths. Bottleneck rooms (final-boss layer) collapse to 1
     * naturally because their target layer has fewer slots.
     *
     * Distribution biased toward 3-4 outgoing (avg ~3.05) so most
     * non-boss rooms feel branchy instead of corridor-like. The
     * START room overrides this and always rolls 4 — see
     * {@link MapGenerator.rollFanout} / {@link
     * MapGenerator.buildLayer} for the depth-1 width override that
     * makes the START 4-fanout actually realisable.
     */
    fanoutRolls: {
        one: 0.10,
        two: 0.30,
        three: 0.30,
        four: 0.30,
    },
    /**
     * Hard cap on outgoing edges per non-bottleneck room. Keeps
     * the visual graph readable even on wide layers and matches
     * the player-facing "1–4 next rooms" guarantee.
     */
    maxEdgesPerNode: 4,
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

// Enemy roster (per-spec). Stats and special mechanics taken directly
// from the design table; passives and prepare blocks are interpreted
// by CombatManager.
export const ENEMY_TIERS: { minDepth: number; pool: EnemyDef[] }[] = [
    {
        minDepth: 0,
        pool: [
            {
                name: 'Rat',
                description: 'A quick critter that occasionally lunges harder.',
                icon: 'R',
                hp: 5,
                attack: 1,
                xp: 3,
                gold: 3,
                color: 0x5a5040,
                profile: 'stalker',
                passive: { kind: 'extraDamageOnHit', chance: 0.2, bonus: 1 },
            },
            {
                name: 'Slime',
                description: 'A corrosive blob that stings when struck.',
                icon: 'S',
                hp: 3,
                attack: 2,
                xp: 3,
                gold: 3,
                color: 0x3e6636,
                profile: 'brute',
                passive: { kind: 'thornsOnTakeHit', chance: 0.3, damage: 1 },
            },
            {
                name: 'Skeleton',
                description: 'Bare bones that sometimes shrug off the blow.',
                icon: 'K',
                hp: 6,
                attack: 2,
                xp: 4,
                gold: 4,
                color: 0x888070,
                profile: 'brute',
                passive: { kind: 'damageReduction', chance: 0.1, reduction: 1 },
            },
            {
                name: 'Bat',
                description: 'A cave flyer that dives after a windup.',
                icon: 'B',
                hp: 5,
                attack: 1,
                xp: 3,
                gold: 4,
                color: 0x36463f,
                profile: 'stalker',
                prepare: {
                    nameEn: 'Bite',
                    nameRu: 'Укус',
                    turns: 1,
                    damage: 3,
                    defenseRule: 'damageBack',
                    defenseBackDamage: 1,
                },
            },
            {
                name: 'Ghoul',
                description: 'An undead horror that festers before it strikes.',
                icon: 'G',
                hp: 10,
                attack: 1,
                xp: 5,
                gold: 5,
                color: 0x455544,
                profile: 'bleeder',
                prepare: {
                    nameEn: 'Decay',
                    nameRu: 'Разложение',
                    turns: 2,
                    damage: 2,
                    poison: { damage: 1, turns: 3 },
                    // Decay cannot be fully blocked. Defense cancels the
                    // poison, but 1 damage still seeps through the guard.
                    defenseRule: 'leakOnDefend',
                    defenseLeakDamage: 1,
                },
            },
        ],
    },
    {
        minDepth: 5,
        pool: [
            {
                name: 'Steel Lynx',
                description: 'A vicious predator with bleeding claws.',
                icon: 'L',
                hp: 10,
                attack: 6,
                xp: 10,
                gold: 10,
                color: 0x6a6a7a,
                profile: 'bleeder',
                prepare: {
                    nameEn: 'Claws',
                    nameRu: 'Когти',
                    turns: 1,
                    damage: 3,
                    bleed: { stacks: 3, turns: 3 },
                    defenseRule: 'cancelRiders',
                },
            },
            {
                name: 'Skeleton Swordsman',
                description: 'An armored skeleton with no tricks — just steel.',
                icon: 'W',
                hp: 15,
                attack: 3,
                xp: 8,
                gold: 8,
                color: 0x888070,
                profile: 'brute',
            },
        ],
    },
];

// [FIX-1, FIX-4] Legacy boss mapping keyed by depth bucket. Pre-PR-1
// the map generator placed forced bosses every 5 depths, so this table
// resolved each bucket to a unique encounter. PR-1 removed those
// hardcoded boss depths — only the final-layer encounter (depth ===
// RUN_CONFIG.runLength) is map-driven now. The pre-final entries are
// kept so legacy combat/narrative code can still call
// `getBossForDepth(d)` for d <= 25, but the map graph no longer spawns
// BOSS rooms at those depths until PR-2 wires up bossPressure-based
// placement (MINI_BOSS / major BOSS).
//
// See src/data/Enemies.ts (lookup + fallback) and src/data/Bosses.ts.
export const BOSSES: { depth: number; def: EnemyDef }[] = [
    {
        depth: 25,
        def: {
            name: 'Death Knight',
            description: 'An armored revenant that commands death itself.',
            icon: '\u2620',
            hp: 45,
            attack: 8,
            xp: 50,
            gold: 40,
            color: 0x2a0814,
            profile: 'boss',
        },
    },
];

// ---------------------------------------------------------------------------
// Stun resistance percentages by enemy class. The higher the pct, the
// more often a stun is fully resisted (instead of half-duration like
// the v0.1 boss handling).
// ---------------------------------------------------------------------------
export const STUN_RESIST_CONFIG = {
    normal: 0,
    elite: 0.5,
    boss: 0.7,
    /** Per-boss override map, indexed by EnemyDef.name. */
    bossByName: {
        'Death Knight': 0.7,
    } as Record<string, number>,
} as const;

// ---------------------------------------------------------------------------
// Death Knight prepare timings. Pulled into a config object so combat
// code, intents, and tests share one source of truth.
// ---------------------------------------------------------------------------
export const DEATH_KNIGHT_CONFIG = {
    /** death_shield: turns of windup before the block lands. */
    shieldPrepareTurns: 1,
    /** Block amount granted by death_shield when it resolves. */
    shieldBlock: 15,
    /** Turns the death_shield block persists if not broken first. */
    shieldDuration: 3,
    /** death_touch: turns of windup before the OHKO lands. */
    touchPrepareTurns: 3,
    /** Damage taken if the player Defends on the death_touch resolution turn. */
    touchDefendDamage: 8,
} as const;
