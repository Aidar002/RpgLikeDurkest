import { describe, it, expect } from 'vitest';
import { parseDevSeedQuery } from '../src/systems/DevSeed';

describe('parseDevSeedQuery', () => {
    it('returns null for an empty string', () => {
        expect(parseDevSeedQuery('')).toBeNull();
    });

    it('returns null when no recognised keys are present', () => {
        expect(parseDevSeedQuery('?foo=bar')).toBeNull();
    });

    it('parses seed as unsigned 32-bit integer', () => {
        const cfg = parseDevSeedQuery('?seed=42');
        expect(cfg).toEqual({ seed: 42 });
    });

    it('coerces negative seed to unsigned 32-bit', () => {
        const cfg = parseDevSeedQuery('?seed=-1');
        expect(cfg).toEqual({ seed: 0xffffffff });
    });

    it('parses inventory with gold and potion', () => {
        const cfg = parseDevSeedQuery('?inv=potion:3,gold:50');
        expect(cfg).toEqual({ inv: { potions: 3, gold: 50 } });
    });

    it('accepts "potions" as an alias for "potion"', () => {
        const cfg = parseDevSeedQuery('?inv=potions:5');
        expect(cfg).toEqual({ inv: { potions: 5 } });
    });

    it('ignores invalid inventory keys', () => {
        const cfg = parseDevSeedQuery('?inv=foo:10,gold:5');
        expect(cfg).toEqual({ inv: { gold: 5 } });
    });

    it('ignores non-positive inventory values', () => {
        expect(parseDevSeedQuery('?inv=gold:0')).toBeNull();
        expect(parseDevSeedQuery('?inv=gold:-1')).toBeNull();
    });

    it('parses lang=ru', () => {
        const cfg = parseDevSeedQuery('?lang=ru');
        expect(cfg).toEqual({ lang: 'ru' });
    });

    it('parses lang=en', () => {
        const cfg = parseDevSeedQuery('?lang=en');
        expect(cfg).toEqual({ lang: 'en' });
    });

    it('ignores invalid lang values', () => {
        expect(parseDevSeedQuery('?lang=fr')).toBeNull();
    });

    it('combines multiple params', () => {
        const cfg = parseDevSeedQuery('?seed=7&lang=ru&inv=gold:999');
        expect(cfg).toEqual({
            seed: 7,
            lang: 'ru',
            inv: { gold: 999 },
        });
    });

    it('ignores NaN seed values', () => {
        expect(parseDevSeedQuery('?seed=abc')).toBeNull();
    });

    it('handles inventory with mixed valid/invalid pairs', () => {
        const cfg = parseDevSeedQuery('?inv=gold:10,bad,potion:2');
        expect(cfg).toEqual({ inv: { gold: 10, potions: 2 } });
    });
});
