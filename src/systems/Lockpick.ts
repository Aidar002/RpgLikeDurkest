/**
 * Headless logic for the lockpick mini-game played on locked treasure
 * chests. Three concentric rings spin at configurable speeds; each
 * ring has one arc-shaped gap. The player taps a single button to
 * push a stick through the current ring — if the gap is aligned with
 * the stick at that moment, the ring locks and the stick advances to
 * the next ring. Misaligned tap = pick breaks, mini-game over.
 *
 * Tuning lives in {@link LOCKPICK_CONFIG} (`src/data/GameConfig.ts`).
 * The UI side ({@link import('../ui/LockpickOverlay').LockpickOverlay})
 * owns the canvas rendering and modal lifecycle; this module only
 * tracks the angular state so it stays headless and unit-testable.
 *
 * All angles are degrees in [0, 360). The "stick" is conceptually
 * fixed at {@link STICK_ANGLE_DEG}; rings rotate around them. The
 * world angle of each ring's gap centre is `ring.gapAngleDeg`, so an
 * attempt succeeds when the angular distance between that and the
 * stick angle is within `gapHalfWidthDeg`.
 */

import { LOCKPICK_CONFIG } from '../data/GameConfig';
import type { Rng } from './Rng';

export type LockpickDifficulty = 'easy' | 'medium' | 'hard';
export type LockpickStatus = 'inProgress' | 'success' | 'failure';

/** Fixed world angle where the stick attempts to pierce. */
export const STICK_ANGLE_DEG = 0;

export interface LockpickRing {
    /** Half of the gap's arc width, in degrees. */
    readonly gapHalfWidthDeg: number;
    /** Current angle of the gap centre in world space, [0, 360). */
    gapAngleDeg: number;
    /** Signed angular velocity in degrees per second (+ cw, − ccw). */
    speedDegPerSec: number;
    /** Locked rings stop rotating and accept no further attempts. */
    locked: boolean;
}

/** Result of a single {@link LockpickGame.attemptDescend} call. */
export type AttemptResult =
    | { kind: 'ringLocked'; ringIndex: number; remaining: number }
    | { kind: 'success' }
    | { kind: 'failure' };

export class LockpickGame {
    readonly rings: LockpickRing[];
    readonly difficulty: LockpickDifficulty;
    private _currentRingIndex = 0;
    private _status: LockpickStatus = 'inProgress';

    constructor(difficulty: LockpickDifficulty, rng: Rng) {
        this.difficulty = difficulty;
        const cfg = LOCKPICK_CONFIG.difficulties[difficulty];
        const radii = LOCKPICK_CONFIG.ringRadiiPx;
        // Convert the designer-friendly pixel gap width into per-ring
        // angular gap. Larger rings cover more pixels per degree, so a
        // fixed pixel width produces a smaller arc-angle on the outer
        // ring than on the inner one — which is what we want, because
        // the rendered gap should look the same width on every ring.
        this.rings = cfg.ringSpeedsDegPerSec.map((speed, i) => ({
            gapHalfWidthDeg: pixelArcToDegrees(cfg.gapWidthPx, radii[i]) / 2,
            // Randomise initial angle so rings don't all start aligned.
            gapAngleDeg: rng.next() * 360,
            // Randomise rotation direction per ring (50/50 cw/ccw).
            speedDegPerSec: rng.next() < 0.5 ? speed : -speed,
            locked: false,
        }));
    }

    get currentRingIndex(): number {
        return this._currentRingIndex;
    }

    get status(): LockpickStatus {
        return this._status;
    }

    /** Advance the rotation of every un-locked ring by `deltaMs` ms. */
    update(deltaMs: number): void {
        if (this._status !== 'inProgress') return;
        const dt = deltaMs / 1000;
        for (const ring of this.rings) {
            if (ring.locked) continue;
            ring.gapAngleDeg = wrap360(ring.gapAngleDeg + ring.speedDegPerSec * dt);
        }
    }

    /**
     * Attempt to push the stick through the current ring. If the gap
     * is within its half-width of the stick angle, the ring locks and
     * the stick advances. Otherwise the pick breaks and the game
     * transitions to `failure`. No-op once the game is in a terminal
     * state.
     */
    attemptDescend(): AttemptResult {
        if (this._status !== 'inProgress') {
            return this._status === 'success' ? { kind: 'success' } : { kind: 'failure' };
        }
        const ring = this.rings[this._currentRingIndex];
        const delta = angularDistance(ring.gapAngleDeg, STICK_ANGLE_DEG);
        if (delta <= ring.gapHalfWidthDeg) {
            ring.locked = true;
            this._currentRingIndex += 1;
            if (this._currentRingIndex >= this.rings.length) {
                this._status = 'success';
                return { kind: 'success' };
            }
            return {
                kind: 'ringLocked',
                ringIndex: this._currentRingIndex - 1,
                remaining: this.rings.length - this._currentRingIndex,
            };
        }
        this._status = 'failure';
        return { kind: 'failure' };
    }
}

/**
 * Roll a difficulty for a locked chest based on the player's current
 * depth. Uses {@link LOCKPICK_CONFIG.difficultyWeights} bucketed by
 * `depthBands`. Pure: depends only on `rng` for determinism.
 */
export function pickLockpickDifficulty(depth: number, rng: Rng): LockpickDifficulty {
    const { depthBands, difficultyWeights } = LOCKPICK_CONFIG;
    const band: 'shallow' | 'mid' | 'deep' =
        depth >= depthBands.deep ? 'deep' : depth >= depthBands.mid ? 'mid' : 'shallow';
    const weights = difficultyWeights[band];
    const total = weights.easy + weights.medium + weights.hard;
    const roll = rng.next() * total;
    if (roll < weights.easy) return 'easy';
    if (roll < weights.easy + weights.medium) return 'medium';
    return 'hard';
}

/** Wrap an angle in degrees into [0, 360). Handles negatives. */
function wrap360(angle: number): number {
    return ((angle % 360) + 360) % 360;
}

/**
 * Convert an arc length (in pixels) along a circle of the given radius
 * into the subtended central angle in degrees. Used to size each
 * ring's gap so a fixed pixel-wide visual gap maps to the right
 * per-ring angular tolerance.
 */
export function pixelArcToDegrees(arcLengthPx: number, radiusPx: number): number {
    if (radiusPx <= 0) return 0;
    return (arcLengthPx / radiusPx) * (180 / Math.PI);
}

/**
 * Shortest angular distance between two angles in degrees, always in
 * [0, 180]. Used to decide whether the gap is currently aligned with
 * the stick within `gapHalfWidthDeg`.
 */
function angularDistance(a: number, b: number): number {
    const d = Math.abs(wrap360(a) - wrap360(b));
    return d > 180 ? 360 - d : d;
}
