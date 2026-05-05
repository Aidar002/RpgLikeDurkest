/**
 * [FIX-2] Light economy helpers.
 *
 * Centralised so the magic numbers `>= 8` (high) / `< 4` (low) used to
 * live across the codebase resolve through one source of truth
 * (EXPEDITION_CONFIG.highLightThreshold / lowLightThreshold).
 */
import { EXPEDITION_CONFIG, LIGHT_CONFIG } from '../data/GameConfig';

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
 * Given the run-level visited-room counter, returns whether this room
 * should consume a unit of light. Pure function so it can be reused by
 * the headless simulator in `scripts/simulateRuns.ts`.
 */
export function shouldDecayLight(roomsVisitedForLight: number): boolean {
    if (LIGHT_CONFIG.decayEveryNRooms <= 0) return false;
    return roomsVisitedForLight % LIGHT_CONFIG.decayEveryNRooms === 0;
}
