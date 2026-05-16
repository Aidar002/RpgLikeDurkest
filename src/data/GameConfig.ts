// Enemy profile is purely a visual / sprite category. Mob behaviour
// comes from per-mob `passive` and `prepare` blocks below — there is no
// extra mechanic attached to the profile field.
export type EnemyProfile = 'brute' | 'stalker' | 'bleeder' | 'boss';

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
     *  - kind: 'extraDamageOnHit'    (rat — 20% deal +1 dmg)
     *  - kind: 'thornsOnTakeHit'     (slime — 30% deal 1 dmg back when hit)
     *  - kind: 'damageReduction'     (skeleton — 10% take −1 incoming dmg;
     *                                  earth-elemental — 30% take −2)
     *  - kind: 'evadeAndStingOnHit'  (bee-butterfly — 20% dodge the player's
     *    incoming attack entirely and counter for a small fixed amount of
     *    true damage)
     *  - kind: 'lifestealOnAttack'   (vampire — heal a ratio of the damage
     *    dealt by a successful regular attack)
     *  - kind: 'attackScalesWithHp'  (goblin-horde — the "thinning horde":
     *    regular-attack damage is scaled by hp/maxHp so a near-dead horde
     *    only musters a couple of hits)
     *  - kind: 'painExultation'      (succubus — "exultation in pain":
     *    +1 regular-attack damage per `bonusPerStep` fraction of missing
     *    HP (default 0.1 → +1 per 10% missing))
     */
    passive?: EnemyPassive;
    /** Mid-combat windup ability the enemy resolves after N turns. */
    prepare?: EnemyPrepareDef;
}

export type EnemyPassive =
    | { kind: 'extraDamageOnHit'; chance: number; bonus: number }
    | { kind: 'thornsOnTakeHit'; chance: number; damage: number }
    | { kind: 'damageReduction'; chance: number; reduction: number }
    | { kind: 'evadeAndStingOnHit'; chance: number; damage: number }
    | { kind: 'lifestealOnAttack'; ratio: number }
    | { kind: 'attackScalesWithHp' }
    | { kind: 'painExultation'; bonusPerStep: number };

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
} as const;

export const EXPEDITION_CONFIG = {
    // Per design: every run begins resourceless. Gold, potions and
    // resolve all reset to zero on a fresh PlayerManager so the player
    // earns them in-run rather than starting with a kit.
    startingGold: 0,
    startingPotions: 0,
    startingResolve: 0,
} as const;

export const COMBAT_CONFIG = {
    minDamage: 1,
    defendBlock: 3,
    resolveFromAttack: 1,
    resolveFromGuard: 1,
    baseCritChance: 0.06,
    potionHeal: 10,
    randomVariance: 2,
    criticalMultiplier: 1.7,
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
 * Until those land, runLength affects map shape only; the combat
 * curve stays tuned to the legacy ~25-depth baseline.
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
        windowStartFactor: 0.1,
        // Pressure-window floor was bumped from 4 to 6 when the
        // generator switched to the grid-cell layout: the START
        // room now hands out four 90° exits, so the lookahead now
        // reaches depth 5 deterministically. Holding the boss
        // window back one extra layer keeps the initial map
        // boss-free regardless of seed and aligns with
        // {@link MAP_CONFIG.initialLookahead}.
        windowStartFloor: 6,
        windowEndFactor: 0.2,
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
        focusResolve: 1,
        focusXp: 4,
    },
    shrine: {
        // Used by RelicDrops when a shrine grants a relic.
        relicChance: 0.3,
    },
    merchant: {
        potionCost: 14,
        armorCost: 24,
        armorDefenseGain: 1,
    },
    empty: {
        scoutGoldChance: 0.3,
        scoutGoldMin: 4,
        scoutGoldMax: 8,
        steadyResolveGain: 1,
    },
    elite: {
        bonusAttack: 1,
        bonusPotions: 1,
        bonusGold: 14,
        relicChance: 0.6,
    },
    boss: {
        relicChance: 1,
    },
} as const;

// ---------------------------------------------------------------------------
// Lockpick mini-game (treasure room locked-chest variant).
//
// Tuning is intentionally exposed as plain numbers so the designer can
// edit ring rotation speeds and difficulty weighting without touching
// game code. Hot spots:
//   - `difficulties.{easy,medium,hard}.ringSpeedsDegPerSec` — speed of
//     each of the 3 spinning rings (in degrees per second). Larger
//     numbers = harder. Index 0 is the outermost ring (which the stick
//     pierces first), index 2 is the innermost.
//   - `difficulties.*.gapWidthPx` — visual arc width of the gap on each
//     ring, in pixels (chord-length approximation along the ring).
//     Converted to per-ring degrees at game-construction time using
//     `ringRadiiPx`, so the gap looks the same width on every ring
//     even though the inner ring covers more degrees per pixel.
//     Smaller = harder.
//   - `ringRadiiPx` — outer → inner ring radii in pixels. Lives in data
//     so the headless `LockpickGame` can size each ring's gap correctly
//     without importing UI; the canvas overlay reads the same values
//     so logic + rendering stay in lockstep.
//   - `stickWidthPx` — visual thickness of the lockpick stick. The
//     overlay reads this for rendering; designers reference it when
//     tuning `gapWidthPx` (e.g. "50 % wider than the stick").
//   - `difficultyWeights` — per-depth-band probabilities for picking
//     easy/medium/hard. `depthBands` controls where each band starts.
//   - `descentPxPerSec` — how fast the stick crawls down while the
//     pierce button is held. Pair with `gapWidthPx` and
//     `ringSpeedsDegPerSec` to tune how forgiving the timing window
//     feels on each difficulty.
//   - `lockedChance` — probability that any given treasure chest is
//     locked at all (player can still walk away for free).
//   - `failureDamage` — HP loss when the pick breaks.
// ---------------------------------------------------------------------------
export const LOCKPICK_CONFIG = {
    /** Probability that a treasure chest spawns locked. */
    lockedChance: 0.7,
    /** HP damage dealt when the lockpick attempt fails. */
    failureDamage: 2,
    /** How fast the lockpick stick descends while the pierce button is
     *  held down, in screen pixels per second. The mini-game uses a
     *  press-and-hold mechanic: the player keeps the button pressed to
     *  push the stick deeper and releases it to stop, so this value
     *  has to be slow enough that they can react to the ring gaps
     *  rotating past. */
    descentPxPerSec: 60,
    /** Pixel buffer between the success-resolved stick tip and the
     *  keyhole centre. Pure cosmetics — controls how deep the tip
     *  sinks into the keyhole on success. */
    successOvershootPx: 4,
    /** Outer → inner ring radii in pixels. Shared with the UI so each
     *  ring's gap arc-width matches the rendered visual gap. */
    ringRadiiPx: [168, 122, 77],
    /** Visual thickness of the lockpick stick in pixels. */
    stickWidthPx: 12,
    /** Difficulty selection bands, keyed by minimum dungeon depth. */
    depthBands: {
        /** Depths >= `mid` use the medium-band weights. */
        mid: 10,
        /** Depths >= `deep` use the deep-band weights. */
        deep: 20,
    },
    /** Per-band weights for picking the difficulty. Normalised at use. */
    difficultyWeights: {
        shallow: { easy: 70, medium: 25, hard: 5 },
        mid: { easy: 30, medium: 50, hard: 20 },
        deep: { easy: 10, medium: 40, hard: 50 },
    },
    /** Per-difficulty ring tuning. Speeds and gap widths are tuned to
     *  pair with the hold-to-move stick: the stick crawls at
     *  `descentPxPerSec` pixels per second while the button is held,
     *  so rings have to rotate slowly enough and gaps have to be small
     *  enough that timing the release is meaningful. */
    difficulties: {
        easy: {
            /** Outer → inner ring speeds in degrees per second. */
            ringSpeedsDegPerSec: [60, 70, 80],
            /** Visual width of the gap arc on every ring, in pixels. */
            gapWidthPx: 72,
        },
        medium: {
            ringSpeedsDegPerSec: [90, 100, 110],
            gapWidthPx: 60,
        },
        hard: {
            ringSpeedsDegPerSec: [120, 130, 140],
            gapWidthPx: 48,
        },
    },
} as const;

// ---------------------------------------------------------------------------
// Altar (shrine room) effects. The four canonical actions per design table:
//   blessing → +1 attack (run)
//   prayer   → +5 max HP (run, also heals 5)
//   speech   → +3 resolve (combat resource)
//   counsel  → +1 defense (run)
// All numbers are per-run buffs that drop on death; tweak here.
// ---------------------------------------------------------------------------
export const ALTAR_EFFECTS = {
    blessingAttack: 1,
    prayerMaxHp: 5,
    prayerHeal: 5,
    speechResolve: 3,
    counselDefense: 1,
} as const;

// Enemy roster (per-spec). Stats and special mechanics taken directly
// from the design table; passives and prepare blocks are interpreted
// by CombatManager.
// Stats per the design table:
//   1–5   → minDepth 0   (Rat, Slime, Bat, Bee-Butterfly, Giant Toad)
//   6–10  → minDepth 6   (Rat Matron, Skeleton, Ghoul, Gelatinous Cube,
//                          Earth Elemental)
//   11–15 → minDepth 11  (Steel Lynx, Vampire, Demon, Goblin Horde,
//                          Underground Ent)
//   16–20 → minDepth 16  (Skeleton Swordsman, Lich, Succubus,
//                          Lost Adventurer, Death Knight)
//   21–25 → minDepth 21  (Prophet, Mammon, Nimrod, Mime, Gilgamesh)
// New roster entries from the design sheet ship without passive /
// prepare blocks — those land in follow-up PRs, one ability per PR.
export const ENEMY_TIERS: { minDepth: number; pool: EnemyDef[] }[] = [
    {
        minDepth: 0,
        pool: [
            {
                name: 'Rat',
                description: 'test_desc_rat',
                icon: 'R',
                hp: 2,
                attack: 1,
                xp: 3,
                gold: 3,
                color: 0x5a5040,
                profile: 'stalker',
                passive: { kind: 'extraDamageOnHit', chance: 0.2, bonus: 1 },
            },
            {
                name: 'Slime',
                description: 'test_desc_slime',
                icon: 'S',
                hp: 2,
                attack: 1,
                xp: 3,
                gold: 3,
                color: 0x3e6636,
                profile: 'brute',
                passive: { kind: 'thornsOnTakeHit', chance: 0.3, damage: 1 },
            },
            {
                name: 'Bat',
                description: 'test_desc_bat',
                icon: 'B',
                hp: 2,
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
                name: 'Bee-Butterfly',
                description: 'test_desc_bee_butterfly',
                icon: 'Y',
                hp: 3,
                attack: 2,
                xp: 3,
                gold: 3,
                color: 0xc4a01e,
                profile: 'stalker',
                // Flutter and sting: 20% chance to dodge the player's
                // attack outright; on dodge the bee-butterfly counters
                // for 1 true damage.
                passive: { kind: 'evadeAndStingOnHit', chance: 0.2, damage: 1 },
            },
            {
                name: 'Giant Toad',
                description: 'test_desc_giant_toad',
                icon: 'T',
                hp: 3,
                attack: 2,
                xp: 3,
                gold: 3,
                color: 0x4a6b2a,
                profile: 'brute',
            },
        ],
    },
    {
        minDepth: 6,
        pool: [
            {
                name: 'Rat Matron',
                description: 'test_desc_rat_matron',
                icon: 'M',
                hp: 8,
                attack: 2,
                xp: 5,
                gold: 5,
                color: 0x6b4530,
                profile: 'brute',
            },
            {
                name: 'Skeleton',
                description: 'test_desc_skeleton',
                icon: 'K',
                hp: 6,
                attack: 3,
                xp: 4,
                gold: 4,
                color: 0x888070,
                profile: 'brute',
                passive: { kind: 'damageReduction', chance: 0.1, reduction: 1 },
            },
            {
                name: 'Ghoul',
                description: 'test_desc_ghoul',
                icon: 'G',
                hp: 7,
                attack: 2,
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
            {
                name: 'Gelatinous Cube',
                description: 'test_desc_gelatinous_cube',
                icon: 'C',
                hp: 9,
                attack: 2,
                xp: 5,
                gold: 5,
                color: 0x82c4d4,
                profile: 'brute',
            },
            {
                name: 'Earth Elemental',
                description: 'test_desc_earth_elemental',
                icon: 'E',
                hp: 9,
                attack: 2,
                xp: 5,
                gold: 5,
                color: 0x6e553b,
                profile: 'brute',
                // Stone Skin: 30% chance to shrug off 2 points of an
                // incoming player hit. Same damageReduction passive as
                // Skeleton, just thicker.
                passive: { kind: 'damageReduction', chance: 0.3, reduction: 2 },
            },
        ],
    },
    {
        minDepth: 11,
        pool: [
            {
                name: 'Steel Lynx',
                description: 'test_desc_steel_lynx',
                icon: 'L',
                hp: 12,
                attack: 3,
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
                name: 'Vampire',
                description: 'test_desc_vampire',
                icon: 'V',
                hp: 9,
                attack: 4,
                xp: 8,
                gold: 8,
                color: 0x4a1a1a,
                profile: 'stalker',
                // Vampirism: heal half of any damage the regular attack
                // dealt to the player (clamped to maxHp, min 1 when the
                // hit landed).
                passive: { kind: 'lifestealOnAttack', ratio: 0.5 },
            },
            {
                name: 'Demon',
                description: 'test_desc_demon',
                icon: 'D',
                hp: 13,
                attack: 5,
                xp: 10,
                gold: 10,
                color: 0x8a1a1a,
                profile: 'brute',
            },
            {
                name: 'Goblin Horde',
                description: 'test_desc_goblin_horde',
                icon: 'O',
                hp: 13,
                attack: 9,
                xp: 10,
                gold: 10,
                color: 0x4d6a2a,
                profile: 'brute',
                // Thinning Horde: attack scales linearly with hp/maxHp.
                // The 9-damage swing is the *full-strength* horde; as
                // goblins fall the surviving few hit weaker.
                passive: { kind: 'attackScalesWithHp' },
            },
            {
                name: 'Underground Ent',
                description: 'test_desc_underground_ent',
                icon: 'N',
                hp: 14,
                attack: 4,
                xp: 10,
                gold: 10,
                color: 0x3a5532,
                profile: 'brute',
            },
        ],
    },
    {
        minDepth: 16,
        pool: [
            {
                name: 'Skeleton Swordsman',
                description: 'test_desc_skeleton_swordsman',
                icon: 'W',
                hp: 18,
                attack: 7,
                xp: 14,
                gold: 14,
                color: 0x888070,
                profile: 'brute',
            },
            {
                name: 'Lich',
                description: 'test_desc_lich',
                icon: 'I',
                hp: 17,
                attack: 4,
                xp: 14,
                gold: 14,
                color: 0x453d5a,
                profile: 'stalker',
            },
            {
                name: 'Succubus',
                description: 'test_desc_succubus',
                icon: 'U',
                hp: 22,
                attack: 1,
                xp: 18,
                gold: 18,
                color: 0x6a2a44,
                profile: 'stalker',
                // Exultation in Pain: +1 damage per 10% missing HP.
                // Base attack of 1 is *almost* pillow-soft at full HP;
                // the threat scales as the player chips her down.
                passive: { kind: 'painExultation', bonusPerStep: 0.1 },
            },
            {
                name: 'Lost Adventurer',
                description: 'test_desc_lost_adventurer',
                icon: 'A',
                hp: 20,
                attack: 4,
                xp: 16,
                gold: 16,
                color: 0x9a8a6a,
                profile: 'brute',
            },
            {
                name: 'Death Knight',
                description: 'test_desc_death_knight',
                icon: '\u2620',
                hp: 24,
                attack: 5,
                xp: 18,
                gold: 18,
                color: 0x2a0814,
                profile: 'brute',
            },
        ],
    },
    {
        minDepth: 21,
        pool: [
            {
                name: 'Prophet',
                description: 'test_desc_prophet',
                icon: 'P',
                hp: 45,
                attack: 7,
                xp: 35,
                gold: 35,
                color: 0xe6d680,
                profile: 'brute',
            },
            {
                name: 'Mammon',
                description: 'test_desc_mammon',
                icon: '$',
                hp: 37,
                attack: 8,
                xp: 30,
                gold: 30,
                color: 0xa67c00,
                profile: 'brute',
            },
            {
                name: 'Nimrod',
                description: 'test_desc_nimrod',
                icon: 'X',
                hp: 41,
                attack: 0,
                xp: 32,
                gold: 32,
                color: 0x483050,
                profile: 'stalker',
            },
            {
                name: 'Mime',
                description: 'test_desc_mime',
                icon: '?',
                hp: 34,
                attack: 6,
                xp: 28,
                gold: 28,
                color: 0xb0b0b0,
                profile: 'stalker',
            },
            {
                name: 'Gilgamesh',
                description: 'test_desc_gilgamesh',
                icon: 'H',
                hp: 43,
                attack: 7,
                xp: 34,
                gold: 34,
                color: 0xb87333,
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
// Depth 25 now resolves to one of five candidate bosses chosen
// deterministically from the combat RNG. Stats mirror the design
// table directly; ability blocks land in follow-up PRs (one boss /
// ability per PR). Boss reward multipliers still apply on top in
// CombatManager.setupEnemy.
//
// See src/data/Enemies.ts (lookup + fallback) and src/data/Bosses.ts.
export const BOSSES: { depth: number; def: EnemyDef }[] = [
    {
        depth: 25,
        def: {
            name: 'Prophet',
            description: 'test_desc_prophet',
            icon: 'P',
            hp: 45,
            attack: 7,
            xp: 50,
            gold: 40,
            color: 0xe6d680,
            profile: 'boss',
        },
    },
    {
        depth: 25,
        def: {
            name: 'Mammon',
            description: 'test_desc_mammon',
            icon: '$',
            hp: 37,
            attack: 8,
            xp: 50,
            gold: 40,
            color: 0xa67c00,
            profile: 'boss',
        },
    },
    {
        depth: 25,
        def: {
            name: 'Nimrod',
            description: 'test_desc_nimrod',
            icon: 'X',
            hp: 41,
            attack: 0,
            xp: 50,
            gold: 40,
            color: 0x483050,
            profile: 'boss',
        },
    },
    {
        depth: 25,
        def: {
            name: 'Mime',
            description: 'test_desc_mime',
            icon: '?',
            hp: 34,
            attack: 6,
            xp: 50,
            gold: 40,
            color: 0xb0b0b0,
            profile: 'boss',
        },
    },
    {
        depth: 25,
        def: {
            name: 'Gilgamesh',
            description: 'test_desc_gilgamesh',
            icon: 'H',
            hp: 43,
            attack: 7,
            xp: 50,
            gold: 40,
            color: 0xb87333,
            profile: 'boss',
        },
    },
];
