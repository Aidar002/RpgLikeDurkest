import { describe, expect, it } from 'vitest';
import {
    EXPECTED_BOSS_NAMES,
    assertBossMapping,
    getBossForDepth,
} from '../src/data/Enemies';
import {
    EXPEDITION_CONFIG,
    LEVEL_UP_CONFIG,
    LIGHT_CONFIG,
    STUN_RESIST_CONFIG,
    PLAYER_CONFIG,
    MAP_CONFIG,
} from '../src/data/GameConfig';
import { PlayerManager } from '../src/systems/PlayerManager';
import { shouldDecayLight } from '../src/systems/Light';

describe('[FIX-4] Boss mapping (canonical depth -> name)', () => {
    it('maps every required depth to the expected boss', () => {
        for (const [depthStr, expectedName] of Object.entries(EXPECTED_BOSS_NAMES)) {
            const def = getBossForDepth(Number(depthStr));
            expect(def.name).toBe(expectedName);
        }
    });

    it('does NOT regress to Nameless Maw at depth 25', () => {
        const def = getBossForDepth(MAP_CONFIG.finalDepth);
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

describe('[FIX-2] Light economy', () => {
    it('decays every N rooms (default runLength), not every room', () => {
        // At default runLength=25 the derived interval is 2.
        expect(shouldDecayLight(1)).toBe(false);
        expect(shouldDecayLight(2)).toBe(true);
        expect(shouldDecayLight(3)).toBe(false);
        expect(shouldDecayLight(4)).toBe(true);
    });

    it('legacy LIGHT_CONFIG.decayEveryNRooms still reports the short-run baseline', () => {
        expect(LIGHT_CONFIG.decayEveryNRooms).toBe(2);
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

describe('[FIX-11] Stun resistance baseline tiers', () => {
    it('matches the spec values for normal / elite tiers', () => {
        expect(STUN_RESIST_CONFIG.normal).toBe(0);
        expect(STUN_RESIST_CONFIG.elite).toBe(0.5);
    });
});

describe('[FIX-3 / sanity] Player config defaults', () => {
    it('starting hp / max resolve are configured', () => {
        expect(PLAYER_CONFIG.hp).toBeGreaterThan(0);
        expect(PLAYER_CONFIG.maxResolve).toBe(3);
    });
});
