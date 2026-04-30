// Minimal RNG abstraction so balance-sensitive systems (map generation,
// stress resolution, relic rolls) can be made deterministic for tests
// without changing run-time behavior when no seed is supplied.

export interface Rng {
    /** Uniform random in [0, 1). */
    next(): number;
}

/**
 * Mulberry32 — tiny deterministic PRNG suitable for seeded runs and tests.
 * Public domain reference: https://stackoverflow.com/a/47593316
 */
export class Mulberry32 implements Rng {
    private state: number;

    constructor(seed: number) {
        // Force to unsigned 32-bit.
        this.state = seed >>> 0;
    }

    next(): number {
        let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

/** Default RNG backed by Math.random; used when no seed is supplied. */
export const defaultRng: Rng = {
    next: () => Math.random(),
};

/** Uniform integer in [min, max] inclusive. */
export function randomInt(rng: Rng, min: number, max: number): number {
    return Math.floor(rng.next() * (max - min + 1)) + min;
}

/** True with probability p. */
export function chance(rng: Rng, p: number): boolean {
    return rng.next() < p;
}

/** Pick a random element. Throws on empty input. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
    if (arr.length === 0) {
        throw new Error('pick() called with empty array');
    }
    return arr[Math.floor(rng.next() * arr.length)];
}
