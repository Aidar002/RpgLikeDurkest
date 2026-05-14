import { describe, expect, it } from 'vitest';
import { ENEMY_TIERS } from '../src/data/GameConfig';
import { getEnemyForDepth } from '../src/systems/EnemyPicker';
import { Mulberry32 } from '../src/systems/Rng';

describe('getEnemyForDepth', () => {
    it('is deterministic when given a seeded Rng (same seed -> same enemy)', () => {
        // Two independent seeded Rngs at the same seed must produce the
        // same enemy at the same depth, even across many calls. Locks in
        // the contract that combat enemy selection is part of the
        // deterministic envelope (matching MapGenerator + CombatManager).
        const a = new Mulberry32(123);
        const b = new Mulberry32(123);
        for (let depth = 1; depth <= 25; depth++) {
            const enemyA = getEnemyForDepth(depth, a);
            const enemyB = getEnemyForDepth(depth, b);
            expect(enemyA.name).toBe(enemyB.name);
        }
    });

    it('returns an enemy from the tier matching the depth', () => {
        const rng = new Mulberry32(7);
        // For depth 1, the matched tier is the highest-minDepth tier
        // with minDepth <= 1. Mirror the production lookup so the test
        // doesn't fossilise a particular minDepth value.
        const sortedTiers = [...ENEMY_TIERS].sort((a, b) => b.minDepth - a.minDepth);
        const tier = sortedTiers.find((t) => 1 >= t.minDepth)!;
        const tierNames = new Set(tier.pool.map((e) => e.name));
        for (let i = 0; i < 50; i++) {
            const enemy = getEnemyForDepth(1, rng);
            expect(tierNames).toContain(enemy.name);
        }
    });

    it('uses defaultRng when no Rng is supplied (smoke)', () => {
        // No determinism contract here, just confirm the call signature
        // still works and returns a real enemy from the configured pool.
        const enemy = getEnemyForDepth(1);
        expect(enemy).toBeTruthy();
        expect(typeof enemy.name).toBe('string');
        expect(enemy.hp).toBeGreaterThan(0);
    });
});
