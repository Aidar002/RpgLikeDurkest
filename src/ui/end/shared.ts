/**
 * Helpers shared by `VictoryScreen` and `DeathScreen`. Both screens
 * need to (a) bank pending skill points exactly once per run when the
 * player escaped, (b) hide the live gameplay containers behind the
 * modal overlay.
 */
import type { EndScreenContext } from './types';

/**
 * Skill points are banked exactly once per run, and only when the
 * player escaped successfully. Death wipes everything elsewhere
 * (`GameScene` calls `meta.resetProgress()` on the death event), so
 * this helper is a no-op for non-escape end screens. The first call
 * commits the points and records the banked total into `runState`;
 * later calls are no-ops.
 */
export function bankSkillPointsOnce(ctx: EndScreenContext): void {
    if (ctx.runState.skillPointsBankedFlag) {
        return;
    }
    if (!ctx.runState.escaped) {
        ctx.runState.skillPointsBankedFlag = true;
        ctx.runState.skillPointsBanked = 0;
        return;
    }
    const banked = ctx.meta.bankSkillPoints(
        ctx.runState.pendingSkillPoints,
        ctx.runState.runBestDepth,
    );
    ctx.runState.skillPointsBanked = banked;
    ctx.runState.skillPointsBankedFlag = true;
}

/**
 * Hide the three live-scene containers (map, current room, HUD) so
 * the end-screen overlay reads as a clean modal rather than competing
 * with leftover gameplay UI. The containers are destroyed by the
 * subsequent `safeRestart()` so they don't need to be re-shown.
 */
export function hideLiveContainers(ctx: EndScreenContext): void {
    ctx.mapContainer.setVisible(false);
    ctx.roomContainer.setVisible(false);
    ctx.uiContainer.setVisible(false);
}
