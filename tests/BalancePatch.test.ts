import { describe, expect, it } from 'vitest';
import { EXPECTED_BOSS_NAMES, assertBossMapping } from '../src/data/Enemies';
import { getBossForDepth } from '../src/systems/EnemyPicker';
import {
    EXPEDITION_CONFIG,
    LEVEL_UP_CONFIG,
    PLAYER_CONFIG,
    MAP_CONFIG,
} from '../src/data/GameConfig';
import { Mulberry32 } from '../src/systems/Rng';
import { PlayerManager } from '../src/systems/PlayerManager';

describe('[FIX-4] Boss mapping (canonical depth -> name set)', () => {
    it('every depth resolves to one of the expected candidate names', () => {
        // Deterministic RNG so the picked boss is reproducible per
        // depth; we re-seed each depth so the test isn't biased by an
        // unrelated earlier roll.
        for (const [depthStr, expectedNames] of Object.entries(EXPECTED_BOSS_NAMES)) {
            const def = getBossForDepth(Number(depthStr), new Mulberry32(1));
            expect(expectedNames).toContain(def.name);
        }
    });

    it('depth 25 covers every candidate boss over many rolls', () => {
        // With multiple equal-depth candidates we expect each one to
        // be reachable; seed-stable RNG over enough draws hits them.
        const expected = new Set(EXPECTED_BOSS_NAMES[MAP_CONFIG.finalDepth]);
        const seen = new Set<string>();
        const rng = new Mulberry32(42);
        for (let i = 0; i < 200 && seen.size < expected.size; i++) {
            seen.add(getBossForDepth(MAP_CONFIG.finalDepth, rng).name);
        }
        expect(seen).toEqual(expected);
    });

    it('does NOT regress to Nameless Maw at depth 25', () => {
        const def = getBossForDepth(MAP_CONFIG.finalDepth, new Mulberry32(7));
        expect(def.name).not.toBe('Nameless Maw');
    });

    it('assertBossMapping does not throw for the canonical table', () => {
        expect(() => assertBossMapping()).not.toThrow();
    });
});

describe('Starting resolve and clamps', () => {
    // Per design (post-FIX-3): runs begin resourceless. Gold, potions
    // and resolve all start at 0 — players earn them in-run.
    it('starting resolve = 0', () => {
        expect(EXPEDITION_CONFIG.startingResolve).toBe(0);
    });

    it('player.gainResolve clamps at maxResolve', () => {
        const p = new PlayerManager();
        const before = p.resources.resolve;
        p.gainResolve(99);
        expect(p.resources.resolve).toBe(p.resources.maxResolve);
        expect(before).toBe(EXPEDITION_CONFIG.startingResolve);
    });
});

describe('[FIX-9] Level cap', () => {
    it('LEVEL_UP_CONFIG.levelCap is 10', () => {
        expect(LEVEL_UP_CONFIG.levelCap).toBe(10);
    });

    it('XP gain past the level cap is dropped', () => {
        const p = new PlayerManager();
        p.stats.level = LEVEL_UP_CONFIG.levelCap;
        p.stats.xp = 0;
        const granted = p.gainXp(9999);
        expect(granted).toBe(0);
        expect(p.stats.level).toBe(LEVEL_UP_CONFIG.levelCap);
    });
});

describe('[FIX-3 / sanity] Player config defaults', () => {
    it('starting hp / max resolve are configured', () => {
        expect(PLAYER_CONFIG.hp).toBeGreaterThan(0);
        expect(PLAYER_CONFIG.maxResolve).toBe(3);
    });
});
