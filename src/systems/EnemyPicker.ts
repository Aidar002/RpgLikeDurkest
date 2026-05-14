import { ENEMY_TIERS } from '../data/GameConfig';
import type { EnemyDef } from '../data/GameConfig';
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
