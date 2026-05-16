import { BOSSES, ENEMY_TIERS, MAP_CONFIG } from '../data/GameConfig';
import type { EnemyDef } from '../data/GameConfig';
import { assertBossMapping } from '../data/Enemies';
import { defaultRng, pick, type Rng } from './Rng';

/**
 * Pick a normal-tier enemy for the given depth. The optional `rng`
 * parameter lets callers (combat manager, tests) inject a seeded
 * source so the enemy roll is part of the deterministic envelope.
 * Defaults to {@link defaultRng} (Math.random) so existing call sites
 * keep their current behaviour.
 *
 * Lives in `systems/` (not `data/`) because it consumes an `Rng` — the
 * `data → systems → ui → scenes` layer rule forbids `data/` from
 * value-importing out of `systems/`.
 */
export function getEnemyForDepth(depth: number, rng: Rng = defaultRng): EnemyDef {
    const tier = [...ENEMY_TIERS].reverse().find((t) => depth >= t.minDepth)!;
    return pick(rng, tier.pool);
}

/**
 * Pick a boss for the given depth. When multiple BOSSES entries share
 * the same depth, the `rng` decides which candidate runs this fight,
 * so the boss roll stays inside the deterministic envelope.
 *
 * Off-bucket queries (e.g. mid-floor reroll) fall through to the
 * highest-defined boss at-or-below `depth`, but never past
 * {@link MAP_CONFIG.finalDepth} — the final depth always resolves
 * above.
 */
export function getBossForDepth(depth: number, rng: Rng = defaultRng): EnemyDef {
    if (import.meta && import.meta.env && import.meta.env.DEV) {
        // assertBossMapping() is cheap and only the first call's result
        // matters, so we let it throw eagerly in dev when the table
        // drifts.
        assertBossMapping();
    }
    const exact = BOSSES.filter((b) => b.depth === depth);
    if (exact.length > 0) {
        return pick(rng, exact).def;
    }

    const fallbackDepth = [...new Set(BOSSES.map((b) => b.depth))]
        .filter((d) => d <= depth && d <= MAP_CONFIG.finalDepth)
        .sort((a, b) => b - a)[0];
    if (fallbackDepth !== undefined) {
        const candidates = BOSSES.filter((b) => b.depth === fallbackDepth);
        return pick(rng, candidates).def;
    }
    return BOSSES[0].def;
}
