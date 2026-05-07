/**
 * [FIX-2] Light economy helpers.
 *
 * Centralised so the magic numbers `>= 8` (high) / `< 4` (low) used to
 * live across the codebase resolve through one source of truth
 * (EXPEDITION_CONFIG.highLightThreshold / lowLightThreshold).
 *
 * The decay-interval helper {@link getLightDecayInterval} scales with
 * RUN_CONFIG.runLength so longer expeditions don't burn through Light
 * before mid-game; see LIGHT_CONFIG comments in GameConfig for the
 * empirical onset table.
 */
import { EXPEDITION_CONFIG, LIGHT_CONFIG, RUN_CONFIG } from '../data/GameConfig';

export function isHighLight(light: number): boolean {
    return light >= EXPEDITION_CONFIG.highLightThreshold;
}

export function isLowLight(light: number): boolean {
    return light < EXPEDITION_CONFIG.lowLightThreshold;
}

/** True iff the player should see a "Darkness approaches" warning. */
export function isLightWarning(light: number): boolean {
    return light <= LIGHT_CONFIG.warningThreshold && light > 0;
}

/**
 * Resolves the Light decay interval for a given run length.
 * Defaults to {@link RUN_CONFIG.runLength} when no explicit length is
 * supplied — call sites in the live game can rely on the default,
 * while the headless simulator and tests pass the value they want.
 *
 * Formula (per spec):
 *
 *   max(decayIntervalFloor, round(runLength / decayIntervalFactor))
 *
 * with `decayIntervalFloor = 2` and `decayIntervalFactor = 12`.
 */
export function getLightDecayInterval(
    runLength: number = RUN_CONFIG.runLength,
): number {
    const raw = Math.round(runLength / LIGHT_CONFIG.decayIntervalFactor);
    return Math.max(LIGHT_CONFIG.decayIntervalFloor, raw);
}

/**
 * Given the run-level visited-room counter, returns whether this room
 * should consume a unit of light. Pure function so it can be reused by
 * the headless simulator in `scripts/simulateRuns.ts`.
 *
 * Optional `runLength` lets the simulator vary the run length without
 * mutating {@link RUN_CONFIG}; the live game leaves it default.
 */
export function shouldDecayLight(
    roomsVisitedForLight: number,
    runLength: number = RUN_CONFIG.runLength,
): boolean {
    const interval = getLightDecayInterval(runLength);
    if (interval <= 0) return false;
    return roomsVisitedForLight % interval === 0;
}
