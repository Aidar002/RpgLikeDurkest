/**
 * Shared types for the post-run modal screens (victory + death).
 *
 * The screens are simple terminal overlays that hide the live scene
 * containers and only need read access to the run-scoped subsystems
 * plus a `runState` reference for skill-point banking bookkeeping.
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
    /** Skill points the player accumulated during the current run
     *  (one per level-up). Only banked when `escaped` is true. */
    pendingSkillPoints: number;
    /** Number of pending points actually banked at end-of-run. Set by
     *  `bankSkillPointsOnce` so the end screen can render the exact
     *  banked total even on later re-renders. */
    skillPointsBanked: number;
    /** Re-entry guard so `bankSkillPointsOnce` only commits once per
     *  end screen instance. */
    skillPointsBankedFlag: boolean;
    /**
     * True when the player invoked the HUD escape button instead of
     * dying. Banking happens only on escape; on death the entire
     * profile (bank + every purchased upgrade) is wiped instead.
     */
    escaped: boolean;
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
