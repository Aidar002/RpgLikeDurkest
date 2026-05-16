import * as Phaser from 'phaser';
import { DungeonManager } from '../systems/DungeonManager';
import { MapGenerator } from '../systems/MapGenerator';
import type { RoomType as RoomTypeValue } from '../data/MapTypes';
import { CombatManager } from '../systems/CombatManager';
import {
    MetaProgressionManager,
    type ContentUnlockMilestone,
} from '../systems/MetaProgressionManager';
import { PlayerManager } from '../systems/PlayerManager';
import { Mulberry32 } from '../systems/Rng';
import type { DevSeedConfig } from '../systems/DevSeed';
import { RunTracker } from '../systems/RunTracker';
import { SKILLS, STARTER_LOADOUT } from '../systems/Skills';
import type { SkillId } from '../systems/Skills';
import { Localization } from '../systems/Localization';
import type { NpcManager } from '../systems/NpcManager';
import type { NpcOfferTemplate } from '../systems/Npcs';
import { EventLog } from '../ui/EventLog';
import { BODY_FONT } from '../ui/HudTheme';
import { VFX } from '../ui/VFX';
import { MusicManager } from '../systems/MusicManager';
import { SoundManager } from '../systems/SoundManager';
import { PixelSprite } from '../ui/PixelSprite';
import {
    BOTTOM_BAR_H,
    Depths,
    GAME_HEIGHT,
    GAME_WIDTH,
    HUD_BOTTOM_OFFSET,
    RoomLayout,
    TOP_BAR_H,
} from '../ui/Layout';
import { setupSceneChrome } from '../ui/SceneChrome';
import type { RoomButtonAction, RoomButtonsHandle } from '../ui/RoomButtons';
import type { LockpickShowOptions } from '../ui/LockpickOverlay';
import type { RunEndState } from '../ui/end/types';
import { RoomFlowController } from './RoomFlow';
import { CombatHudController } from './CombatHud';
import { GameHudController } from './controllers/GameHudController';
import { GameMapController } from './controllers/GameMapController';
import { GameOverlayController } from './controllers/GameOverlayController';
import { GameRoomController } from './controllers/GameRoomController';
import { maybeDropRelic as maybeDropRelicImpl, type RelicDropKind } from '../systems/RelicDrops';

// Map layout / node-visual types moved to ../ui/MapView.ts.

// Room-action button types/builders moved to ../ui/RoomButtons.ts.
// Re-exported here for backward compat with `import { RoomButtonAction }
// from '../scenes/GameScene'` call sites in CombatHud / RoomFlow.
export type { RoomButtonAction } from '../ui/RoomButtons';

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

    /** True after the death-screen sequence starts (or escape commits).
     *  Read by `GameHudController` / room transitions to gate clicks. */
    public dead = false;
    /** Re-entry guard so the death sequence runs only once per run.
     *  Set by `GameHudController.wire()` death handler and the escape flow. */
    public deathSequenceStarted = false;
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
    public roomDialogContainer!: Phaser.GameObjects.Container;
    public roomPanelGroup!: Phaser.GameObjects.Container;
    public roomButtons!: RoomButtonsHandle;

    public roomFlow: RoomFlowController = new RoomFlowController(this);
    public combatHud: CombatHudController = new CombatHudController(this);
    public hud: GameHudController = new GameHudController(this);
    public map: GameMapController = new GameMapController(this);
    public overlay: GameOverlayController = new GameOverlayController(this);
    public room: GameRoomController = new GameRoomController(this);

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
    private devSeed: DevSeedConfig | null = null;

    init(data?: {
        loc?: Localization;
        sfx?: SoundManager;
        music?: MusicManager;
        devSeed?: DevSeedConfig | null;
    }) {
        this.loc = data?.loc ?? new Localization();
        this.sfx = data?.sfx ?? new SoundManager();
        this.music = data?.music ?? new MusicManager();
        this.devSeed = data?.devSeed ?? null;
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
        // Fade the dungeon in from black so the hand-off from BootScene
        // (which fades the camera out to black just before transitioning)
        // reads as one continuous dissolve instead of a hard pop. 1400 ms
        // mirrors `CAMERA_FADE_MS` in BootScene so the in/out beats are
        // symmetric. The map / HUD / player setup below runs while the
        // screen is still black, so the player only sees the dungeon
        // once the fade-in completes.
        this.cameras.main.fadeIn(1400, 0, 0, 0);

        this.meta = new MetaProgressionManager();
        // Wipe per-NPC memory on every run start so each NPC greets
        // the player with their `first` dialog beat. Upgrades, unlocks
        // and banked skill points keep their meta-persistence — only
        // the dialog memory map is reset.
        this.meta.resetNpcMemoryForNewRun();
        this.npcs = this.meta.getNpcManager();
        const metaBonuses = this.meta.getBonuses();

        this.tracker = new RunTracker();

        this.player = new PlayerManager(metaBonuses.player);
        this.player.relicsChange.on(() => this.refreshUI());

        // Pick loadout: first 2 skills from [starter + meta-unlocked extras].
        const extras = this.meta.getUnlockedExtraSkills();
        const pool: SkillId[] = [
            ...STARTER_LOADOUT,
            ...extras.filter((s) => !STARTER_LOADOUT.includes(s)),
        ];
        this.skillLoadout = pool.slice(0, 2);

        const rng =
            this.devSeed?.seed !== undefined ? new Mulberry32(this.devSeed.seed) : undefined;
        this.mapGen = new MapGenerator(
            this.map.getUnlockedRoomTypes(this.meta.getUnlockedContent()),
            rng
        );

        if (this.devSeed?.inv) {
            if (this.devSeed.inv.gold) this.player.gainGold(this.devSeed.inv.gold);
            if (this.devSeed.inv.potions) this.player.gainPotions(this.devSeed.inv.potions);
        }

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
        // Re-create the HUD/map/room/overlay controllers on every
        // restart so their widget refs are scrubbed alongside Phaser's
        // container teardown. The initialiser-bound instances only
        // cover the very first run.
        this.hud = new GameHudController(this);
        this.map = new GameMapController(this);
        this.overlay = new GameOverlayController(this);
        this.room = new GameRoomController(this);

        const nodes = this.mapGen.generateInitialMap();
        this.dungeon = new DungeonManager(
            nodes,
            (node, previous) => this.map.afterMove(node, previous),
            (fromDepth) => this.map.appendLayer(fromDepth)
        );

        PixelSprite.registerAll(this);

        this.mapContainer = this.add.container(0, 0);
        this.roomContainer = this.add.container(0, 0);
        this.uiContainer = this.add.container(0, 0);
        this.roomContainer.setVisible(false);

        // Tooltip text used by MapView for hover-name labels. Created
        // before MapView so the constructor can capture it.
        this.tooltipText = this.add
            .text(0, 0, '', {
                fontFamily: BODY_FONT,
                fontSize: '11px',
                color: '#d0d0d0',
                backgroundColor: '#1a1a1aee',
                padding: { x: 6, y: 3 },
            })
            .setDepth(Depths.Tooltip)
            .setVisible(false);

        this.map.build();

        this.log = new EventLog(
            this,
            RoomLayout.logX,
            TOP_BAR_H + 12,
            RoomLayout.logWidth,
            GAME_HEIGHT - TOP_BAR_H - BOTTOM_BAR_H - HUD_BOTTOM_OFFSET - 12
        );
        this.roomContainer.add(this.log.view);

        this.hud.build();

        this.combat = new CombatManager(this.player, this.log, this.loc);
        this.combat.combatEnd.on((payload) => this.combatHud.handleVictory(payload));
        this.combat.playerHit.on(({ damage }) => this.combatHud.onPlayerHit(damage));
        this.combat.enemyUpdate.on(({ hp, maxHp, color, name, icon }) =>
            this.combatHud.updateEnemyUI(hp, maxHp, color, name, icon)
        );
        this.combat.playerStatusChange.on(() => this.hud.updatePlayerStatus());
        this.combat.enemyStatusChange.on(() => this.hud.updateEnemyStatus());

        this.hud.wire();

        this.room.build();
        this.setupKeyboardShortcuts();
        this.map.layoutInitial();
        this.refreshUI();

        VFX.scanlines(this, GAME_WIDTH, GAME_HEIGHT);
        VFX.ambientEmbers(this, 22);

        setupSceneChrome(this, this.sfx, this.loc, () => this.safeRestart(), this.music);
        this.sfx.startAmbient(0);
        // Music setup lives here (not in BootScene) so the title
        // screen stays silent except for the procedural torch
        // crackle. `setPlaylist` is safe to call on every restart —
        // it just rewinds the (single-track) playlist.
        const audioBase = `${import.meta.env.BASE_URL}audio`;
        this.music.setPlaylist([{ url: `${audioBase}/dungeon_sound_2.mp3` }]);
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
        this.room.triggerActionButton(index);
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

    /**
     * Roll-and-grant a relic for a reward `kind`. Thin wrapper around
     * {@link maybeDropRelicImpl} (in `../systems/RelicDrops`) — exists
     * here only so external callers (`CombatHud`, `RoomFlow`) can keep
     * using the familiar `scene.maybeDropRelic(...)` shape. Returns
     * `true` if the player picked up a new relic.
     *
     * Plumbs `dungeon.currentDepth` and `player.aggregate.relicDropChanceMod`
     * into the dispatcher so the Stage [4] `X + Y*depth + Z + K + relicMod`
     * formula in `Relics.rollRelicForEnemy` has its full input vector
     * even though the call sites still spell `scene.maybeDropRelic(kind, name)`.
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
                depth: this.dungeon.currentDepth,
                relicMod: this.player.aggregate.relicDropChanceMod,
            },
            kind,
            enemyName
        );
    }

    /**
     * @deprecated Use `this.roomButtons.setActions(...)` directly.
     * Kept as a thin shim so RoomFlow / CombatHud call sites compile
     * unchanged after the RoomButtons extraction.
     */
    public setRoomButtons(actions: RoomButtonAction[], useWideOnly: boolean = false): void {
        this.room.setRoomButtons(actions, useWideOnly);
    }

    /** Forward to {@link GameMapController.applyRoomTint}. */
    public applyRoomTint(type: RoomTypeValue) {
        this.map.applyRoomTint(type);
    }

    /** Forward to {@link GameMapController.handleMilestoneUnlocks}. */
    public handleMilestoneUnlocks(milestones: ContentUnlockMilestone[]) {
        this.map.handleMilestoneUnlocks(milestones);
    }

    public startCombatEncounter(kind: 'normal' | 'elite' | 'boss') {
        this.combatHud.start(kind);
    }

    /** Forward to {@link GameRoomController.applyTrapDamage}. */
    public applyTrapDamage(rawDamage: number): number {
        return this.room.applyTrapDamage(rawDamage);
    }

    /** Forward to {@link GameRoomController.showLockpickModal}. */
    public showLockpickModal(options: LockpickShowOptions): void {
        this.room.showLockpickModal(options);
    }

    /** Forward to {@link GameRoomController.showRoomCard}. */
    public showRoomCard(
        header: string,
        title: string,
        description: string,
        color: number,
        icon: string,
        spriteKey: string = header
    ) {
        this.room.showRoomCard(header, title, description, color, icon, spriteKey);
    }

    /** Forward to {@link GameRoomController.showRoomNpcCard}. */
    public showRoomNpcCard(
        header: string,
        title: string,
        color: number,
        icon: string,
        npcSpeech: string
    ) {
        this.room.showRoomNpcCard(header, title, color, icon, npcSpeech);
    }

    /** Forward to {@link GameRoomController.updateRoomDialog}. */
    public updateRoomDialog(opts: { npc?: string; player?: string }) {
        this.room.updateRoomDialog(opts);
    }

    /** Forward to {@link GameRoomController.showReturnButton}. */
    public showReturnButton() {
        this.room.showReturnButton();
    }

    /** Forward to {@link GameMapController.returnToMap}. */
    public returnToMap() {
        this.map.returnToMap();
    }

    /** Forward to {@link GameOverlayController.showVictoryScreen}. */
    public showVictoryScreen() {
        this.overlay.showVictoryScreen();
    }

    /** Forward to {@link GameOverlayController.showDeathScreenInternal}. */
    public showDeathScreenInternal() {
        this.overlay.showDeathScreenInternal();
    }

    /** Forward to {@link GameOverlayController.safeRestart}. */
    public safeRestart() {
        this.overlay.safeRestart();
    }
}
