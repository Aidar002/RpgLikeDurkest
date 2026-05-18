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

    it('seed=0 does not collapse to the all-zeros attractor', () => {
        // Bare Mulberry32 with seed=0 stays correlated for several
        // ticks before the (state + 0x6d2b79f5) mixer escapes. We
        // bump 0 to a fixed non-zero constant in the constructor so
        // the first ~10 outputs are already well-distributed.
        const rng = new Mulberry32(0);
        const samples = Array.from({ length: 10 }, () => rng.next());
        expect(samples.every((v) => v >= 0 && v < 1)).toBe(true);
        // At least one of the first ten samples must be > 0 — the
        // degenerate seed would otherwise produce a long run of 0s.
        expect(samples.some((v) => v > 0)).toBe(true);
    });

    it('seed=0 still produces a reproducible stream', () => {
        const a = new Mulberry32(0);
        const b = new Mulberry32(0);
        const seqA = Array.from({ length: 16 }, () => a.next());
        const seqB = Array.from({ length: 16 }, () => b.next());
        expect(seqA).toEqual(seqB);
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
