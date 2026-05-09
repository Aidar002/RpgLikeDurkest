import * as Phaser from 'phaser';
import { DungeonManager } from '../systems/DungeonManager';
import {
    MapGenerator,
    RoomType,
} from '../systems/MapGenerator';
import type { MapNode, RoomType as RoomTypeValue } from '../systems/MapGenerator';
import { CombatManager } from '../systems/CombatManager';
import {
    MetaProgressionManager,
    type ContentUnlockMilestone,
    type ContentUnlockState,
} from '../systems/MetaProgressionManager';
import { PlayerManager } from '../systems/PlayerManager';
import { RunTracker } from '../systems/RunTracker';
import { SKILLS, STARTER_LOADOUT } from '../systems/Skills';
import type { SkillId } from '../systems/Skills';
import { Localization } from '../systems/Localization';
import type { NpcManager } from '../systems/NpcManager';
import type { NpcOfferTemplate } from '../systems/Npcs';
import { EventLog } from '../ui/EventLog';
import { VFX } from '../ui/VFX';
import { MusicManager } from '../systems/MusicManager';
import { SoundManager } from '../systems/SoundManager';
import { PixelSprite } from '../ui/PixelSprite';
import { fitEnemySprite } from '../ui/RoomVisuals';
import { compactText } from '../ui/TextHelpers';
import {
    BOTTOM_BAR_H,
    CENTER_X,
    CENTER_Y,
    Depths,
    GAME_HEIGHT,
    GAME_WIDTH,
    HUD_BOTTOM_OFFSET,
    TOP_BAR_H,
} from '../ui/Layout';
import { hasTexture } from '../ui/AssetGuard';
import { setupSceneChrome, showUnlockBanner } from '../ui/SceneChrome';
import { createRoomButtons, type RoomButtonAction, type RoomButtonsHandle } from '../ui/RoomButtons';
import { MapView } from '../ui/MapView';
import {
    showDeathScreen,
    showVictoryScreen,
    type EndScreenContext,
} from '../ui/EndScreens';
import type { RunEndState } from '../ui/end/types';
import { RoomFlowController } from './RoomFlow';
import { CombatHudController } from './CombatHud';
import { GameHudController } from './controllers/GameHudController';
import {
    maybeDropRelic as maybeDropRelicImpl,
    type RelicDropKind,
} from '../systems/RelicDrops';

// Map layout / node-visual types moved to ../ui/MapView.ts.

// Room-action button types/builders moved to ../ui/RoomButtons.ts.
// Re-exported here for backward compat with `import { RoomButtonAction,
// RoomButtonVariant } from '../scenes/GameScene'` call sites in
// CombatHud / RoomFlow.
export type { RoomButtonAction, RoomButtonVariant } from '../ui/RoomButtons';

// =============================================================================
// GameScene routing map (see .agents/skills/rpg-like-durkest/SKILL.md for the cross-file picture)
// -----------------------------------------------------------------------------
// The global HUD (top + bottom bars, escape/restart buttons, restart-confirm
// modal, torchlight overlay, refresh + player-event wiring) lives in
// `./controllers/GameHudController.ts`. This file owns: scene lifecycle,
// container + manager wiring, map clicks + fade transitions, room-panel
// widgets shared with `RoomFlow` / `CombatHud`, end-screen routing.
// =============================================================================
export class GameScene extends Phaser.Scene {
    public meta!: MetaProgressionManager;
    public mapGen!: MapGenerator;
    public dungeon!: DungeonManager;
    public player!: PlayerManager;
    public combat!: CombatManager;
    public log!: EventLog;
    public tracker!: RunTracker;
    public skillLoadout: SkillId[] = [...STARTER_LOADOUT];
    public loc!: Localization;
    public sfx!: SoundManager;
    public music!: MusicManager;
    public npcs!: NpcManager;
    public mapContainer!: Phaser.GameObjects.Container;
    public roomContainer!: Phaser.GameObjects.Container;
    public uiContainer!: Phaser.GameObjects.Container;
    private mapView!: MapView;

    private animating = false;
    /** True after the death-screen sequence starts (or escape commits).
     *  Read by `GameHudController` / room transitions to gate clicks. */
    public dead = false;
    /** Re-entry guard so the death sequence runs only once per run.
     *  Set by `GameHudController.wire()` death handler and the escape flow. */
    public deathSequenceStarted = false;
    /** Duration of each fade phase (`fade-to-black` / `fade-from-black`). */
    private readonly roomTransitionPhaseMs = 800;
    /** Duration of the walk along the map edge before the room fade. */
    private readonly walkDurationMs = 2000;
    /** Fade-in / fade-out duration for the looped footsteps SFX that
     *  plays during the camera-pan room transition. */
    private readonly footstepsFadeMs = 500;
    public lastEnemyHp = 0;
    /**
     * Single source of truth for run-end-screen flags.
     *
     * Used to be 6 separate fields on the scene with a hand-rolled
     * proxy in `endScreenContext()` mapping each one to the
     * `RunEndState` shape. Folding them into one object lets us pass
     * the field straight into the end-screen context (no proxy) and
     * keeps the death-screen / escape-screen contract anchored on a
     * single type.
     *
     *  - `runBestDepth` / `runBossKills`: per-run telemetry shown on
     *    the HUD and on the run-summary screens.
     *  - `pendingSkillPoints`: skill points the player accumulated
     *    this run (one per level-up). Banked on escape, wiped on
     *    death.
     *  - `skillPointsBanked` / `skillPointsBankedFlag`: bookkeeping
     *    so the end screen renders "+N banked" exactly once even
     *    on re-renders.
     *  - `escaped`: true when the player committed to the HUD
     *    escape button instead of dying. Banking only fires when
     *    this is true.
     */
    public runState: RunEndState = {
        runBestDepth: 0,
        runBossKills: 0,
        pendingSkillPoints: 0,
        skillPointsBanked: 0,
        skillPointsBankedFlag: false,
        escaped: false,
    };
    public eliteKillsThisRun = 0;
    private roomTintOverlay: Phaser.GameObjects.Rectangle | null = null;

    public tooltipText!: Phaser.GameObjects.Text;

    public roomHeaderText!: Phaser.GameObjects.Text;
    public enemyPortrait!: Phaser.GameObjects.Rectangle;
    public enemyIconText!: Phaser.GameObjects.Text;
    public enemySpriteImage!: Phaser.GameObjects.Image;
    public enemyNameText!: Phaser.GameObjects.Text;
    public enemyHpBar!: Phaser.GameObjects.Rectangle;
    public enemyHpBarBg!: Phaser.GameObjects.Rectangle;
    public enemyHpText!: Phaser.GameObjects.Text;
    public enemyIntelText!: Phaser.GameObjects.Text;
    public roomFlavorText!: Phaser.GameObjects.Text;
    public roomPanelGroup!: Phaser.GameObjects.Container;
    public roomButtons!: RoomButtonsHandle;

    private roomFlow: RoomFlowController = new RoomFlowController(this);
    public combatHud: CombatHudController = new CombatHudController(this);
    private hud: GameHudController = new GameHudController(this);

    constructor() {
        super('GameScene');
    }

    /**
     * Receive shared services from the previous scene (BootScene). Falls back
     * to fresh instances so the scene still works if started directly (e.g.
     * future tests or hot-reload). Phaser carries init data through
     * `scene.restart()`, so the same `loc` / `sfx` references survive a run
     * restart from the death screen.
     */
    init(data?: { loc?: Localization; sfx?: SoundManager; music?: MusicManager }) {
        this.loc = data?.loc ?? new Localization();
        this.sfx = data?.sfx ?? new SoundManager();
        this.music = data?.music ?? new MusicManager();
    }

    public skillShort(id: SkillId): string {
        return this.loc.pick(SKILLS[id].short);
    }

    public milestoneLabel(milestone: ContentUnlockMilestone): string {
        return this.loc.pick(milestone.label);
    }

    public milestoneRequirement(milestone: ContentUnlockMilestone): string {
        return this.loc.pick(milestone.requirement);
    }

    public npcOfferLabel(offer: NpcOfferTemplate, cost: number, index: number): string {
        return this.loc.format(offer.label, { cost, index });
    }

    create() {
        this.meta = new MetaProgressionManager();
        this.npcs = this.meta.getNpcManager();
        const metaBonuses = this.meta.getBonuses();

        this.tracker = new RunTracker();

        this.player = new PlayerManager(metaBonuses.player);
        this.player.relicsChange.on(() => this.refreshUI());

        // Pick loadout: first 2 skills from [starter + meta-unlocked extras].
        const extras = this.meta.getUnlockedExtraSkills();
        const pool: SkillId[] = [...STARTER_LOADOUT, ...extras.filter(s => !STARTER_LOADOUT.includes(s))];
        this.skillLoadout = pool.slice(0, 2);

        this.mapGen = new MapGenerator(this.getUnlockedRoomTypes(this.meta.getUnlockedContent()));

        this.roomTintOverlay = null;
        this.animating = false;
        this.dead = false;
        this.deathSequenceStarted = false;
        this.lastEnemyHp = 0;
        this.runState = {
            runBestDepth: 0,
            runBossKills: 0,
            pendingSkillPoints: 0,
            skillPointsBanked: 0,
            skillPointsBankedFlag: false,
            escaped: false,
        };
        // Re-create the HUD controller on every restart so its widget
        // refs are scrubbed alongside Phaser's container teardown. The
        // initialiser-bound instance only covers the very first run.
        this.hud = new GameHudController(this);

        const nodes = this.mapGen.generateInitialMap();
        this.dungeon = new DungeonManager(
            nodes,
            (node, previous) => this.afterMove(node, previous),
            (fromDepth) => this.appendLayer(fromDepth)
        );

        PixelSprite.registerAll(this);

        this.mapContainer = this.add.container(0, 0);
        this.roomContainer = this.add.container(0, 0);
        this.uiContainer = this.add.container(0, 0);
        this.roomContainer.setVisible(false);

        // Tooltip text used by MapView for hover-name labels. Created
        // before MapView so the constructor can capture it.
        this.tooltipText = this.add.text(0, 0, '', {
            fontFamily: 'Courier New',
            fontSize: '11px',
            color: '#d0d0d0',
            backgroundColor: '#1a1a1aee',
            padding: { x: 6, y: 3 },
        }).setDepth(Depths.Tooltip).setVisible(false);

        this.mapView = new MapView({
            scene: this,
            container: this.mapContainer,
            dungeon: this.dungeon,
            meta: this.meta,
            loc: this.loc,
            tooltipText: this.tooltipText,
            canMove: (_node) =>
                this.mapContainer.visible &&
                !this.roomContainer.visible &&
                !this.animating &&
                !this.dead,
            onNodeClick: (node) => {
                this.sfx.play('nodeSelect');
                this.advanceToNode(node);
            },
        });

        this.log = new EventLog(
            this,
            18,
            TOP_BAR_H + 12,
            530,
            GAME_HEIGHT - TOP_BAR_H - BOTTOM_BAR_H - HUD_BOTTOM_OFFSET - 12,
        );
        this.roomContainer.add(this.log.view);

        this.hud.build();

        this.combat = new CombatManager(
            this.player,
            this.log,
            this.loc
        );
        this.combat.combatEnd.on((payload) => this.combatHud.handleVictory(payload));
        this.combat.playerHit.on(({ damage }) => this.combatHud.onPlayerHit(damage));
        this.combat.enemyUpdate.on(({ hp, maxHp, color, name, icon }) =>
            this.combatHud.updateEnemyUI(hp, maxHp, color, name, icon));
        this.combat.playerStatusChange.on(() => this.updatePlayerStatusUI());
        this.combat.enemyStatusChange.on(() => this.updateEnemyStatusUI());

        this.hud.wire();

        this.setupRoomUI();
        this.setupKeyboardShortcuts();
        this.mapView.build(false);
        this.mapView.redrawEdges();
        this.mapView.refresh();
        this.mapView.centerOnNode(this.dungeon.currentNode);
        this.refreshUI();

        VFX.scanlines(this, GAME_WIDTH, GAME_HEIGHT);
        VFX.ambientEmbers(this, 22);

        setupSceneChrome(this, this.sfx, this.loc, () => this.safeRestart(), this.music);
        this.sfx.startAmbient(0);
        this.music.start();

        this.log.addMessage(
            this.loc.language === 'ru'
                ? 'Спуск за Артефактом Желаний начался.'
                : 'The hunt for the Wish Artifact begins.',
            '#999999'
        );
    }

    private setupKeyboardShortcuts() {
        this.input.keyboard?.on('keydown-ONE', () => this.triggerActionButton(0));
        this.input.keyboard?.on('keydown-TWO', () => this.triggerActionButton(1));
        this.input.keyboard?.on('keydown-THREE', () => this.triggerActionButton(2));
        this.input.keyboard?.on('keydown-FOUR', () => this.triggerActionButton(3));
        this.input.keyboard?.on('keydown-FIVE', () => this.triggerActionButton(4));
        this.input.keyboard?.on('keydown-SPACE', () => {
            if (this.roomButtons.wideEnabled()) {
                this.triggerActionButton(4);
                return;
            }

            this.triggerActionButton(0);
        });
    }

    private triggerActionButton(index: number) {
        if (!this.roomContainer.visible || this.dead) {
            return;
        }

        this.roomButtons.trigger(index);
    }

    /**
     * Forward to the HUD controller. Kept as a public scene method
     * because `RoomFlow`, `CombatHud`, and many internal scene
     * methods (`afterMove`, `enterRoom`, end-screen handlers) call
     * `scene.refreshUI()`. Splitting the implementation into the
     * controller leaves these call sites untouched.
     */
    public refreshUI() {
        this.hud.refresh();
    }

    /** Forward to {@link GameHudController.updatePlayerStatus}. */
    public updatePlayerStatusUI() {
        this.hud.updatePlayerStatus();
    }

    /** Forward to {@link GameHudController.updateEnemyStatus}. */
    public updateEnemyStatusUI() {
        this.hud.updateEnemyStatus();
    }

    /** Forward to {@link GameHudController.relicSummary}. */
    public relicSummary(): string {
        return this.hud.relicSummary();
    }


    /**
     * Roll-and-grant a relic for a reward `kind`. Thin wrapper around
     * {@link maybeDropRelicImpl} (in `../systems/RelicDrops`) — exists
     * here only so external callers (`CombatHud`, `RoomFlow`) can keep
     * using the familiar `scene.maybeDropRelic(...)` shape. Returns
     * `true` if the player picked up a new relic.
     */
    public maybeDropRelic(kind: RelicDropKind, enemyName?: string): boolean {
        return maybeDropRelicImpl(
            {
                meta: this.meta,
                player: this.player,
                tracker: this.tracker,
                sfx: this.sfx,
                log: this.log,
                loc: this.loc,
            },
            kind,
            enemyName
        );
    }

    private setupRoomUI() {
        const panelY = TOP_BAR_H + 12;
        const panelH = GAME_HEIGHT - TOP_BAR_H - BOTTOM_BAR_H - HUD_BOTTOM_OFFSET - 12;
        const panel = this.add.rectangle(570, panelY, 434, panelH, 0x111111).setOrigin(0);
        panel.setStrokeStyle(2, 0x353535);

        this.roomHeaderText = this.add.text(590, panelY + 4, '', {
            fontFamily: 'Courier New',
            fontSize: '13px',
            color: '#8b8b8b',
        });

        this.enemyPortrait = this.add.rectangle(787, 190, 120, 120, 0x333333).setStrokeStyle(2, 0x555555);
        this.enemyIconText = this.add.text(787, 204, '', {
            fontFamily: 'Courier New',
            fontSize: '42px',
            color: '#ffffff',
        }).setOrigin(0.5);
        this.enemySpriteImage = this.add.image(787, 190, '__DEFAULT')
            .setVisible(false).setOrigin(0.5);

        this.enemyNameText = this.add.text(787, 266, '', {
            fontFamily: 'Courier New',
            fontSize: '18px',
            color: '#f0f0f0',
            align: 'center',
            wordWrap: { width: 280 },
        }).setOrigin(0.5, 0);

        this.enemyHpBarBg = this.add.rectangle(647, 326, 280, 14, 0x331111).setOrigin(0, 0.5);
        this.enemyHpBar = this.add.rectangle(647, 326, 280, 14, 0xc93d2f).setOrigin(0, 0.5);
        this.enemyHpText = this.add.text(787, 342, '', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#ad6767',
        }).setOrigin(0.5);

        this.enemyIntelText = this.add.text(787, 370, '', {
            fontFamily: 'Courier New',
            fontSize: '11px',
            color: '#7ea4ff',
            align: 'center',
            wordWrap: { width: 300 },
        }).setOrigin(0.5, 0);

        this.roomFlavorText = this.add.text(787, 416, '', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#9b9b9b',
            align: 'center',
            wordWrap: { width: 300 },
            lineSpacing: 2,
        }).setOrigin(0.5, 0);

        this.roomPanelGroup = this.add.container(0, 0, [
            panel,
            this.roomHeaderText,
            this.enemyPortrait,
            this.enemyIconText,
            this.enemySpriteImage,
            this.enemyNameText,
            this.enemyHpBarBg,
            this.enemyHpBar,
            this.enemyHpText,
            this.enemyIntelText,
            this.roomFlavorText,
        ]);

        this.roomContainer.add(this.roomPanelGroup);

        // Buttons live inside the right info panel (x=570..1004, centred at
        // 787). The left column was previously at x=650 which spilled past
        // the panel border and overlapped the EVENT LOG seam — shift the
        // pair so each column sits ~22 px inside the panel walls. The
        // actual button creation lives in `../ui/RoomButtons.ts`; the
        // returned handle exposes setActions / trigger / wideEnabled /
        // disableAll for keyboard shortcuts and combat to call.
        this.roomButtons = createRoomButtons(this, this.roomContainer, this.sfx);
    }

    /**
     * @deprecated Use `this.roomButtons.setActions(...)` directly.
     * Kept as a thin shim so RoomFlow / CombatHud call sites compile
     * unchanged after the RoomButtons extraction.
     */
    public setRoomButtons(actions: RoomButtonAction[], useWideOnly: boolean = false): void {
        this.roomButtons.setActions(actions, useWideOnly);
    }

    /**
     * Sequence the post-move animation: dim cleared rooms, build any
     * freshly-revealed nodes, redraw edges, then walk along the edge
     * path to the new node (with footstep traces and sound) before
     * fading into the room itself.
     * Triggered by `DungeonManager.onMove` (wired in `create()`).
     */
    private afterMove(node: MapNode, previous: MapNode) {
        this.updateRunProgress(node.depth);
        this.animating = true;

        this.mapView.animateClearedOut(() => {
            this.mapView.build(true);
            this.mapView.redrawEdges();
            this.mapView.refresh();

            this.sfx.startFootstepsLoop(this.footstepsFadeMs);

            this.mapView.animateWalk(
                previous,
                node,
                this.walkDurationMs,
                (_screenX, _screenY) => {
                    if (this.hud.torchlight) {
                        this.hud.torchlight.setPosition(_screenX, _screenY);
                    }
                },
                () => {
                    this.sfx.stopFootstepsLoop(this.footstepsFadeMs);
                    if (this.hud.torchlight) {
                        this.hud.torchlight.setPosition(
                            this.hud.torchlightHomeX,
                            this.hud.torchlightHomeY,
                        );
                    }
                    this.fadeToRoom(node);
                },
            );
        });
    }

    private updateRunProgress(depth: number) {
        if (depth > this.runState.runBestDepth) {
            this.runState.runBestDepth = depth;
        }

        const milestones = this.meta.unlockDepthMilestones(depth);
        this.handleMilestoneUnlocks(milestones);
        this.refreshUI();
    }

    public handleMilestoneUnlocks(milestones: ContentUnlockMilestone[]) {
        if (milestones.length === 0) {
            return;
        }

        milestones.forEach((milestone) => {
            const label = this.milestoneLabel(milestone);
            this.log.addMessage(this.loc.t('unlocked', { label }), '#66b8ff');
            showUnlockBanner(this, label);
        });

        this.refreshAvailableRoomPool(this.dungeon.currentDepth);
        this.mapView.refresh();
        this.refreshUI();
    }

    private appendLayer(fromDepth: number) {
        this.refreshAvailableRoomPool(this.dungeon.currentDepth);
        const newNodes = this.mapGen.generateNextLayer(this.dungeon.getAllNodes(), fromDepth);
        this.dungeon.addNodes(newNodes);
    }

    private refreshAvailableRoomPool(depth: number) {
        const projectedUnlocks = this.meta.getProjectedUnlocks(depth);
        this.mapGen.setAvailableRoomTypes(this.getUnlockedRoomTypes(projectedUnlocks));
    }

    private getUnlockedRoomTypes(unlocks: ContentUnlockState): RoomTypeValue[] {
        const roomTypes: RoomTypeValue[] = [RoomType.ENEMY, RoomType.EMPTY, RoomType.REST, RoomType.TREASURE];

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

    private fadeToRoom(node: MapNode) {
        this.animating = true;
        const overlay = this.add.rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000).setAlpha(0).setDepth(Depths.RoomTint);
        this.animateTorchlightSweep('forward');
        this.tweens.add({
            targets: overlay,
            alpha: 1,
            duration: this.roomTransitionPhaseMs,
            ease: 'Sine.in',
            onComplete: () => {
                this.mapContainer.setVisible(false);
                this.roomContainer.setVisible(true);
                // Re-evaluate HUD-button visibility now that the map
                // container is hidden — refreshUI keys off
                // mapContainer.visible to drop the Escape/Restart
                // buttons inside rooms.
                this.refreshUI();
                this.tweens.add({
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
     * Slide the torchlight pool toward `direction` over `roomTransitionPhaseMs`,
     * then ease it back to the home position over the same duration. Lines up
     * the visible "camera drift" of the lit area with the existing fade-to-
     * black / fade-from-black phases of the room transition.
     */
    private animateTorchlightSweep(direction: 'forward' | 'back') {
        const tl = this.hud.torchlight;
        if (!tl) return;
        const delta = direction === 'forward' ? this.hud.torchlightSweepPx : -this.hud.torchlightSweepPx;
        this.tweens.killTweensOf(tl);
        this.tweens.add({
            targets: tl,
            x: this.hud.torchlightHomeX + delta,
            duration: this.roomTransitionPhaseMs,
            ease: 'Sine.in',
            onComplete: () => {
                this.tweens.add({
                    targets: tl,
                    x: this.hud.torchlightHomeX,
                    duration: this.roomTransitionPhaseMs,
                    ease: 'Sine.out',
                });
            },
        });
    }

    private roomTintColor(type: RoomTypeValue): { color: number; alpha: number } {
        switch (type) {
            case RoomType.ENEMY: return { color: 0x331111, alpha: 0.12 };
            case RoomType.ELITE: return { color: 0x442211, alpha: 0.15 };
            case RoomType.BOSS: return { color: 0x440000, alpha: 0.18 };
            case RoomType.MINI_BOSS: return { color: 0x441111, alpha: 0.16 };
            case RoomType.TREASURE: return { color: 0x332800, alpha: 0.10 };
            case RoomType.TRAP: return { color: 0x220033, alpha: 0.14 };
            case RoomType.REST: return { color: 0x003311, alpha: 0.10 };
            case RoomType.SHRINE: return { color: 0x111133, alpha: 0.10 };
            case RoomType.MERCHANT: return { color: 0x112233, alpha: 0.10 };
            default: return { color: 0x111111, alpha: 0.06 };
        }
    }

    public applyRoomTint(type: RoomTypeValue) {
        if (this.roomTintOverlay) {
            this.roomTintOverlay.destroy();
            this.roomTintOverlay = null;
        }
        const tint = this.roomTintColor(type);
        this.roomTintOverlay = this.add.rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, tint.color, tint.alpha)
            .setDepth(1).setScrollFactor(0);
    }

    public clearRoomTint() {
        if (this.roomTintOverlay) {
            this.roomTintOverlay.destroy();
            this.roomTintOverlay = null;
        }
    }

    private enterRoom(node: MapNode) {
        this.roomFlow.enter(node);
    }

    public startCombatEncounter(kind: 'normal' | 'elite' | 'boss') {
        this.combatHud.start(kind);
    }

    public applyTrapDamage(rawDamage: number): number {
        return this.player.takeDamage(rawDamage, 0, 'trap');
    }

    public showRoomCard(
        header: string,
        title: string,
        description: string,
        color: number,
        icon: string,
        intel: string,
        spriteKey: string = header
    ) {
        this.roomHeaderText.setText(header);
        this.enemyPortrait.setFillStyle(color);
        this.enemyIconText.setText(icon);
        this.enemyNameText.setText(compactText(title, 28));
        this.roomFlavorText.setText(compactText(description, 72));
        this.enemyIntelText.setText(compactText(intel, 54));
        this.enemyIntelText.setVisible(true);
        this.enemyHpBarBg.setVisible(false);
        this.enemyHpBar.setVisible(false);
        this.enemyHpText.setVisible(false);
        this.roomPanelGroup.setVisible(true);

        const roomKey = PixelSprite.roomKey(spriteKey);
        if (hasTexture(this, roomKey)) {
            this.enemySpriteImage.setTexture(roomKey).setVisible(true);
            fitEnemySprite(this.enemySpriteImage);
            this.enemyIconText.setVisible(false);
        } else {
            this.enemySpriteImage.setVisible(false);
            this.enemyIconText.setVisible(true);
        }
    }

    public showReturnButton() {
        this.setRoomButtons(
            [
                {
                    label: this.loc.t('returnToMap'),
                    callback: () => this.returnToMap(),
                    fill: 0x202020,
                },
            ],
            true
        );
    }

    public returnToMap() {
        if (this.animating) return;
        this.animating = true;
        const overlay = this.add.rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000).setAlpha(0).setDepth(Depths.RoomTint);
        this.animateTorchlightSweep('back');
        this.tweens.add({
            targets: overlay,
            alpha: 1,
            duration: this.roomTransitionPhaseMs,
            ease: 'Sine.in',
            onComplete: () => {
                this.roomContainer.setVisible(false);
                this.mapContainer.setVisible(true);
                this.roomPanelGroup.setVisible(false);
                this.setRoomButtons([]);
                this.clearRoomTint();
                this.mapView.refresh();
                this.refreshUI();
                this.tweens.add({
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

    public advanceToNode(node: MapNode) {
        if (!this.mapView.canUseNode(node)) {
            return;
        }

        this.roomContainer.setVisible(false);
        this.roomPanelGroup.setVisible(false);
        this.mapContainer.setVisible(true);
        this.setRoomButtons([]);
        this.clearRoomTint();
        this.refreshUI();
        this.dungeon.moveTo(node.id);
    }

    public updateEnemyUI(
        hp: number,
        maxHp: number,
        color: number,
        name: string,
        icon: string
    ) {
        this.combatHud.updateEnemyUI(hp, maxHp, color, name, icon);
    }

    private endScreenContext(): EndScreenContext {
        // `runState` is the single source of truth for the run-end
        // flags (see field doc). End screens mutate it in place via
        // `bankSkillPointsOnce` and read back the banked totals on
        // re-renders — no proxy needed.
        return {
            scene: this,
            loc: this.loc,
            sfx: this.sfx,
            meta: this.meta,
            tracker: this.tracker,
            player: this.player,
            npcs: this.npcs,
            mapContainer: this.mapContainer,
            roomContainer: this.roomContainer,
            uiContainer: this.uiContainer,
            safeRestart: () => this.safeRestart(),
            runState: this.runState,
        };
    }

    public showVictoryScreen() {
        showVictoryScreen(this.endScreenContext());
    }

    /**
     * Run the death-screen flow. Public so {@link GameHudController}
     * can invoke it from the player.death handler and from the
     * escape-button two-tap commit path; existing scene-internal
     * call sites don't change.
     */
    public showDeathScreenInternal() {
        showDeathScreen(this.endScreenContext());
    }

    /**
     * Tear down timers/tweens/input and restart the current scene
     * (so the player starts a fresh run with the same locale + audio
     * managers). Used by the death-screen "play again" button and
     * the {@link setupSceneChrome} reset hook.
     */
    public safeRestart() {
        this.tweens.killAll();
        this.time.removeAllEvents();
        this.input.removeAllListeners();
        this.scene.restart();
    }
}
