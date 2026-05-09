import { showDeathScreen, showVictoryScreen, type EndScreenContext } from '../../ui/EndScreens';
import type { GameScene } from '../GameScene';

/**
 * Owns the run-end overlay flow: builds the {@link EndScreenContext}
 * shared by the victory/death screens, fires either screen, and runs
 * the `safeRestart` teardown that the screens (and `setupSceneChrome`
 * reset hook) call when the player chooses to play again.
 *
 * `GameScene` keeps thin shim methods (`showVictoryScreen`,
 * `showDeathScreenInternal`, `safeRestart`) so the existing call sites
 * in `GameHudController` (death-screen handlers) and `CombatHud`
 * (victory delay) keep working without changes.
 */
export class GameOverlayController {
    private readonly scene: GameScene;

    constructor(scene: GameScene) {
        this.scene = scene;
    }

    /**
     * Build the shared end-screen context. `runState` is the single
     * source of truth for the run-end flags (see the field doc on
     * `GameScene.runState`). End screens mutate it in place via
     * `bankSkillPointsOnce` and read back the banked totals on
     * re-renders — no proxy needed.
     */
    private endScreenContext(): EndScreenContext {
        const scene = this.scene;
        return {
            scene,
            loc: scene.loc,
            sfx: scene.sfx,
            meta: scene.meta,
            tracker: scene.tracker,
            player: scene.player,
            npcs: scene.npcs,
            mapContainer: scene.mapContainer,
            roomContainer: scene.roomContainer,
            uiContainer: scene.uiContainer,
            safeRestart: () => this.safeRestart(),
            runState: scene.runState,
        };
    }

    public showVictoryScreen(): void {
        showVictoryScreen(this.endScreenContext());
    }

    /**
     * Run the death-screen flow. Public so {@link GameHudController}
     * can invoke it from the player.death handler and from the
     * escape-button two-tap commit path.
     */
    public showDeathScreenInternal(): void {
        showDeathScreen(this.endScreenContext());
    }

    /**
     * Tear down timers/tweens/input and restart the current scene
     * (so the player starts a fresh run with the same locale + audio
     * managers). Used by the death-screen "play again" button and
     * the `setupSceneChrome` reset hook.
     */
    public safeRestart(): void {
        const scene = this.scene;
        scene.tweens.killAll();
        scene.time.removeAllEvents();
        scene.input.removeAllListeners();
        scene.scene.restart();
    }
}
