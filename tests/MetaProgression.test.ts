import { describe, expect, it } from 'vitest';
import {
    cloneDefaultProfile,
    migrateLegacyProfile,
    sanitizeProfile,
} from '../src/systems/MetaProgressionManager';

describe('sanitizeProfile', () => {
    it('clamps prestige and counters at zero', () => {
        const result = sanitizeProfile({
            prestigePoints: -5,
            totalPrestigeEarned: -10,
            highestDepthEver: -1,
            bossesKilledEver: -99,
        });
        expect(result.prestigePoints).toBe(0);
        expect(result.totalPrestigeEarned).toBe(0);
        expect(result.highestDepthEver).toBe(0);
        expect(result.bossesKilledEver).toBe(0);
    });

    it('clamps upgrade levels to each definition maxLevel', () => {
        const result = sanitizeProfile({
            upgrades: {
                vitality: 999,
                might: -4,
                wisdom: 999,
                recovery: 999,
                preparation: 999,
                lastStand: 999,
            },
        });
        // Using the current UPGRADE_DEFINITIONS maxLevels (5/3/4/4/3/1):
        expect(result.upgrades.vitality).toBeLessThanOrEqual(5);
        expect(result.upgrades.might).toBe(0);
        expect(result.upgrades.wisdom).toBeLessThanOrEqual(4);
        expect(result.upgrades.recovery).toBeLessThanOrEqual(4);
        expect(result.upgrades.preparation).toBeLessThanOrEqual(3);
        expect(result.upgrades.lastStand).toBeLessThanOrEqual(1);
    });

    it('fills in defaults for missing fields', () => {
        const empty = sanitizeProfile({});
        const base = cloneDefaultProfile();
        expect(empty.prestigePoints).toBe(base.prestigePoints);
        expect(empty.upgrades).toEqual(base.upgrades);
        expect(empty.contentUnlocks).toEqual(base.contentUnlocks);
    });
});

describe('migrateLegacyProfile', () => {
    it('remaps legacy foresight -> preparation', () => {
        const migrated = migrateLegacyProfile({
            upgrades: { foresight: 2 },
        });
        expect(migrated.upgrades.preparation).toBe(2);
    });

    it('derives bossesKilledEver from highestDepthEver when missing', () => {
        const migrated = migrateLegacyProfile({
            highestDepthEver: 17,
        });
        // Depths > 8 and > 16 both passed, so bosses ≥ 2.
        expect(migrated.bossesKilledEver).toBeGreaterThanOrEqual(2);
    });

    it('ignores completely bogus input gracefully', () => {
        const migrated = migrateLegacyProfile({ whatever: 'foo', upgrades: 'nope' });
        expect(migrated.prestigePoints).toBe(0);
        expect(migrated.upgrades.vitality).toBe(0);
    });
});
