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
import { narrate } from '../systems/Narrator';
import { RELICS, rollRelicFor } from '../systems/Relics';
import type { RelicRarity } from '../systems/Relics';
import { SKILLS, STARTER_LOADOUT } from '../systems/Skills';
import type { SkillId } from '../systems/Skills';
import { StressManager } from '../systems/Stress';
import type { Resolution } from '../systems/Stress';
import { statusSummary } from '../systems/StatusEffects';
import { Localization } from '../systems/Localization';
import type { NpcManager } from '../systems/NpcManager';
import type { NpcOfferTemplate } from '../systems/Npcs';
import { EventLog } from '../ui/EventLog';
import { VFX } from '../ui/VFX';
import { MusicManager } from '../systems/MusicManager';
import { SoundManager } from '../systems/SoundManager';
import { PixelSprite } from '../ui/PixelSprite';
import { fitEnemySprite, fitRoomSprite, hasFireEffect, roomFrameIndex, roomIcon, roomIconFrame, roomSpriteKey, roomTypeName } from '../ui/RoomVisuals';
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
import { drawBottomFrame, drawStoneBackdrop, drawTopFrame } from '../ui/HudFrame';
import { createHudCell, createHudInlineSlot, type HudCellHandle, type HudInlineSlotHandle } from '../ui/HudCell';
import { createHudIcon } from '../ui/HudIcons';
import { setupSceneChrome, showUnlockBanner } from '../ui/SceneChrome';
import {
    showDeathScreen,
    showVictoryScreen,
    type EndScreenContext,
} from '../ui/EndScreens';
import { RoomFlowController } from './RoomFlow';
import { CombatHudController } from './CombatHud';

const COL_W = 180;
const ROW_H = 140;
const NODE_SZ = 80;
const MAP_X = 360;
const MAP_Y = 380;
const VIEW_X = 512;
const VIEW_Y = 380;

interface NodeVisual {
    rect: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Text;
    sprite?: Phaser.GameObjects.Image;
    frame?: Phaser.GameObjects.Image;
}

interface ActionButton {
    background: Phaser.GameObjects.Rectangle;
    label: Phaser.GameObjects.Text;
    callback: (() => void) | null;
    enabled: boolean;
    defaultX: number;
    defaultY: number;
    defaultWidth: number;
}

export interface RoomButtonAction {
    label: string;
    callback: () => void;
    enabled?: boolean;
    fill?: number;
}

export class GameScene extends Phaser.Scene {
    public meta!: MetaProgressionManager;
    public mapGen!: MapGenerator;
    public dungeon!: DungeonManager;
    public player!: PlayerManager;
    public combat!: CombatManager;
    public log!: EventLog;
    public tracker!: RunTracker;
    public stress!: StressManager;
    public skillLoadout: SkillId[] = [...STARTER_LOADOUT];
    public loc!: Localization;
    public sfx!: SoundManager;
    public music!: MusicManager;
    public npcs!: NpcManager;
    public vethSharpenedThisRoom = false;

    public mapContainer!: Phaser.GameObjects.Container;
    public roomContainer!: Phaser.GameObjects.Container;
    public uiContainer!: Phaser.GameObjects.Container;
    private edgeGfx!: Phaser.GameObjects.Graphics;
    private visuals: Map<string, NodeVisual> = new Map();
    private glowMap: Map<string, Phaser.GameObjects.Graphics> = new Map();
    private fireMap: Map<string, { destroy: () => void }> = new Map();

    private animating = false;
    private dead = false;
    private deathSequenceStarted = false;
    public lastEnemyHp = 0;
    private runBestDepth = 0;
    public runBossKills = 0;
    private prestigeReward = 0;
    private prestigeAwarded = false;
    public skipLightSpendThisRoom = false;
    private roomTintOverlay: Phaser.GameObjects.Rectangle | null = null;

    // HUD bar widths cached so refreshUI can rescale fills without re-measuring.
    // HP and stress share width / start-X so the two rows align as a clean grid.
    private readonly hpBarWidth = 200;
    private readonly hpBarHeight = 14;
    private readonly stressBarWidth = 200;
    private readonly stressBarHeight = 8;
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
    private hintText!: Phaser.GameObjects.Text;
    // mapDepthText was the small "ГЛУБИНА N" pill below the bottom bar —
    // removed because the dedicated ГЛУБИНА cell in the bottom HUD now
    // shows the same value with much better legibility.
    public tooltipText!: Phaser.GameObjects.Text;

    private stressBarBg!: Phaser.GameObjects.Rectangle;
    private stressBar!: Phaser.GameObjects.Rectangle;
    private stressText!: Phaser.GameObjects.Text;
    private resolutionText!: Phaser.GameObjects.Text;
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
    public actionButtons: ActionButton[] = [];

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

    private resolutionInfo(resolution: Resolution): { name: string; description: string } {
        return {
            name: this.loc.pick(resolution.name),
            description: this.loc.pick(resolution.description),
        };
    }

    create() {
        this.meta = new MetaProgressionManager();
        this.npcs = this.meta.getNpcManager();
        const metaBonuses = this.meta.getBonuses();

        this.tracker = new RunTracker();

        this.player = new PlayerManager(metaBonuses.player);
        this.player.relicsChange.on(() => this.refreshUI());

        this.stress = new StressManager();
        this.stress.valueChange.on(({ value }) => {
            if (value > this.tracker.current.peakStress) this.tracker.trackMax('peakStress', value);
            this.updateStressUI();
        });
        this.stress.resolutionChange.on((r) => this.handleStressResolution(r));

        // Pick loadout: first 2 skills from [starter + meta-unlocked extras].
        const extras = this.meta.getUnlockedExtraSkills();
        const pool: SkillId[] = [...STARTER_LOADOUT, ...extras.filter(s => !STARTER_LOADOUT.includes(s))];
        this.skillLoadout = pool.slice(0, 2);

        this.mapGen = new MapGenerator(this.getUnlockedRoomTypes(this.meta.getUnlockedContent()));

        this.actionButtons = [];
        this.visuals = new Map();
        this.glowMap = new Map();
        this.fireMap = new Map();
        this.roomTintOverlay = null;
        this.animating = false;
        this.dead = false;
        this.deathSequenceStarted = false;
        this.lastEnemyHp = 0;
        this.runBestDepth = 0;
        this.runBossKills = 0;
        this.prestigeReward = 0;
        this.prestigeAwarded = false;
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

        this.edgeGfx = this.add.graphics();
        this.mapContainer.add(this.edgeGfx);

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
            this.stress,
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
        this.buildAllVisuals(false);
        this.redrawEdges();
        this.refreshInteractivity();
        this.centerMapOnNode(this.dungeon.currentNode);
        this.refreshUI();

        this.tooltipText = this.add.text(0, 0, '', {
            fontFamily: 'Courier New',
            fontSize: '11px',
            color: '#d0d0d0',
            backgroundColor: '#1a1a1aee',
            padding: { x: 6, y: 3 },
        }).setDepth(Depths.Tooltip).setVisible(false);

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
            if (this.actionButtons[4]?.background.visible && this.actionButtons[4].enabled) {
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

        const button = this.actionButtons[index];
        if (!button || !button.enabled || !button.callback || !button.background.visible) {
            return;
        }

        button.callback();
    }

    private setupGlobalUI() {
        const PAD = HUD_PAD;
        const TOP_H = TOP_BAR_H;
        const BOT_H = BOTTOM_BAR_H;
        const BOT_Y = GAME_HEIGHT - BOT_H - HUD_BOTTOM_OFFSET;

        // ── PLAY-AREA BACKDROP ───────────────────────────────────
        // Optional carved-stone wall texture between the two HUD bars.
        // Drops out gracefully when the asset is missing.
        const stoneWall = drawStoneBackdrop(this, TOP_H, GAME_WIDTH, GAME_HEIGHT - TOP_H - BOT_H);

        // ── TOP BAR ─────────────────────────────────────────────
        // Carved-stone frame (PNG when available, layered fallback otherwise).
        const topFrame = drawTopFrame(this, GAME_WIDTH, TOP_H);

        // Group A — Vitals (HP bar + stress bar) on the left ~third.
        // The 96px panel has a 52px interior (y=22..74 after the carved
        // gold rim). Two rows are spread across that band — HP at y=36,
        // stress at y=64 — so neither bar fights the corner ornament.
        // Vitals share a single bar-start X so HP and stress line up cleanly.
        // 64 is the floor for the label column so the carved-frame corner
        // ornament never crowds the leftmost label glyph.
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

        const stressIcon = createHudIcon(this, PAD + 8, 64, 'skull', { pixelSize: 14 });
        const stressLabel = this.add.text(VITALS_LABEL_X, 57, this.loc.t('stressLabel').toUpperCase(), {
            fontFamily: HUD_FONT,
            fontSize: '11px',
            color: HudHex.textSecondary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        });
        const stressBarX = VITALS_BAR_X;
        const stressBarY = 64;
        const stressBarFrame = drawBarFrame(
            this,
            stressBarX,
            stressBarY,
            this.stressBarWidth,
            this.stressBarHeight,
        );
        this.stressBarBg = this.add
            .rectangle(stressBarX, stressBarY, this.stressBarWidth, this.stressBarHeight, HudColors.stressTrack)
            .setOrigin(0, 0.5);
        // Fill is built at full width so refreshUI's setDisplaySize
        // can scale it linearly. Initial scale 0 keeps it empty.
        this.stressBar = this.add
            .rectangle(stressBarX, stressBarY, this.stressBarWidth, this.stressBarHeight, HudColors.stressFill)
            .setOrigin(0, 0.5);
        this.stressBar.setDisplaySize(0, this.stressBarHeight);
        this.stressText = this.add.text(stressBarX + this.stressBarWidth + 8, stressBarY - 8, '0', {
            fontFamily: HUD_FONT,
            fontSize: '12px',
            color: HudHex.accentStress,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        });
        this.resolutionText = this.add.text(stressBarX + this.stressBarWidth + 36, stressBarY - 8, '', {
            fontFamily: HUD_FONT,
            fontSize: '11px',
            color: HudHex.accentVirtue,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        });

        // Group B — Level + XP, centred about the canvas midline. Top
        // bar reads as a 2-row × 3-column grid: vitals (HP/stress) on
        // the left, level+XP in the middle, combat (atk/def) on the
        // right. Both rows of group B share y with vitals/combat so
        // values line up across the entire bar.
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
        // is left-anchored at x=720 so it stays clear of the top-right
        // icon row (mute / options / language) and the optional
        // secondary slots tucked in next to it.
        const statsX = 720;
        this.atkStat = createHudInlineSlot(this, statsX, 36, {
            icon: 'sword',
            label: this.loc.t('attackShort').toUpperCase(),
            valueColor: HudHex.textPrimary,
            valueFontSize: '17px',
        });
        this.defStat = createHudInlineSlot(this, statsX, 64, {
            icon: 'shield',
            label: this.loc.t('defenseShort').toUpperCase(),
            valueColor: HudHex.textPrimary,
            valueFontSize: '17px',
        });

        // Optional secondary stats — stacked just to the right of the
        // primary atk/def block when they're actually relevant.
        this.revivesStat = createHudInlineSlot(this, statsX + 130, 38, {
            icon: 'heart',
            label: this.loc.t('reviveShort').toUpperCase(),
            valueFontSize: '13px',
            labelFontSize: '11px',
            iconSize: 12,
        });
        this.lightTorchIcon = this.add.text(statsX + 130, 66, '', {
            fontFamily: HUD_FONT,
            fontSize: '14px',
            color: HudHex.accentLight,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        });

        this.playerStatusText = this.add.text(CENTER_X, TOP_H + 14, '', {
            fontFamily: HUD_FONT,
            fontSize: '12px',
            color: HudHex.accentVirtue,
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
        const cellTop = BOT_Y + 4;
        const cellH = 70;
        const resW = 112;
        const resStart = 36;
        const progW = 88;
        const progStart = 624;

        this.goldStat = createHudCell(this, resStart + 0 * resW, cellTop, resW, cellH, {
            icon: 'coin',
            label: this.loc.t('goldShort').toUpperCase(),
            valueColor: HudHex.accentGold,
        });
        this.potionStat = createHudCell(this, resStart + 1 * resW, cellTop, resW, cellH, {
            icon: 'potion',
            label: this.loc.t('potionShort').toUpperCase(),
            valueColor: HudHex.accentPotion,
        });
        this.resolveStat = createHudCell(this, resStart + 2 * resW, cellTop, resW, cellH, {
            icon: 'quill',
            label: this.loc.t('resolveShort').toUpperCase(),
            valueColor: HudHex.accentResolve,
        });
        this.lightResStat = createHudCell(this, resStart + 3 * resW, cellTop, resW, cellH, {
            icon: 'lantern',
            label: this.loc.t('lightShort').toUpperCase(),
            valueColor: HudHex.accentLight,
        });
        this.shardStat = createHudCell(this, resStart + 4 * resW, cellTop, resW, cellH, {
            icon: 'shard',
            label: this.loc.t('shardShort').toUpperCase(),
            valueColor: HudHex.accentShard,
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
        });
        this.killsStat = createHudCell(this, progStart + 1 * progW, cellTop, progW, cellH, {
            icon: 'kills',
            label: this.loc.t('killShort').toUpperCase(),
            valueColor: HudHex.accentKills,
        });
        this.bossStat = createHudCell(this, progStart + 2 * progW, cellTop, progW, cellH, {
            icon: 'boss',
            label: this.loc.t('bossShort').toUpperCase(),
            valueColor: HudHex.accentBoss,
        });
        this.prestigeStat = createHudCell(this, progStart + 3 * progW, cellTop, progW, cellH, {
            icon: 'star',
            label: this.loc.t('prestige').toUpperCase(),
            valueColor: HudHex.accentExp,
        });

        // Thin info strip at the very bottom: depth pill on the left,
        // hint on the right (next to the ♫/RU chrome buttons).
        const stripY = BOT_Y + BOT_H - 18;
        this.relicText = this.add.text(PAD, stripY - 18, '', {
            fontFamily: HUD_FONT,
            fontSize: '11px',
            color: HudHex.accentGold,
            stroke: HUD_STROKE,
            strokeThickness: 2,
            wordWrap: { width: 540 },
        });
        this.hintText = this.add.text(GAME_WIDTH - HUD_PAD - 80, stripY, '', {
            fontFamily: HUD_FONT,
            fontSize: '11px',
            color: HudHex.textSecondary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
            align: 'right',
        }).setOrigin(1, 0);

        this.enemyStatusText = this.add.text(780, 356, '', {
            fontFamily: HUD_FONT,
            fontSize: '11px',
            color: HudHex.accentBloodLow,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        }).setOrigin(0.5, 0);

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
            stressIcon,
            stressLabel,
            stressBarFrame,
            this.stressBarBg,
            this.stressBar,
            this.stressText,
            this.resolutionText,
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
        ];

        if (stoneWall) {
            this.uiContainer.add(stoneWall);
            stoneWall.setDepth(-1);
        }
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
        this.hintText.setText(
            nextUnlock
                ? compactText(
                    `${this.loc.t('stressNextLabel')}: ${this.milestoneRequirement(nextUnlock)}`,
                    30
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
        this.updateStressUI();
        this.updatePlayerStatusUI();
    }

    public updateStressUI() {
        const v = this.stress.value;
        const ratio = Phaser.Math.Clamp(v / 100, 0, 1);
        this.stressBar.setDisplaySize(this.stressBarWidth * ratio, this.stressBarHeight);
        this.stressBar.setFillStyle(
            v >= 75
                ? HudColors.stressFillHigh
                : v >= 50
                  ? HudColors.stressFillMid
                  : HudColors.stressFill
        );
        this.stressText.setText(`${v}`);
        if (this.stress.resolution) {
            const info = this.resolutionInfo(this.stress.resolution);
            this.resolutionText.setText(
                this.stress.resolution.kind === 'virtue'
                    ? `\u2605\uFE0E ${info.name}`
                    : `\u2620\uFE0E ${info.name}`
            );
            this.resolutionText.setColor(
                this.stress.resolution.kind === 'virtue' ? HudHex.accentVirtue : HudHex.accentAffliction
            );
        } else {
            this.resolutionText.setText('');
        }
    }

    private handleStressResolution(r: Resolution) {
        this.tracker.record('stressResolutions');
        this.sfx.play('stressSpike');
        const info = this.resolutionInfo(r);
        this.log.addMessage(
            r.kind === 'virtue'
                ? `${this.loc.t('stressVirtueShort')}: ${info.name}. ${info.description}`
                : `${this.loc.t('stressAfflictionShort')}: ${info.name}. ${info.description}`,
            r.kind === 'virtue' ? '#8bd8ff' : '#e07070'
        );
        this.log.addMessage(
            narrate(r.kind === 'virtue' ? 'virtue' : 'affliction', this.loc.language),
            '#c4a35a'
        );
        showUnlockBanner(this, 
            r.kind === 'virtue'
                ? `${this.loc.t('stressVirtueTitle')}: ${info.name}`
                : `${this.loc.t('stressAfflictionTitle')}: ${info.name}`
        );
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
        // pair so each column sits ~22 px inside the panel walls. Rows are
        // also lifted so the wide [5] button no longer collides with the
        // 108 px bottom HUD bar (which now starts at y=650).
        const buttonSpecs = [
            { x: 682, y: 525, width: 180 },
            { x: 892, y: 525, width: 180 },
            { x: 682, y: 575, width: 180 },
            { x: 892, y: 575, width: 180 },
            { x: 787, y: 625, width: 390 },
        ];

        buttonSpecs.forEach((spec) => {
            const background = this.add
                .rectangle(spec.x, spec.y, spec.width, 40, 0x1b1b1b)
                .setStrokeStyle(1, 0x575757)
                .setInteractive({ useHandCursor: true });

            const label = this.add.text(spec.x, spec.y, '', {
                fontFamily: 'Courier New',
                fontSize: '14px',
                color: '#dddddd',
            }).setOrigin(0.5);

            const actionButton: ActionButton = {
                background,
                label,
                callback: null,
                enabled: false,
                defaultX: spec.x,
                defaultY: spec.y,
                defaultWidth: spec.width,
            };

            background.on('pointerover', () => {
                if (actionButton.enabled) {
                    background.setStrokeStyle(2, 0xffffff);
                    this.sfx.play('buttonHover');
                }
            });
            background.on('pointerout', () => {
                background.setStrokeStyle(1, actionButton.enabled ? 0x8a8a8a : 0x3e3e3e);
            });
            background.on('pointerdown', () => {
                if (actionButton.enabled && actionButton.callback) {
                    this.sfx.play('buttonClick');
                    actionButton.callback();
                }
            });

            this.actionButtons.push(actionButton);
            this.roomContainer.add([background, label]);
        });

        this.setRoomButtons([]);
    }

    public setRoomButtons(actions: RoomButtonAction[], useWideOnly: boolean = false) {
        this.actionButtons.forEach((button) => {
            button.background.setPosition(button.defaultX, button.defaultY);
            button.background.setSize(button.defaultWidth, 40);
            button.label.setPosition(button.defaultX, button.defaultY);
            button.background.setVisible(false);
            button.label.setVisible(false);
            button.background.disableInteractive();
            button.callback = null;
            button.enabled = false;
        });

        if (useWideOnly && actions.length === 1) {
            this.applyButtonAction(this.actionButtons[4], actions[0]);
            return;
        }

        actions.forEach((action, index) => {
            const button = this.actionButtons[index];
            if (!button) {
                return;
            }

            this.applyButtonAction(button, action);
        });
    }

    private applyButtonAction(button: ActionButton, action: RoomButtonAction) {
        const enabled = action.enabled ?? true;
        button.callback = action.callback;
        button.enabled = enabled;
        button.background.setVisible(true);
        button.label.setVisible(true);
        button.background.setInteractive({ useHandCursor: true });
        button.background.setFillStyle(action.fill ?? 0x1b1b1b);
        button.background.setStrokeStyle(1, enabled ? 0x8a8a8a : 0x3e3e3e);
        button.label.setText(compactText(action.label, button.defaultWidth > 200 ? 42 : 24));
        button.label.setColor(enabled ? '#f0f0f0' : '#686868');
    }

    private nodeX(node: MapNode) {
        return MAP_X + node.depth * COL_W;
    }

    private nodeY(node: MapNode) {
        const siblings = this.dungeon.getAllNodes().filter((candidate) => candidate.depth === node.depth);
        return MAP_Y + (node.slot - (siblings.length - 1) / 2) * ROW_H;
    }

    private getMapOffset(node: MapNode) {
        return {
            x: VIEW_X - this.nodeX(node),
            y: VIEW_Y - this.nodeY(node),
        };
    }

    private centerMapOnNode(node: MapNode) {
        const { x, y } = this.getMapOffset(node);
        this.mapContainer.setPosition(x, y);
    }

    private buildAllVisuals(fadeIn: boolean) {
        const unlocks = this.meta.getUiUnlockState();
        const currentId = this.dungeon.currentNode.id;
        const forwardIds = new Set(this.dungeon.getForwardNodes().map((node) => node.id));

        this.dungeon.getAllNodes().forEach((node) => {
            if (this.visuals.has(node.id)) {
                return;
            }

            const x = this.nodeX(node);
            const y = this.nodeY(node);
            const revealed = node.visited || forwardIds.has(node.id) || node.id === currentId;
            const knowsType = node.cleared || node.visited || node.id === currentId || unlocks.showRoomIcons;
            // Every room sits on a black backdrop; the carved frame
            // overlay (room_frames.png) is what carries the state colour
            // (gold safe / red danger / grey unknown). The procedural
            // fallback below adds a thin stroke when the frame texture
            // is missing.
            const alpha = node.cleared ? 0.35 : 1;
            const hasFrame = this.textures.exists('hud_room_frames');
            const stroke = node.cleared
                ? 0x333333
                : node.id === currentId
                  ? 0xffffff
                  : forwardIds.has(node.id)
                    ? 0x6d6d6d
                    : 0x343434;

            const rect = this.add
                .rectangle(x, y, NODE_SZ, NODE_SZ, 0x000000)
                .setAlpha(alpha);
            if (!hasFrame) {
                rect.setStrokeStyle(2, stroke);
            }

            const icon = this.add
                .text(x, y, revealed && knowsType ? roomIcon(node.type) : '?', {
                    fontFamily: 'Courier New',
                    fontSize: '28px',
                    color: node.cleared ? '#888888' : '#ffffff',
                })
                .setOrigin(0.5)
                .setAlpha(alpha);

            // Sprite priority: hand-authored room_icons spritesheet →
            // procedural PixelSprite (per-type 24×24 sprite) → text glyph.
            let sprite: Phaser.GameObjects.Image | undefined;
            if (revealed && knowsType && this.textures.exists('hud_room_icons')) {
                icon.setVisible(false);
                sprite = this.add
                    .image(x, y, 'hud_room_icons', roomIconFrame(node.type))
                    .setOrigin(0.5)
                    .setAlpha(alpha);
                fitRoomSprite(sprite);
                if (node.cleared) sprite.setTint(0x555555);
            } else {
                const spriteKey = PixelSprite.roomKey(roomSpriteKey(node.type));
                if (revealed && knowsType && this.textures.exists(spriteKey)) {
                    icon.setVisible(false);
                    sprite = this.add.image(x, y, spriteKey)
                        .setOrigin(0.5)
                        .setAlpha(alpha);
                    fitRoomSprite(sprite);
                    if (node.cleared) sprite.setTint(0x555555);
                }
            }

            // Decorative frame overlay (bronze for safe, iron-red for danger,
            // grey for unknown). Only renders when the optional spritesheet is
            // present — falls back silently to the base rect+icon otherwise.
            let frame: Phaser.GameObjects.Image | undefined;
            if (hasFrame) {
                const frameIdx = revealed && knowsType ? roomFrameIndex(node.type) : 2;
                frame = this.add.image(x, y, 'hud_room_frames', frameIdx)
                    .setOrigin(0.5)
                    .setAlpha(alpha);
                frame.setDisplaySize(NODE_SZ + 8, NODE_SZ + 8);
                if (node.cleared) frame.setTint(0x555555);
            }

            if (fadeIn && !node.cleared) {
                rect.setAlpha(0);
                icon.setAlpha(0);
                const targets: Phaser.GameObjects.GameObject[] = [rect, icon];
                if (sprite) { sprite.setAlpha(0); targets.push(sprite); }
                if (frame) { frame.setAlpha(0); targets.push(frame); }
                this.tweens.add({
                    targets,
                    alpha: 1,
                    duration: 420,
                    ease: 'Quad.out',
                });
            }

            this.makeClickable(rect, node);

            const children: Phaser.GameObjects.GameObject[] = [rect, icon];
            if (sprite) children.push(sprite);
            if (frame) children.push(frame);
            this.mapContainer.add(children);
            this.visuals.set(node.id, { rect, icon, sprite, frame });
        });
    }

    private makeClickable(rect: Phaser.GameObjects.Rectangle, node: MapNode) {
        rect.setInteractive({ useHandCursor: true });
        rect.on('pointerdown', () => {
            if (this.canUseMapNode(node)) {
                this.sfx.play('nodeSelect');
                this.advanceToNode(node);
            }
        });
        rect.on('pointerover', () => {
            if (this.canUseMapNode(node)) {
                this.applyNodeHover(node, true);
            }
            const unlocks = this.meta.getUiUnlockState();
            const revealed = node.visited || node.id === this.dungeon.currentNode.id ||
                this.dungeon.getForwardNodes().some((n) => n.id === node.id);
            const knowsType = node.visited || node.id === this.dungeon.currentNode.id || unlocks.showRoomIcons;
            if (revealed && knowsType && !node.cleared) {
                this.tooltipText.setText(roomTypeName(node.type, this.loc));
                const screenX = this.nodeX(node) + this.mapContainer.x;
                const screenY = this.nodeY(node) + this.mapContainer.y - NODE_SZ / 2 - 18;
                this.tooltipText.setPosition(screenX, screenY).setOrigin(0.5, 1).setVisible(true);
            }
        });
        rect.on('pointerout', () => {
            this.applyNodeHover(node, false);
            this.tooltipText.setVisible(false);
        });
    }

    /**
     * Map-node hover affordance. With the carved `room_frames.png` overlay
     * present we scale the frame ~10% and tint it lighter; without the
     * overlay we fall back to a thicker neutral-gold rect stroke. No white
     * outline anywhere — that was the "current room" highlight the player
     * asked us to retire.
     */
    private applyNodeHover(node: MapNode, hovered: boolean) {
        const visual = this.visuals.get(node.id);
        if (!visual) {
            return;
        }
        const targetSize = hovered ? NODE_SZ + 16 : NODE_SZ + 8;
        const tint = hovered ? 0xfff5cc : 0xffffff;
        if (visual.frame) {
            this.tweens.killTweensOf(visual.frame);
            this.tweens.add({
                targets: visual.frame,
                displayWidth: targetSize,
                displayHeight: targetSize,
                duration: 120,
                ease: 'Sine.out',
            });
            if (node.cleared) {
                visual.frame.setTint(0x555555);
            } else if (hovered) {
                visual.frame.setTint(tint);
            } else {
                visual.frame.clearTint();
            }
            return;
        }
        // Fallback path (PNG missing) — a thin stroke change with the same
        // semantic palette as updateMapUI(), no white.
        const isForward = this.dungeon.canMoveTo(node.id) && !node.cleared;
        const colour = node.cleared ? 0x333333 : isForward ? 0x6d6d6d : 0x343434;
        visual.rect.setStrokeStyle(hovered ? 3 : 2, hovered ? 0x9a8a4a : colour);
    }

    private canUseMapNode(node: MapNode): boolean {
        return (
            this.mapContainer.visible &&
            !this.roomContainer.visible &&
            !this.animating &&
            !this.dead &&
            !node.cleared &&
            this.dungeon.canMoveTo(node.id)
        );
    }

    private redrawEdges() {
        this.edgeGfx.clear();
        const currentDepth = this.dungeon.currentDepth;
        const forwardIds = new Set(this.dungeon.getForwardNodes().map((node) => node.id));
        const currentId = this.dungeon.currentNode.id;
        const allNodes = this.dungeon.getAllNodes();

        // Per-source-node grouping: each source spreads its outgoing lanes
        // so lines never overlap with siblings from the same node.
        allNodes.forEach((node) => {
            if (node.depth < currentDepth) return;
            if (node.edges.length === 0) return;

            const targets = node.edges
                .map((id) => allNodes.find((candidate) => candidate.id === id))
                .filter((target): target is MapNode => !!target)
                .sort((a, b) => a.slot - b.slot);

            const x1 = this.nodeX(node);
            const y1 = this.nodeY(node);

            targets.forEach((target, index) => {
                const active = !node.cleared && forwardIds.has(target.id) && node.id === currentId;
                const lineColor = node.cleared ? 0x2a2a2a : active ? 0x9b9b9b : 0x3b3b3b;
                const lineAlpha = node.cleared ? 0.18 : active ? 1 : 0.35;
                const lineWidth = active ? 3 : 2;

                const x2 = this.nodeX(target);
                const y2 = this.nodeY(target);

                // Fan out: bias lane from source based on this target's
                // relative rank, not the target's slot (which was the
                // bug that made lines cross). Spread range is 25%-75%
                // of the corridor between the two columns.
                const rank = (index + 1) / (targets.length + 1);
                const laneX = x1 + (x2 - x1) * (0.35 + rank * 0.30);

                this.edgeGfx.lineStyle(lineWidth, lineColor, lineAlpha);
                this.edgeGfx.beginPath();
                this.edgeGfx.moveTo(x1, y1);
                this.edgeGfx.lineTo(laneX, y1);
                this.edgeGfx.lineTo(laneX, y2);
                this.edgeGfx.lineTo(x2, y2);
                this.edgeGfx.strokePath();
            });
        });
    }

    private afterMove(node: MapNode, _previous: MapNode) {
        this.updateRunProgress(node.depth);
        this.animating = true;

        this.animateClearedOut(() => {
            this.buildAllVisuals(true);
            this.redrawEdges();
            this.refreshInteractivity();
            this.animateShift(node, () => {
                this.animating = false;
                this.fadeToRoom(node);
            });
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
        this.refreshInteractivity();
        this.refreshUI();
    }

    private animateClearedOut(done: () => void) {
        const ids = this.dungeon
            .getAllNodes()
            .filter((node) => node.cleared)
            .map((node) => node.id)
            .filter((id) => this.visuals.has(id));

        if (!ids.length) {
            done();
            return;
        }

        let remaining = ids.length;
        ids.forEach((id) => {
            const visual = this.visuals.get(id);
            if (!visual) {
                remaining--;
                if (remaining === 0) {
                    done();
                }
                return;
            }

            visual.rect.setFillStyle(0x232323).setStrokeStyle(1, 0x333333);
            visual.icon.setColor('#777777');

            const tweenTargets: Phaser.GameObjects.GameObject[] = [visual.rect, visual.icon];
            if (visual.sprite) { visual.sprite.setTint(0x555555); tweenTargets.push(visual.sprite); }
            this.tweens.add({
                targets: tweenTargets,
                alpha: 0.35,
                duration: 280,
                ease: 'Quad.in',
                onComplete: () => {
                    remaining--;
                    if (remaining === 0) {
                        done();
                    }
                },
            });
        });
    }

    private animateShift(node: MapNode, done: () => void) {
        const { x, y } = this.getMapOffset(node);
        this.tweens.add({
            targets: this.mapContainer,
            x,
            y,
            duration: 360,
            ease: 'Quad.inOut',
            onComplete: done,
        });
    }

    public refreshInteractivity() {
        const unlocks = this.meta.getUiUnlockState();

        this.glowMap.forEach((glow) => glow.destroy());
        this.glowMap.clear();
        this.fireMap.forEach((fire) => fire.destroy());
        this.fireMap.clear();

        const currentId = this.dungeon.currentNode.id;
        const forwardIds = new Set(this.dungeon.getForwardNodes().map((node) => node.id));
        const allNodes = this.dungeon.getAllNodes();

        this.visuals.forEach((visual, id) => {
            const node = allNodes.find((candidate) => candidate.id === id);
            if (!node) {
                return;
            }

            const hasFrame = this.textures.exists('hud_room_frames');

            if (node.cleared) {
                visual.rect.setFillStyle(0x000000).setAlpha(0.35);
                if (hasFrame) {
                    visual.rect.setStrokeStyle(0);
                } else {
                    visual.rect.setStrokeStyle(1, 0x333333);
                }
                visual.icon.setColor('#777777').setAlpha(0.5);
                if (visual.sprite) visual.sprite.setAlpha(0.35).setTint(0x555555);
                if (visual.frame) {
                    this.tweens.killTweensOf(visual.frame);
                    visual.frame
                        .setAlpha(0.35)
                        .setTint(0x555555)
                        .setDisplaySize(NODE_SZ + 8, NODE_SZ + 8);
                }
                return;
            }

            const isCurrent = id === currentId;
            const isForward = forwardIds.has(id);
            const revealed = isCurrent || isForward || node.visited;
            const knowsType = node.visited || isCurrent || unlocks.showRoomIcons;
            const iconText = revealed && knowsType ? roomIcon(node.type) : '?';

            // Black backdrop for every room — the carved frame overlay
            // (when present) carries the state colour, so the rect's
            // own stroke is only used as a fallback indicator when the
            // frame texture is missing. The "current room" no longer gets
            // a separate white outline; the player figures out where they
            // stand from the play-area state and the upcoming hover scale
            // affordance on reachable nodes.
            visual.rect.setFillStyle(0x000000).setAlpha(1);
            if (hasFrame) {
                visual.rect.setStrokeStyle(0);
            } else {
                visual.rect.setStrokeStyle(2, isForward ? 0x6d6d6d : 0x343434);
            }

            if (visual.frame) {
                const frameIdx = revealed && knowsType ? roomFrameIndex(node.type) : 2;
                this.tweens.killTweensOf(visual.frame);
                visual.frame
                    .setFrame(frameIdx)
                    .setAlpha(1)
                    .clearTint()
                    .setDisplaySize(NODE_SZ + 8, NODE_SZ + 8);
            }

            // Sprite priority: hand-authored room_icons spritesheet →
            // procedural PixelSprite → text glyph (matches buildAllVisuals).
            const useSheet =
                revealed && knowsType && this.textures.exists('hud_room_icons');
            const proceduralKey = PixelSprite.roomKey(roomSpriteKey(node.type));
            const useProcedural =
                !useSheet &&
                revealed &&
                knowsType &&
                this.textures.exists(proceduralKey);
            if (useSheet) {
                if (!visual.sprite) {
                    visual.sprite = this.add
                        .image(
                            this.nodeX(node),
                            this.nodeY(node),
                            'hud_room_icons',
                            roomIconFrame(node.type),
                        )
                        .setOrigin(0.5);
                    this.mapContainer.add(visual.sprite);
                } else {
                    visual.sprite.setTexture('hud_room_icons', roomIconFrame(node.type));
                }
                fitRoomSprite(visual.sprite);
                visual.sprite.setAlpha(1).clearTint().setVisible(true);
                visual.icon.setVisible(false);
            } else if (useProcedural) {
                if (!visual.sprite) {
                    visual.sprite = this.add
                        .image(this.nodeX(node), this.nodeY(node), proceduralKey)
                        .setOrigin(0.5);
                    this.mapContainer.add(visual.sprite);
                } else {
                    visual.sprite.setTexture(proceduralKey);
                }
                fitRoomSprite(visual.sprite);
                visual.sprite.setAlpha(1).clearTint().setVisible(true);
                visual.icon.setVisible(false);
            } else {
                visual.icon.setText(iconText).setColor('#ffffff').setAlpha(1).setVisible(true);
                if (visual.sprite) visual.sprite.setVisible(false);
            }

            // Highlight glow around reachable nodes — uniform neutral grey so
            // gold/red/green tints don't clash with the carved frame palette.
            if (isForward) {
                const glow = VFX.nodeGlow(this, this.nodeX(node), this.nodeY(node), 0x9a9a9a, NODE_SZ);
                this.mapContainer.add(glow);
                this.glowMap.set(id, glow);
            }

            // Tiny fire embers above campfire/altar nodes (REST/START/SHRINE).
            // Skipped on cleared rooms because their fire is "out".
            if (!node.cleared && hasFireEffect(node.type)) {
                const fire = VFX.nodeFire(
                    this,
                    this.mapContainer,
                    this.nodeX(node),
                    this.nodeY(node),
                );
                this.fireMap.set(id, fire);
            }
        });

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
        const overlay = this.add.rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000).setAlpha(0).setDepth(Depths.RoomTint);
        this.tweens.add({
            targets: overlay,
            alpha: 1,
            duration: 220,
            ease: 'Quad.in',
            onComplete: () => {
                this.mapContainer.setVisible(false);
                this.roomContainer.setVisible(true);
                this.tweens.add({
                    targets: overlay,
                    alpha: 0,
                    duration: 260,
                    ease: 'Quad.out',
                    onComplete: () => overlay.destroy(),
                });
                this.enterRoom(node);
            },
        });
    }

    private roomTintColor(type: RoomTypeValue): { color: number; alpha: number } {
        switch (type) {
            case RoomType.ENEMY: return { color: 0x331111, alpha: 0.12 };
            case RoomType.ELITE: return { color: 0x442211, alpha: 0.15 };
            case RoomType.BOSS: return { color: 0x440000, alpha: 0.18 };
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
        if (this.textures.exists(roomKey)) {
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
        const overlay = this.add.rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000).setAlpha(0).setDepth(Depths.RoomTint);
        this.tweens.add({
            targets: overlay,
            alpha: 1,
            duration: 180,
            ease: 'Quad.in',
            onComplete: () => {
                this.roomContainer.setVisible(false);
                this.mapContainer.setVisible(true);
                this.roomPanelGroup.setVisible(false);
                this.setRoomButtons([]);
                this.clearRoomTint();
                this.refreshInteractivity();
                this.refreshUI();
                this.tweens.add({
                    targets: overlay,
                    alpha: 0,
                    duration: 240,
                    ease: 'Quad.out',
                    onComplete: () => overlay.destroy(),
                });
            },
        });
    }

    public advanceToNode(node: MapNode) {
        if (!this.canUseMapNode(node)) {
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

}
