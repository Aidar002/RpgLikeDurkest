import { beforeEach, describe, expect, it } from 'vitest';
import { AFFLICTIONS, StressManager, VIRTUES, type Resolution } from '../src/systems/Stress';
import { Mulberry32 } from '../src/systems/Rng';

describe('StressManager', () => {
    let stress: StressManager;

    beforeEach(() => {
        stress = new StressManager(new Mulberry32(1));
    });

    it('accumulates stress and auto-resolves at 100 (resets to 50)', () => {
        stress.add(40);
        expect(stress.value).toBe(40);
        const result = stress.add(80);
        // Reaching 100 immediately triggers resolve(), which resets to 50.
        expect(result).not.toBeNull();
        expect(stress.value).toBe(50);
    });

    it('ignores negative amounts', () => {
        stress.add(-10);
        expect(stress.value).toBe(0);
    });

    it('applies reductionPct', () => {
        stress.add(50, 0.5);
        expect(stress.value).toBe(25);
    });

    it('resolves at 100 and resets to 50', () => {
        const result = stress.add(100);
        expect(result).not.toBeNull();
        expect(stress.value).toBe(50);
        expect(stress.resolution).not.toBeNull();
    });

    it('resolution is deterministic for a given seed', () => {
        const a = new StressManager(new Mulberry32(12345));
        const b = new StressManager(new Mulberry32(12345));
        const ra = a.add(100);
        const rb = b.add(100);
        expect(ra?.id).toBe(rb?.id);
    });

    it('abusive affliction increases stress gain by 50%', () => {
        const s = new StressManager(new Mulberry32(1));
        s.resolution = AFFLICTIONS.abusive;
        s.value = 0;
        s.add(20);
        expect(s.value).toBe(30);
    });

    it('relieve reduces stress but never below zero', () => {
        stress.add(30);
        stress.relieve(50);
        expect(stress.value).toBe(0);
    });

    it('isOverwhelmed becomes true only at 100', () => {
        // resolve() resets to 50, so we inspect the transient state via value.
        expect(stress.isOverwhelmed).toBe(false);
        stress.value = 100;
        expect(stress.isOverwhelmed).toBe(true);
    });

    it('damageTakenMod reflects resolution', () => {
        const s = new StressManager(new Mulberry32(1));
        s.resolution = AFFLICTIONS.paranoid;
        expect(s.damageTakenMod()).toBe(1);
        s.resolution = VIRTUES.stalwart;
        expect(s.damageTakenMod()).toBe(-1);
        s.resolution = null;
        expect(s.damageTakenMod()).toBe(0);
    });

    it('resolve picks a valid Affliction OR Virtue', () => {
        const kinds = new Set<Resolution['kind']>();
        for (let seed = 0; seed < 40; seed++) {
            const s = new StressManager(new Mulberry32(seed));
            const r = s.add(100);
            expect(r).not.toBeNull();
            kinds.add(r!.kind);
        }
        // Over 40 seeds we should see both affliction and virtue outcomes.
        expect(kinds.has('affliction')).toBe(true);
        expect(kinds.has('virtue')).toBe(true);
    });
});
