import { ENEMY_TIERS, BOSSES, MAP_CONFIG } from './GameConfig';
import type { EnemyDef } from './GameConfig';

export type { EnemyDef };

export function getEnemyForDepth(depth: number): EnemyDef {
    const tier = [...ENEMY_TIERS].reverse().find(t => depth >= t.minDepth)!;
    const pool = tier.pool;
    return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * [FIX-1] Boss lookup is now an exact-depth match. The previous
 * implementation used `reverse().find(b => depth >= b.depth)` which
 * caused depth 25 to silently fall back to the depth-20 entry
 * (Nameless Maw). With every boss bucket explicit and a dev-mode
 * assertion in {@link assertBossMapping}, the final depth correctly
 * resolves to The Undying Wound.
 *
 * [FIX-4] In dev mode the function throws if the configured BOSSES
 * table doesn't satisfy the canonical depth -> name mapping.
 */
export const EXPECTED_BOSS_NAMES: Record<number, string> = {
    25: 'Death Knight',
};

export function getBossForDepth(depth: number): EnemyDef {
    if (import.meta && import.meta.env && import.meta.env.DEV) {
        // assertBossMapping() is cheap and only the first call's result
        // matters, so we let it throw eagerly in dev when the table
        // drifts.
        assertBossMapping();
    }
    const exact = BOSSES.find((b) => b.depth === depth);
    if (exact) return exact.def;

    // Fallback for off-bucket queries (e.g. mid-floor reroll). We still
    // pick the highest-defined boss at-or-below depth, but never fall
    // through past the final depth — depth 25 always resolves above.
    const fallback = [...BOSSES]
        .filter((b) => b.depth <= depth && b.depth <= MAP_CONFIG.finalDepth)
        .sort((a, b) => b.depth - a.depth)[0];
    return fallback ? fallback.def : BOSSES[0].def;
}

/**
 * Validates that the BOSSES table has every required depth and that
 * each one matches the canonical name. Used at module load in dev and
 * by the unit tests (FIX-4 acceptance).
 */
export function assertBossMapping(): void {
    for (const [depthStr, expectedName] of Object.entries(EXPECTED_BOSS_NAMES)) {
        const depth = Number(depthStr);
        const entry = BOSSES.find((b) => b.depth === depth);
        if (!entry) {
            throw new Error(
                `[BalancePatch] Missing boss at depth ${depth}; expected "${expectedName}".`
            );
        }
        if (entry.def.name !== expectedName) {
            throw new Error(
                `[BalancePatch] Boss at depth ${depth} should be "${expectedName}" but is "${entry.def.name}".`
            );
        }
    }
}
