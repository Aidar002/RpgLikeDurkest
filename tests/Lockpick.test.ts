import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCKPICK_CONFIG } from '../src/data/GameConfig';
import {
    LockpickGame,
    pickLockpickDifficulty,
    STICK_ANGLE_DEG,
    type LockpickDifficulty,
} from '../src/systems/Lockpick';
import { Mulberry32 } from '../src/systems/Rng';

afterEach(() => {
    vi.restoreAllMocks();
});

const ALL_DIFFICULTIES: LockpickDifficulty[] = ['easy', 'medium', 'hard'];

describe('LockpickGame construction', () => {
    it('builds 3 rings for every difficulty using the configured speeds + gap width', () => {
        for (const d of ALL_DIFFICULTIES) {
            const game = new LockpickGame(d, new Mulberry32(1));
            const cfg = LOCKPICK_CONFIG.difficulties[d];
            expect(game.rings).toHaveLength(3);
            for (const ring of game.rings) {
                expect(ring.gapHalfWidthDeg).toBeCloseTo(cfg.gapWidthDeg / 2);
                expect(ring.locked).toBe(false);
                expect(cfg.ringSpeedsDegPerSec).toContain(Math.abs(ring.speedDegPerSec));
                expect(ring.gapAngleDeg).toBeGreaterThanOrEqual(0);
                expect(ring.gapAngleDeg).toBeLessThan(360);
            }
        }
    });

    it('starts in progress, with no ring locked and index 0', () => {
        const game = new LockpickGame('easy', new Mulberry32(1));
        expect(game.status).toBe('inProgress');
        expect(game.currentRingIndex).toBe(0);
    });
});

describe('LockpickGame.update', () => {
    it('rotates every un-locked ring proportional to speed × deltaMs', () => {
        const game = new LockpickGame('hard', new Mulberry32(7));
        const before = game.rings.map((r) => r.gapAngleDeg);
        const speeds = game.rings.map((r) => r.speedDegPerSec);
        game.update(100); // 0.1 s
        for (let i = 0; i < game.rings.length; i++) {
            const expected = wrap360(before[i] + speeds[i] * 0.1);
            expect(game.rings[i].gapAngleDeg).toBeCloseTo(expected);
        }
    });

    it('keeps locked rings frozen in place', () => {
        const game = new LockpickGame('easy', new Mulberry32(1));
        // Force the first ring to be alignable, then lock it.
        game.rings[0].gapAngleDeg = STICK_ANGLE_DEG;
        game.attemptDescend();
        const lockedAngle = game.rings[0].gapAngleDeg;
        game.update(1000);
        expect(game.rings[0].gapAngleDeg).toBe(lockedAngle);
    });

    it('no-ops once the game has settled into a terminal status', () => {
        const game = new LockpickGame('easy', new Mulberry32(1));
        // Force a failure.
        game.rings[0].gapAngleDeg = 180;
        expect(game.attemptDescend().kind).toBe('failure');
        const snapshot = game.rings.map((r) => r.gapAngleDeg);
        game.update(500);
        expect(game.rings.map((r) => r.gapAngleDeg)).toEqual(snapshot);
    });
});

describe('LockpickGame.attemptDescend', () => {
    it('locks the current ring and advances when the gap is aligned', () => {
        const game = new LockpickGame('easy', new Mulberry32(1));
        game.rings[0].gapAngleDeg = STICK_ANGLE_DEG;
        const r = game.attemptDescend();
        expect(r).toEqual({ kind: 'ringLocked', ringIndex: 0, remaining: 2 });
        expect(game.rings[0].locked).toBe(true);
        expect(game.currentRingIndex).toBe(1);
        expect(game.status).toBe('inProgress');
    });

    it('counts an attempt as aligned when the gap is within its half-width of the stick', () => {
        const game = new LockpickGame('easy', new Mulberry32(1));
        const halfWidth = game.rings[0].gapHalfWidthDeg;
        // 1° inside the gap edge → still a hit.
        game.rings[0].gapAngleDeg = wrap360(STICK_ANGLE_DEG + halfWidth - 1);
        expect(game.attemptDescend().kind).toBe('ringLocked');
    });

    it('treats a gap just past its half-width as a miss → failure', () => {
        const game = new LockpickGame('easy', new Mulberry32(1));
        const halfWidth = game.rings[0].gapHalfWidthDeg;
        game.rings[0].gapAngleDeg = wrap360(STICK_ANGLE_DEG + halfWidth + 1);
        expect(game.attemptDescend().kind).toBe('failure');
        expect(game.status).toBe('failure');
    });

    it('clearing all 3 rings transitions to success', () => {
        const game = new LockpickGame('easy', new Mulberry32(1));
        game.rings.forEach((r) => (r.gapAngleDeg = STICK_ANGLE_DEG));
        expect(game.attemptDescend()).toMatchObject({ kind: 'ringLocked', ringIndex: 0 });
        expect(game.attemptDescend()).toMatchObject({ kind: 'ringLocked', ringIndex: 1 });
        expect(game.attemptDescend()).toEqual({ kind: 'success' });
        expect(game.status).toBe('success');
        expect(game.rings.every((r) => r.locked)).toBe(true);
    });

    it('returns the terminal kind on extra calls after success or failure', () => {
        const game = new LockpickGame('easy', new Mulberry32(1));
        game.rings[0].gapAngleDeg = 180; // out of gap → failure
        game.attemptDescend();
        expect(game.attemptDescend()).toEqual({ kind: 'failure' });
    });
});

describe('pickLockpickDifficulty', () => {
    it('biases towards easy on shallow depths', () => {
        const counts = sampleDistribution(1, 1000);
        expect(counts.easy).toBeGreaterThan(counts.medium);
        expect(counts.easy).toBeGreaterThan(counts.hard);
    });

    it('biases towards medium on the mid band', () => {
        const counts = sampleDistribution(LOCKPICK_CONFIG.depthBands.mid, 1000);
        expect(counts.medium).toBeGreaterThan(counts.easy);
        expect(counts.medium).toBeGreaterThan(counts.hard);
    });

    it('biases towards hard on the deep band', () => {
        const counts = sampleDistribution(LOCKPICK_CONFIG.depthBands.deep, 1000);
        expect(counts.hard).toBeGreaterThan(counts.easy);
        expect(counts.hard).toBeGreaterThanOrEqual(counts.medium);
    });

    it('uses the shallow band on depth 0', () => {
        const counts = sampleDistribution(0, 500);
        expect(counts.easy).toBeGreaterThan(counts.hard);
    });
});

function sampleDistribution(depth: number, n: number): Record<LockpickDifficulty, number> {
    const counts: Record<LockpickDifficulty, number> = { easy: 0, medium: 0, hard: 0 };
    const rng = new Mulberry32(42);
    for (let i = 0; i < n; i++) counts[pickLockpickDifficulty(depth, rng)] += 1;
    return counts;
}

function wrap360(angle: number): number {
    return ((angle % 360) + 360) % 360;
}
