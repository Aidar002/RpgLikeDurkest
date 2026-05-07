import * as Phaser from 'phaser';
import { EXPEDITION_CONFIG, ROOM_CONFIG } from '../data/GameConfig';
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
import { RELICS, rollRelicFor } from '../systems/Relics';
import type { RelicRarity } from '../systems/Relics';
import { SKILLS, STARTER_LOADOUT } from '../systems/Skills';
import type { SkillId } from '../systems/Skills';
import { statusSummary } from '../systems/StatusEffects';
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
    HUD_PAD,
    HudLayout,
    TOP_BAR_H,
} from '../ui/Layout';
import {
    HUD_FONT,
    HUD_STROKE,
    HudColors,
    HudHex,
    drawBarFrame,
    drawBarSegments,
} from '../ui/HudTheme';
import { hasTexture } from '../ui/AssetGuard';
import { drawBottomFrame, drawStoneBackdrop, drawTopFrame } from '../ui/HudFrame';
import { createTorchlightOverlay } from '../ui/Torchlight';
import { createHudCell, createHudInlineSlot, type HudCellHandle, type HudInlineSlotHandle } from '../ui/HudCell';
import { createHudIcon } from '../ui/HudIcons';
import { setupSceneChrome, showUnlockBanner } from '../ui/SceneChrome';
import { createRoomButtons, type RoomButtonAction, type RoomButtonsHandle } from '../ui/RoomButtons';
import { MapView } from '../ui/MapView';
import {
    showDeathScreen,
    showVictoryScreen,
    type EndScreenContext,
} from '../ui/EndScreens';
import { RoomFlowController } from './RoomFlow';
import { CombatHudController } from './CombatHud';

// Map layout / node-visual types moved to ../ui/MapView.ts.

// Room-action button types/builders moved to ../ui/RoomButtons.ts.
// Re-exported here for backward compat with `import { RoomButtonAction,
// RoomButtonVariant } from '../scenes/GameScene'` call sites in
// CombatHud / RoomFlow.
export type { RoomButtonAction, RoomButtonVariant } from '../ui/RoomButtons';

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
    private dead = false;
    private torchlight: Phaser.GameObjects.Image | null = null;
    private torchlightHomeX = 0;
    private torchlightHomeY = 0;
    /** Horizontal slide each direction during a room transition (px). The
     *  light visibly drifts forward as the screen darkens, then back to
     *  centre as the new room emerges. */
    private readonly torchlightSweepPx = 110;
    /** Duration of each fade phase (`fade-to-black` / `fade-from-black`). */
    private readonly roomTransitionPhaseMs = 800;
    /** Duration of the walk along the map edge before the room fade. */
    private readonly walkDurationMs = 2000;
    /** Fade-in / fade-out duration for the looped footsteps SFX that
     *  plays during the camera-pan room transition. */
    private readonly footstepsFadeMs = 500;
    private deathSequenceStarted = false;
    public lastEnemyHp = 0;
    private runBestDepth = 0;
    public runBossKills = 0;
    private prestigeReward = 0;
    private prestigeAwarded = false;
    private escaped = false;
    /** Two-step confirm timer for the HUD escape button. -1 == idle. */
    private escapeConfirmAt = -1;
    public skipLightSpendThisRoom = false;
    /**
     * [FIX-2] Run-level counter incremented every time the player
     * enters a non-start room. Light is consumed only on every Nth
     * tick (LIGHT_CONFIG.decayEveryNRooms), preventing the early-game
     * darkness death-spiral.
     */
    public roomsVisitedForLight = 0;
    public eliteKillsThisRun = 0;
    private roomTintOverlay: Phaser.GameObjects.Rectangle | null = null;

    // HUD bar widths cached so refreshUI can rescale fills without re-measuring.
    private readonly hpBarWidth = 200;
    private readonly hpBarHeight = 14;
    private readonly xpBarWidth = 200;
    private readonly xpBarHeight = 10;

    private xpBarFrame!: Phaser.GameObjects.Graphics;
    private hpBar!: Phaser.GameObjects.Rectangle;
    private hpValueText!: Phaser.GameObjects.Text;
    private xpBar!: Phaser.GameObjects.Rectangle;
    private xpBarBg!: Phaser.GameObjects.Rectangle;
    private levelText!: Phaser.GameObjects.Text;
    private xpValueText!: Phaser.GameObjects.Text;
    private atkStat!: HudInlineSlotHandle;
    private defStat!: HudInlineSlotHandle;
    private revivesStat!: HudInlineSlotHandle;
    private lightTorchIcon!: Phaser.GameObjects.Text;
    private goldStat!: HudCellHandle;
    private potionStat!: HudCellHandle;
    private resolveStat!: HudCellHandle;
    private lightResStat!: HudCellHandle;
    private shardStat!: HudCellHandle;
    private depthStat!: HudCellHandle;
    private killsStat!: HudCellHandle;
    private bossStat!: HudCellHandle;
    private prestigeStat!: HudCellHandle;
    private escapeButtonBg!: Phaser.GameObjects.Rectangle;
    private escapeButtonLabel!: Phaser.GameObjects.Text;
    private hintText!: Phaser.GameObjects.Text;
    // mapDepthText was the small "ГЛУБИНА N" pill below the bottom bar —
    // removed because the dedicated ГЛУБИНА cell in the bottom HUD now
    // shows the same value with much better legibility.
    public tooltipText!: Phaser.GameObjects.Text;

    private relicText!: Phaser.GameObjects.Text;
    private playerStatusText!: Phaser.GameObjects.Text;
    private enemyStatusText!: Phaser.GameObjects.Text;

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
    private combatHud: CombatHudController = new CombatHudController(this);

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
        this.runBestDepth = 0;
        this.runBossKills = 0;
        this.prestigeReward = 0;
        this.prestigeAwarded = false;
        this.escaped = false;
        this.escapeConfirmAt = -1;
        this.skipLightSpendThisRoom = false;

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

        this.setupGlobalUI();

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

    private setupGlobalUI() {
        const PAD = HUD_PAD;
        const TOP_H = TOP_BAR_H;
        const BOT_H = BOTTOM_BAR_H;
        const BOT_Y = GAME_HEIGHT - BOT_H - HUD_BOTTOM_OFFSET;

        // ── PLAY-AREA BACKDROP ───────────────────────────────────
        // Optional carved-stone wall texture between the two HUD bars.
        // Drops out gracefully when the asset is missing.
        const playAreaH = GAME_HEIGHT - TOP_H - BOT_H;
        const stoneWall = drawStoneBackdrop(this, TOP_H, GAME_WIDTH, playAreaH);
        // Torchlight: a radial darkening overlay that keeps the centre
        // (where the room panel sits) readable and fades the rest of the
        // wall toward black so the dungeon feels lit by a single lamp.
        // The texture is oversized by TORCH_MARGIN on every side so the
        // overlay can slide during room transitions without exposing an
        // un-dimmed strip of stone at the trailing edge.
        const TORCH_MARGIN = 256;
        const torchW = GAME_WIDTH + TORCH_MARGIN * 2;
        const torchH = playAreaH + TORCH_MARGIN * 2;
        const torchlight = createTorchlightOverlay(this, torchW, torchH, {
            innerRadius: 250,
            outerRadius: 400,
            centerAlpha: 0.45,
            edgeAlpha: 0.94,
        });
        this.torchlightHomeX = GAME_WIDTH / 2;
        this.torchlightHomeY = TOP_H + playAreaH / 2;
        torchlight
            .setOrigin(0.5, 0.5)
            .setPosition(this.torchlightHomeX, this.torchlightHomeY)
            .setDepth(Depths.Background - 0.5);
        this.torchlight = torchlight;

        // ── TOP BAR ─────────────────────────────────────────────
        // Carved-stone frame (PNG when available, layered fallback otherwise).
        const topFrame = drawTopFrame(this, GAME_WIDTH, TOP_H);

        // Group A — Vitals (HP bar) on the left ~third.
        // The 96px panel has a 52px interior (y=22..74 after the carved
        // gold rim).
        const VITALS_LABEL_X = PAD + 22;
        const VITALS_BAR_X = PAD + 22 + 64 + 12;
        const hpIcon = createHudIcon(this, PAD + 8, 36, 'heart', { pixelSize: 16 });
        const hpLabel = this.add.text(VITALS_LABEL_X, 29, this.loc.t('hp').toUpperCase(), {
            fontFamily: HUD_FONT,
            fontSize: '11px',
            color: HudHex.textSecondary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        });
        const hpBarX = VITALS_BAR_X;
        const hpBarY = 36;
        const hpBarFrame = drawBarFrame(this, hpBarX, hpBarY, this.hpBarWidth, this.hpBarHeight);
        const hpBarBg = this.add
            .rectangle(hpBarX, hpBarY, this.hpBarWidth, this.hpBarHeight, HudColors.bloodTrack)
            .setOrigin(0, 0.5);
        this.hpBar = this.add
            .rectangle(hpBarX, hpBarY, this.hpBarWidth, this.hpBarHeight, HudColors.bloodFill)
            .setOrigin(0, 0.5);
        const hpSegments = drawBarSegments(this, hpBarX, hpBarY, this.hpBarWidth, this.hpBarHeight, 5);
        this.hpValueText = this.add.text(hpBarX + this.hpBarWidth + 10, hpBarY - 9, '', {
            fontFamily: HUD_FONT,
            fontSize: '14px',
            color: HudHex.textPrimary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        });

        // Group B — Level + XP, centred about the canvas midline. Top
        // bar reads as a 2-row × 3-column grid: vitals (HP) on the
        // left, level+XP in the middle, combat (atk/def) on the right.
        const centreX = GAME_WIDTH / 2;
        // "УР N" right-anchored, "ОП X/Y" left-anchored, with an 8 px gap
        // around centre — the row stays centred regardless of value width.
        this.levelText = this.add.text(centreX - 8, 36, '', {
            fontFamily: HUD_FONT,
            fontSize: '15px',
            fontStyle: 'bold',
            color: HudHex.textPrimary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        }).setOrigin(1, 0.5);
        this.xpValueText = this.add.text(centreX + 8, 36, '', {
            fontFamily: HUD_FONT,
            fontSize: '13px',
            color: HudHex.textSecondary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        }).setOrigin(0, 0.5);
        const xpBarX = centreX - this.xpBarWidth / 2;
        const xpBarY = 64;
        this.xpBarFrame = drawBarFrame(
            this,
            xpBarX,
            xpBarY,
            this.xpBarWidth,
            this.xpBarHeight,
        );
        this.xpBarBg = this.add
            .rectangle(xpBarX, xpBarY, this.xpBarWidth, this.xpBarHeight, 0x14202c)
            .setOrigin(0, 0.5);
        // Fill at full width then scaled by ratio in refreshUI.
        this.xpBar = this.add
            .rectangle(xpBarX, xpBarY, this.xpBarWidth, this.xpBarHeight, 0x6a8fc2)
            .setOrigin(0, 0.5);
        this.xpBar.setDisplaySize(0, this.xpBarHeight);

        // Group C — Combat stats on the right, stacked vertically:
        // sword "АТАКА N" on top, shield "ЗАЩИТА N" below it. The block
        // sits in the right third of the top bar with breathing room
        // on either side: ~120 px gap to the centred XP block on the
        // left, ~90 px gap to the chrome icon row on the right.
        // valueOffsetX forces both rows to share a single value column
        // so the numbers line up vertically even though "АТАКА" is
        // shorter than "ЗАЩИТА". The block was lifted 10 px from its
        // original 36/64 spec on player request — keeps it tucked
        // closer to the carved top rim instead of sitting low.
        const { topHud } = HudLayout;
        const secondColX = topHud.statsX + topHud.secondColumnDx;
        this.atkStat = createHudInlineSlot(this, topHud.statsX, topHud.atkY, {
            icon: 'sword',
            label: this.loc.t('attackShort').toUpperCase(),
            valueColor: HudHex.textPrimary,
            valueFontSize: '17px',
            valueOffsetX: topHud.statsValueOffset,
        });
        this.defStat = createHudInlineSlot(this, topHud.statsX, topHud.defY, {
            icon: 'shield',
            label: this.loc.t('defenseShort').toUpperCase(),
            valueColor: HudHex.textPrimary,
            valueFontSize: '17px',
            valueOffsetX: topHud.statsValueOffset,
        });

        // Optional secondary stats — stacked just to the right of the
        // primary atk/def block when they're actually relevant. Y
        // values mirror the atk/def shift above so the rows stay
        // visually aligned across both columns.
        this.revivesStat = createHudInlineSlot(this, secondColX, topHud.revivesY, {
            icon: 'heart',
            label: this.loc.t('reviveShort').toUpperCase(),
            valueFontSize: '13px',
            labelFontSize: '11px',
            iconSize: 12,
        });
        this.lightTorchIcon = this.add.text(secondColX, topHud.torchIconY, '', {
            fontFamily: HUD_FONT,
            fontSize: '14px',
            color: HudHex.accentLight,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        });

        this.playerStatusText = this.add.text(CENTER_X, TOP_H + 14, '', {
            fontFamily: HUD_FONT,
            fontSize: '12px',
            color: HudHex.accentResolve,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        }).setOrigin(0.5, 0);

        // ── BOTTOM BAR ──────────────────────────────────────────
        // Carved frame + 9 cells: 5 resource cells, divider pillar,
        // 4 progress cells (the last cell — PRESTIGE — gets a gold rim).
        const botFrame = drawBottomFrame(this, BOT_Y, GAME_WIDTH, BOT_H);

        // Bottom-bar PNG carved corners eat ~32 px on each side; cells
        // are sized so the row sits comfortably inside that safe area
        // (left margin 36, right margin ~36 to the carved frame).
        // Cells are vertically centred inside the bar so they don't
        // crowd the top gold rim and leave a dead strip at the bottom.
        //
        // cellH grew 70 → 110 so the resource icons can render at
        // ~2× their old pixel size (18 → 36) without crowding the
        // label/value rows. Stat label / value font sizes are bumped
        // a tier to keep visual hierarchy consistent with the chunkier
        // icons.
        const cellH = 110;
        const cellTop = BOT_Y + Math.round((BOT_H - cellH) / 2);
        const resW = 112;
        const resStart = 36;
        const progW = 88;
        const progStart = 624;
        const STAT_ICON_SIZE = 36;
        const STAT_LABEL_FONT = '12px';
        const STAT_VALUE_FONT = '17px';

        this.goldStat = createHudCell(this, resStart + 0 * resW, cellTop, resW, cellH, {
            icon: 'coin',
            label: this.loc.t('goldShort').toUpperCase(),
            valueColor: HudHex.accentGold,
            iconPixelSize: STAT_ICON_SIZE,
            labelFontSize: STAT_LABEL_FONT,
            valueFontSize: STAT_VALUE_FONT,
        });
        this.potionStat = createHudCell(this, resStart + 1 * resW, cellTop, resW, cellH, {
            icon: 'potion',
            label: this.loc.t('potionShort').toUpperCase(),
            valueColor: HudHex.accentPotion,
            iconPixelSize: STAT_ICON_SIZE,
            labelFontSize: STAT_LABEL_FONT,
            valueFontSize: STAT_VALUE_FONT,
        });
        this.resolveStat = createHudCell(this, resStart + 2 * resW, cellTop, resW, cellH, {
            icon: 'quill',
            label: this.loc.t('resolveShort').toUpperCase(),
            valueColor: HudHex.accentResolve,
            iconPixelSize: STAT_ICON_SIZE,
            labelFontSize: STAT_LABEL_FONT,
            valueFontSize: STAT_VALUE_FONT,
        });
        this.lightResStat = createHudCell(this, resStart + 3 * resW, cellTop, resW, cellH, {
            icon: 'lantern',
            label: this.loc.t('lightShort').toUpperCase(),
            valueColor: HudHex.accentLight,
            iconPixelSize: STAT_ICON_SIZE,
            labelFontSize: STAT_LABEL_FONT,
            valueFontSize: STAT_VALUE_FONT,
        });
        this.shardStat = createHudCell(this, resStart + 4 * resW, cellTop, resW, cellH, {
            icon: 'shard',
            label: this.loc.t('shardShort').toUpperCase(),
            valueColor: HudHex.accentShard,
            iconPixelSize: STAT_ICON_SIZE,
            labelFontSize: STAT_LABEL_FONT,
            valueFontSize: STAT_VALUE_FONT,
        });

        // Pillar divider between the resource block and the progress block.
        const pillarG = this.add.graphics();
        pillarG.fillStyle(HudColors.panelOuter, 0.95);
        pillarG.fillRect(resStart + 5 * resW + 2, cellTop + 6, 4, cellH - 12);
        pillarG.fillStyle(HudColors.panelHi, 0.7);
        pillarG.fillRect(resStart + 5 * resW + 2, cellTop + 6, 4, 1);
        pillarG.fillRect(resStart + 5 * resW + 2, cellTop + cellH - 7, 4, 1);

        this.depthStat = createHudCell(this, progStart + 0 * progW, cellTop, progW, cellH, {
            icon: 'depth',
            label: this.loc.t('depthShort').toUpperCase(),
            valueColor: HudHex.accentDepth,
            iconPixelSize: STAT_ICON_SIZE,
            labelFontSize: STAT_LABEL_FONT,
            valueFontSize: STAT_VALUE_FONT,
        });
        this.killsStat = createHudCell(this, progStart + 1 * progW, cellTop, progW, cellH, {
            icon: 'kills',
            label: this.loc.t('killShort').toUpperCase(),
            valueColor: HudHex.accentKills,
            iconPixelSize: STAT_ICON_SIZE,
            labelFontSize: STAT_LABEL_FONT,
            valueFontSize: STAT_VALUE_FONT,
        });
        this.bossStat = createHudCell(this, progStart + 2 * progW, cellTop, progW, cellH, {
            icon: 'boss',
            label: this.loc.t('bossShort').toUpperCase(),
            valueColor: HudHex.accentBoss,
            iconPixelSize: STAT_ICON_SIZE,
            labelFontSize: STAT_LABEL_FONT,
            valueFontSize: STAT_VALUE_FONT,
        });
        this.prestigeStat = createHudCell(this, progStart + 3 * progW, cellTop, progW, cellH, {
            icon: 'star',
            label: this.loc.t('prestige').toUpperCase(),
            valueColor: HudHex.accentExp,
            iconPixelSize: STAT_ICON_SIZE,
            labelFontSize: STAT_LABEL_FONT,
            valueFontSize: STAT_VALUE_FONT,
        });

        // Hint text ("дальше: достигни глубины N") and relic summary
        // both float in the play area immediately above the carved
        // bottom bar instead of inside it. Anchoring them to BOT_Y −
        // small offset means a future change to BOTTOM_BAR_H carries
        // them along, and the carved bar interior is left entirely to
        // the resource cells (so the milestone hint no longer sits on
        // top of the bottom rim where it gets visually clipped).
        //
        // The two are stacked vertically — hint sits on the bottom
        // line just above the bar (centred so it reads as a deliberate
        // goal reminder), relic summary sits one line up on the left
        // — because their horizontal extents (centred + 540 px word
        // wrap) would otherwise collide whenever the player has both
        // relics and an outstanding milestone simultaneously.
        const HINT_LINE_Y = BOT_Y - 8;
        const RELIC_LINE_Y = BOT_Y - 24;
        this.relicText = this.add.text(PAD, RELIC_LINE_Y, '', {
            fontFamily: HUD_FONT,
            fontSize: '12px',
            color: HudHex.accentGold,
            stroke: HUD_STROKE,
            strokeThickness: 2,
            wordWrap: { width: 540 },
        }).setOrigin(0, 1);
        this.hintText = this.add.text(CENTER_X, HINT_LINE_Y, '', {
            fontFamily: HUD_FONT,
            fontSize: '12px',
            color: HudHex.textSecondary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
            align: 'center',
        }).setOrigin(0.5, 1);

        this.enemyStatusText = this.add.text(780, 356, '', {
            fontFamily: HUD_FONT,
            fontSize: '11px',
            color: HudHex.accentBloodLow,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        }).setOrigin(0.5, 0);

        // ── ESCAPE BUTTON ───────────────────────────────────────
        // Out-of-combat escape from the run. Click once to arm,
        // click again within ~3s to confirm. On confirm: prestige
        // is awarded for current depth + bosses, then the scene
        // hands off to the victory/escape end screen which routes
        // back to the hub via safeRestart().
        const ESCAPE_BTN_W = 110;
        const ESCAPE_BTN_H = 26;
        const ESCAPE_BTN_X = GAME_WIDTH - PAD - ESCAPE_BTN_W / 2;
        const ESCAPE_BTN_Y = TOP_H + 18;
        this.escapeButtonBg = this.add
            .rectangle(ESCAPE_BTN_X, ESCAPE_BTN_Y, ESCAPE_BTN_W, ESCAPE_BTN_H, HudColors.panelBg, 0.92)
            .setStrokeStyle(1, HudColors.panelHi)
            .setOrigin(0.5)
            .setDepth(220)
            .setInteractive({ useHandCursor: true });
        this.escapeButtonLabel = this.add
            .text(ESCAPE_BTN_X, ESCAPE_BTN_Y - 1, this.loc.t('escapeButton'), {
                fontFamily: HUD_FONT,
                fontSize: '12px',
                color: HudHex.textSecondary,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0.5)
            .setDepth(221);
        this.escapeButtonBg.on('pointerover', () => {
            this.escapeButtonBg.setStrokeStyle(2, HudColors.accentExp);
        });
        this.escapeButtonBg.on('pointerout', () => {
            this.escapeButtonBg.setStrokeStyle(1, HudColors.panelHi);
        });
        this.escapeButtonBg.on('pointerdown', () => this.handleEscapeClick());

        const topWidgets: Phaser.GameObjects.GameObject[] = [
            topFrame,
            hpIcon,
            hpLabel,
            // bar frame must sit beneath the track so its rim hugs the bar
            hpBarFrame,
            hpBarBg,
            this.hpBar,
            hpSegments,
            this.hpValueText,
            this.levelText,
            this.xpBarFrame,
            this.xpBarBg,
            this.xpBar,
            this.xpValueText,
            this.atkStat.root,
            this.defStat.root,
            this.revivesStat.root,
            this.lightTorchIcon,
            this.playerStatusText,
        ];

        const bottomWidgets: Phaser.GameObjects.GameObject[] = [
            botFrame,
            this.goldStat.root,
            this.potionStat.root,
            this.resolveStat.root,
            this.lightResStat.root,
            this.shardStat.root,
            pillarG,
            this.depthStat.root,
            this.killsStat.root,
            this.bossStat.root,
            this.prestigeStat.root,
            this.relicText,
            this.hintText,
            this.escapeButtonBg,
            this.escapeButtonLabel,
        ];

        // Stone wall must sit below the room content. Inside a Container
        // setDepth has no effect, so keep it scene-level and pin it under
        // every Depths.* tier (Background = 0).
        stoneWall.setDepth(Depths.Background - 1);
        this.uiContainer.add([...topWidgets, ...bottomWidgets]);

        this.roomContainer.add(this.enemyStatusText);

        this.player.hpChange.on(() => this.refreshUI());
        this.player.statsChange.on(() => this.refreshUI());
        this.player.resourcesChange.on(() => {
            this.refreshUI();
            if (this.combat.enemy) {
                this.combatHud.refreshButtons();
            }
        });
        this.player.levelUp.on(({ level }) => {
            this.tracker.trackMax('levelReached', level);
            this.log.addMessage(this.loc.t('levelUp', { level }), '#fff17a');
            VFX.floatText(this, 370, 20, `${this.loc.t('level')} ${level}`, '#fff17a');
            this.sfx.play('levelUp');
            const flash = this.add.rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0xfff17a, 0.08).setDepth(Depths.ScreenFlash);
            this.tweens.add({ targets: flash, alpha: 0, duration: 500, onComplete: () => flash.destroy() });
            this.refreshUI();
        });
        this.player.revive.on(({ remaining }) => {
            this.log.addMessage(this.loc.t('revive', { count: remaining }), '#ffcb73');
            this.refreshUI();
        });
        this.player.death.on(() => {
            if (this.deathSequenceStarted) {
                return;
            }

            this.deathSequenceStarted = true;
            this.dead = true;
            this.sfx.play('death');
            this.sfx.stopAmbient();
            this.cameras.main.shake(650, 0.04);
            this.time.delayedCall(320, () => this.showDeathScreen());
        });
    }

    public refreshUI() {
        const unlocks = this.meta.getUiUnlockState();
        const stats = this.player.stats;
        const resources = this.player.resources;

        // Vitals: HP bar fill colour shifts as HP drops; numeric overlay tracks
        // exact values for the player.
        const hpRatio = Phaser.Math.Clamp(stats.hp / stats.maxHp, 0, 1);
        this.hpBar.setDisplaySize(this.hpBarWidth * hpRatio, this.hpBarHeight);
        this.hpBar.setFillStyle(
            hpRatio > 0.5
                ? HudColors.bloodFill
                : hpRatio > 0.25
                  ? HudColors.bloodFillMid
                  : HudColors.bloodFillLow
        );
        this.hpValueText.setText(`${stats.hp} / ${stats.maxHp}`);

        // Progression: XP bar + featured level number + caption.
        const xpRatio = Phaser.Math.Clamp(stats.xp / this.player.xpToNextLevel, 0, 1);
        this.xpBar.setDisplaySize(this.xpBarWidth * xpRatio, this.xpBarHeight);
        this.levelText.setText(`${this.loc.t('level')} ${stats.level}`);
        this.xpValueText.setText(`${this.loc.t('xp')} ${stats.xp}/${this.player.xpToNextLevel}`);

        // Combat stats: each stat has its own icon/value pair so colours can
        // differentiate at a glance.
        const showStats = unlocks.showPlayerStats;
        this.atkStat.setValue(`${this.player.getAttackPower()}`);
        this.atkStat.setVisible(showStats);
        this.defStat.setValue(`${stats.defense}`);
        this.defStat.setVisible(showStats);
        const showRevives = showStats && this.player.remainingRevives > 0;
        this.revivesStat.setValue(`${this.player.remainingRevives}`);
        this.revivesStat.setVisible(showRevives);
        if (showStats && this.player.hasHighLight) {
            this.lightTorchIcon.setText('\u2600\uFE0E').setColor(HudHex.accentLight).setVisible(true);
        } else if (showStats && this.player.hasLowLight) {
            this.lightTorchIcon.setText('\u263D\uFE0E').setColor(HudHex.accentMoon).setVisible(true);
        } else {
            this.lightTorchIcon.setVisible(false);
        }

        // Resources: per-stat slots, each with their own accent colour.
        this.goldStat.setValue(`${resources.gold}`);
        this.goldStat.setVisible(unlocks.showGold);
        this.potionStat.setValue(`${resources.potions}`);
        this.potionStat.setVisible(unlocks.showPotions);
        this.resolveStat.setValue(`${resources.resolve}/${resources.maxResolve}`);
        this.resolveStat.setVisible(unlocks.showResolve);
        this.lightResStat.setValue(`${resources.light}/${EXPEDITION_CONFIG.maxLight}`);
        this.lightResStat.setVisible(unlocks.showLight);
        this.shardStat.setValue(`${resources.relicShards}`);
        this.shardStat.setVisible(unlocks.showRelicShards);

        // Progress + prestige forecast.
        const showProgress = unlocks.showRunMetrics || unlocks.showKillCounter;
        this.depthStat.setValue(`${this.runBestDepth}`);
        this.depthStat.setVisible(showProgress);
        this.killsStat.setValue(`${this.player.killCount}`);
        this.killsStat.setVisible(showProgress && unlocks.showKillCounter);
        this.bossStat.setValue(`${this.runBossKills}`);
        this.bossStat.setVisible(showProgress && unlocks.showRunMetrics);

        const prestigeForecast = this.runBestDepth + this.runBossKills * 2;
        this.prestigeStat.setValue(`+${prestigeForecast}`);
        this.prestigeStat.setVisible(unlocks.showPrestigeForecast);

        const nextUnlock = this.meta.getNextContentUnlock();
        // The hint now floats centred above the bar with no chrome
        // buttons crowding it, so we can afford a longer label
        // (≈ 60 chars fits comfortably at fontSize 12 in the play area).
        this.hintText.setText(
            nextUnlock
                ? compactText(
                    `${this.loc.t('nextUnlockLabel')}: ${this.milestoneRequirement(nextUnlock)}`,
                    60
                )
                : ''
        );

        this.hpValueText.setVisible(unlocks.showHpNumbers);
        this.xpBarFrame.setVisible(unlocks.showLevelPanel);
        this.xpBarBg.setVisible(unlocks.showLevelPanel);
        this.xpBar.setVisible(unlocks.showLevelPanel);
        this.levelText.setVisible(unlocks.showLevelPanel);
        this.xpValueText.setVisible(unlocks.showLevelPanel);
        const hintVisible = !!nextUnlock && this.mapContainer.visible;
        this.hintText.setVisible(hintVisible);

        this.relicText.setText(this.relicSummary());
        this.updatePlayerStatusUI();

        // Escape button is HUD-only and only meaningful out of combat.
        // Hide while an enemy is active, while a death sequence is
        // running, or while we're already on an end screen.
        const escapeVisible =
            !this.combat?.enemy && !this.dead && !this.deathSequenceStarted;
        this.escapeButtonBg.setVisible(escapeVisible);
        this.escapeButtonLabel.setVisible(escapeVisible);
    }

    public updatePlayerStatusUI() {
        const txt = statusSummary(this.player.status, this.loc.language);
        this.playerStatusText.setText(txt);
    }

    public updateEnemyStatusUI() {
        if (!this.combat.enemy) {
            this.enemyStatusText.setText('');
            return;
        }
        const txt = statusSummary(this.combat.enemy.status, this.loc.language);
        this.enemyStatusText.setText(txt);
    }

    public relicSummary(): string {
        if (this.player.relics.length === 0) return '';
        return this.loc.t('relicsLabel') + this.player.relics
            .map((id) => this.loc.pick(RELICS[id].short))
            .join(', ');
    }

    public maybeDropRelic(kind: 'normal' | 'elite' | 'boss' | 'treasure' | 'shrine'): boolean {
        const allowedRarities = this.meta.getRelicRarityPool();
        const chance = kind === 'boss'
            ? 1
            : kind === 'elite'
              ? ROOM_CONFIG.elite.relicChance
              : kind === 'treasure'
                ? ROOM_CONFIG.treasure.relicChance
                : kind === 'shrine'
                  ? ROOM_CONFIG.shrine.relicChance
                  : 0;
        if (Math.random() > chance) return false;

        const rollKind = kind === 'treasure' || kind === 'shrine'
            ? 'normal'
            : kind;
        const relicId = rollRelicFor(this.player.relics, rollKind as 'normal' | 'elite' | 'boss');
        if (!relicId) return false;

        // Filter by unlocked rarity pool.
        const relic = RELICS[relicId];
        if (!allowedRarities.includes(relic.rarity as RelicRarity)) {
            // downgrade to common alt.
            const fallback = rollRelicFor(this.player.relics, 'normal');
            if (!fallback) return false;
            this.player.addRelic(fallback);
            this.tracker.record('relicsFound');
            this.sfx.play('relicDrop');
            this.log.addMessage(
                this.loc.t('relicObtained', { value: this.loc.pick(RELICS[fallback].name), value2: this.loc.pick(RELICS[fallback].description) }),
                '#ffcc99'
            );
            return true;
        }

        this.player.addRelic(relicId);
        this.tracker.record('relicsFound');
        this.sfx.play('relicDrop');
        this.log.addMessage(
            this.loc.t('relicObtained', { value: this.loc.pick(relic.name), value2: this.loc.pick(relic.description) }),
            relic.rarity === 'unique' ? '#f0a8ff' : relic.rarity === 'rare' ? '#ffd36e' : '#ffcc99'
        );
        return true;
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
                    if (this.torchlight) {
                        this.torchlight.setPosition(_screenX, _screenY);
                    }
                },
                () => {
                    this.sfx.stopFootstepsLoop(this.footstepsFadeMs);
                    if (this.torchlight) {
                        this.torchlight.setPosition(
                            this.torchlightHomeX,
                            this.torchlightHomeY,
                        );
                    }
                    this.fadeToRoom(node);
                },
            );
        });
    }

    private updateRunProgress(depth: number) {
        if (depth > this.runBestDepth) {
            this.runBestDepth = depth;
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
        const tl = this.torchlight;
        if (!tl) return;
        const delta = direction === 'forward' ? this.torchlightSweepPx : -this.torchlightSweepPx;
        this.tweens.killTweensOf(tl);
        this.tweens.add({
            targets: tl,
            x: this.torchlightHomeX + delta,
            duration: this.roomTransitionPhaseMs,
            ease: 'Sine.in',
            onComplete: () => {
                this.tweens.add({
                    targets: tl,
                    x: this.torchlightHomeX,
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
        const mitigated = Math.max(1, rawDamage - this.meta.getBonuses().rooms.trapDamageReduction);
        return this.player.takeDamage(mitigated);
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
        // runState proxies its fields back onto the scene, so EndScreens can
        // mutate prestigeAwarded / prestigeReward and re-entry still sees the
        // flag that guards double-awarding.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const scene = this;
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
            runState: {
                get runBestDepth() { return scene.runBestDepth; },
                get runBossKills() { return scene.runBossKills; },
                get prestigeAwarded() { return scene.prestigeAwarded; },
                set prestigeAwarded(v: boolean) { scene.prestigeAwarded = v; },
                get prestigeReward() { return scene.prestigeReward; },
                set prestigeReward(v: number) { scene.prestigeReward = v; },
                get escaped() { return scene.escaped; },
                set escaped(v: boolean) { scene.escaped = v; },
            },
        };
    }

    public showVictoryScreen() {
        showVictoryScreen(this.endScreenContext());
    }

    private showDeathScreen() {
        showDeathScreen(this.endScreenContext());
    }

    private safeRestart() {
        this.tweens.killAll();
        this.time.removeAllEvents();
        this.input.removeAllListeners();
        this.scene.restart();
    }

    /**
     * HUD escape button. First click arms a confirm window; second
     * click within {@link ESCAPE_CONFIRM_MS} commits the escape and
     * hands off to the end screen (which awards prestige and routes
     * the player back to the hub via safeRestart). Pressing the
     * button while combat is active or while the player is dead is
     * a no-op — the visibility logic in refreshUI() also hides it in
     * those cases, this guard is belt-and-braces.
     */
    private handleEscapeClick() {
        if (this.combat?.enemy || this.dead || this.deathSequenceStarted) {
            return;
        }
        const now = this.time.now;
        const ESCAPE_CONFIRM_MS = 3000;
        if (this.escapeConfirmAt > 0 && now - this.escapeConfirmAt <= ESCAPE_CONFIRM_MS) {
            // Confirmed — commit the escape.
            this.escapeConfirmAt = -1;
            this.escaped = true;
            this.dead = true;
            this.showVictoryScreen();
            return;
        }
        // First click — arm the confirm window and update the label.
        this.escapeConfirmAt = now;
        this.escapeButtonLabel.setText(this.loc.t('escapeButtonConfirm'));
        this.escapeButtonLabel.setColor(HudHex.accentBloodLow);
        this.time.delayedCall(ESCAPE_CONFIRM_MS, () => {
            // Window expired without a confirm — revert label.
            if (this.escapeConfirmAt > 0 && this.time.now - this.escapeConfirmAt >= ESCAPE_CONFIRM_MS) {
                this.escapeConfirmAt = -1;
                this.escapeButtonLabel.setText(this.loc.t('escapeButton'));
                this.escapeButtonLabel.setColor(HudHex.textSecondary);
            }
        });
    }

}
