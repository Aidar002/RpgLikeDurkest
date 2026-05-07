import { describe, expect, it } from 'vitest';
import {
    getLightDecayInterval,
    isHighLight,
    isLightWarning,
    isLowLight,
    shouldDecayLight,
} from '../src/systems/Light';
import { EXPEDITION_CONFIG, LIGHT_CONFIG } from '../src/data/GameConfig';

/**
 * Light economy invariants. The decay interval is now derived from
 * `RUN_CONFIG.runLength` so longer expeditions don't burn through
 * Light before mid-game; these tests pin the formula for the four
 * canonical run lengths (25/35/50/75) plus boundary behaviour.
 */
describe('Light economy', () => {
    describe('getLightDecayInterval', () => {
        it.each([
            { runLength: 25, expected: 2 },
            { runLength: 35, expected: 3 },
            { runLength: 50, expected: 4 },
            { runLength: 75, expected: 6 },
        ])(
            'runLength=$runLength → interval=$expected (formula: max(2, round(rl/12)))',
            ({ runLength, expected }) => {
                expect(getLightDecayInterval(runLength)).toBe(expected);
            },
        );

        it('floors at decayIntervalFloor (=2) for very short runs', () => {
            expect(getLightDecayInterval(1)).toBe(LIGHT_CONFIG.decayIntervalFloor);
            expect(getLightDecayInterval(10)).toBe(LIGHT_CONFIG.decayIntervalFloor);
        });

        it('keeps scaling for runs longer than the canonical 75', () => {
            // 100 / 12 = 8.33 → 8
            expect(getLightDecayInterval(100)).toBe(8);
            // 120 / 12 = 10 → 10
            expect(getLightDecayInterval(120)).toBe(10);
        });
    });

    describe('shouldDecayLight', () => {
        it('triggers exactly on multiples of the interval', () => {
            // runLength=50 → interval=4
            expect(shouldDecayLight(1, 50)).toBe(false);
            expect(shouldDecayLight(2, 50)).toBe(false);
            expect(shouldDecayLight(3, 50)).toBe(false);
            expect(shouldDecayLight(4, 50)).toBe(true);
            expect(shouldDecayLight(5, 50)).toBe(false);
            expect(shouldDecayLight(8, 50)).toBe(true);
        });

        it('triggers every 6th room at runLength=75', () => {
            for (let r = 1; r <= 30; r++) {
                expect(shouldDecayLight(r, 75)).toBe(r % 6 === 0);
            }
        });
    });

    describe('low-light onset (no recovery)', () => {
        // Spec note: ideal target is "≈ 60-70 % of runLength" (per the
        // original brief). With the spec-quoted formula `runLength/12`
        // and current startingLight=7 / lowLightThreshold=4 the actual
        // onset is ~32 % across all lengths because the drop count
        // (startingLight - lowLightThreshold) is fixed at 4. Tracked in
        // the PR description for follow-up balance once recovery
        // sources are in. We assert the *current* formula behaviour
        // here, not the ideal target, so the test is deterministic.
        it.each([
            { runLength: 25, expectedRoom: 8, expectedPct: 32 },
            { runLength: 35, expectedRoom: 12, expectedPct: 34 },
            { runLength: 50, expectedRoom: 16, expectedPct: 32 },
            { runLength: 75, expectedRoom: 24, expectedPct: 32 },
        ])(
            'runLength=$runLength → low-light at room $expectedRoom (~$expectedPct % of run)',
            ({ runLength, expectedRoom, expectedPct }) => {
                let light: number = EXPEDITION_CONFIG.startingLight;
                let firstLowLightRoom = -1;
                for (let room = 1; room <= runLength; room++) {
                    if (shouldDecayLight(room, runLength)) {
                        light = Math.max(0, light - 1);
                    }
                    if (light < EXPEDITION_CONFIG.lowLightThreshold) {
                        firstLowLightRoom = room;
                        break;
                    }
                }
                expect(firstLowLightRoom).toBe(expectedRoom);
                const pct = Math.round((firstLowLightRoom / runLength) * 100);
                expect(pct).toBe(expectedPct);
            },
        );
    });

    describe('threshold helpers (unchanged)', () => {
        it('isHighLight: light >= EXPEDITION_CONFIG.highLightThreshold', () => {
            expect(isHighLight(EXPEDITION_CONFIG.highLightThreshold)).toBe(true);
            expect(isHighLight(EXPEDITION_CONFIG.highLightThreshold - 1)).toBe(false);
        });

        it('isLowLight: light < EXPEDITION_CONFIG.lowLightThreshold', () => {
            expect(isLowLight(EXPEDITION_CONFIG.lowLightThreshold - 1)).toBe(true);
            expect(isLowLight(EXPEDITION_CONFIG.lowLightThreshold)).toBe(false);
        });

        it('isLightWarning: 0 < light <= warningThreshold', () => {
            expect(isLightWarning(0)).toBe(false);
            expect(isLightWarning(1)).toBe(true);
            expect(isLightWarning(LIGHT_CONFIG.warningThreshold)).toBe(true);
            expect(isLightWarning(LIGHT_CONFIG.warningThreshold + 1)).toBe(false);
        });
    });
});
