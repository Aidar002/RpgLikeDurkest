/**
 * Shared types for the post-run modal screens (victory + death).
 *
 * The screens are simple terminal overlays that hide the live scene
 * containers and only need read access to the run-scoped subsystems
 * plus a `runState` reference for prestige awarding bookkeeping.
 */
import type * as Phaser from 'phaser';

import type { Localization } from '../../systems/Localization';
import type { MetaProgressionManager } from '../../systems/MetaProgressionManager';
import type { NpcManager } from '../../systems/NpcManager';
import type { PlayerManager } from '../../systems/PlayerManager';
import type { RunTracker } from '../../systems/RunTracker';
import type { SoundManager } from '../../systems/SoundManager';

/** Run-scoped flags shared between the two end-screen flows. */
export interface RunEndState {
    runBestDepth: number;
    runBossKills: number;
    prestigeAwarded: boolean;
    prestigeReward: number;
}

/**
 * Everything an end-screen renderer needs. Bundled into one object so
 * `showVictoryScreen` / `showDeathScreen` keep narrow signatures and
 * GameScene only constructs this once.
 */
export interface EndScreenContext {
    scene: Phaser.Scene;
    loc: Localization;
    sfx: SoundManager;
    meta: MetaProgressionManager;
    tracker: RunTracker;
    player: PlayerManager;
    npcs: NpcManager;
    mapContainer: Phaser.GameObjects.Container;
    roomContainer: Phaser.GameObjects.Container;
    uiContainer: Phaser.GameObjects.Container;
    runState: RunEndState;
    /** Scene restart that also tears down timers/tweens/input. */
    safeRestart: () => void;
}
