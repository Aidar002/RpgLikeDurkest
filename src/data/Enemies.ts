import { BOSSES } from './GameConfig';

/**
 * [FIX-1] Boss lookup is now an exact-depth match. The lookup itself
 * lives in {@link systems/EnemyPicker.getBossForDepth} (it needs an
 * `Rng` to pick between equal-depth candidates, and `data/` cannot
 * value-import from `systems/`). This module owns the canonical-name
 * table and the dev-mode assertion that guards drift.
 *
 * Depth 25 resolves to one of five candidate bosses chosen by the
 * combat RNG.
 */
export const EXPECTED_BOSS_NAMES: Record<number, readonly string[]> = {
    25: ['Prophet', 'Mammon', 'Nimrod', 'Mime', 'Gilgamesh'],
};

/**
 * Validates that the BOSSES table has every required depth and that
 * each depth covers the canonical set of boss names. Used at module
 * load in dev and by the unit tests (FIX-4 acceptance).
 */
export function assertBossMapping(): void {
    for (const [depthStr, expectedNames] of Object.entries(EXPECTED_BOSS_NAMES)) {
        const depth = Number(depthStr);
        const entries = BOSSES.filter((b) => b.depth === depth);
        if (entries.length === 0) {
            throw new Error(
                `[BalancePatch] Missing boss(es) at depth ${depth}; expected one of "${expectedNames.join(', ')}".`
            );
        }
        const actualNames = new Set(entries.map((b) => b.def.name));
        for (const expected of expectedNames) {
            if (!actualNames.has(expected)) {
                throw new Error(
                    `[BalancePatch] Boss at depth ${depth} missing expected candidate "${expected}".`
                );
            }
        }
    }
}
