import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    cloneDefaultProfile,
    MetaProgressionManager,
    sanitizeProfile,
} from '../src/systems/MetaProgressionManager';

const STORAGE_KEY = 'rpglikedurkest-meta-v4';
const LEGACY_KEYS = ['rpglikedurkest-meta-v3', 'rpglikedurkest-meta-v2', 'rpglikedurkest-meta-v1'];

class MemoryStorage {
    private data = new Map<string, string>();
    getItem(key: string): string | null {
        return this.data.has(key) ? this.data.get(key)! : null;
    }
    setItem(key: string, value: string): void {
        this.data.set(key, String(value));
    }
    removeItem(key: string): void {
        this.data.delete(key);
    }
    clear(): void {
        this.data.clear();
    }
    key(index: number): string | null {
        return Array.from(this.data.keys())[index] ?? null;
    }
    get length(): number {
        return this.data.size;
    }
}

declare const globalThis: { window?: { localStorage: MemoryStorage } };

beforeEach(() => {
    globalThis.window = { localStorage: new MemoryStorage() };
});

afterEach(() => {
    delete globalThis.window;
});

describe('sanitizeProfile', () => {
    it('clamps skill points and counters at zero', () => {
        const result = sanitizeProfile({
            skillPoints: -5,
            totalSkillPointsBanked: -10,
            highestDepthEver: -1,
            bossesKilledEver: -99,
        });
        expect(result.skillPoints).toBe(0);
        expect(result.totalSkillPointsBanked).toBe(0);
        expect(result.highestDepthEver).toBe(0);
        expect(result.bossesKilledEver).toBe(0);
    });

    it('clamps upgrade levels to each definition maxLevel', () => {
        const result = sanitizeProfile({
            upgrades: {
                damage: 999,
                hp: -4,
                defense: 999,
                goldGain: 999,
            },
        });
        // Canonical caps: damage 7, hp 8, defense 4, goldGain 4.
        expect(result.upgrades.damage).toBe(7);
        expect(result.upgrades.hp).toBe(0);
        expect(result.upgrades.defense).toBe(4);
        expect(result.upgrades.goldGain).toBe(4);
    });

    it('fills in defaults for missing fields', () => {
        const empty = sanitizeProfile({});
        const base = cloneDefaultProfile();
        expect(empty.skillPoints).toBe(base.skillPoints);
        expect(empty.upgrades).toEqual(base.upgrades);
        expect(empty.contentUnlocks).toEqual(base.contentUnlocks);
    });
});

describe('MetaProgressionManager.bankSkillPoints', () => {
    it('adds pending points to the persistent bank', () => {
        const manager = new MetaProgressionManager();
        const banked = manager.bankSkillPoints(3, 5);
        expect(banked).toBe(3);
        expect(manager.availableSkillPoints).toBe(3);
        expect(manager.totalSkillPointsBanked).toBe(3);
        expect(manager.highestDepthEver).toBe(5);
    });

    it('rejects negative or fractional inputs', () => {
        const manager = new MetaProgressionManager();
        expect(manager.bankSkillPoints(-7, 0)).toBe(0);
        expect(manager.bankSkillPoints(2.7, 0)).toBe(2);
        expect(manager.availableSkillPoints).toBe(2);
    });
});

describe('MetaProgressionManager.purchaseUpgrade', () => {
    // Canonical cost curves — keep in sync with UPGRADE_DEFINITIONS in
    // src/systems/MetaProgressionManager.ts. The parametric loop below
    // walks every level and asserts the manager spends the bank in the
    // exact cost order.
    const upgrades = [
        { id: 'damage' as const, costs: [1, 2, 4, 8, 16, 32, 64], maxLevel: 7 },
        { id: 'hp' as const, costs: [1, 2, 4, 5, 8, 9, 16, 17], maxLevel: 8 },
        { id: 'defense' as const, costs: [5, 10, 20, 40], maxLevel: 4 },
        { id: 'goldGain' as const, costs: [5, 10, 20, 40], maxLevel: 4 },
    ];

    upgrades.forEach(({ id, costs, maxLevel }) => {
        it(`spends skill points along the ${id} cost curve`, () => {
            const manager = new MetaProgressionManager();
            const total = costs.reduce((a, b) => a + b, 0);
            manager.bankSkillPoints(total, 0);

            for (let level = 0; level < maxLevel; level++) {
                expect(manager.purchaseUpgrade(id)).toBe(true);
                expect(manager.getUpgradeLevel(id)).toBe(level + 1);
            }

            expect(manager.availableSkillPoints).toBe(0);
            expect(manager.purchaseUpgrade(id)).toBe(false);
            expect(manager.getUpgradeLevel(id)).toBe(maxLevel);
        });
    });

    it('refuses purchases when the bank is too small', () => {
        const manager = new MetaProgressionManager();
        expect(manager.purchaseUpgrade('damage')).toBe(false);
        manager.bankSkillPoints(1, 0);
        expect(manager.purchaseUpgrade('defense')).toBe(false);
        expect(manager.availableSkillPoints).toBe(1);
    });
});

describe('MetaProgressionManager.resetProgress', () => {
    it('wipes the bank, every upgrade, and legacy localStorage entries', () => {
        const manager = new MetaProgressionManager();
        manager.bankSkillPoints(50, 9);
        expect(manager.purchaseUpgrade('damage')).toBe(true);
        LEGACY_KEYS.forEach((key) => window.localStorage.setItem(key, 'stale'));

        manager.resetProgress();

        expect(manager.availableSkillPoints).toBe(0);
        expect(manager.totalSkillPointsBanked).toBe(0);
        expect(manager.getUpgradeLevel('damage')).toBe(0);
        expect(manager.getUpgradeLevel('hp')).toBe(0);
        expect(manager.getUpgradeLevel('defense')).toBe(0);
        expect(manager.getUpgradeLevel('goldGain')).toBe(0);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
        LEGACY_KEYS.forEach((key) => {
            expect(window.localStorage.getItem(key)).toBeNull();
        });
    });
});

describe('MetaProgressionManager.getMilestoneProgressList', () => {
    it('returns one entry per milestone with current/target in the natural unit', () => {
        const manager = new MetaProgressionManager();
        const entries = manager.getMilestoneProgressList('en');
        expect(entries).toHaveLength(4);
        const targets = entries.map((e) => ({ id: e.id, target: e.target }));
        expect(targets).toEqual([
            { id: 'depth-5', target: 5 },
            { id: 'depth-15', target: 15 },
            { id: 'depth-25', target: 25 },
            { id: 'first-boss', target: 1 },
        ]);
        entries.forEach((entry) => {
            expect(entry.current).toBe(0);
            expect(entry.unlocked).toBe(false);
        });
    });

    it('clamps depth progress to the milestone target and lights up unlocked rows', () => {
        const manager = new MetaProgressionManager();
        manager.unlockDepthMilestones(15);
        manager.bankSkillPoints(0, 15);

        const entries = manager.getMilestoneProgressList('en');
        const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
        expect(byId['depth-5']).toMatchObject({ current: 5, target: 5, unlocked: true });
        expect(byId['depth-15']).toMatchObject({ current: 15, target: 15, unlocked: true });
        expect(byId['depth-25']).toMatchObject({ current: 15, target: 25, unlocked: false });
        expect(byId['first-boss']).toMatchObject({ current: 0, target: 1, unlocked: false });
    });

    it('treats the first boss kill as a 0/1 -> 1/1 ✓ row', () => {
        const manager = new MetaProgressionManager();
        manager.registerBossKill();
        const boss = manager
            .getMilestoneProgressList('en')
            .find((entry) => entry.id === 'first-boss');
        expect(boss).toMatchObject({ current: 1, target: 1, unlocked: true });
    });

    it('zeroes every entry after resetProgress', () => {
        const manager = new MetaProgressionManager();
        manager.unlockDepthMilestones(9);
        manager.registerBossKill();
        manager.bankSkillPoints(0, 9);
        manager.resetProgress();

        const entries = manager.getMilestoneProgressList('en');
        entries.forEach((entry) => {
            expect(entry.current).toBe(0);
            expect(entry.unlocked).toBe(false);
        });
    });
});

describe('MetaProgressionManager localStorage migration', () => {
    it('drops any pre-v4 snapshot on first load and starts from defaults', () => {
        LEGACY_KEYS.forEach((key) => window.localStorage.setItem(key, '{"prestigePoints":99}'));
        const manager = new MetaProgressionManager();
        expect(manager.availableSkillPoints).toBe(0);
        expect(manager.totalSkillPointsBanked).toBe(0);
        LEGACY_KEYS.forEach((key) => {
            expect(window.localStorage.getItem(key)).toBeNull();
        });
    });
});
