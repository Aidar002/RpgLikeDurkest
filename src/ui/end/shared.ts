/**
 * Helpers shared by `VictoryScreen` and `DeathScreen`. Both screens
 * need to (a) award prestige exactly once for the current run,
 * (b) hide the live gameplay containers behind the modal overlay.
 */
import type { EndScreenContext } from './types';

/**
 * Prestige is awarded once per run regardless of which end screen
 * fired (player can technically reach victory after a near-death,
 * etc.). The first call records the reward into `runState`; later
 * calls are no-ops.
 */
export function awardPrestigeOnce(ctx: EndScreenContext): void {
    if (!ctx.runState.prestigeAwarded) {
        ctx.runState.prestigeReward = ctx.meta.awardPrestigeForRun(
            ctx.runState.runBestDepth,
            ctx.runState.runBossKills,
        );
        ctx.runState.prestigeAwarded = true;
    }
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
