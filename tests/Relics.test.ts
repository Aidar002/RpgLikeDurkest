import { describe, expect, it } from 'vitest';
import {
    RELICS,
    aggregateRelics,
    rollRelic,
    rollRelicFor,
    rollRelicForEnemy,
    type RelicId,
} from '../src/systems/Relics';
import { DROP_FORMULA } from '../src/data/GameConfig';
import { getEnemyDropMod } from '../src/systems/EnemyPicker';
import { Mulberry32 } from '../src/systems/Rng';

describe('Relics — generic pool', () => {
    it('rollRelic returns null when the owned list covers every relic', () => {
        const allOwned = Object.keys(RELICS) as RelicId[];
        expect(rollRelic(allOwned, 'common', new Mulberry32(1))).toBeNull();
    });

    it('rollRelic is deterministic for a given seed', () => {
        const owned: RelicId[] = [];
        const a = rollRelic(owned, 'common', new Mulberry32(42));
        const b = rollRelic(owned, 'common', new Mulberry32(42));
        expect(a).toBe(b);
    });

    it('rollRelicFor("boss") returns a unique relic when available', () => {
        const chosen = rollRelicFor([], 'boss', new Mulberry32(1));
        expect(chosen).not.toBeNull();
        if (chosen) {
            expect(RELICS[chosen].rarity).toBe('unique');
        }
    });

    it('rollRelicFor("normal") tends to return a common relic', () => {
        let commonCount = 0;
        const total = 40;
        for (let seed = 0; seed < total; seed++) {
            const chosen = rollRelicFor([], 'normal', new Mulberry32(seed));
            if (chosen && RELICS[chosen].rarity === 'common') commonCount++;
        }
        // Vast majority of normal rolls should land on commons.
        expect(commonCount).toBeGreaterThan(total * 0.75);
    });
});

// ---------------------------------------------------------------------------
// Stage [4] drop formula tests.
//
// Formula in `rollRelicForEnemy`:
//   dropChance = clamp01((X + Y*depth + Z + K*owned)/100 + relicMod)
//
// where
//   X  = randInt(DROP_FORMULA.xMin..xMax) — 20..30 inclusive
//   Y  = DROP_FORMULA.perDepth (= 2 per depth)
//   K  = DROP_FORMULA.perOwnedRelic (= -5 per relic owned)
//   Z  = `enemyDropMod` (per-enemy table — see EnemyPicker.getEnemyDropMod)
//   relicMod = aggregate.relicDropChanceMod (Clover +0.10, Cursed -0.25)
//
// We drive the formula with explicit depth/relicMod/enemyDropMod so the
// tests are arithmetic checks instead of integration checks.
// ---------------------------------------------------------------------------

/**
 * Tiny Rng stub that yields a fixed sequence of numbers in [0,1).
 * `rollRelicForEnemy` consumes at most three rolls per call:
 *   1. the X integer pick (Math.floor(r*range)+xMin)
 *   2. the formula gate (rng < dropChance)
 *   3. the weighted-pick selector (rng * totalWeight)
 *
 * The stub clamps past-the-end reads to 0 so a very high `dropChance`
 * roll (e.g. 0) always passes when the test forgot a third value.
 */
function fixedRng(values: number[]): { next: () => number } {
    let i = 0;
    return {
        next: () => {
            const v = values[i] ?? 0;
            i += 1;
            return v;
        },
    };
}

describe('rollRelicForEnemy — Stage [4] formula', () => {
    it('returns null when no relic in the table targets the enemy name', () => {
        const out = rollRelicForEnemy('NotAnEnemy', [], 5, 0, 0, new Mulberry32(1));
        expect(out).toBeNull();
    });

    it('clamps the drop chance to 0 (deeply negative inputs never drop)', () => {
        // X=20 (min), Y*depth = 2*0 = 0, Z=-50, K=-5*0 = 0,
        // relicMod = -0.25 → total% = -30 + relicMod*100 = -55%.
        // After clamp: 0 → roll always misses, no matter the rng value.
        // We pick Rat (has drops with chance=0.05) so the candidate set
        // is non-empty and the early-null path is the formula clamp.
        const out = rollRelicForEnemy(
            'Rat',
            [],
            0,
            -0.25,
            -50,
            // X=20 (rng[0]=0), formula gate would consume rng[1] but
            // dropChance=0 ⇒ the function bails before rolling.
            fixedRng([0, 0, 0])
        );
        expect(out).toBeNull();
    });

    it('clamps the drop chance to 1 (very positive inputs always drop)', () => {
        // X=30 (max), Y*depth=2*20=40, Z=+30, K=0, relicMod=+0.5
        // → 100%/100 + 0.5 = 1.5 → clamps to 1.0. Roll always passes.
        // Rat has two drop entries (worn_ring, slime_irrelevant). We
        // assert *some* relic comes back.
        const out = rollRelicForEnemy(
            'Rat',
            [],
            20,
            0.5,
            30,
            // rng[0] selects X (max → use 0.9999 so floor → 30-20+1=11
            // bucket lands on the top), rng[1] is the gate (anything
            // <1 passes), rng[2] picks the weighted candidate.
            fixedRng([0.99, 0.5, 0.0])
        );
        expect(out).not.toBeNull();
    });

    it('returns the guaranteed drop when an unowned drop entry has chance >= 1', () => {
        // Crown of Greed has `{ enemyName: 'Mammon', chance: 1 }` which
        // satisfies the >= 1.0 guaranteed branch. The formula does not
        // run; the function returns greed_crown immediately even if
        // the seeded rng would have miss-rolled.
        const out = rollRelicForEnemy(
            'Mammon',
            [],
            25,
            0,
            getEnemyDropMod('Mammon'),
            fixedRng([0, 0.999, 0])
        );
        expect(out).toBe('greed_crown');
    });

    it('once Crown of Greed is owned, Mammon falls back to weighted pick on Shard', () => {
        // After greed_crown is filtered out the only remaining Mammon
        // drop is `longinus_shard` (chance: 0.25 → only candidate).
        // We push the formula into "always pass" territory so the
        // weighted pick definitely fires and returns the shard.
        const out = rollRelicForEnemy(
            'Mammon',
            ['greed_crown'],
            25,
            0.5, // relicMod, ensures clamp → 1
            getEnemyDropMod('Mammon'),
            fixedRng([0.99, 0.0, 0.0])
        );
        expect(out).toBe('longinus_shard');
    });

    it('owning many relics drops the chance via K = -5 per relic', () => {
        // Build a base scenario that would land at ~50% drop chance
        // and then verify that adding 5 owned relics moves it to
        // ~25% (K=-25). We use Monte Carlo over the seed space so
        // the stochastic side gets exercised end-to-end.
        const enemy = 'Rat';
        const z = getEnemyDropMod(enemy); // +5
        const ownedFew: RelicId[] = ['knight_sword']; // not in Rat's drop list
        const ownedMany: RelicId[] = [
            'knight_sword',
            'knight_armor',
            'knight_helmet',
            'lost_staff',
            'cursed_amulet',
        ];
        let hitsFew = 0;
        let hitsMany = 0;
        const trials = 600;
        for (let s = 0; s < trials; s++) {
            const seed = s + 1;
            if (rollRelicForEnemy(enemy, ownedFew, 10, 0, z, new Mulberry32(seed))) hitsFew++;
            if (rollRelicForEnemy(enemy, ownedMany, 10, 0, z, new Mulberry32(seed))) hitsMany++;
        }
        // Larger inventory must measurably depress the hit rate.
        expect(hitsMany).toBeLessThan(hitsFew);
    });

    it('Clover relicMod (+0.10) raises the hit rate vs the same scenario without it', () => {
        const enemy = 'Vampire'; // Z=+15, only drop = four_leaf_clover
        const z = getEnemyDropMod(enemy);
        let hitsBase = 0;
        let hitsClover = 0;
        const trials = 600;
        for (let s = 0; s < trials; s++) {
            const seed = s + 1;
            // owned list is empty in both; the only difference is
            // the relicMod parameter.
            if (rollRelicForEnemy(enemy, [], 8, 0.0, z, new Mulberry32(seed))) hitsBase++;
            if (rollRelicForEnemy(enemy, [], 8, 0.1, z, new Mulberry32(seed))) hitsClover++;
        }
        expect(hitsClover).toBeGreaterThan(hitsBase);
    });

    it('Cursed set relicMod (-0.25) lowers the hit rate', () => {
        const enemy = 'Vampire';
        const z = getEnemyDropMod(enemy);
        let hitsBase = 0;
        let hitsCursed = 0;
        const trials = 600;
        for (let s = 0; s < trials; s++) {
            const seed = s + 1;
            if (rollRelicForEnemy(enemy, [], 12, 0.0, z, new Mulberry32(seed))) hitsBase++;
            if (rollRelicForEnemy(enemy, [], 12, -0.25, z, new Mulberry32(seed))) hitsCursed++;
        }
        expect(hitsCursed).toBeLessThan(hitsBase);
    });

    it('full Cursed set (cursed_amulet + cursed_ring) yields relicDropChanceMod = -0.25', () => {
        const agg = aggregateRelics(['cursed_amulet', 'cursed_ring']);
        expect(agg.relicDropChanceMod).toBeCloseTo(-0.25, 5);
    });

    it('Four-Leaf Clover yields relicDropChanceMod = +0.10', () => {
        const agg = aggregateRelics(['four_leaf_clover']);
        expect(agg.relicDropChanceMod).toBeCloseTo(0.1, 5);
    });

    it('DROP_FORMULA exposes the spec knobs with the expected defaults', () => {
        // Sanity-pin the Stage [4] knobs so a future tweak surfaces in
        // the test diff.
        expect(DROP_FORMULA.xMin).toBe(20);
        expect(DROP_FORMULA.xMax).toBe(30);
        expect(DROP_FORMULA.perDepth).toBe(2);
        expect(DROP_FORMULA.perOwnedRelic).toBe(-5);
    });
});
