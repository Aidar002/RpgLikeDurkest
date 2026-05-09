// Constants and helpers shared between the map generator and the
// post-build validator. Lives in its own module so neither side has
// to depend on the other (avoids a circular import between
// `MapGenerator.ts` and `validate.ts`).

import { FEATURES, RUN_CONFIG } from '../../data/GameConfig';
import { RoomType } from '../../data/MapTypes';

function clamp(value: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, value));
}

/**
 * Compute the `requiredSeals` budget for a given run length.
 *
 * When the seal feature is disabled (see {@link FEATURES.seals}) we
 * return 0 so the generator skips the seal-coverage promotion pass —
 * promoting plain rooms into mini-bosses for an invisible system
 * would just inflate the boss count and slow generation on long
 * runs.
 */
export function getRequiredSeals(runLength: number): number {
    if (!FEATURES.seals) return 0;
    const cfg = RUN_CONFIG.seals;
    return clamp(
        Math.round(runLength / cfg.requiredSealsFactor),
        cfg.requiredSealsMin,
        cfg.requiredSealsMax
    );
}

/**
 * Recovery / reward room types forced as the **direct child** of a
 * mid-run major boss (`bossKind === 'major'`). Mini-bosses do *not*
 * trigger this — only major bosses interrupt the run hard enough
 * to deserve a guaranteed catch-your-breath room afterwards.
 *
 * The generator enforces this when placing children of a major
 * (`pickRecoveryType` and `parentChildBlocked` in `MapGenerator.ts`);
 * the validator checks the same set as a post-build invariant.
 */
export const POST_MAJOR_RECOVERY_POOL: RoomType[] = [
    RoomType.REST,
    RoomType.SHRINE,
    RoomType.MERCHANT,
    RoomType.TREASURE,
];
