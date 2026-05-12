import type * as Phaser from 'phaser';

import { CENTER_X, CENTER_Y, Depths, GAME_HEIGHT, GAME_WIDTH } from '../../ui/Layout';
import { MapView } from '../../ui/MapView';
import { RoomType, type MapNode, type RoomType as RoomTypeValue } from '../../data/MapTypes';
import type {
    ContentUnlockMilestone,
    ContentUnlockState,
} from '../../systems/MetaProgressionManager';
import { showUnlockBanner } from '../../ui/SceneChrome';
import type { GameScene } from '../GameScene';

/**
 * Owns the world-map presentation and traversal flow: the {@link MapView}
 * instance, fade-to-black room transitions, the torchlight sweep that
 * pairs with each fade, milestone-unlock banners, room-tint overlay, and
 * the appendLayer / refreshAvailableRoomPool helpers driven by
 * {@link DungeonManager} callbacks.
 *
 * `GameScene` keeps thin shim methods (`applyRoomTint`, `returnToMap`,
 * `handleMilestoneUnlocks`) that forward here so existing call sites
 * in `RoomFlow` / `CombatHud` keep compiling unchanged.
 */
export class GameMapController {
    private readonly scene: GameScene;

    private mapView!: MapView;
    private animating = false;
    private roomTintOverlay: Phaser.GameObjects.Rectangle | null = null;

    /** Duration of each fade phase (`fade-to-black` / `fade-from-black`).
     *  Total transition = 2 × this value. */
    private readonly roomTransitionPhaseMs = 550;
    /** Duration of the walk along the map edge before the room fade. */
    private readonly walkDurationMs = 2000;
    /** Fade-in / fade-out duration for the looped footsteps SFX that
     *  plays during the camera-pan room transition. */
    private readonly footstepsFadeMs = 500;

    constructor(scene: GameScene) {
        this.scene = scene;
    }

    /** True while a fade / walk transition is in flight. Read by the HUD
     *  controller (via the scene shim) to gate clicks. */
    public isAnimating(): boolean {
        return this.animating;
    }

    /**
     * Construct the {@link MapView} and wire its `canMove` / `onNodeClick`
     * callbacks back into the scene. Must be called after `dungeon`,
     * `mapContainer`, and `tooltipText` are built on the scene.
     */
    public build(): void {
        const scene = this.scene;
        this.mapView = new MapView({
            scene,
            container: scene.mapContainer,
            dungeon: scene.dungeon,
            sfx: scene.sfx,
            meta: scene.meta,
            loc: scene.loc,
            tooltipText: scene.tooltipText,
            canMove: (_node) =>
                scene.mapContainer.visible &&
                !scene.roomContainer.visible &&
                !this.animating &&
                !scene.dead,
            onNodeClick: (node) => {
                scene.sfx.play('nodeSelect');
                this.advanceToNode(node);
            },
        });
    }

    /** Initial build / redraw / center sequence run once after `build()`. */
    public layoutInitial(): void {
        this.mapView.build(false);
        this.mapView.redrawEdges();
        this.mapView.refresh();
        this.mapView.centerOnNode(this.scene.dungeon.currentNode);
        // Pin the player on the starting node so its room pictogram
        // is suppressed from the very first frame — the carved frame
        // alone marks "you are here". See `MapView.arrivedNodeId`.
        this.mapView.setArrivedNode(this.scene.dungeon.currentNode.id);
    }

    public getUnlockedRoomTypes(unlocks: ContentUnlockState): RoomTypeValue[] {
        const roomTypes: RoomTypeValue[] = [
            RoomType.ENEMY,
            RoomType.EMPTY,
            RoomType.REST,
            RoomType.TREASURE,
        ];

        if (unlocks.room_trap) {
            roomTypes.push(RoomType.TRAP);
        }
        if (unlocks.room_merchant) {
            roomTypes.push(RoomType.MERCHANT);
        }
        if (unlocks.room_shrine) {
            roomTypes.push(RoomType.SHRINE);
        }
        if (unlocks.room_elite) {
            roomTypes.push(RoomType.ELITE);
        }

        return roomTypes;
    }

    /**
     * Sequence the post-move animation: dim cleared rooms, build any
     * freshly-revealed nodes, redraw edges, then walk along the edge
     * path to the new node (with footstep traces and sound) before
     * fading into the room itself.
     * Triggered by `DungeonManager.onMove` (wired in `GameScene.create`).
     */
    public afterMove(node: MapNode, previous: MapNode): void {
        const scene = this.scene;
        this.updateRunProgress(node.depth);
        this.animating = true;

        this.mapView.animateClearedOut(() => {
            this.mapView.build(true);
            this.mapView.redrawEdges();
            this.mapView.refresh();

            scene.sfx.startFootstepsLoop(this.footstepsFadeMs);

            this.mapView.animateWalk(
                previous,
                node,
                this.walkDurationMs,
                (_screenX, _screenY) => {
                    if (scene.hud.torchlight) {
                        scene.hud.torchlight.setPosition(_screenX, _screenY);
                    }
                },
                () => {
                    scene.sfx.stopFootstepsLoop(this.footstepsFadeMs);
                    if (scene.hud.torchlight) {
                        scene.hud.torchlight.setPosition(
                            scene.hud.torchlightHomeX,
                            scene.hud.torchlightHomeY
                        );
                    }
                    // Player has fully arrived — drop the destination's
                    // room pictogram so the slot reads as "you are
                    // here". The icon stayed visible during the 2 s
                    // walk so the player could see what they were
                    // walking toward. See `MapView.arrivedNodeId`.
                    this.mapView.setArrivedNode(node.id);
                    this.fadeToRoom(node);
                }
            );
        });
    }

    private updateRunProgress(depth: number): void {
        const scene = this.scene;
        if (depth > scene.runState.runBestDepth) {
            scene.runState.runBestDepth = depth;
        }

        const milestones = scene.meta.unlockDepthMilestones(depth);
        this.handleMilestoneUnlocks(milestones);
        scene.refreshUI();
    }

    public handleMilestoneUnlocks(milestones: ContentUnlockMilestone[]): void {
        if (milestones.length === 0) {
            return;
        }

        const scene = this.scene;
        milestones.forEach((milestone) => {
            const label = scene.milestoneLabel(milestone);
            scene.log.addMessage(scene.loc.t('unlocked', { label }), '#66b8ff');
            showUnlockBanner(scene, label);
        });

        this.refreshAvailableRoomPool(scene.dungeon.currentDepth);
        this.mapView.refresh();
        scene.refreshUI();
    }

    public appendLayer(fromDepth: number): void {
        const scene = this.scene;
        this.refreshAvailableRoomPool(scene.dungeon.currentDepth);
        const newNodes = scene.mapGen.generateNextLayer(scene.dungeon.getAllNodes(), fromDepth);
        scene.dungeon.addNodes(newNodes);
    }

    private refreshAvailableRoomPool(depth: number): void {
        const scene = this.scene;
        const projectedUnlocks = scene.meta.getProjectedUnlocks(depth);
        scene.mapGen.setAvailableRoomTypes(this.getUnlockedRoomTypes(projectedUnlocks));
    }

    private fadeToRoom(node: MapNode): void {
        const scene = this.scene;
        this.animating = true;
        const overlay = scene.add
            .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000)
            .setAlpha(0)
            .setDepth(Depths.RoomTint);
        this.animateTorchlightSweep('forward');
        scene.tweens.add({
            targets: overlay,
            alpha: 1,
            duration: this.roomTransitionPhaseMs,
            ease: 'Sine.in',
            onComplete: () => {
                scene.mapContainer.setVisible(false);
                scene.roomContainer.setVisible(true);
                // Re-evaluate HUD-button visibility now that the map
                // container is hidden — refreshUI keys off
                // mapContainer.visible to drop the Escape/Restart
                // buttons inside rooms.
                scene.refreshUI();
                scene.tweens.add({
                    targets: overlay,
                    alpha: 0,
                    duration: this.roomTransitionPhaseMs,
                    ease: 'Sine.out',
                    onComplete: () => {
                        overlay.destroy();
                        this.animating = false;
                    },
                });
                this.enterRoom(node);
            },
        });
    }

    /**
     * Slide the torchlight pool toward `direction` over
     * `roomTransitionPhaseMs`, then ease it back to the home position
     * over the same duration. Lines up the visible "camera drift" of
     * the lit area with the existing fade-to-black / fade-from-black
     * phases of the room transition.
     */
    private animateTorchlightSweep(direction: 'forward' | 'back'): void {
        const scene = this.scene;
        const tl = scene.hud.torchlight;
        if (!tl) return;
        const delta =
            direction === 'forward' ? scene.hud.torchlightSweepPx : -scene.hud.torchlightSweepPx;
        scene.tweens.killTweensOf(tl);
        scene.tweens.add({
            targets: tl,
            x: scene.hud.torchlightHomeX + delta,
            duration: this.roomTransitionPhaseMs,
            ease: 'Sine.in',
            onComplete: () => {
                scene.tweens.add({
                    targets: tl,
                    x: scene.hud.torchlightHomeX,
                    duration: this.roomTransitionPhaseMs,
                    ease: 'Sine.out',
                });
            },
        });
    }

    private roomTintColor(type: RoomTypeValue): { color: number; alpha: number } {
        switch (type) {
            case RoomType.ENEMY:
                return { color: 0x331111, alpha: 0.12 };
            case RoomType.ELITE:
                return { color: 0x442211, alpha: 0.15 };
            case RoomType.BOSS:
                return { color: 0x440000, alpha: 0.18 };
            case RoomType.MINI_BOSS:
                return { color: 0x441111, alpha: 0.16 };
            case RoomType.TREASURE:
                return { color: 0x332800, alpha: 0.1 };
            case RoomType.TRAP:
                return { color: 0x220033, alpha: 0.14 };
            case RoomType.REST:
                return { color: 0x003311, alpha: 0.1 };
            case RoomType.SHRINE:
                return { color: 0x111133, alpha: 0.1 };
            case RoomType.MERCHANT:
                return { color: 0x112233, alpha: 0.1 };
            default:
                return { color: 0x111111, alpha: 0.06 };
        }
    }

    public applyRoomTint(type: RoomTypeValue): void {
        const scene = this.scene;
        if (this.roomTintOverlay) {
            this.roomTintOverlay.destroy();
            this.roomTintOverlay = null;
        }
        const tint = this.roomTintColor(type);
        this.roomTintOverlay = scene.add
            .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, tint.color, tint.alpha)
            .setDepth(1)
            .setScrollFactor(0);
    }

    public clearRoomTint(): void {
        if (this.roomTintOverlay) {
            this.roomTintOverlay.destroy();
            this.roomTintOverlay = null;
        }
    }

    private enterRoom(node: MapNode): void {
        this.scene.roomFlow.enter(node);
    }

    public returnToMap(): void {
        if (this.animating) return;
        const scene = this.scene;
        this.animating = true;
        const overlay = scene.add
            .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000)
            .setAlpha(0)
            .setDepth(Depths.RoomTint);
        this.animateTorchlightSweep('back');
        scene.tweens.add({
            targets: overlay,
            alpha: 1,
            duration: this.roomTransitionPhaseMs,
            ease: 'Sine.in',
            onComplete: () => {
                scene.roomContainer.setVisible(false);
                scene.mapContainer.setVisible(true);
                scene.roomPanelGroup.setVisible(false);
                scene.setRoomButtons([]);
                this.clearRoomTint();
                this.mapView.refresh();
                scene.refreshUI();
                scene.tweens.add({
                    targets: overlay,
                    alpha: 0,
                    duration: this.roomTransitionPhaseMs,
                    ease: 'Sine.out',
                    onComplete: () => {
                        overlay.destroy();
                        this.animating = false;
                    },
                });
            },
        });
    }

    public advanceToNode(node: MapNode): void {
        if (!this.mapView.canUseNode(node)) {
            return;
        }

        const scene = this.scene;
        scene.roomContainer.setVisible(false);
        scene.roomPanelGroup.setVisible(false);
        scene.mapContainer.setVisible(true);
        scene.setRoomButtons([]);
        this.clearRoomTint();
        scene.refreshUI();
        scene.dungeon.moveTo(node.id);
    }
}
