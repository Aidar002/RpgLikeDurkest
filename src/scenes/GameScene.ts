import * as Phaser from 'phaser';
import { COMBAT_CONFIG, EXPEDITION_CONFIG, MAP_CONFIG, ROOM_CONFIG, STRESS_CONFIG } from '../data/GameConfig';
import { DungeonManager } from '../systems/DungeonManager';
import {
    MapGenerator,
    RoomType,
} from '../systems/MapGenerator';
import type { MapNode, RoomType as RoomTypeValue } from '../systems/MapGenerator';
import {
    CombatManager,
    type CombatAction,
    type CombatEndPayload,
} from '../systems/CombatManager';
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
import type { NpcEvalContext, NpcManager, PickedDialog } from '../systems/NpcManager';
import type { NpcId, NpcOfferTemplate } from '../systems/Npcs';
import { EventLog } from '../ui/EventLog';
import { VFX } from '../ui/VFX';
import { SoundManager } from '../systems/SoundManager';
import { PixelSprite } from '../ui/PixelSprite';
import { roomColor, roomIcon, roomSpriteKey, roomTypeName } from '../ui/RoomVisuals';
import { compactText } from '../ui/TextHelpers';
import { setupSceneChrome, showUnlockBanner } from '../ui/SceneChrome';
import {
    showDeathScreen,
    showVictoryScreen,
    type EndScreenContext,
} from '../ui/EndScreens';
import { defaultRng, randomInt } from '../systems/Rng';

const COL_W = 150;
const ROW_H = 110;
const NODE_SZ = 44;
const MAP_X = 280;
const MAP_Y = 300;
const VIEW_X = 400;
const VIEW_Y = 300;

interface NodeVisual {
    rect: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Text;
    sprite?: Phaser.GameObjects.Image;
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

interface RoomButtonAction {
    label: string;
    callback: () => void;
    enabled?: boolean;
    fill?: number;
}

export class GameScene extends Phaser.Scene {
    private meta!: MetaProgressionManager;
    private mapGen!: MapGenerator;
    private dungeon!: DungeonManager;
    private player!: PlayerManager;
    private combat!: CombatManager;
    private log!: EventLog;
    private tracker!: RunTracker;
    private stress!: StressManager;
    private skillLoadout: SkillId[] = [...STARTER_LOADOUT];
    private loc: Localization = new Localization();
    private sfx: SoundManager = new SoundManager();
    private npcs!: NpcManager;
    private vethSharpenedThisRoom = false;

    private mapContainer!: Phaser.GameObjects.Container;
    private roomContainer!: Phaser.GameObjects.Container;
    private uiContainer!: Phaser.GameObjects.Container;
    private edgeGfx!: Phaser.GameObjects.Graphics;
    private visuals: Map<string, NodeVisual> = new Map();
    private glowMap: Map<string, Phaser.GameObjects.Graphics> = new Map();

    private animating = false;
    private dead = false;
    private deathSequenceStarted = false;
    private lastEnemyHp = 0;
    private runBestDepth = 0;
    private runBossKills = 0;
    private prestigeReward = 0;
    private prestigeAwarded = false;
    private skipLightSpendThisRoom = false;
    private roomTintOverlay: Phaser.GameObjects.Rectangle | null = null;

    private hpBar!: Phaser.GameObjects.Rectangle;
    private hpValueText!: Phaser.GameObjects.Text;
    private xpBar!: Phaser.GameObjects.Rectangle;
    private xpBarBg!: Phaser.GameObjects.Rectangle;
    private levelText!: Phaser.GameObjects.Text;
    private statsText!: Phaser.GameObjects.Text;
    private resourceText!: Phaser.GameObjects.Text;
    private progressText!: Phaser.GameObjects.Text;
    private prestigeText!: Phaser.GameObjects.Text;
    private hintText!: Phaser.GameObjects.Text;
    private mapDepthText!: Phaser.GameObjects.Text;
    private tooltipText!: Phaser.GameObjects.Text;
    private depthLabels: Map<number, Phaser.GameObjects.Text> = new Map();

    private stressBarBg!: Phaser.GameObjects.Rectangle;
    private stressBar!: Phaser.GameObjects.Rectangle;
    private stressText!: Phaser.GameObjects.Text;
    private resolutionText!: Phaser.GameObjects.Text;
    private relicText!: Phaser.GameObjects.Text;
    private playerStatusText!: Phaser.GameObjects.Text;
    private enemyStatusText!: Phaser.GameObjects.Text;

    private roomHeaderText!: Phaser.GameObjects.Text;
    private enemyPortrait!: Phaser.GameObjects.Rectangle;
    private enemyIconText!: Phaser.GameObjects.Text;
    private enemySpriteImage!: Phaser.GameObjects.Image;
    private enemyNameText!: Phaser.GameObjects.Text;
    private enemyHpBar!: Phaser.GameObjects.Rectangle;
    private enemyHpBarBg!: Phaser.GameObjects.Rectangle;
    private enemyHpText!: Phaser.GameObjects.Text;
    private enemyIntelText!: Phaser.GameObjects.Text;
    private roomFlavorText!: Phaser.GameObjects.Text;
    private roomPanelGroup!: Phaser.GameObjects.Container;
    private actionButtons: ActionButton[] = [];

    constructor() {
        super('GameScene');
    }

    private tr(ru: string, en: string): string {
        return this.loc.language === 'ru' ? ru : en;
    }

    private skillShort(id: SkillId): string {
        return this.loc.pick(SKILLS[id].short);
    }

    private milestoneLabel(milestone: ContentUnlockMilestone): string {
        return this.loc.pick(milestone.label);
    }

    private milestoneRequirement(milestone: ContentUnlockMilestone): string {
        return this.loc.pick(milestone.requirement);
    }

    private npcOfferLabel(offer: NpcOfferTemplate, cost: number, index: number): string {
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
        this.player.onRelicsChange = () => this.refreshUI();

        this.stress = new StressManager();
        this.stress.onChange = (v) => {
            if (v > this.tracker.current.peakStress) this.tracker.trackMax('peakStress', v);
            this.updateStressUI();
        };
        this.stress.onResolution = (r) => this.handleStressResolution(r);

        // Pick loadout: first 2 skills from [starter + meta-unlocked extras].
        const extras = this.meta.getUnlockedExtraSkills();
        const pool: SkillId[] = [...STARTER_LOADOUT, ...extras.filter(s => !STARTER_LOADOUT.includes(s))];
        this.skillLoadout = pool.slice(0, 2);

        this.mapGen = new MapGenerator(this.getUnlockedRoomTypes(this.meta.getUnlockedContent()));

        this.actionButtons = [];
        this.visuals = new Map();
        this.glowMap = new Map();
        this.depthLabels = new Map();
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

        this.log = new EventLog(this, 18, 82, 410, 490);
        this.roomContainer.add(this.log.view);

        this.setupGlobalUI();

        this.combat = new CombatManager(
            this.player,
            this.log,
            (payload) => this.handleCombatVictory(payload),
            (damage) => this.onPlayerHit(damage),
            this.stress,
            this.loc
        );
        this.combat.onEnemyUpdate = (hp, maxHp, color, name, icon) =>
            this.updateEnemyUI(hp, maxHp, color, name, icon);
        this.combat.onPlayerStatusChange = () => this.updatePlayerStatusUI();
        this.combat.onEnemyStatusChange = () => this.updateEnemyStatusUI();

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
        }).setDepth(220).setVisible(false);

        VFX.vignette(this, 800, 600);
        VFX.scanlines(this, 800, 600);
        VFX.ambientEmbers(this, 22);

        setupSceneChrome(this, this.sfx, this.loc, () => this.safeRestart());
        this.sfx.startAmbient(0);

        this.log.addMessage(
            this.loc.language === 'ru'
                ? 'Спуск за Артефактом Желаний начался.'
                : 'The hunt for the Wish Artifact begins.',
            '#999999'
        );
        this.buildDepthLabels();
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
        const topBar = this.add.rectangle(0, 0, 800, 64, 0x101010).setOrigin(0);
        topBar.setStrokeStyle(1, 0x353535);

        const hpLabel = this.add.text(12, 10, this.loc.t('uiVital'), {
            fontFamily: 'Courier New',
            fontSize: '13px',
            color: '#888888',
        });

        const hpBarBg = this.add.rectangle(12, 36, 170, 14, 0x3c1111).setOrigin(0, 0.5);
        this.hpBar = this.add.rectangle(12, 36, 170, 14, 0xd93c3c).setOrigin(0, 0.5);
        this.hpValueText = this.add.text(192, 27, '', {
            fontFamily: 'Courier New',
            fontSize: '13px',
            color: '#ff8d8d',
        });

        this.xpBarBg = this.add.rectangle(300, 36, 132, 8, 0x1d2430).setOrigin(0, 0.5);
        this.xpBar = this.add.rectangle(300, 36, 132, 8, 0x5b9cff).setOrigin(0, 0.5);
        this.levelText = this.add.text(300, 10, '', {
            fontFamily: 'Courier New',
            fontSize: '13px',
            color: '#f5e28d',
        });

        this.statsText = this.add.text(448, 10, '', {
            fontFamily: 'Courier New',
            fontSize: '13px',
            color: '#cccccc',
        });

        this.resourceText = this.add.text(448, 28, '', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#9fc7ff',
        });

        this.progressText = this.add.text(786, 6, '', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#b8b8b8',
            align: 'right',
        }).setOrigin(1, 0);

        this.prestigeText = this.add.text(786, 20, '', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#ffd36e',
            align: 'right',
        }).setOrigin(1, 0);

        this.hintText = this.add.text(786, 36, '', {
            fontFamily: 'Courier New',
            fontSize: '10px',
            color: '#7b7b7b',
            align: 'right',
            wordWrap: { width: 180 },
        }).setOrigin(1, 0);

        this.mapDepthText = this.add.text(120, 558, '', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#3d3d3d',
        }).setOrigin(0, 0.5);

        // Stress bar (second row, below HP).
        const stressLabel = this.add.text(12, 46, this.tr('СТРЕСС', 'STRESS'), {
            fontFamily: 'Courier New',
            fontSize: '9px',
            color: '#8a7a99',
        });
        this.stressBarBg = this.add.rectangle(64, 52, 118, 6, 0x1a0c26).setOrigin(0, 0.5);
        this.stressBar = this.add.rectangle(64, 52, 0, 6, 0x7b4db8).setOrigin(0, 0.5);
        this.stressText = this.add.text(192, 47, '0', {
            fontFamily: 'Courier New',
            fontSize: '10px',
            color: '#a887c4',
        });
        this.resolutionText = this.add.text(216, 47, '', {
            fontFamily: 'Courier New',
            fontSize: '10px',
            color: '#c49fff',
        });

        this.relicText = this.add.text(12, 64, '', {
            fontFamily: 'Courier New',
            fontSize: '9px',
            color: '#b0a080',
            wordWrap: { width: 770 },
        });

        this.playerStatusText = this.add.text(400, 82, '', {
            fontFamily: 'Courier New',
            fontSize: '10px',
            color: '#8be0a7',
        }).setOrigin(0.5, 0);

        this.enemyStatusText = this.add.text(616, 320, '', {
            fontFamily: 'Courier New',
            fontSize: '10px',
            color: '#e09f9f',
        }).setOrigin(0.5, 0);

        this.uiContainer.add([
            topBar,
            hpLabel,
            hpBarBg,
            this.hpBar,
            this.hpValueText,
            this.xpBarBg,
            this.xpBar,
            this.levelText,
            this.statsText,
            this.resourceText,
            this.progressText,
            this.prestigeText,
            this.hintText,
            this.mapDepthText,
            stressLabel,
            this.stressBarBg,
            this.stressBar,
            this.stressText,
            this.resolutionText,
            this.relicText,
            this.playerStatusText,
        ]);

        this.roomContainer.add(this.enemyStatusText);

        this.player.onHpChange = () => this.refreshUI();
        this.player.onStatsChange = () => this.refreshUI();
        this.player.onResourcesChange = () => {
            this.refreshUI();
            if (this.combat.enemy) {
                this.refreshCombatButtons();
            }
        };
        this.player.onLevelUp = (level) => {
            this.tracker.trackMax('levelReached', level);
            this.log.addMessage(this.loc.t('levelUp', { level }), '#fff17a');
            VFX.floatText(this, 300, 20, `${this.loc.t('level')} ${level}`, '#fff17a');
            this.sfx.play('levelUp');
            const flash = this.add.rectangle(400, 300, 800, 600, 0xfff17a, 0.08).setDepth(88);
            this.tweens.add({ targets: flash, alpha: 0, duration: 500, onComplete: () => flash.destroy() });
            this.refreshUI();
        };
        this.player.onRevive = (remaining) => {
            this.log.addMessage(this.loc.t('revive', { count: remaining }), '#ffcb73');
            this.refreshUI();
        };
        this.player.onDeath = () => {
            if (this.deathSequenceStarted) {
                return;
            }

            this.deathSequenceStarted = true;
            this.dead = true;
            this.sfx.play('death');
            this.sfx.stopAmbient();
            this.cameras.main.shake(650, 0.04);
            this.time.delayedCall(320, () => this.showDeathScreen());
        };
    }

    private refreshUI() {
        const unlocks = this.meta.getUiUnlockState();
        const stats = this.player.stats;
        const resources = this.player.resources;

        const hpRatio = Phaser.Math.Clamp(stats.hp / stats.maxHp, 0, 1);
        this.hpBar.setDisplaySize(170 * hpRatio, 14);
        this.hpBar.setFillStyle(hpRatio > 0.5 ? 0xd93c3c : hpRatio > 0.25 ? 0xdb7a1c : 0xff4747);
        this.hpValueText.setText(`${this.loc.t('hp')} ${stats.hp}/${stats.maxHp}`);

        const xpRatio = Phaser.Math.Clamp(stats.xp / this.player.xpToNextLevel, 0, 1);
        this.xpBar.setDisplaySize(132 * xpRatio, 8);
        this.levelText.setText(
            `${this.loc.t('level')} ${stats.level}  ${this.loc.t('xp')} ${stats.xp}/${this.player.xpToNextLevel}`
        );

        const statParts = [
            `${this.loc.t('attackShort')} ${this.player.getAttackPower()}`,
            `${this.loc.t('defenseShort')} ${stats.defense}`,
        ];
        if (this.player.remainingRevives > 0) {
            statParts.push(`${this.loc.t('reviveShort')} ${this.player.remainingRevives}`);
        }
        if (this.player.hasHighLight) {
            statParts.push('\u2600');
        } else if (this.player.hasLowLight) {
            statParts.push('\u263D');
        }
        this.statsText.setText(statParts.join(' '));

        const resourceParts: string[] = [];
        if (unlocks.showGold) {
            resourceParts.push(`${this.loc.t('goldShort')} ${resources.gold}`);
        }
        if (unlocks.showPotions) {
            resourceParts.push(`${this.loc.t('potionShort')} ${resources.potions}`);
        }
        if (unlocks.showResolve) {
            resourceParts.push(`${this.loc.t('resolveShort')} ${resources.resolve}/${resources.maxResolve}`);
        }
        if (unlocks.showLight) {
            resourceParts.push(`${this.loc.t('lightShort')} ${resources.light}/${EXPEDITION_CONFIG.maxLight}`);
        }
        if (unlocks.showRelicShards) {
            resourceParts.push(`${this.loc.t('shardShort')} ${resources.relicShards}`);
        }
        this.resourceText.setText(resourceParts.join('  '));

        const progressParts = [`${this.loc.t('depthShort')} ${this.runBestDepth}`];
        if (unlocks.showKillCounter) {
            progressParts.push(`${this.loc.t('killShort')} ${this.player.killCount}`);
        }
        if (unlocks.showRunMetrics) {
            progressParts.push(`${this.loc.t('bossShort')} ${this.runBossKills}`);
        }
        this.progressText.setText(progressParts.join('  '));

        const prestigeForecast = this.runBestDepth + this.runBossKills * 2;
        this.prestigeText.setText(unlocks.showPrestigeForecast ? `${this.loc.t('prestige')} +${prestigeForecast}` : '');
        this.mapDepthText.setText(`${this.loc.t('mapDepth')} ${this.dungeon.currentDepth}`);

        const nextUnlock = this.meta.getNextContentUnlock();
        this.hintText.setText(
            nextUnlock
                ? compactText(
                    `${this.tr('Дальше', 'Next')}: ${this.milestoneRequirement(nextUnlock)}`,
                    30
                )
                : ''
        );

        this.hpValueText.setVisible(unlocks.showHpNumbers);
        this.mapDepthText.setVisible(unlocks.showDepthReadout);
        this.xpBarBg.setVisible(unlocks.showLevelPanel);
        this.xpBar.setVisible(unlocks.showLevelPanel);
        this.levelText.setVisible(unlocks.showLevelPanel);
        this.statsText.setVisible(unlocks.showPlayerStats);
        this.resourceText.setVisible(resourceParts.length > 0);
        this.progressText.setVisible(unlocks.showRunMetrics || unlocks.showKillCounter);
        this.prestigeText.setVisible(unlocks.showPrestigeForecast);
        const hintVisible = !!nextUnlock && this.mapContainer.visible;
        this.hintText.setVisible(hintVisible);

        this.relicText.setText(this.relicSummary());
        this.updateStressUI();
        this.updatePlayerStatusUI();
    }

    private updateStressUI() {
        const v = this.stress.value;
        const ratio = Phaser.Math.Clamp(v / 100, 0, 1);
        this.stressBar.setDisplaySize(118 * ratio, 6);
        this.stressBar.setFillStyle(v >= 75 ? 0xcb5ae8 : v >= 50 ? 0xa27bc4 : 0x7b4db8);
        this.stressText.setText(`${v}`);
        if (this.stress.resolution) {
            const info = this.resolutionInfo(this.stress.resolution);
            this.resolutionText.setText(
                this.stress.resolution.kind === 'virtue'
                    ? `\u2605 ${info.name}`
                    : `\u2620 ${info.name}`
            );
            this.resolutionText.setColor(
                this.stress.resolution.kind === 'virtue' ? '#a0e08a' : '#e87878'
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
                ? `${this.tr('ДОБЛЕСТЬ', 'VIRTUE')}: ${info.name}. ${info.description}`
                : `${this.tr('СРЫВ', 'AFFLICTION')}: ${info.name}. ${info.description}`,
            r.kind === 'virtue' ? '#8bd8ff' : '#e07070'
        );
        this.log.addMessage(
            narrate(r.kind === 'virtue' ? 'virtue' : 'affliction', this.loc.language),
            '#c4a35a'
        );
        showUnlockBanner(this, 
            r.kind === 'virtue'
                ? `${this.tr('Доблесть', 'Virtue')}: ${info.name}`
                : `${this.tr('Срыв', 'Affliction')}: ${info.name}`
        );
    }

    private updatePlayerStatusUI() {
        const txt = statusSummary(this.player.status, this.loc.language);
        this.playerStatusText.setText(txt);
    }

    private updateEnemyStatusUI() {
        if (!this.combat.enemy) {
            this.enemyStatusText.setText('');
            return;
        }
        const txt = statusSummary(this.combat.enemy.status, this.loc.language);
        this.enemyStatusText.setText(txt);
    }

    private relicSummary(): string {
        if (this.player.relics.length === 0) return '';
        return this.tr('Реликвии: ', 'Relics: ') + this.player.relics
            .map((id) => this.loc.pick(RELICS[id].short))
            .join(', ');
    }

    private maybeDropRelic(kind: 'normal' | 'elite' | 'boss' | 'treasure' | 'shrine'): boolean {
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
                this.tr(
                    `Реликвия: ${this.loc.pick(RELICS[fallback].name)}. ${this.loc.pick(RELICS[fallback].description)}`,
                    `Relic obtained: ${this.loc.pick(RELICS[fallback].name)}. ${this.loc.pick(RELICS[fallback].description)}`
                ),
                '#ffcc99'
            );
            return true;
        }

        this.player.addRelic(relicId);
        this.tracker.record('relicsFound');
        this.sfx.play('relicDrop');
        this.log.addMessage(
            this.tr(
                `Реликвия: ${this.loc.pick(relic.name)}. ${this.loc.pick(relic.description)}`,
                `Relic obtained: ${this.loc.pick(relic.name)}. ${this.loc.pick(relic.description)}`
            ),
            relic.rarity === 'unique' ? '#f0a8ff' : relic.rarity === 'rare' ? '#ffd36e' : '#ffcc99'
        );
        return true;
    }

    private setupRoomUI() {
        const panel = this.add.rectangle(450, 82, 332, 490, 0x111111).setOrigin(0);
        panel.setStrokeStyle(2, 0x353535);

        this.roomHeaderText = this.add.text(470, 98, '', {
            fontFamily: 'Courier New',
            fontSize: '13px',
            color: '#8b8b8b',
        });

        this.enemyPortrait = this.add.rectangle(616, 166, 96, 96, 0x333333).setStrokeStyle(2, 0x555555);
        this.enemyIconText = this.add.text(616, 178, '', {
            fontFamily: 'Courier New',
            fontSize: '36px',
            color: '#ffffff',
        }).setOrigin(0.5);
        this.enemySpriteImage = this.add.image(616, 166, '__DEFAULT')
            .setVisible(false).setOrigin(0.5);

        this.enemyNameText = this.add.text(616, 226, '', {
            fontFamily: 'Courier New',
            fontSize: '18px',
            color: '#f0f0f0',
            align: 'center',
            wordWrap: { width: 220 },
        }).setOrigin(0.5, 0);

        this.enemyHpBarBg = this.add.rectangle(506, 294, 220, 12, 0x331111).setOrigin(0, 0.5);
        this.enemyHpBar = this.add.rectangle(506, 294, 220, 12, 0xc93d2f).setOrigin(0, 0.5);
        this.enemyHpText = this.add.text(616, 308, '', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#ad6767',
        }).setOrigin(0.5);

        this.enemyIntelText = this.add.text(616, 340, '', {
            fontFamily: 'Courier New',
            fontSize: '11px',
            color: '#7ea4ff',
            align: 'center',
            wordWrap: { width: 236 },
        }).setOrigin(0.5, 0);

        this.roomFlavorText = this.add.text(616, 382, '', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#9b9b9b',
            align: 'center',
            wordWrap: { width: 236 },
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

        const buttonSpecs = [
            { x: 516, y: 446, width: 140 },
            { x: 684, y: 446, width: 140 },
            { x: 516, y: 492, width: 140 },
            { x: 684, y: 492, width: 140 },
            { x: 600, y: 540, width: 308 },
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

    private setRoomButtons(actions: RoomButtonAction[], useWideOnly: boolean = false) {
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
        button.label.setText(compactText(action.label, button.defaultWidth > 200 ? 34 : 19));
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
            const color = node.cleared ? 0x242424 : revealed ? roomColor(node) : 0x1a1a1a;
            const stroke = node.cleared
                ? 0x333333
                : node.id === currentId
                  ? 0xffffff
                  : forwardIds.has(node.id)
                    ? 0x6d6d6d
                    : 0x343434;
            const alpha = node.cleared ? 0.35 : 1;

            const rect = this.add
                .rectangle(x, y, NODE_SZ, NODE_SZ, color)
                .setStrokeStyle(2, stroke)
                .setAlpha(alpha);

            const icon = this.add
                .text(x, y, revealed && knowsType ? roomIcon(node.type) : '?', {
                    fontFamily: 'Courier New',
                    fontSize: '18px',
                    color: node.cleared ? '#4d4d4d' : '#ffffff',
                })
                .setOrigin(0.5)
                .setAlpha(alpha);

            const spriteKey = PixelSprite.roomKey(roomSpriteKey(node.type));
            let sprite: Phaser.GameObjects.Image | undefined;
            if (revealed && knowsType && this.textures.exists(spriteKey)) {
                icon.setVisible(false);
                sprite = this.add.image(x, y, spriteKey)
                    .setOrigin(0.5)
                    .setAlpha(alpha);
                if (node.cleared) sprite.setTint(0x555555);
            }

            if (fadeIn && !node.cleared) {
                rect.setAlpha(0);
                icon.setAlpha(0);
                const targets: Phaser.GameObjects.GameObject[] = [rect, icon];
                if (sprite) { sprite.setAlpha(0); targets.push(sprite); }
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
            this.mapContainer.add(children);
            this.visuals.set(node.id, { rect, icon, sprite });
        });
    }

    private buildDepthLabels() {
        this.depthLabels.forEach((label) => label.destroy());
        this.depthLabels.clear();

        const depths = new Set<number>();
        this.dungeon.getAllNodes().forEach((node) => depths.add(node.depth));

        depths.forEach((depth) => {
            if (depth === 0) return;
            this.addDepthLabel(depth);
        });
    }

    private addDepthLabel(depth: number) {
        if (this.depthLabels.has(depth)) return;
        const x = MAP_X + (depth - 1) * COL_W;
        const y = MAP_Y - ROW_H * 1.1;
        const isBoss = depth > 0 && depth % 8 === 0;
        const label = this.add.text(x, y, isBoss ? `D${depth} ★` : `D${depth}`, {
            fontFamily: 'Courier New',
            fontSize: '10px',
            color: isBoss ? '#c93d3d' : '#3d3d3d',
        }).setOrigin(0.5);
        this.mapContainer.add(label);
        this.depthLabels.set(depth, label);
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
                rect.setStrokeStyle(3, 0xffffff);
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
            const isCurrent = node.id === this.dungeon.currentNode.id;
            const isForward = this.dungeon.canMoveTo(node.id) && !node.cleared;
            rect.setStrokeStyle(2, isCurrent ? 0xffffff : isForward ? 0x6d6d6d : 0x333333);
            this.tooltipText.setVisible(false);
        });
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

    private handleMilestoneUnlocks(milestones: ContentUnlockMilestone[]) {
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
            visual.icon.setColor('#474747');

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

    private refreshInteractivity() {
        const unlocks = this.meta.getUiUnlockState();

        this.glowMap.forEach((glow) => glow.destroy());
        this.glowMap.clear();

        const currentId = this.dungeon.currentNode.id;
        const forwardIds = new Set(this.dungeon.getForwardNodes().map((node) => node.id));
        const allNodes = this.dungeon.getAllNodes();

        this.visuals.forEach((visual, id) => {
            const node = allNodes.find((candidate) => candidate.id === id);
            if (!node) {
                return;
            }

            if (node.cleared) {
                visual.rect.setFillStyle(0x232323).setStrokeStyle(1, 0x333333).setAlpha(0.35);
                visual.icon.setColor('#474747').setAlpha(0.35);
                if (visual.sprite) visual.sprite.setAlpha(0.35).setTint(0x555555);
                return;
            }

            const isCurrent = id === currentId;
            const isForward = forwardIds.has(id);
            const revealed = isCurrent || isForward || node.visited;
            const knowsType = node.visited || isCurrent || unlocks.showRoomIcons;
            const iconText = revealed && knowsType ? roomIcon(node.type) : '?';

            visual.rect.setFillStyle(revealed ? roomColor(node) : 0x1a1a1a).setAlpha(1);
            visual.rect.setStrokeStyle(2, isCurrent ? 0xffffff : isForward ? 0x6d6d6d : 0x333333);

            const spriteKey = PixelSprite.roomKey(roomSpriteKey(node.type));
            if (revealed && knowsType && this.textures.exists(spriteKey)) {
                if (!visual.sprite) {
                    visual.sprite = this.add.image(this.nodeX(node), this.nodeY(node), spriteKey)
                        .setOrigin(0.5);
                    this.mapContainer.add(visual.sprite);
                } else {
                    visual.sprite.setTexture(spriteKey);
                }
                visual.sprite.setAlpha(1).clearTint().setVisible(true);
                visual.icon.setVisible(false);
            } else {
                visual.icon.setText(iconText).setColor('#ffffff').setAlpha(1).setVisible(true);
                if (visual.sprite) visual.sprite.setVisible(false);
            }

            if (isForward) {
                const glow = VFX.nodeGlow(this, this.nodeX(node), this.nodeY(node), roomColor(node), NODE_SZ);
                this.mapContainer.add(glow);
                this.glowMap.set(id, glow);
            }
        });

    }

    private appendLayer(fromDepth: number) {
        this.refreshAvailableRoomPool(this.dungeon.currentDepth);
        const newNodes = this.mapGen.generateNextLayer(this.dungeon.getAllNodes(), fromDepth);
        this.dungeon.addNodes(newNodes);
        newNodes.forEach((node) => this.addDepthLabel(node.depth));
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
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000).setAlpha(0).setDepth(90);
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

    private applyRoomTint(type: RoomTypeValue) {
        if (this.roomTintOverlay) {
            this.roomTintOverlay.destroy();
            this.roomTintOverlay = null;
        }
        const tint = this.roomTintColor(type);
        this.roomTintOverlay = this.add.rectangle(400, 300, 800, 600, tint.color, tint.alpha)
            .setDepth(1).setScrollFactor(0);
    }

    private clearRoomTint() {
        if (this.roomTintOverlay) {
            this.roomTintOverlay.destroy();
            this.roomTintOverlay = null;
        }
    }

    private enterRoom(node: MapNode) {
        this.lastEnemyHp = 0;
        this.tracker.record('roomsVisited');
        this.tracker.trackMax('bestDepth', this.dungeon.currentDepth);
        this.applyRoomTint(node.type);
        this.sfx.play('footstep');
        this.sfx.updateAmbientDepth(this.dungeon.currentDepth);

        const sparesLight =
            this.player.aggregate.emptyRoomsSpareLight && node.type === RoomType.EMPTY;
        if (this.skipLightSpendThisRoom) {
            this.skipLightSpendThisRoom = false;
        } else if (!sparesLight) {
            const spent = this.player.spendLight(EXPEDITION_CONFIG.lightLossPerRoom);
            if (spent > 0) {
                this.log.addMessage(this.loc.t('lightLower', { count: spent }), '#e0c873');
            }
        }

        // Low-light stress bite.
        if (this.player.hasLowLight && node.type !== RoomType.START) {
            this.stress.add(STRESS_CONFIG.onLowLightRoom, this.player.aggregate.stressReductionPct);
            if (Math.random() < 0.3) {
                this.log.addMessage(narrate('low_light', this.loc.language), '#c4a35a');
            }
        }
        if (this.player.hasHighLight && node.type === RoomType.EMPTY) {
            this.stress.add(STRESS_CONFIG.onEmptyRoomHighLight, this.player.aggregate.stressReductionPct);
        }

        this.log.addDivider(`${this.loc.t('depth')} ${this.dungeon.currentDepth}`);

        const d = this.dungeon.currentDepth;
        if (d === 3) {
            this.sfx.play('whisper');
            this.log.addMessage(
                this.loc.language === 'ru'
                    ? 'На стене нацарапано: «Добыча ниже. Назад — выше».'
                    : 'Scratched into the wall: "Treasure below. Turn back above."',
                '#c4a35a'
            );
        } else if (d === 10) {
            this.sfx.play('whisper');
            this.log.addMessage(
                this.loc.language === 'ru'
                    ? 'У стены сидит мёртвый искатель. В пустом рюкзаке осталась карта вниз.'
                    : 'A dead treasure hunter sits against the wall. His map points deeper.',
                '#c4a35a'
            );
        } else if (d === 15) {
            this.sfx.play('whisper');
            this.log.addMessage(
                this.loc.language === 'ru'
                    ? 'Воздух дрожит в зубах. Артефакт ближе.'
                    : 'The air hums. The artifact is closer — you can feel it.',
                '#c4a35a'
            );
        } else if (d === 20) {
            this.sfx.play('whisper');
            this.log.addMessage(
                this.loc.language === 'ru'
                    ? 'Чужие зарубки кончились. Дальше только твои.'
                    : 'You are past the last known expedition. No marks but yours.',
                '#c4a35a'
            );
        } else if (d === MAP_CONFIG.finalDepth - 1) {
            this.sfx.play('whisper');
            this.log.addMessage(
                this.loc.language === 'ru'
                    ? 'Стены слабо светятся. Артефакт за следующей глубиной.'
                    : 'The walls glow faintly. The Wish Artifact is close.',
                '#ffd36e'
            );
        } else if (d >= MAP_CONFIG.finalDepth && node.type === RoomType.BOSS) {
            this.sfx.play('whisper');
            this.log.addMessage(
                this.loc.language === 'ru'
                    ? 'Последняя глубина. Страж ждёт у артефакта.'
                    : 'The final floor. The Artifact Guardian awaits.',
                '#ffd36e'
            );
        }

        switch (node.type) {
            case RoomType.ENEMY:
                this.startCombatEncounter('normal');
                return;
            case RoomType.ELITE:
                this.startCombatEncounter('elite');
                return;
            case RoomType.BOSS:
                this.startCombatEncounter('boss');
                return;
            case RoomType.TREASURE:
                this.resolveTreasureRoom();
                return;
            case RoomType.TRAP:
                this.showTrapOptions();
                return;
            case RoomType.REST:
                this.showRestOptions();
                return;
            case RoomType.SHRINE:
                this.showShrineOptions();
                return;
            case RoomType.MERCHANT:
                this.showMerchantOptions();
                return;
            case RoomType.EMPTY:
                this.showEmptyOptions();
                return;
            case RoomType.START:
                this.showRoomCard(
                    this.loc.t('start'),
                    this.loc.language === 'ru' ? 'Лагерь' : 'Camp',
                    this.loc.language === 'ru'
                        ? 'Вход остался сверху. Артефакт Желаний лежит внизу.'
                        : 'The entry is behind you. The Wish Artifact waits at the very bottom.',
                    0x555555,
                    '@',
                    this.loc.language === 'ru' ? 'Иди, когда выдохнешь.' : 'Continue when you are ready.'
                );
                this.showReturnButton();
                return;
        }
    }

    private startCombatEncounter(kind: 'normal' | 'elite' | 'boss') {
        const isFinalBoss = kind === 'boss' && this.dungeon.currentDepth >= MAP_CONFIG.finalDepth;
        const card = kind === 'boss'
            ? {
                  header: isFinalBoss ? (this.loc.language === 'ru' ? 'СТРАЖ АРТЕФАКТА' : 'ARTIFACT GUARDIAN') : this.loc.t('boss'),
                  title: isFinalBoss
                      ? (this.loc.language === 'ru' ? 'Хранитель Артефакта Желаний.' : 'The Guardian of the Wish Artifact.')
                      : this.tr('Хранитель этажа перекрывает лестницу.', 'A ruler of this floor rises.'),
                  description: isFinalBoss
                      ? (this.loc.language === 'ru' ? 'Последний страж. За ним лежит Артефакт Желаний.' : 'The final keeper. Beyond it lies the wish-granting artifact.')
                      : this.tr('Сейчас пригодится всё, чему тебя научил спуск.', 'Every system you earned is being tested at once.'),
                  color: isFinalBoss ? 0xc8a030 : 0xa52f2f,
                  icon: isFinalBoss ? '\u2726' : 'B',
              }
            : kind === 'elite'
              ? {
                    header: this.loc.t('elite'),
                    title: this.tr('Опытный враг держит коридор.', 'A hardened threat bars the corridor.'),
                    description: this.tr('Победа здесь будет дорогой. Добыча тоже.', 'Winning here should feel costly and worth it.'),
                    color: 0xa14a4a,
                    icon: 'E',
                }
              : {
                    header: this.loc.t('hostile'),
                    title: this.tr('Контакт', 'Threat detected'),
                    description: this.tr('Коридор сужается. Впереди заняли проход.', 'The corridor narrows. Something waits in the dark.'),
                    color: 0x6b3030,
                    icon: 'X',
                };

        this.showRoomCard(
            card.header,
            card.title,
            card.description,
            card.color,
            card.icon,
            this.loc.t('chooseMove'),
            kind === 'boss' ? 'BOSS' : kind === 'elite' ? 'ELITE' : 'ENEMY'
        );
        this.combat.startCombat(this.dungeon.currentDepth, kind);
        this.refreshCombatButtons();

        if (kind === 'boss') {
            this.sfx.play('bossAppear');
        } else if (kind === 'elite') {
            this.sfx.play('eliteAppear');
        }

        // Boss intro from a recurring NPC the player has bonded with.
        if (kind === 'boss') {
            const intro = this.npcs.pickBossIntro(this.loc.language);
            if (intro) {
                this.log.addMessage(intro.line, '#cdb8ff');
            }
        }
    }

    private refreshCombatButtons() {
        if (!this.combat.enemy) {
            this.setRoomButtons([]);
            return;
        }

        const actions: RoomButtonAction[] = [
            {
                label: this.loc.t('actionAttack'),
                callback: () => this.performCombatAction('attack'),
                fill: 0x5a1d1d,
            },
            {
                label: this.loc.t('actionDefend'),
                callback: () => this.performCombatAction('defend'),
                fill: 0x1b335b,
            },
        ];

        // Skill loadout: up to 2 skills from the loadout become 2 buttons.
        this.skillLoadout.forEach((id) => {
            const def = SKILLS[id];
            const cost = Math.max(1, def.resolveCost + (this.stress?.resolveCostMod() ?? 0));
            actions.push({
                label: `[${actions.length + 1}] ${this.skillShort(id)} ${cost}${this.loc.t('resolveShort').toLowerCase()}`,
                callback: () => this.performCombatAction({ kind: 'skill', id }),
                enabled: this.player.resources.resolve >= cost,
                fill: def.color,
            });
        });

        actions.push({
            label: this.loc.t('actionPotion', { num: actions.length + 1 }),
            callback: () => this.performCombatAction('potion'),
            enabled: this.player.resources.potions > 0,
            fill: 0x1f5b2f,
        });

        this.setRoomButtons(actions);
        this.enemyIntelText.setText(this.buildCombatIntel());
        this.enemyIntelText.setVisible(true);
    }

    private performCombatAction(action: CombatAction) {
        if (!this.combat.enemy) {
            return;
        }

        // Disable buttons to prevent spamming during combat turn
        this.actionButtons.forEach((b) => { b.enabled = false; });

        const hpBefore = this.combat.enemy.hp;
        this.tracker.record('turnsInCombat');
        const actionKind = typeof action === 'string' ? action : action.kind;
        if (actionKind === 'skill') {
            this.tracker.record('skillsUsed');
            this.sfx.play('skillUse');
        }
        if (actionKind === 'defend') {
            this.tracker.record('defendsUsed');
            VFX.shieldFlash(this, 126, 82);
            this.sfx.play('defend');
        }
        if (actionKind === 'potion') {
            this.tracker.record('potionsUsed');
            VFX.healGlow(this, 126, 82);
            this.sfx.play('potion');
        }

        this.combat.processTurn(action);

        if (this.combat.lastActionResult.critical) {
            this.tracker.record('criticalHits');
            VFX.critFlash(this);
            this.sfx.play('crit');
        } else if (actionKind === 'attack' || actionKind === 'skill') {
            this.sfx.play('hit');
        }

        const dmgDealt = hpBefore - (this.combat.enemy?.hp ?? 0);
        if (dmgDealt > 0) this.tracker.record('damageDealt', dmgDealt);

        // Re-enable buttons after a brief delay for pacing
        this.time.delayedCall(350, () => {
            if (this.combat.enemy) {
                this.refreshCombatButtons();
            }
        });
    }

    private buildCombatIntel(): string {
        if (!this.combat.enemy) {
            return this.tr('Выдохни и иди глубже.', 'Collect yourself and continue deeper.');
        }

        const enemy = this.combat.enemy;
        const profileHints: Record<string, string> = {
            brute: this.tr('Громила: ярится в ране.', 'Brute: enrages when wounded.'),
            stalker: this.tr('Охотник: бьёт сериями.', 'Stalker: may strike twice.'),
            mage: this.tr('Маг: копит силу для тяжёлого удара.', 'Mage: charges a heavy spell.'),
            boss: this.tr('Босс: держит путь вниз.', 'Boss: relentless power.'),
        };

        const hints: string[] = [];
        hints.push(profileHints[enemy.profile] ?? '');

        if (enemy.enraged) {
            hints.push(this.tr('ЯРОСТЬ!', 'ENRAGED!'));
        }
        if (enemy.charging) {
            hints.push(this.tr('Копит силу...', 'Charging...'));
        }

        if (this.meta.isUnlocked('action_skill')) {
            hints.push(
                this.tr(
                    `Навык: ${COMBAT_CONFIG.skillCost} ${this.loc.t('resolveShort').toLowerCase()}.`,
                    `Skill: ${COMBAT_CONFIG.skillCost} resolve.`
                )
            );
        }

        return hints.filter(Boolean).join(' ');
    }

    private resolveTreasureRoom() {
        const goldUnlocked = this.meta.isUnlocked('currency_gold');
        const xpGained = this.player.gainXp(ROOM_CONFIG.treasure.xpReward);

        let goldGained = 0;
        let potionGained = 0;
        if (goldUnlocked) {
            goldGained = this.player.gainGold(randomInt(defaultRng, ROOM_CONFIG.treasure.goldMin, ROOM_CONFIG.treasure.goldMax));
            if (goldGained > 0) this.tracker.record('goldEarned', goldGained);
            if (this.player.isPotionUnlocked && Math.random() < ROOM_CONFIG.treasure.potionChance) {
                potionGained = this.player.gainPotions(1);
            }
        }

        const rewardParts = [this.loc.t('plusXp', { value: xpGained })];
        if (goldGained > 0) {
            rewardParts.push(this.loc.t('plusGold', { value: goldGained }));
        }
        if (potionGained > 0) {
            rewardParts.push(this.loc.t('plusPotion'));
        }

        this.showRoomCard(
            this.loc.t('treasure'),
            this.tr('Старый тайник', 'Forgotten Cache'),
            this.tr(
                `Треснувший сундук не любит спешки. ${rewardParts.join(', ')}.`,
                `A cracked chest still rewards careful hands. ${rewardParts.join(', ')}.`
            ),
            0x8d6a21,
            '$',
            this.tr('Забери добычу и уходи.', 'Claim the spoils and move on.'),
            'TREASURE'
        );
        this.log.addMessage(this.loc.t('treasureSecured', { parts: rewardParts.join(', ') }), '#f7d46b');
        this.sfx.play('treasure');
        this.maybeDropRelic('treasure');
        this.stress.relieve(STRESS_CONFIG.onTreasure);
        this.showReturnButton();
    }

    private showTrapOptions() {
        const trapVariants = [
            {
                title: this.tr('Проволочная петля', 'Mechanical Snare'),
                desc: this.tr('Плита щёлкает под сапогом.', 'A pressure plate snaps awake under your boot.'),
                icon: '^',
            },
            {
                title: this.tr('Дротиковая стена', 'Poison Dart Wall'),
                desc: this.tr('В камне ряд мелких отверстий. Внутри шипит давление.', 'Tiny holes line the corridor. Something hisses inside.'),
                icon: '!',
            },
            {
                title: this.tr('Просевший пол', 'Collapsing Floor'),
                desc: this.tr('Камни ходят под ногами. Вес решит всё.', 'The stones shift. One wrong step and the ground gives way.'),
                icon: 'v',
            },
        ];
        const trap = trapVariants[Math.floor(Math.random() * trapVariants.length)];

        this.showRoomCard(
            this.loc.t('trap'),
            trap.title,
            trap.desc,
            0x75458a,
            trap.icon,
            this.tr('Проскочить или разобрать механизм.', 'Rush through or try to disarm it.'),
            'TRAP'
        );

        this.setRoomButtons([
            {
                label: this.loc.t('actionRush'),
                callback: () => {
                    this.tracker.record('trapsTriggered');
                    const damage = this.applyTrapDamage(
                        randomInt(defaultRng, ROOM_CONFIG.trap.rushDamageMin, ROOM_CONFIG.trap.rushDamageMax)
                    );
                    this.sfx.play('trapTrigger');
                    this.log.addMessage(this.loc.t('trapRush', { damage }), '#ff7777');
                    if (this.player.stats.hp > 0) {
                        this.showReturnButton();
                        this.enemyIntelText.setText(this.tr('Механизм замолк.', 'The worst is behind you.'));
                    }
                },
                fill: 0x5a1d1d,
            },
            {
                label: this.loc.t('actionDisarm'),
                callback: () => {
                    if (Math.random() < ROOM_CONFIG.trap.disarmChance) {
                        const gold = this.player.gainGold(
                            randomInt(defaultRng, ROOM_CONFIG.trap.disarmGoldMin, ROOM_CONFIG.trap.disarmGoldMax)
                        );
                        this.sfx.play('trapDisarm');
                        this.log.addMessage(this.loc.t('trapDisarm', { gold }), '#f7d46b');
                        this.enemyIntelText.setText(this.tr('Пружина сдаётся у тебя в руках.', 'The mechanism falls apart in your hands.'));
                    } else {
                        const damage = this.applyTrapDamage(
                            randomInt(defaultRng, 
                                ROOM_CONFIG.trap.disarmFailDamageMin,
                                ROOM_CONFIG.trap.disarmFailDamageMax
                            )
                        );
                        this.sfx.play('trapTrigger');
                        this.log.addMessage(this.loc.t('trapSnap', { damage }), '#ff7777');
                        this.enemyIntelText.setText(this.loc.t('trapSnapIntel'));
                    }

                    if (this.player.stats.hp > 0) {
                        this.showReturnButton();
                    }
                },
                fill: 0x5a2d78,
            },
        ]);
    }

    private showRestOptions() {
        this.sfx.play('rest');
        this.showRoomCard(
            this.loc.t('rest'),
            this.tr('Костёр', 'Campfire'),
            this.tr('Угли уже слабые, но тепла в них ещё хватает.', 'The coals are low, but still warm enough to matter.'),
            0x2f8b4b,
            '+',
            this.tr('Залатай тело, дыхание или нервы.', 'Recover body, mind, or spirit.'),
            'REST'
        );

        this.setRoomButtons([
            {
                label: this.loc.t('actionRecover'),
                callback: () => {
                    const healed = this.player.heal(
                        ROOM_CONFIG.rest.recoverHeal +
                            this.meta.getBonuses().rooms.restHealBonus +
                            this.player.aggregate.restHealBonus
                    );
                    if (healed > 0) this.tracker.record('healingDone', healed);
                    const lightGained = this.player.gainLight(ROOM_CONFIG.rest.recoverLight);
                    const summary = [`${healed} ${this.loc.t('hp')}`];
                    if (lightGained > 0) {
                        summary.push(`${lightGained} ${this.tr('света', 'light')}`);
                    }
                    this.log.addMessage(this.loc.t('restRecover', { parts: summary.join(', ') }), '#79e28f');
                    this.enemyIntelText.setText(this.tr('Комната на минуту отпускает.', 'The room feels less hostile for a moment.'));
                    this.showReturnButton();
                },
                fill: 0x1f5b2f,
            },
            {
                label: this.loc.t('actionFocus'),
                callback: () => {
                    const gained = this.player.gainResolve(ROOM_CONFIG.rest.focusResolve);
                    this.log.addMessage(this.loc.t('focusResolve', { value: gained }), '#9bc8ff');
                    this.enemyIntelText.setText(this.tr('Ты уходишь ровнее, чем вошёл.', 'You leave steadier than you arrived.'));
                    this.showReturnButton();
                },
                fill: 0x1b335b,
            },
            {
                label: this.tr('[3] Медитация', '[3] Meditate'),
                callback: () => {
                    this.stress.relieve(ROOM_CONFIG.rest.meditateStressRelief);
                    this.log.addMessage(
                        this.tr(
                            `Ты выдыхаешь лишний вес. -${ROOM_CONFIG.rest.meditateStressRelief} стресса.`,
                            `You breathe through the weight. -${ROOM_CONFIG.rest.meditateStressRelief} stress.`
                        ),
                        '#d6b8ff'
                    );
                    this.enemyIntelText.setText(this.tr('Углы на миг теряют зубы.', 'The shadows lose an edge, if briefly.'));
                    this.showReturnButton();
                },
                fill: 0x3e2260,
            },
        ]);
    }

    // === NPC presentation ====================================================

    private buildNpcEvalContext(): NpcEvalContext {
        const hpFrac = this.player.stats.maxHp > 0
            ? this.player.stats.hp / this.player.stats.maxHp
            : 1;
        const r = this.stress.resolution;
        return {
            depth: this.dungeon.currentDepth,
            hpFrac,
            stress: this.stress.value,
            resolution: r ? r.kind : 'none',
            bleedDamageDealt: this.tracker.current.bleedDamageDealt,
            relicsFound: this.tracker.current.relicsFound,
            bossesKilledEver: this.meta.bossesKilledEver,
        };
    }

    private npcOfferCost(offerId: string, _npcId: NpcId): number {
        switch (offerId) {
            case 'mira_potion':
                return ROOM_CONFIG.merchant.potionCost;
            case 'mira_lantern':
                return ROOM_CONFIG.merchant.lanternCost;
            case 'mira_armor':
                return ROOM_CONFIG.merchant.armorCost;
            case 'mira_relic_oil':
                return ROOM_CONFIG.merchant.premiumShardCost;
            case 'casimir_offer':
                return ROOM_CONFIG.shrine.offerGoldCost;
            case 'casimir_rite':
                return ROOM_CONFIG.shrine.premiumShardCost;
            case 'hollow_relic_for_hp':
                return Math.max(4, Math.floor(this.player.stats.maxHp * 0.25));
            case 'hollow_shards_for_relic':
                return 2;
            case 'hollow_potion_for_gold':
                return ROOM_CONFIG.merchant.potionCost - 2;
            case 'veth_challenge':
                return Math.max(3, Math.floor(this.player.stats.maxHp * 0.15));
            case 'veth_lesson':
                return 25;
            case 'chorister_relieve':
                return ROOM_CONFIG.shrine.offerGoldCost - 6;
            case 'chorister_resolve':
                return ROOM_CONFIG.shrine.offerGoldCost - 8;
            case 'chorister_unbind':
                return ROOM_CONFIG.shrine.premiumShardCost;
            default:
                return 0;
        }
    }

    private isNpcOfferEnabled(offer: NpcOfferTemplate, npcId: NpcId): boolean {
        const cost = this.npcOfferCost(offer.id, npcId);
        switch (offer.id) {
            case 'mira_potion':
            case 'mira_lantern':
            case 'mira_armor':
            case 'casimir_offer':
            case 'chorister_relieve':
            case 'chorister_resolve':
                return this.player.resources.gold >= cost;
            case 'mira_relic_oil':
            case 'casimir_rite':
            case 'hollow_shards_for_relic':
            case 'chorister_unbind':
                return this.player.resources.relicShards >= cost;
            case 'hollow_relic_for_hp':
            case 'veth_challenge':
                return this.player.stats.hp > cost + 1;
            case 'veth_lesson':
                // Costs stress: only enabled if stress isn't capped already.
                return this.stress.value < 100;
            case 'hollow_potion_for_gold':
                return this.player.resources.potions > 0;
            case 'veth_strop':
                return !this.vethSharpenedThisRoom;
            case 'kessa_tea':
            case 'kessa_warning':
                return true;
            case 'kessa_token':
                return !this.npcs.hasFlag('kessa', 'gave-token');
            default:
                return true;
        }
    }

    private presentNpcRoom(npcId: NpcId, headerLabel: string) {
        this.vethSharpenedThisRoom = false;

        // Pick dialog *before* marking the encounter so metCount===0 selects
        // the 'first' stage on the very first meeting. markEncounter then
        // bumps the count for subsequent visits.
        const ctx = this.buildNpcEvalContext();
        const picked = this.npcs.pickDialog(npcId, ctx);
        this.npcs.markEncounter(npcId, this.dungeon.currentDepth);

        // Render the room card. Avoid compactText for dialog so wordWrap
        // can render the full beat — these lines are intentionally long.
        this.roomHeaderText.setText(headerLabel);
        this.enemyPortrait.setFillStyle(picked.npc.color);
        this.enemyIconText.setText(picked.npc.glyph);
        this.enemyNameText.setText(
            compactText(
                `${this.loc.pick(picked.npc.name)}, ${this.loc.pick(picked.npc.title)}`,
                28
            )
        );
        // Scene flavor (italic-feel, smaller) goes in intel; dialog beat in body.
        this.enemyIntelText.setText(this.loc.pick(picked.npc.flavor));
        this.enemyIntelText.setVisible(true);
        this.roomFlavorText.setText(compactText(this.loc.pick(picked.beat.text), 90));
        this.enemySpriteImage.setVisible(false);
        this.enemyIconText.setVisible(true);
        this.enemyHpBarBg.setVisible(false);
        this.enemyHpBar.setVisible(false);
        this.enemyHpText.setVisible(false);
        this.roomPanelGroup.setVisible(true);

        // Log the dialog beat so it persists in the run log too.
        this.log.addMessage(this.loc.pick(picked.beat.text), '#cdb8ff');

        const actions = picked.offers.map<RoomButtonAction>((offer, idx) => {
            const cost = this.npcOfferCost(offer.id, npcId);
            return {
                label: this.npcOfferLabel(offer, cost, idx + 1),
                callback: () => this.handleNpcOffer(npcId, offer),
                enabled: this.isNpcOfferEnabled(offer, npcId),
                fill: picked.npc.color,
            };
        });

        actions.push({
            label: this.loc.t('actionDynamicLeave', { num: actions.length + 1 }),
            callback: () => this.leaveNpcRoom(picked),
            fill: 0x202020,
        });

        this.setRoomButtons(actions);
    }

    private leaveNpcRoom(picked: PickedDialog) {
        if (picked.farewell) {
            const farewell = this.loc.pick(picked.farewell.text);
            this.log.addMessage(farewell, '#a89dc4');
            this.enemyIntelText.setText(compactText(farewell, 60));
        }
        this.showReturnButton();
    }

    private handleNpcOffer(npcId: NpcId, offer: NpcOfferTemplate) {
        const cost = this.npcOfferCost(offer.id, npcId);
        let consumed = true;
        let affinityDelta = 1;

        switch (offer.id) {
            // -- Mira ------------------------------------------------------------
            case 'mira_potion':
                if (!this.player.spendGold(cost)) { consumed = false; break; }
                this.tracker.record('goldSpent', cost);
                this.player.gainPotions(1);
                this.log.addMessage(this.tr('Мира без слов ставит эликсир ближе.', 'Mira slides a potion across without comment.'), '#9be0a7');
                break;
            case 'mira_lantern': {
                if (!this.player.spendGold(cost)) { consumed = false; break; }
                this.tracker.record('goldSpent', cost);
                const gainedLight = this.player.gainLight(ROOM_CONFIG.merchant.lanternLightGain);
                this.log.addMessage(this.tr(`Мира доливает масло в фонарь: +${gainedLight} света.`, `Mira refills your lantern: +${gainedLight} light.`), '#ffe08a');
                affinityDelta = 2;
                break;
            }
            case 'mira_armor':
                if (!this.player.spendGold(cost)) { consumed = false; break; }
                this.tracker.record('goldSpent', cost);
                this.player.addDefenseBonus(ROOM_CONFIG.merchant.armorDefenseGain);
                this.log.addMessage(this.tr(`Мира затягивает ремни брони: +${ROOM_CONFIG.merchant.armorDefenseGain} защиты.`, `Mira fastens armor straps: +${ROOM_CONFIG.merchant.armorDefenseGain} defense.`), '#b8d3ff');
                break;
            case 'mira_relic_oil':
                if (!this.player.spendRelicShard(cost)) { consumed = false; break; }
                this.player.addAttackBonus(ROOM_CONFIG.merchant.premiumAttackBonus);
                this.player.gainPotions(ROOM_CONFIG.merchant.premiumPotionBonus);
                this.log.addMessage(
                    this.tr(
                        `Мира смазывает клинок реликтовым маслом. +${ROOM_CONFIG.merchant.premiumAttackBonus} атаки, +${ROOM_CONFIG.merchant.premiumPotionBonus} эликсир.`,
                        `Mira anoints your blade. +${ROOM_CONFIG.merchant.premiumAttackBonus} attack, +${ROOM_CONFIG.merchant.premiumPotionBonus} potion.`
                    ),
                    '#ffd9f7'
                );
                affinityDelta = 2;
                break;

            // -- Casimir ---------------------------------------------------------
            case 'casimir_pray':
                if (Math.random() < ROOM_CONFIG.shrine.prayBlessChance) {
                    this.player.addAttackBonus(ROOM_CONFIG.shrine.prayAttackBonus);
                    this.log.addMessage(
                        this.tr(
                            `Казимир шепчет строку безымянной молитвы. +${ROOM_CONFIG.shrine.prayAttackBonus} атаки.`,
                            `Casimir whispers a heretical line. +${ROOM_CONFIG.shrine.prayAttackBonus} attack.`
                        ),
                        '#d7b6ff'
                    );
                    affinityDelta = 2;
                } else {
                    const damage = this.player.takeDamage(ROOM_CONFIG.shrine.prayDamage);
                    const resolve = this.player.gainResolve(ROOM_CONFIG.shrine.prayResolveGain);
                    this.log.addMessage(
                        this.tr(
                            `Алтарь берёт кровь и возвращает волю. -${damage} ОЗ, +${resolve} воли.`,
                            `The altar pays him in your blood. -${damage} HP, +${resolve} resolve.`
                        ),
                        '#c99cff'
                    );
                    affinityDelta = 1;
                }
                break;
            case 'casimir_offer':
                if (!this.player.spendGold(cost)) { consumed = false; break; }
                this.tracker.record('goldSpent', cost);
                this.player.addMaxHpBonus(ROOM_CONFIG.shrine.offerMaxHpBonus);
                this.log.addMessage(
                    this.tr(
                        `Казимир кладёт подношение на камень. +${ROOM_CONFIG.shrine.offerMaxHpBonus} к макс. ОЗ на этот забег.`,
                        `Casimir feeds the altar. +${ROOM_CONFIG.shrine.offerMaxHpBonus} max HP this run.`
                    ),
                    '#ffd36e'
                );
                affinityDelta = 2;
                break;
            case 'casimir_rite':
                if (!this.player.spendRelicShard(cost)) { consumed = false; break; }
                this.player.addMaxHpBonus(
                    ROOM_CONFIG.shrine.premiumMaxHpBonus,
                    ROOM_CONFIG.shrine.premiumMaxHpBonus
                );
                this.player.gainResolve(ROOM_CONFIG.shrine.premiumResolveBonus);
                this.log.addMessage(
                    this.tr(
                        `Казимир проводит обряд слишком уверенно. +${ROOM_CONFIG.shrine.premiumMaxHpBonus} макс. ОЗ, +${ROOM_CONFIG.shrine.premiumResolveBonus} воли.`,
                        `Casimir performs the wrong rite, perfectly. +${ROOM_CONFIG.shrine.premiumMaxHpBonus} max HP, +${ROOM_CONFIG.shrine.premiumResolveBonus} resolve.`
                    ),
                    '#ffd9f7'
                );
                affinityDelta = 2;
                break;

            // -- Hollow Trader ---------------------------------------------------
            case 'hollow_relic_for_hp': {
                this.player.takeDamage(cost, 0, 'true');
                const got = this.maybeDropRelic('elite');
                if (!got) {
                    // Always grant *something* — refund some gold instead.
                    this.player.gainGold(8);
                    this.log.addMessage(this.tr('Торговец платит монетой. Сделка закрыта.', 'The Trader pays in coin instead. The deal is honoured.'), '#a8a0c0');
                } else {
                    this.log.addMessage(this.tr('Полый торговец ставит отметку в книге. Боль точна.', 'The Hollow Trader marks the ledger. The pain is precise.'), '#a8a0c0');
                }
                affinityDelta = 2;
                this.npcs.addFlag('hollow', 'paid-in-blood');
                break;
            }
            case 'hollow_shards_for_relic':
                if (!this.player.spendRelicShard(cost)) { consumed = false; break; }
                this.maybeDropRelic('boss');
                this.log.addMessage(this.tr('Торговец забирает часть тебя. Реликвия ложится в сумку.', 'The Trader trades absence for absence. A relic settles into your kit.'), '#f0a8ff');
                affinityDelta = 2;
                break;
            case 'hollow_potion_for_gold':
                if (this.player.resources.potions <= 0) { consumed = false; break; }
                this.player.resources.potions -= 1;
                this.player.gainGold(cost);
                this.log.addMessage(this.tr(`Торговец забирает эликсир так, будто он уже был его. +${cost} золота.`, `The Trader takes the potion as if it were never there. +${cost} gold.`), '#ffd36e');
                break;

            // -- Veth ------------------------------------------------------------
            case 'veth_challenge': {
                this.player.takeDamage(cost, 0, 'true');
                const got = this.maybeDropRelic('elite');
                if (!got) {
                    this.player.gainGold(20);
                    this.log.addMessage(this.tr('Вет прячет договор и платит монетой. "Шрам есть шрам."', 'Veth pockets her pact and pays you in coin. "A scar is a scar."'), '#ffb084');
                } else {
                    this.log.addMessage(this.tr('Вет смотрит на свежую линию. "Неси её достойно."', 'Veth admires the line she drew. "Carry it well."'), '#ffb084');
                }
                affinityDelta = 2;
                this.npcs.addFlag('veth', 'pacted');
                break;
            }
            case 'veth_lesson':
                this.stress.add(cost);
                this.player.addAttackBonus(2);
                this.log.addMessage(this.tr('Вет показывает третий разрез: +2 атаки на этот забег. Цена остаётся с тобой.', 'Veth teaches the third cut. +2 attack this run; the lesson costs.'), '#ffb084');
                affinityDelta = 2;
                this.npcs.addFlag('veth', 'taught');
                break;
            case 'veth_strop':
                if (this.vethSharpenedThisRoom) { consumed = false; break; }
                this.vethSharpenedThisRoom = true;
                this.player.addAttackBonus(1);
                this.log.addMessage(this.tr('Вет правит клинок о старую кожу. +1 атаки.', 'Veth strops your blade against the leather. +1 attack.'), '#ffb084');
                affinityDelta = 1;
                break;

            // -- Chorister -------------------------------------------------------
            case 'chorister_relieve':
                if (!this.player.spendGold(cost)) { consumed = false; break; }
                this.tracker.record('goldSpent', cost);
                this.stress.relieve(20);
                this.log.addMessage(this.tr('Хорист держит низкую ноту. -20 стресса.', 'The Chorister sings. -20 stress.'), '#d6b8ff');
                affinityDelta = 2;
                break;
            case 'chorister_resolve':
                if (!this.player.spendGold(cost)) { consumed = false; break; }
                this.tracker.record('goldSpent', cost);
                this.player.gainResolve(2);
                this.log.addMessage(this.tr('Хорист выравнивает твои руки. +2 воли.', 'The Chorister steadies your hands. +2 resolve.'), '#9bc8ff');
                break;
            case 'chorister_unbind':
                if (!this.player.spendRelicShard(cost)) { consumed = false; break; }
                if (this.stress.resolution && this.stress.resolution.kind === 'affliction') {
                    this.stress.resolution = null;
                    this.updateStressUI();
                    this.log.addMessage(this.tr('Хорист ослабляет срыв. Песня держит трещину закрытой.', 'The Chorister unbinds the affliction. The song carries it away.'), '#ffd9f7');
                    affinityDelta = 3;
                } else {
                    this.player.gainResolve(3);
                    this.log.addMessage(this.tr('Сегодня нечего чинить. Песня становится волей. +3 воли.', 'There is no crack to mend today. The song becomes resolve. +3 resolve.'), '#ffd9f7');
                    affinityDelta = 1;
                }
                break;

            // -- Kessa -----------------------------------------------------------
            case 'kessa_tea':
                this.player.heal(4);
                this.stress.relieve(10);
                this.log.addMessage(this.tr('Кесса наливает вторую кружку. +4 ОЗ, -10 стресса.', 'Kessa pours the second cup. +4 HP, -10 stress.'), '#9be0a7');
                affinityDelta = 2;
                break;
            case 'kessa_warning':
                this.player.gainResolve(1);
                this.log.addMessage(
                    this.tr(
                    'Кесса: "Третья комната на любой глубине врёт. Держи второй эликсир, если можешь." (+1 воля)',
                        'Kessa: "Third room of any depth lies. Bring two potions if you can." (+1 resolve)'
                    ),
                    '#9bc8ff'
                );
                affinityDelta = 1;
                break;
            case 'kessa_token':
                this.player.addAttackBonus(1);
                this.player.addDefenseBonus(1);
                this.log.addMessage(
                    this.tr(
                    'Кесса вкладывает в ладонь латунную серьгу Серы. +1 атаки и +1 защиты на этот забег.',
                        'Kessa presses Sera\'s brass earring into your palm. +1 attack, +1 defense for this run.'
                    ),
                    '#ffd36e'
                );
                this.npcs.addFlag('kessa', 'gave-token');
                affinityDelta = 3;
                break;

            default:
                consumed = false;
        }

        if (consumed && affinityDelta !== 0) {
            this.npcs.adjustAffinity(npcId, affinityDelta);
        }

        // Stay in the room — show the offer's flavor as intel, then a return button.
        const flavor = this.loc.pick(offer.flavor);
        if (flavor) {
            this.enemyIntelText.setText(compactText(flavor, 60));
        }
        this.showReturnButton();
    }

    private showShrineOptions() {
        this.sfx.play('shrine');
        this.tracker.record('shrinesVisited');
        const npcId = this.npcs.pickForRole('shrine', this.dungeon.currentDepth);
        if (npcId) {
            this.presentNpcRoom(npcId, this.loc.t('shrine'));
        } else {
            this.showGenericShrineOptions();
        }
    }

    private showGenericShrineOptions() {
        const actions: RoomButtonAction[] = [
            {
                label: this.loc.t('actionPray'),
                callback: () => {
                    if (Math.random() < ROOM_CONFIG.shrine.prayBlessChance) {
                        this.player.addAttackBonus(ROOM_CONFIG.shrine.prayAttackBonus);
                        this.log.addMessage(this.loc.t('shrineAttack'), '#d7b6ff');
                    } else {
                        const damage = this.player.takeDamage(ROOM_CONFIG.shrine.prayDamage);
                        const resolve = this.player.gainResolve(ROOM_CONFIG.shrine.prayResolveGain);
                        this.log.addMessage(this.loc.t('shrineWound', { damage, resolve }), '#c99cff');
                    }
                    if (this.player.stats.hp > 0) {
        this.enemyIntelText.setText(this.tr('Алтарь запомнил твою кровь.', 'The shrine remembers your name.'));
                        this.showReturnButton();
                    }
                },
                fill: 0x5f4e8a,
            },
            {
                label: this.loc.t('actionDynamicLeave', { num: 2 }),
                callback: () => this.showReturnButton(),
                fill: 0x202020,
            },
        ];

        this.showRoomCard(
            this.loc.t('shrine'),
            this.tr('Старый алтарь', 'Forgotten Altar'),
            this.tr('Под камнем что-то слушает сквозь пыль.', 'Something old still listens from beneath the stone.'),
            0x5f4e8a,
            'S',
            this.tr('Молитва, подношение или тихий уход.', 'A prayer, an offering, or a careful retreat.'),
            'SHRINE'
        );
        this.setRoomButtons(actions);
    }

    private showMerchantOptions() {
        this.sfx.play('merchant');
        this.tracker.record('merchantsVisited');
        const npcId = this.npcs.pickForRole('merchant', this.dungeon.currentDepth);
        if (npcId) {
            this.presentNpcRoom(npcId, this.loc.t('merchant'));
            return;
        }
        this.showGenericMerchantOptions();
    }

    private showGenericMerchantOptions() {
        const actions: RoomButtonAction[] = [
            {
                label: this.loc.t('actionBuyPotion', { cost: ROOM_CONFIG.merchant.potionCost }),
                callback: () => {
                    if (!this.player.spendGold(ROOM_CONFIG.merchant.potionCost)) {
                        return;
                    }
                    this.tracker.record('goldSpent', ROOM_CONFIG.merchant.potionCost);
                    this.player.gainPotions(1);
                    this.log.addMessage(this.loc.t('buyPotion'), '#9be0a7');
            this.enemyIntelText.setText(this.tr('Торговец считает монеты, не поднимая глаз.', 'The merchant counts the coins and looks away.'));
                    this.showReturnButton();
                },
                enabled: this.player.resources.gold >= ROOM_CONFIG.merchant.potionCost,
                fill: 0x1f5b2f,
            },
        ];

        if (this.player.isLightUnlocked) {
            actions.push({
                label: this.loc.t('actionLantern', { num: actions.length + 1, cost: ROOM_CONFIG.merchant.lanternCost }),
                callback: () => {
                    if (!this.player.spendGold(ROOM_CONFIG.merchant.lanternCost)) {
                        return;
                    }
                    this.tracker.record('goldSpent', ROOM_CONFIG.merchant.lanternCost);
                    const gainedLight = this.player.gainLight(ROOM_CONFIG.merchant.lanternLightGain);
                    this.log.addMessage(this.loc.t('buyLantern', { value: gainedLight }), '#ffe08a');
            this.enemyIntelText.setText(this.tr('Масло пахнет чище здешнего воздуха.', 'The oil smells cleaner than the dungeon air.'));
                    this.showReturnButton();
                },
                enabled: this.player.resources.gold >= ROOM_CONFIG.merchant.lanternCost,
                fill: 0x8a5d2d,
            });
        }

        actions.push({
            label: this.loc.t('actionArmor', { num: actions.length + 1, cost: ROOM_CONFIG.merchant.armorCost }),
            callback: () => {
                if (!this.player.spendGold(ROOM_CONFIG.merchant.armorCost)) {
                    return;
                }
                this.tracker.record('goldSpent', ROOM_CONFIG.merchant.armorCost);
                this.player.addDefenseBonus(ROOM_CONFIG.merchant.armorDefenseGain);
                this.log.addMessage(this.loc.t('buyArmor', { value: ROOM_CONFIG.merchant.armorDefenseGain }), '#b8d3ff');
            this.enemyIntelText.setText(this.tr('Честная сделка. Насколько здесь бывает.', 'A fair trade, by dungeon standards.'));
                this.showReturnButton();
            },
            enabled: this.player.resources.gold >= ROOM_CONFIG.merchant.armorCost,
            fill: 0x355070,
        });

        if (this.meta.isUnlocked('merchant_premium')) {
            actions.push({
                label: this.loc.t('actionRelic', { num: actions.length + 1, cost: ROOM_CONFIG.merchant.premiumShardCost }),
                callback: () => {
                    if (!this.player.spendRelicShard(ROOM_CONFIG.merchant.premiumShardCost)) {
                        return;
                    }
                    this.player.addAttackBonus(ROOM_CONFIG.merchant.premiumAttackBonus);
                    this.player.gainPotions(ROOM_CONFIG.merchant.premiumPotionBonus);
                    this.log.addMessage(this.loc.t('buyRelic', {
                        attack: ROOM_CONFIG.merchant.premiumAttackBonus,
                        potions: ROOM_CONFIG.merchant.premiumPotionBonus,
                    }), '#ffd9f7');
            this.enemyIntelText.setText(this.tr('Торговец улыбается, когда реликвия меняет хозяина.', 'The merchant smiles only when relics change hands.'));
                    this.showReturnButton();
                },
                enabled: this.player.resources.relicShards >= ROOM_CONFIG.merchant.premiumShardCost,
                fill: 0x6b4c96,
            });
        }

        actions.push({
            label: this.loc.t('actionDynamicLeave', { num: actions.length + 1 }),
            callback: () => this.showReturnButton(),
            fill: 0x202020,
        });

        this.showRoomCard(
            this.loc.t('merchant'),
            this.tr('Торговец в капюшоне', 'Shadow Trader'),
            this.tr('Фигура в капюшоне уже оценила твой страх.', 'A hooded figure has already decided what your fear is worth.'),
            0x2e6c87,
            'M',
            this.tr('Выбирай осторожно. Здесь дают одну сделку.', 'Spend carefully. This room lasts one choice.'),
            'MERCHANT'
        );
        this.setRoomButtons(actions);
    }

    private showEmptyOptions() {
        // 35% chance to roll a wandering NPC into an empty room (Veth or Kessa).
        if (Math.random() < 0.35) {
            const npcId = this.npcs.pickForRole('wanderer', this.dungeon.currentDepth);
            if (npcId) {
                this.presentNpcRoom(npcId, this.tr('ВСТРЕЧА', 'ENCOUNTER'));
                return;
            }
        }

        const subEvents = [
            {
                title: this.tr('Пыльная камера', 'Dusty Chamber'),
            desc: this.tr('В тишине слышно и тайник, и собственные руки.', 'Stillness can hide a cache or steady a shaking hand.'),
                icon: '.',
            },
            {
            title: this.tr('Заваленный проход', 'Collapsed Passage'),
            desc: this.tr('Завал держит проход, но в щелях видны боковые ниши.', 'Rubble blocks the way, but gaps reveal hidden corners.'),
                icon: '~',
            },
            {
            title: this.tr('Гулкий зал', 'Echoing Hall'),
            desc: this.tr('Шаги возвращаются позднее, чем должны.', 'Footsteps return from walls that should not be so far away.'),
                icon: '"',
            },
            {
            title: this.tr('Старая ниша', 'Forgotten Alcove'),
            desc: this.tr('Здесь уже прятались. Царапины на камне ещё светлые.', 'Someone sheltered here before. Their scratches mark the stone.'),
                icon: '\'',
            },
        ];
        const event = subEvents[Math.floor(Math.random() * subEvents.length)];

        this.showRoomCard(
            this.loc.t('empty'),
            event.title,
            event.desc,
            0x444444,
            event.icon,
            this.tr('Обыскать комнату или выровнять дыхание.', 'Search the room or keep your footing.'),
            'EMPTY'
        );

        this.setRoomButtons([
            {
                label: this.loc.t('actionScout'),
                callback: () => {
                    const gains: string[] = [];
                    const lightGain = this.player.gainLight(ROOM_CONFIG.empty.scoutLightGain);
                    if (lightGain > 0) {
                        gains.push(`${lightGain} ${this.tr('света', 'light')}`);
                    }

                    if (
                        this.player.isGoldUnlocked &&
                        Math.random() < ROOM_CONFIG.empty.scoutGoldChance
                    ) {
                        const gold = this.player.gainGold(
                            randomInt(defaultRng, ROOM_CONFIG.empty.scoutGoldMin, ROOM_CONFIG.empty.scoutGoldMax)
                        );
                        if (gold > 0) this.tracker.record('goldEarned', gold);
                        gains.push(`${gold} ${this.tr('золота', 'gold')}`);
                    }

                    if (gains.length === 0) {
                        const xp = this.player.gainXp(1);
                        gains.push(this.loc.t('plusXp', { value: xp }).replace(/^\+/, ''));
                    }

                    this.log.addMessage(this.loc.t('emptyScout', { parts: gains.join(', ') }), '#bbbbbb');
                this.enemyIntelText.setText(this.tr('Ты уходишь с более ясной картой углов.', 'You leave with a slightly clearer picture of the dark.'));
                    this.showReturnButton();
                },
                fill: 0x3d3d3d,
            },
            {
                label: this.loc.t('actionSteady'),
                callback: () => {
                    if (this.player.isResolveUnlocked) {
                        const gained = this.player.gainResolve(ROOM_CONFIG.empty.steadyResolveGain);
                        this.log.addMessage(this.loc.t('emptySteady', { value: gained }), '#9bc8ff');
                    } else {
                        const gainedXp = this.player.gainXp(1);
                        this.log.addMessage(this.loc.t('emptyStudy', { value: gainedXp }), '#bbbbbb');
                    }
            this.enemyIntelText.setText(this.tr('Комната ничего не требует. Этого достаточно.', 'The room gives nothing, and that helps.'));
                    this.showReturnButton();
                },
                fill: 0x2b2b2b,
            },
        ]);
    }

    private applyTrapDamage(rawDamage: number): number {
        const mitigated = Math.max(1, rawDamage - this.meta.getBonuses().rooms.trapDamageReduction);
        return this.player.takeDamage(mitigated);
    }

    private showRoomCard(
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
            this.enemyIconText.setVisible(false);
        } else {
            this.enemySpriteImage.setVisible(false);
            this.enemyIconText.setVisible(true);
        }
    }

    private showReturnButton() {
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

    private returnToMap() {
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000).setAlpha(0).setDepth(90);
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

    private advanceToNode(node: MapNode) {
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

    private updateEnemyUI(
        hp: number,
        maxHp: number,
        color: number,
        name: string,
        icon: string
    ) {
        const unlocks = this.meta.getUiUnlockState();
        const description = this.combat.enemy?.description ?? this.loc.t('enemyFallback');

        const isFinalBoss = this.combat.enemy?.kind === 'boss' && this.dungeon.currentDepth >= MAP_CONFIG.finalDepth;
        this.roomHeaderText.setText(
            isFinalBoss
                ? (this.loc.language === 'ru' ? 'СТРАЖ АРТЕФАКТА' : 'ARTIFACT GUARDIAN')
                : this.combat.enemy?.kind === 'boss'
                  ? this.loc.t('boss')
                  : this.combat.enemy?.kind === 'elite'
                    ? this.loc.t('elite')
                    : this.loc.t('hostile')
        );
        this.enemyPortrait.setFillStyle(color);
        this.enemyIconText.setText(icon);
        this.enemyNameText.setText(compactText(name, 28));
        this.roomFlavorText.setText(compactText(description, 72));
        this.roomPanelGroup.setVisible(true);

        const profile = this.combat.enemy?.profile;
        if (profile) {
            const sprKey = PixelSprite.enemyKey(profile);
            if (this.textures.exists(sprKey)) {
                this.enemySpriteImage.setTexture(sprKey).setVisible(true);
                this.enemyIconText.setVisible(false);
            } else {
                this.enemySpriteImage.setVisible(false);
                this.enemyIconText.setVisible(true);
            }
        } else {
            this.enemySpriteImage.setVisible(false);
            this.enemyIconText.setVisible(true);
        }

        const ratio = Phaser.Math.Clamp(hp / maxHp, 0, 1);
        this.enemyHpBar.setDisplaySize(ratio * 220, 12);
        this.enemyHpBar.setFillStyle(ratio > 0.5 ? 0xc65a2e : ratio > 0.25 ? 0xcf9e16 : 0xc63d2d);
        this.enemyHpText.setText(`${this.loc.t('hp')} ${Math.max(0, hp)}/${maxHp}`);
        this.enemyHpBarBg.setVisible(unlocks.showEnemyHp);
        this.enemyHpBar.setVisible(unlocks.showEnemyHp);
        this.enemyHpText.setVisible(unlocks.showEnemyHp);
        this.enemyIntelText.setVisible(true);
        this.enemyIntelText.setText(
            unlocks.showEnemyHp
                ? compactText(this.buildCombatIntel(), 54)
                : this.loc.t('enemyInfoLocked')
        );

        if (this.lastEnemyHp > 0 && hp < this.lastEnemyHp) {
            const damage = this.lastEnemyHp - hp;
            VFX.floatText(this, 616, 138, `-${damage}`, '#ff7373');
            VFX.shake(this, this.enemyPortrait);
            VFX.flash(this, this.enemyPortrait, 0xff3232, 120);
        }

        this.lastEnemyHp = hp;
    }

    private handleCombatVictory(payload: CombatEndPayload) {
        const rewardLines: string[] = [];

        this.tracker.record('enemiesKilled');
        if (payload.kind === 'elite') this.tracker.record('elitesKilled');
        if (payload.kind === 'boss') {
            this.runBossKills += 1;
            this.tracker.record('bossesKilled');
            const bossMilestones = this.meta.registerBossKill();
            this.handleMilestoneUnlocks(bossMilestones);
        }

        const gainedXp = this.player.gainXp(payload.rewards.xp);
        rewardLines.push(this.loc.t('plusXp', { value: gainedXp }));

        const gainedGold = this.player.gainGold(payload.rewards.gold);
        if (gainedGold > 0) {
            rewardLines.push(this.loc.t('plusGold', { value: gainedGold }));
            this.tracker.record('goldEarned', gainedGold);
        }

        const gainedPotions = this.player.gainPotions(payload.rewards.potions);
        if (gainedPotions > 0) {
            rewardLines.push(this.loc.t('plusPotion'));
        }

        if (payload.rewards.attackBonus > 0) {
            this.player.addAttackBonus(payload.rewards.attackBonus);
            rewardLines.push(this.loc.t('plusAttack', { value: payload.rewards.attackBonus }));
        }

        const gainedShards = this.player.gainRelicShards(payload.rewards.relicShards);
        if (gainedShards > 0) {
            rewardLines.push(this.loc.t('plusShard', { value: gainedShards }));
        }

        this.player.registerKill();
        this.log.addMessage(this.loc.t('victoryRewards', { parts: rewardLines.join(', ') }), '#9be0a7');

        if (payload.kind === 'boss') {
            this.maybeDropRelic('boss');
            // Surviving a boss steadies known NPCs' regard for you.
            const intro = this.npcs.pickBossIntro(this.loc.language);
            if (intro) {
                const farewells = intro.npc.voice.farewell;
                const line = this.loc.pick(farewells[Math.floor(Math.random() * farewells.length)]);
                this.log.addMessage(line, '#cdb8ff');
            }

            if (this.dungeon.currentDepth >= MAP_CONFIG.finalDepth) {
                this.time.delayedCall(800, () => this.showVictoryScreen());
                return;
            }
        } else if (payload.kind === 'elite') {
            this.maybeDropRelic('elite');
        } else if (Math.random() < 0.07) {
            // Small chance for normal-kill relic scraps.
            this.maybeDropRelic('normal');
        }

        this.enemyIntelText.setText(this.loc.t('pathOpen'));
        this.showReturnButton();
        this.refreshUI();
    }

    private onPlayerHit(damage: number) {
        this.tracker.record('damageTaken', damage);
        this.sfx.play('enemyHit');
        const intensity = Math.min(0.015, 0.004 * damage);
        this.cameras.main.shake(220, intensity);
        const flash = this.add.rectangle(400, 300, 800, 600, 0xff0000, 0.18).setDepth(88);
        this.tweens.add({
            targets: flash,
            alpha: 0,
            duration: 300,
            onComplete: () => flash.destroy(),
        });
        VFX.floatText(this, 126, 82, `-${damage}`, '#ff5555');

        // Below ~25% HP after a hit: a known NPC's voice surfaces in memory.
        // Throttled by chance so it doesn't fire every hit.
        if (
            this.player.stats.maxHp > 0 &&
            this.player.stats.hp / this.player.stats.maxHp <= 0.25 &&
            Math.random() < 0.4
        ) {
            const recall = this.npcs.pickLowHpRecall(this.loc.language);
            if (recall) this.log.addMessage(recall, '#a89dc4');
        }
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
            tr: (ru, en) => this.tr(ru, en),
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

    private showVictoryScreen() {
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
