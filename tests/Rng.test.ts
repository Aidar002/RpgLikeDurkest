import { describe, expect, it } from 'vitest';
import { Mulberry32, chance, defaultRng, pick, randomInt } from '../src/systems/Rng';

describe('Mulberry32', () => {
    it('produces identical sequences for the same seed', () => {
        const a = new Mulberry32(42);
        const b = new Mulberry32(42);
        const seqA = Array.from({ length: 10 }, () => a.next());
        const seqB = Array.from({ length: 10 }, () => b.next());
        expect(seqA).toEqual(seqB);
    });

    it('produces different sequences for different seeds', () => {
        const a = new Mulberry32(1);
        const b = new Mulberry32(2);
        const seqA = Array.from({ length: 10 }, () => a.next());
        const seqB = Array.from({ length: 10 }, () => b.next());
        expect(seqA).not.toEqual(seqB);
    });

    it('stays in [0, 1)', () => {
        const rng = new Mulberry32(12345);
        for (let i = 0; i < 1000; i++) {
            const v = rng.next();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });
});

describe('defaultRng', () => {
    it('also stays in [0, 1)', () => {
        for (let i = 0; i < 100; i++) {
            const v = defaultRng.next();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });
});

describe('helpers', () => {
    it('randomInt respects inclusive bounds', () => {
        const rng = new Mulberry32(7);
        for (let i = 0; i < 200; i++) {
            const v = randomInt(rng, 3, 9);
            expect(v).toBeGreaterThanOrEqual(3);
            expect(v).toBeLessThanOrEqual(9);
        }
    });

    it('chance respects p=0 and p=1', () => {
        const rng = new Mulberry32(7);
        for (let i = 0; i < 50; i++) {
            expect(chance(rng, 0)).toBe(false);
            expect(chance(rng, 1)).toBe(true);
        }
    });

    it('pick returns an element from the array', () => {
        const rng = new Mulberry32(99);
        const arr = ['a', 'b', 'c'] as const;
        for (let i = 0; i < 50; i++) {
            expect(arr).toContain(pick(rng, arr));
        }
    });

    it('pick throws on empty array', () => {
        const rng = new Mulberry32(1);
        expect(() => pick(rng, [])).toThrow();
    });
});
