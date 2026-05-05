/**
 * Barrel re-exports for the post-run end screens. The implementation
 * was split into per-screen modules under `./end/` so each file is
 * focused on a single overlay (death vs. victory) plus shared helpers
 * — see `./end/DeathScreen.ts`, `./end/VictoryScreen.ts`,
 * `./end/shared.ts`, `./end/types.ts`.
 *
 * Existing callers (`GameScene`) keep importing from `./EndScreens`
 * unchanged; new callers can reach for the per-module imports.
 */
export { showDeathScreen } from './end/DeathScreen';
export { showVictoryScreen } from './end/VictoryScreen';
export type { EndScreenContext, RunEndState } from './end/types';
