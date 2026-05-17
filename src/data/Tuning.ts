/**
 * Tuning constants for player progression, combat, run pacing,
 * map shape, room rewards, drop formula, lockpick mini-game, and
 * altar buffs.
 *
 * Pure data; all numbers are designer-tunable without touching
 * runtime code. See {@link EnemyTypes} for enemy stat shapes and
 * {@link EnemyTiers} / {@link Bosses} for the actual roster data.
 */
export const PLAYER_CONFIG = {
    maxHp: 5,
    hp: 5,
    attack: 1,
    defense: 0,
    level: 1,
    xp: 0,
    // Start with 2 resolve so the player can use a starter skill on
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
    // Hard level ceiling. Past this level, gainXp() / level-up are
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
// Stage [4] relic drop formula.
//
// Per design sheet, the chance that a slain combat enemy drops a relic
// is computed each kill as
//
//     dropChance% = X + Y*depth + Z + K*owned + relicMod*100
//
// then clamped to [0..100] and rolled. After the roll passes, the
// per-relic `RELICS[id].drops[*].chance` field is reinterpreted as a
// WEIGHT for a weighted-random pick across the dead enemy's unowned
// drop entries (with `chance >= 1.0` reserved for guaranteed drops,
// e.g. Crown of Greed on Mammon).
//
// Knobs:
//   - X (`xMin`..`xMax`): per-encounter base chance, picked uniformly
//     in `[xMin..xMax]` inclusive. Sheet says 20..30%.
//   - Y (`perDepth`): flat % bonus per current room depth. Sheet says
//     +2 / room.
//   - K (`perOwnedRelic`): % penalty per relic the player already has.
//     Sheet says -5 / relic. Stored as a negative number so the
//     formula is just an additive sum.
//   - Z: per-enemy `dropMod` (see {@link EnemyDef.dropMod}). Stored
//     on the enemy table, not here.
//   - relicMod: aggregate.relicDropChanceMod (Clover +0.10, Cursed
//     set -0.25). Already computed in `Relics.aggregateRelics` —
//     this PR is what wakes it up.
//
// Treasure / shrine / unknown-enemy drop paths are NOT covered by
// this formula and continue to use {@link ROOM_CONFIG} chances.
// ---------------------------------------------------------------------------
export const DROP_FORMULA = {
    /** Lower bound (inclusive) of the per-encounter base chance X, in %. */
    xMin: 20,
    /** Upper bound (inclusive) of the per-encounter base chance X, in %. */
    xMax: 30,
    /** Y term: % added per dungeon depth. */
    perDepth: 2,
    /** K term: % added per equipped relic. Negative so the formula
     *  is a plain sum. */
    perOwnedRelic: -5,
} as const;

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
