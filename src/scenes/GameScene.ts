import * as Phaser from 'phaser';
import { COMBAT_CONFIG, EXPEDITION_CONFIG, ROOM_CONFIG } from '../data/GameConfig';
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
    type UpgradeId,
} from '../systems/MetaProgressionManager';
import { Localization } from '../systems/Localization';
import {
    edgePath,
    MAP_LAYOUT,
    mapOffset,
    nodeX as layoutNodeX,
    nodeY as layoutNodeY,
} from '../systems/MapLayout';
import { NarrativeManager } from '../systems/NarrativeManager';
import { PlayerManager } from '../systems/PlayerManager';
import { RunTracker } from '../systems/RunTracker';
import { EventLog } from '../ui/EventLog';
import { VFX } from '../ui/VFX';

interface NodeVisual {
    rect: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Text;
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

interface UpgradeCardVisual {
    id: UpgradeId;
    background: Phaser.GameObjects.Rectangle;
    title: Phaser.GameObjects.Text;
    level: Phaser.GameObjects.Text;
    body: Phaser.GameObjects.Text;
    cost: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
    private meta!: MetaProgressionManager;
    private mapGen!: MapGenerator;
    private dungeon!: DungeonManager;
    private player!: PlayerManager;
    private combat!: CombatManager;
    private loc!: Localization;
    private narrative!: NarrativeManager;
    private log!: EventLog;
    private tracker!: RunTracker;

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

    private roomHeaderText!: Phaser.GameObjects.Text;
    private enemyPortrait!: Phaser.GameObjects.Rectangle;
    private enemyIconText!: Phaser.GameObjects.Text;
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

    create() {
        this.input.enabled = true;
        this.meta = new MetaProgressionManager();
        this.loc = new Localization();
        this.narrative = new NarrativeManager(this.loc);
        const metaBonuses = this.meta.getBonuses();

        this.player = new PlayerManager(metaBonuses.player, {
            gold: this.meta.isUnlocked('currency_gold'),
            potions: this.meta.isUnlocked('resource_potions'),
            resolve: this.meta.isUnlocked('resource_resolve'),
            light: this.meta.isUnlocked('resource_light'),
            relicShards: this.meta.isUnlocked('currency_relic_shards'),
        });

        this.mapGen = new MapGenerator(this.getUnlockedRoomTypes(this.meta.getUnlockedContent()));

        this.tracker = new RunTracker();
        this.visuals = new Map();
        this.glowMap = new Map();
        this.depthLabels = new Map();
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

        this.mapContainer = this.add.container(0, 0);
        this.roomContainer = this.add.container(0, 0);
        this.uiContainer = this.add.container(0, 0);
        this.roomContainer.setVisible(false);

        this.edgeGfx = this.add.graphics();
        this.mapContainer.add(this.edgeGfx);

        this.log = new EventLog(this, 18, 92, 430, 478, this.loc.t('eventLog'));
        this.roomContainer.add(this.log.view);

        this.setupGlobalUI();

        this.combat = new CombatManager(
            this.player,
            this.log,
            this.loc,
            (payload) => this.handleCombatVictory(payload),
            (damage) => this.onPlayerHit(damage)
        );
        this.combat.onEnemyUpdate = (hp, maxHp, color, name, icon) =>
            this.updateEnemyUI(hp, maxHp, color, name, icon);

        this.setupRoomUI();
        this.setupKeyboardShortcuts();
        this.buildAllVisuals(false);
        this.redrawEdges();
        this.refreshInteractivity();
        this.centerMapOnNode(this.dungeon.currentNode);
        this.refreshUI();

        this.tooltipText = this.add.text(0, 0, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '11px',
            color: '#d0d0d0',
            backgroundColor: '#1a1a1aee',
            padding: { x: 6, y: 3 },
        }).setDepth(220).setVisible(false);

        VFX.vignette(this, 800, 600);
        VFX.scanlines(this, 800, 600);
        VFX.ambientEmbers(this, 22);

        this.log.addMessage(this.loc.t('beginSilence'), '#999999');
        this.log.addMessage(this.loc.t('dungeonListens'), '#777777');
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
        const topBar = this.add.rectangle(0, 0, 800, 78, 0x0f1216).setOrigin(0);
        topBar.setStrokeStyle(1, 0x3f4a54);

        const hpLabel = this.add.text(12, 10, this.loc.t('uiVital'), {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '15px',
            color: '#e7eef6',
            stroke: '#020406',
            strokeThickness: 2,
        });

        const hpBarBg = this.add.rectangle(12, 36, 170, 14, 0x3c1111).setOrigin(0, 0.5);
        this.hpBar = this.add.rectangle(12, 36, 170, 14, 0xd93c3c).setOrigin(0, 0.5);
        this.hpValueText = this.add.text(192, 27, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '14px',
            color: '#ffb0aa',
            stroke: '#020406',
            strokeThickness: 2,
        });

        this.xpBarBg = this.add.rectangle(288, 36, 132, 8, 0x1d2430).setOrigin(0, 0.5);
        this.xpBar = this.add.rectangle(288, 36, 132, 8, 0x5b9cff).setOrigin(0, 0.5);
        this.levelText = this.add.text(288, 10, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '14px',
            color: '#ffe58a',
            stroke: '#020406',
            strokeThickness: 2,
        });

        this.statsText = this.add.text(548, 12, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '11px',
            color: '#e5edf5',
            stroke: '#020406',
            strokeThickness: 2,
        });

        this.resourceText = this.add.text(548, 35, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '11px',
            color: '#b9d7ff',
            stroke: '#020406',
            strokeThickness: 2,
        });

        this.progressText = this.add.text(548, 58, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '11px',
            color: '#aeb8c2',
            align: 'left',
            stroke: '#020406',
            strokeThickness: 2,
        }).setOrigin(0, 0);

        this.prestigeText = this.add.text(646, 58, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '10px',
            color: '#ffe09a',
            align: 'left',
            stroke: '#020406',
            strokeThickness: 2,
        }).setOrigin(0, 0);

        this.hintText = this.add.text(786, 36, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '11px',
            color: '#b6c0ca',
            align: 'right',
            wordWrap: { width: 180 },
            stroke: '#020406',
            strokeThickness: 2,
        }).setOrigin(1, 0);

        this.mapDepthText = this.add.text(40, 558, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '12px',
            color: '#8995a1',
            stroke: '#020406',
            strokeThickness: 2,
        }).setOrigin(0, 0.5);

        const langButton = this.add.rectangle(754, 50, 68, 24, 0x1f2933).setStrokeStyle(1, 0x6b7a88);
        langButton.setInteractive({ useHandCursor: true });
        const langText = this.add.text(754, 50, this.loc.language === 'ru' ? 'RU / EN' : 'EN / RU', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '11px',
            color: '#f1f7ff',
        }).setOrigin(0.5);
        langButton.on('pointerover', () => langButton.setStrokeStyle(2, 0xd8e6f3));
        langButton.on('pointerout', () => langButton.setStrokeStyle(1, 0x6b7a88));
        langButton.on('pointerdown', () => {
            this.loc.toggle();
            this.restartSceneSafely();
        });

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
            langButton,
            langText,
        ]);

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
        this.levelText.setText(`${this.loc.t('level')} ${stats.level}  ${this.loc.t('xp')} ${stats.xp}/${this.player.xpToNextLevel}`);

        const statParts = [`${this.loc.t('attackShort')} ${this.player.getAttackPower()}`, `${this.loc.t('defenseShort')} ${stats.defense}`];
        if (this.player.remainingRevives > 0) {
            statParts.push(`${this.loc.t('reviveShort')} ${this.player.remainingRevives}`);
        }
        if (this.player.hasHighLight) {
            statParts.push(this.loc.t('bright'));
        } else if (this.player.hasLowLight) {
            statParts.push(this.loc.t('dark'));
        }
        this.statsText.setText(statParts.join('  '));

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

        this.hintText.setText('');

        this.hpValueText.setVisible(unlocks.showHpNumbers);
        this.mapDepthText.setVisible(unlocks.showDepthReadout && this.mapContainer.visible);
        this.xpBarBg.setVisible(unlocks.showLevelPanel);
        this.xpBar.setVisible(unlocks.showLevelPanel);
        this.levelText.setVisible(unlocks.showLevelPanel);
        this.statsText.setVisible(unlocks.showPlayerStats);
        this.resourceText.setVisible(resourceParts.length > 0);
        this.progressText.setVisible(this.mapContainer.visible && (unlocks.showRunMetrics || unlocks.showKillCounter));
        this.prestigeText.setVisible(this.mapContainer.visible && unlocks.showPrestigeForecast);
        this.hintText.setVisible(false);
    }

    private setupRoomUI() {
        const panel = this.add.rectangle(462, 92, 320, 478, 0x11161c).setOrigin(0);
        panel.setStrokeStyle(2, 0x4d5a66);

        this.roomHeaderText = this.add.text(480, 106, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '13px',
            color: '#b7c7d9',
        }).setVisible(false);

        this.enemyPortrait = this.add.rectangle(622, 166, 82, 82, 0x333333).setStrokeStyle(2, 0x697480);
        this.enemyIconText = this.add.text(622, 174, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '36px',
            color: '#ffffff',
        }).setOrigin(0.5);

        this.enemyNameText = this.add.text(622, 218, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '15px',
            color: '#f0f0f0',
            align: 'center',
            wordWrap: { width: 252 },
        }).setOrigin(0.5, 0);

        this.enemyHpBarBg = this.add.rectangle(500, 274, 244, 12, 0x331111).setOrigin(0, 0.5);
        this.enemyHpBar = this.add.rectangle(500, 274, 244, 12, 0xc93d2f).setOrigin(0, 0.5);
        this.enemyHpText = this.add.text(622, 288, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '12px',
            color: '#ad6767',
        }).setOrigin(0.5);

        this.enemyIntelText = this.add.text(496, 310, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '11px',
            color: '#9ec2ff',
            align: 'left',
            wordWrap: { width: 252 },
            lineSpacing: 4,
            stroke: '#020406',
            strokeThickness: 2,
        }).setOrigin(0, 0);

        this.roomFlavorText = this.add.text(496, 386, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '11px',
            color: '#c8c8c8',
            align: 'left',
            wordWrap: { width: 252 },
            lineSpacing: 4,
            stroke: '#020406',
            strokeThickness: 2,
        }).setOrigin(0, 0);

        this.roomPanelGroup = this.add.container(0, 0, [
            panel,
            this.roomHeaderText,
            this.enemyPortrait,
            this.enemyIconText,
            this.enemyNameText,
            this.enemyHpBarBg,
            this.enemyHpBar,
            this.enemyHpText,
            this.enemyIntelText,
            this.roomFlavorText,
        ]);

        this.roomContainer.add(this.roomPanelGroup);

        const buttonSpecs = [
            { x: 542, y: 482, width: 148 },
            { x: 702, y: 482, width: 148 },
            { x: 542, y: 528, width: 148 },
            { x: 702, y: 528, width: 148 },
            { x: 622, y: 528, width: 300 },
        ];

        buttonSpecs.forEach((spec) => {
            const background = this.add
                .rectangle(spec.x, spec.y, spec.width, 40, 0x1b1b1b)
                .setStrokeStyle(1, 0x575757)
                .setInteractive({ useHandCursor: true });

            const label = this.add.text(spec.x, spec.y, '', {
                fontFamily: 'Lucida Console, Consolas, monospace',
                fontSize: '11px',
                color: '#dddddd',
                align: 'center',
                wordWrap: { width: spec.width - 12 },
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
                }
            });
            background.on('pointerout', () => {
                background.setStrokeStyle(1, actionButton.enabled ? 0x8a8a8a : 0x3e3e3e);
            });
            background.on('pointerdown', () => {
                if (actionButton.enabled && actionButton.callback) {
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
        button.label.setText(this.compactText(action.label, button.defaultWidth > 200 ? 34 : 22));
        button.label.setColor(enabled ? '#f0f0f0' : '#686868');
        button.label.setFontSize(button.label.text.length > 18 && button.defaultWidth <= 148 ? 10 : 11);
    }

    private nodeX(node: MapNode) {
        return layoutNodeX(node);
    }

    private nodeY(node: MapNode) {
        return layoutNodeY(node, this.getDepthSiblingCount(node.depth));
    }

    private getMapOffset(node: MapNode) {
        return mapOffset(node, this.getDepthSiblingCount(node.depth));
    }

    private getDepthSiblingCount(depth: number) {
        return this.dungeon.getAllNodes().filter((candidate) => candidate.depth === depth).length;
    }

    private centerMapOnNode(node: MapNode) {
        const { x, y } = this.getMapOffset(node);
        this.mapContainer.setPosition(x, y);
    }

    private roomColor(node: MapNode): number {
        switch (node.type) {
            case RoomType.START:
                return 0x777777;
            case RoomType.ENEMY:
                return 0x903535;
            case RoomType.TREASURE:
                return 0x9b7a22;
            case RoomType.TRAP:
                return 0x7f4b96;
            case RoomType.REST:
                return 0x2f8f52;
            case RoomType.SHRINE:
                return 0x5f4e8a;
            case RoomType.MERCHANT:
                return 0x2e6c87;
            case RoomType.ELITE:
                return 0xb14545;
            case RoomType.BOSS:
                return 0xc83b3b;
            case RoomType.EMPTY:
                return 0x454545;
        }
    }

    private roomIcon(type: RoomTypeValue): string {
        switch (type) {
            case RoomType.START:
                return '@';
            case RoomType.ENEMY:
                return 'X';
            case RoomType.TREASURE:
                return '$';
            case RoomType.TRAP:
                return '^';
            case RoomType.REST:
                return '+';
            case RoomType.SHRINE:
                return 'S';
            case RoomType.MERCHANT:
                return 'M';
            case RoomType.ELITE:
                return 'E';
            case RoomType.BOSS:
                return 'B';
            case RoomType.EMPTY:
                return '.';
        }
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
            const color = node.cleared ? 0x242424 : revealed ? this.roomColor(node) : 0x1a1a1a;
            const stroke = node.cleared
                ? 0x333333
                : node.id === currentId
                  ? 0xffffff
                  : forwardIds.has(node.id)
                    ? 0x6d6d6d
                    : 0x343434;
            const alpha = node.cleared ? 0.35 : 1;

            const rect = this.add
                .rectangle(x, y, MAP_LAYOUT.nodeSize, MAP_LAYOUT.nodeSize, color)
                .setStrokeStyle(2, stroke)
                .setAlpha(alpha);

            const icon = this.add
                .text(x, y, revealed && knowsType ? this.roomIcon(node.type) : '?', {
                    fontFamily: 'Lucida Console, Consolas, monospace',
                    fontSize: '18px',
                    color: node.cleared ? '#4d4d4d' : '#ffffff',
                })
                .setOrigin(0.5)
                .setAlpha(alpha);

            if (fadeIn && !node.cleared) {
                rect.setAlpha(0);
                icon.setAlpha(0);
                this.tweens.add({
                    targets: [rect, icon],
                    alpha: 1,
                    duration: 420,
                    ease: 'Quad.out',
                });
            }

            this.makeClickable(rect, node);

            this.mapContainer.add([rect, icon]);
            this.visuals.set(node.id, { rect, icon });
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
        const nodesAtDepth = this.dungeon.getAllNodes().filter((node) => node.depth === depth);
        const anchor = nodesAtDepth[0];
        if (!anchor) return;
        const x = this.nodeX(anchor);
        const y = Math.min(...nodesAtDepth.map((node) => this.nodeY(node))) - MAP_LAYOUT.nodeSize * 1.15;
        const isBoss = depth > 0 && depth % 8 === 0;
        const label = this.add.text(x, y, isBoss ? `D${depth} *` : `D${depth}`, {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '10px',
            color: isBoss ? '#c93d3d' : '#3d3d3d',
        }).setOrigin(0.5);
        this.mapContainer.add(label);
        this.depthLabels.set(depth, label);
    }

    private roomTypeName(type: RoomTypeValue): string {
        switch (type) {
            case RoomType.START: return this.loc.t('roomCamp');
            case RoomType.ENEMY: return this.loc.t('roomEnemy');
            case RoomType.TREASURE: return this.loc.t('roomTreasure');
            case RoomType.TRAP: return this.loc.t('roomTrap');
            case RoomType.REST: return this.loc.t('roomRest');
            case RoomType.SHRINE: return this.loc.t('roomShrine');
            case RoomType.MERCHANT: return this.loc.t('roomMerchant');
            case RoomType.ELITE: return this.loc.t('roomElite');
            case RoomType.BOSS: return this.loc.t('roomBoss');
            case RoomType.EMPTY: return this.loc.t('roomEmpty');
        }
    }

    private makeClickable(rect: Phaser.GameObjects.Rectangle, node: MapNode) {
        rect.setInteractive({ useHandCursor: true });
        rect.on('pointerdown', () => {
            if (this.canUseMapNode(node)) {
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
                this.tooltipText.setText(this.roomTypeName(node.type));
                const screenX = this.nodeX(node) + this.mapContainer.x;
                const screenY = this.nodeY(node) + this.mapContainer.y - MAP_LAYOUT.nodeSize / 2 - 18;
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
        const allNodes = this.dungeon.getAllNodes();
        const edgeGroups = new Map<number, Array<{ from: MapNode; to: MapNode }>>();

        allNodes.forEach((node) => {
            if (node.depth < currentDepth) {
                return;
            }

            node.edges.forEach((edgeId) => {
                const target = allNodes.find((candidate) => candidate.id === edgeId);
                if (!target) {
                    return;
                }

                if (!edgeGroups.has(node.depth)) {
                    edgeGroups.set(node.depth, []);
                }

                edgeGroups.get(node.depth)?.push({ from: node, to: target });
            });
        });

        edgeGroups.forEach((edges) => {
            edges.sort((left, right) =>
                left.from.slot !== right.from.slot
                    ? left.from.slot - right.from.slot
                    : left.to.slot - right.to.slot
            );

            const totalEdges = edges.length;
            edges.forEach((edge, index) => {
                const active =
                    !edge.from.cleared &&
                    forwardIds.has(edge.to.id) &&
                    edge.from.id === this.dungeon.currentNode.id;
                const lineColor = edge.from.cleared ? 0x323232 : active ? 0x8b8b8b : 0x474747;
                const lineAlpha = edge.from.cleared ? 0.2 : active ? 1 : 0.42;
                const lineWidth = active ? 3 : 2;

                const x1 = this.nodeX(edge.from);
                const y1 = this.nodeY(edge.from);
                const x2 = this.nodeX(edge.to);
                const y2 = this.nodeY(edge.to);
                const path = edgePath({ x: x1, y: y1 }, { x: x2, y: y2 }, index, totalEdges).points;
                this.edgeGfx.lineStyle(lineWidth, lineColor, lineAlpha);
                this.edgeGfx.beginPath();
                this.edgeGfx.moveTo(path[0].x, path[0].y);
                path.slice(1).forEach((point) => this.edgeGfx.lineTo(point.x, point.y));
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
            const label = this.loc.milestoneLabel(milestone.id, milestone.label);
            this.log.addMessage(this.loc.t('unlocked', { label }), '#66b8ff');
            this.showUnlockBanner(label);
            milestone.unlocks.forEach((unlockId) => {
                switch (unlockId) {
                    case 'currency_gold':
                        this.player.unlockGold();
                        break;
                    case 'resource_potions':
                        this.player.unlockPotions(EXPEDITION_CONFIG.startingPotions);
                        break;
                    case 'resource_resolve':
                        this.player.unlockResolve(EXPEDITION_CONFIG.startingResolve);
                        break;
                    case 'resource_light':
                        this.player.unlockLight(this.getStartingLight());
                        this.skipLightSpendThisRoom = true;
                        break;
                    case 'currency_relic_shards':
                        this.player.unlockRelicShards();
                        break;
                    default:
                        break;
                }
            });
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

            this.tweens.add({
                targets: [visual.rect, visual.icon],
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
                return;
            }

            const isCurrent = id === currentId;
            const isForward = forwardIds.has(id);
            const revealed = isCurrent || isForward || node.visited;
            const knowsType = node.visited || isCurrent || unlocks.showRoomIcons;
            const iconText = revealed && knowsType ? this.roomIcon(node.type) : '?';

            visual.rect.setFillStyle(revealed ? this.roomColor(node) : 0x1a1a1a).setAlpha(1);
            visual.rect.setStrokeStyle(2, isCurrent ? 0xffffff : isForward ? 0x6d6d6d : 0x333333);
            visual.icon.setText(iconText).setColor('#ffffff').setAlpha(1);

            if (isForward) {
                const glow = VFX.nodeGlow(this, this.nodeX(node), this.nodeY(node), this.roomColor(node), MAP_LAYOUT.nodeSize);
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

        if (this.player.isLightUnlocked) {
            if (this.skipLightSpendThisRoom) {
                this.skipLightSpendThisRoom = false;
            } else {
                const spent = this.player.spendLight(EXPEDITION_CONFIG.lightLossPerRoom);
                if (spent > 0) {
                    this.log.addMessage(this.loc.t('lightLower', { count: spent }), '#e0c873');
                    if (this.player.hasLowLight) {
                        this.log.addMessage(this.narrative.choiceLine('darkness'), '#8d83c9');
                    }
                }
            }
        }

        this.log.addDivider(`${this.loc.t('depth')} ${this.dungeon.currentDepth}`);
        const depthLine = this.narrative.enterDepth(this.dungeon.currentDepth, this.player.hasLowLight);
        if (depthLine) {
            this.log.addMessage(depthLine, '#8888aa');
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
                const card = this.narrative.roomCard(RoomType.START, this.dungeon.currentDepth);
                this.showRoomCard(this.loc.t('start'), card.title, card.description, 0x555555, '@', card.intel);
                this.showReturnButton();
                return;
        }
    }

    private startCombatEncounter(kind: 'normal' | 'elite' | 'boss') {
        const narrativeType =
            kind === 'boss' ? RoomType.BOSS : kind === 'elite' ? RoomType.ELITE : RoomType.ENEMY;
        const narrativeCard = this.narrative.roomCard(narrativeType, this.dungeon.currentDepth);
        const card = kind === 'boss'
            ? {
                  header: this.loc.t('boss'),
                  title: narrativeCard.title,
                  description: narrativeCard.description,
                  color: 0xa52f2f,
                  icon: 'B',
              }
            : kind === 'elite'
              ? {
                    header: this.loc.t('elite'),
                    title: narrativeCard.title,
                    description: narrativeCard.description,
                    color: 0xa14a4a,
                    icon: 'E',
                }
              : {
                    header: this.loc.t('hostile'),
                    title: narrativeCard.title,
                    description: narrativeCard.description,
                    color: 0x6b3030,
                    icon: 'X',
                };

        this.showRoomCard(card.header, card.title, card.description, card.color, card.icon, narrativeCard.intel);
        this.combat.startCombat(this.dungeon.currentDepth, kind);
        if (this.combat.enemy) {
            this.log.addMessage(this.narrative.combatIntro(kind, this.combat.enemy.name), '#a8a8a8');
        }
        this.refreshCombatButtons();
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

        if (this.meta.isUnlocked('action_skill')) {
            actions.push({
                label: this.loc.t('actionStagger'),
                callback: () => this.performCombatAction('skill'),
                enabled: this.player.resources.resolve >= COMBAT_CONFIG.skillCost,
                fill: 0x5a2d78,
            });
        }

        if (this.meta.isUnlocked('action_potion')) {
            actions.push({
                label: this.loc.t('actionPotion', { num: actions.length + 1 }),
                callback: () => this.performCombatAction('potion'),
                enabled: this.player.resources.potions > 0,
                fill: 0x1f5b2f,
            });
        }

        this.setRoomButtons(actions);
        this.enemyIntelText.setText(this.buildCombatIntel());
        this.enemyIntelText.setVisible(true);
    }

    private performCombatAction(action: CombatAction) {
        if (!this.combat.enemy) {
            return;
        }

        if (action === 'attack') {
            this.narrative.mark('violence');
        } else if (action === 'defend' || action === 'potion') {
            this.narrative.mark('caution');
        } else if (action === 'skill') {
            this.narrative.mark('craft');
        }

        this.actionButtons.forEach((b) => { b.enabled = false; });

        const hpBefore = this.combat.enemy.hp;
        this.tracker.record('turnsInCombat');
        if (action === 'skill') this.tracker.record('skillsUsed');
        if (action === 'defend') {
            this.tracker.record('defendsUsed');
            VFX.shieldFlash(this, 126, 82);
        }
        if (action === 'potion') {
            this.tracker.record('potionsUsed');
            VFX.healGlow(this, 126, 82);
        }

        this.combat.processTurn(action);

        if (this.combat.lastActionResult.critical) {
            this.tracker.record('criticalHits');
            VFX.critFlash(this);
        }

        const dmgDealt = hpBefore - (this.combat.enemy?.hp ?? 0);
        if (dmgDealt > 0) this.tracker.record('damageDealt', dmgDealt);

        this.time.delayedCall(350, () => {
            if (this.combat.enemy) {
                this.refreshCombatButtons();
            }
        });
    }

    private buildCombatIntel(): string {
        if (!this.combat.enemy) {
            return this.loc.t('collectSelf');
        }

        const hints: string[] = [];
        const intent = this.combat.currentIntentInfo;

        if (intent) {
            hints.push(this.loc.t('intentLine', { label: intent.label, detail: intent.detail }));
        }

        return hints.filter(Boolean).join(' ');
    }

    private resolveTreasureRoom() {
        const card = this.narrative.roomCard(RoomType.TREASURE, this.dungeon.currentDepth);
        this.showRoomCard(
            this.loc.t('treasure'),
            card.title,
            card.description,
            0x8d6a21,
            '$',
            card.intel
        );

        this.setRoomButtons([
            {
                label: this.loc.t('actionCareful'),
                callback: () => {
                    this.claimTreasure(1, false);
                },
                fill: 0x8a5d2d,
            },
            {
                label: this.loc.t('actionForce'),
                callback: () => {
                    this.claimTreasure(1.55, true);
                },
                fill: 0x5a1d1d,
            },
            {
                label: this.loc.t('actionLeave'),
                callback: () => {
                    const line = this.narrative.choiceLine('mercy');
                    const resolve = this.player.gainResolve(1);
                    const light = this.player.gainLight(1);
                    const parts: string[] = [];
                    if (resolve > 0) {
                        parts.push(`${resolve} ${this.loc.t('resolveShort')}`);
                    }
                    if (light > 0) {
                        parts.push(`${light} ${this.loc.t('lightShort')}`);
                    }
                    this.log.addMessage(
                        parts.length > 0
                            ? this.loc.t('treasureLeaveGain', { parts: parts.join(', ') })
                            : this.loc.t('treasureLeaveNoGain'),
                        '#9bc8ff'
                    );
                    this.enemyIntelText.setText(line);
                    this.showReturnButton();
                },
                fill: 0x202020,
            },
        ]);
    }

    private claimTreasure(multiplier: number, risky: boolean) {
        const narrativeLine = this.narrative.choiceLine(risky ? 'greed' : 'caution');
        const xpGained = this.player.gainXp(Math.round(ROOM_CONFIG.treasure.xpReward * multiplier));
        const goldGained = this.player.gainGold(
            this.randomBetween(
                Math.round(ROOM_CONFIG.treasure.goldMin * multiplier),
                Math.round(ROOM_CONFIG.treasure.goldMax * multiplier)
            )
        );
        const potionGained =
            this.player.isPotionUnlocked && Math.random() < ROOM_CONFIG.treasure.potionChance * multiplier
                ? this.player.gainPotions(1)
                : 0;

        const rewardParts = [this.loc.t('plusXp', { value: xpGained })];
        if (goldGained > 0) {
            rewardParts.push(this.loc.t('plusGold', { value: goldGained }));
            this.tracker.record('goldEarned', goldGained);
        }
        if (potionGained > 0) {
            rewardParts.push(this.loc.t('plusPotion'));
        }

        if (risky && Math.random() < 0.5) {
            this.tracker.record('trapsTriggered');
            const damage = this.applyTrapDamage(
                this.randomBetween(ROOM_CONFIG.trap.rushDamageMin, ROOM_CONFIG.trap.disarmFailDamageMax)
            );
            this.log.addMessage(this.loc.t('lockBites', { damage }), '#ff7777');
        }

        if (this.player.stats.hp > 0) {
            this.log.addMessage(this.loc.t('treasureSecured', { parts: rewardParts.join(', ') }), '#f7d46b');
            this.enemyIntelText.setText(narrativeLine);
            this.showReturnButton();
        }
    }

    private showTrapOptions() {
        const card = this.narrative.roomCard(RoomType.TRAP, this.dungeon.currentDepth);
        this.showRoomCard(
            this.loc.t('trap'),
            card.title,
            card.description,
            0x75458a,
            '^',
            card.intel
        );

        this.setRoomButtons([
            {
                label: this.loc.t('actionRush'),
                callback: () => {
                    const line = this.narrative.choiceLine('violence');
                    this.tracker.record('trapsTriggered');
                    const damage = this.applyTrapDamage(
                        this.randomBetween(ROOM_CONFIG.trap.rushDamageMin, ROOM_CONFIG.trap.rushDamageMax)
                    );
                    this.log.addMessage(this.loc.t('trapRush', { damage }), '#ff7777');
                    if (this.player.stats.hp > 0) {
                        this.showReturnButton();
                        this.enemyIntelText.setText(line);
                    }
                },
                fill: 0x5a1d1d,
            },
            {
                label: this.loc.t('actionDisarm'),
                callback: () => {
                    const line = this.narrative.choiceLine('caution');
                    if (Math.random() < ROOM_CONFIG.trap.disarmChance) {
                        const gold = this.player.gainGold(
                            this.randomBetween(ROOM_CONFIG.trap.disarmGoldMin, ROOM_CONFIG.trap.disarmGoldMax)
                        );
                        if (gold > 0) this.tracker.record('goldEarned', gold);
                        this.log.addMessage(this.loc.t('trapDisarm', { gold }), '#f7d46b');
                        this.enemyIntelText.setText(line);
                    } else {
                        this.tracker.record('trapsTriggered');
                        const damage = this.applyTrapDamage(
                            this.randomBetween(
                                ROOM_CONFIG.trap.disarmFailDamageMin,
                                ROOM_CONFIG.trap.disarmFailDamageMax
                            )
                        );
                        this.log.addMessage(this.loc.t('trapSnap', { damage }), '#ff7777');
                        this.enemyIntelText.setText(this.loc.t('trapSnapIntel'));
                    }

                    if (this.player.stats.hp > 0) {
                        this.showReturnButton();
                    }
                },
                fill: 0x5a2d78,
            },
            {
                label: this.loc.t('actionProbe'),
                callback: () => {
                    if (!this.player.spendResolve(1)) {
                        return;
                    }

                    const line = this.narrative.choiceLine('craft');
                    const gold = this.player.gainGold(
                        this.randomBetween(ROOM_CONFIG.trap.disarmGoldMin, ROOM_CONFIG.trap.disarmGoldMax)
                    );
                    if (gold > 0) this.tracker.record('goldEarned', gold);
                    const light = this.player.gainLight(1);
                    const parts = [`${gold} ${this.loc.t('goldShort')}`];
                    if (light > 0) {
                        parts.push(`${light} ${this.loc.t('lightShort')}`);
                    }
                    this.log.addMessage(this.loc.t('trapProbe', { parts: parts.join(', ') }), '#9bc8ff');
                    this.enemyIntelText.setText(line);
                    this.showReturnButton();
                },
                enabled: this.player.resources.resolve > 0,
                fill: 0x1b335b,
            },
        ]);
    }

    private showRestOptions() {
        const card = this.narrative.roomCard(RoomType.REST, this.dungeon.currentDepth);
        this.showRoomCard(
            this.loc.t('rest'),
            card.title,
            card.description,
            0x2f8b4b,
            '+',
            card.intel
        );

        this.setRoomButtons([
            {
                label: this.loc.t('actionRecover'),
                callback: () => {
                    const line = this.narrative.choiceLine('caution');
                    const healed = this.player.heal(ROOM_CONFIG.rest.recoverHeal + this.meta.getBonuses().rooms.restHealBonus);
                    if (healed > 0) this.tracker.record('healingDone', healed);
                    const lightGained = this.player.gainLight(ROOM_CONFIG.rest.recoverLight);
                    const summary = [`${healed} ${this.loc.t('hp')}`];
                    if (lightGained > 0) {
                        summary.push(`${lightGained} ${this.loc.t('lightShort')}`);
                    }
                    this.log.addMessage(this.loc.t('restRecover', { parts: summary.join(', ') }), '#79e28f');
                    this.enemyIntelText.setText(line);
                    this.showReturnButton();
                },
                fill: 0x1f5b2f,
            },
            {
                label: this.loc.t('actionFocus'),
                callback: () => {
                    const line = this.narrative.choiceLine('craft');
                    if (this.player.isResolveUnlocked) {
                        const gained = this.player.gainResolve(ROOM_CONFIG.rest.focusResolve);
                        this.log.addMessage(this.loc.t('focusResolve', { value: gained }), '#9bc8ff');
                    } else {
                        const gainedXp = this.player.gainXp(ROOM_CONFIG.rest.focusXp);
                        this.log.addMessage(this.loc.t('focusXp', { value: gainedXp }), '#f7d46b');
                    }
                    this.enemyIntelText.setText(line);
                    this.showReturnButton();
                },
                fill: 0x1b335b,
            },
        ]);
    }

    private showShrineOptions() {
        this.tracker.record('shrinesVisited');
        const actions: RoomButtonAction[] = [
            {
                label: this.loc.t('actionPray'),
                callback: () => {
                    const line = this.narrative.choiceLine('faith');
                    if (Math.random() < ROOM_CONFIG.shrine.prayBlessChance) {
                        this.player.addAttackBonus(ROOM_CONFIG.shrine.prayAttackBonus);
                        this.log.addMessage(this.loc.t('shrineAttack'), '#d7b6ff');
                    } else {
                        const damage = this.player.takeDamage(ROOM_CONFIG.shrine.prayDamage);
                        const resolve = this.player.gainResolve(ROOM_CONFIG.shrine.prayResolveGain);
                        this.log.addMessage(
                            this.loc.t('shrineWound', { damage, resolve }),
                            '#c99cff'
                        );
                    }
                    if (this.player.stats.hp > 0) {
                        this.enemyIntelText.setText(line);
                        this.showReturnButton();
                    }
                },
                fill: 0x5f4e8a,
            },
            {
                label: this.loc.t('actionOffer', { cost: ROOM_CONFIG.shrine.offerGoldCost }),
                callback: () => {
                    if (!this.player.spendGold(ROOM_CONFIG.shrine.offerGoldCost)) {
                        return;
                    }
                    const line = this.narrative.choiceLine('faith');
                    this.tracker.record('goldSpent', ROOM_CONFIG.shrine.offerGoldCost);
                    this.player.addMaxHpBonus(ROOM_CONFIG.shrine.offerMaxHpBonus);
                    this.log.addMessage(
                        this.loc.t('shrineOffer', { value: ROOM_CONFIG.shrine.offerMaxHpBonus }),
                        '#ffd36e'
                    );
                    this.enemyIntelText.setText(line);
                    this.showReturnButton();
                },
                enabled: this.player.resources.gold >= ROOM_CONFIG.shrine.offerGoldCost,
                fill: 0x8a5d2d,
            },
        ];

        if (this.meta.isUnlocked('shrine_premium')) {
            actions.push({
                label: this.loc.t('actionRite', { cost: ROOM_CONFIG.shrine.premiumShardCost }),
                callback: () => {
                    if (!this.player.spendRelicShard(ROOM_CONFIG.shrine.premiumShardCost)) {
                        return;
                    }
                    const line = this.narrative.choiceLine('faith');
                    this.player.addMaxHpBonus(
                        ROOM_CONFIG.shrine.premiumMaxHpBonus,
                        ROOM_CONFIG.shrine.premiumMaxHpBonus
                    );
                    this.player.gainResolve(ROOM_CONFIG.shrine.premiumResolveBonus);
                    this.log.addMessage(
                        this.loc.t('shrineRite', {
                            hp: ROOM_CONFIG.shrine.premiumMaxHpBonus,
                            resolve: ROOM_CONFIG.shrine.premiumResolveBonus,
                        }),
                        '#ffd9f7'
                    );
                    this.enemyIntelText.setText(line);
                    this.showReturnButton();
                },
                enabled: this.player.resources.relicShards >= ROOM_CONFIG.shrine.premiumShardCost,
                fill: 0x7a3d6a,
            });
        }

        actions.push({
            label: this.loc.t('actionDynamicLeave', { num: actions.length + 1 }),
            callback: () => {
                this.enemyIntelText.setText(this.narrative.choiceLine('caution'));
                this.showReturnButton();
            },
            fill: 0x202020,
        });

        const card = this.narrative.roomCard(RoomType.SHRINE, this.dungeon.currentDepth);
        this.showRoomCard(
            this.loc.t('shrine'),
            card.title,
            card.description,
            0x5f4e8a,
            'S',
            card.intel
        );
        this.setRoomButtons(actions);
    }

    private showMerchantOptions() {
        this.tracker.record('merchantsVisited');
        const actions: RoomButtonAction[] = [
            {
                label: this.loc.t('actionBuyPotion', { cost: ROOM_CONFIG.merchant.potionCost }),
                callback: () => {
                    if (!this.player.spendGold(ROOM_CONFIG.merchant.potionCost)) {
                        return;
                    }
                    const line = this.narrative.choiceLine('commerce');
                    this.tracker.record('goldSpent', ROOM_CONFIG.merchant.potionCost);
                    this.player.gainPotions(1);
                    this.log.addMessage(this.loc.t('buyPotion'), '#9be0a7');
                    this.enemyIntelText.setText(line);
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
                    const line = this.narrative.choiceLine('commerce');
                    this.tracker.record('goldSpent', ROOM_CONFIG.merchant.lanternCost);
                    const gainedLight = this.player.gainLight(ROOM_CONFIG.merchant.lanternLightGain);
                    this.log.addMessage(this.loc.t('buyLantern', { value: gainedLight }), '#ffe08a');
                    this.enemyIntelText.setText(line);
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
                const line = this.narrative.choiceLine('commerce');
                this.tracker.record('goldSpent', ROOM_CONFIG.merchant.armorCost);
                this.player.addDefenseBonus(ROOM_CONFIG.merchant.armorDefenseGain);
                this.log.addMessage(this.loc.t('buyArmor', { value: ROOM_CONFIG.merchant.armorDefenseGain }), '#b8d3ff');
                this.enemyIntelText.setText(line);
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
                    const line = this.narrative.choiceLine('commerce');
                    this.player.addAttackBonus(ROOM_CONFIG.merchant.premiumAttackBonus);
                    this.player.gainPotions(ROOM_CONFIG.merchant.premiumPotionBonus);
                    this.log.addMessage(
                        this.loc.t('buyRelic', {
                            attack: ROOM_CONFIG.merchant.premiumAttackBonus,
                            potions: ROOM_CONFIG.merchant.premiumPotionBonus,
                        }),
                        '#ffd9f7'
                    );
                    this.enemyIntelText.setText(line);
                    this.showReturnButton();
                },
                enabled: this.player.resources.relicShards >= ROOM_CONFIG.merchant.premiumShardCost,
                fill: 0x6b4c96,
            });
        }

        actions.push({
            label: this.loc.t('actionDynamicLeave', { num: actions.length + 1 }),
            callback: () => {
                this.enemyIntelText.setText(this.narrative.choiceLine('caution'));
                this.showReturnButton();
            },
            fill: 0x202020,
        });

        const card = this.narrative.roomCard(RoomType.MERCHANT, this.dungeon.currentDepth);
        this.showRoomCard(
            this.loc.t('merchant'),
            card.title,
            card.description,
            0x2e6c87,
            'M',
            card.intel
        );
        this.setRoomButtons(actions);
    }

    private showEmptyOptions() {
        const card = this.narrative.roomCard(RoomType.EMPTY, this.dungeon.currentDepth);
        this.showRoomCard(
            this.loc.t('empty'),
            card.title,
            card.description,
            0x444444,
            '.',
            card.intel
        );

        this.setRoomButtons([
            {
                label: this.loc.t('actionScout'),
                callback: () => {
                    const line = this.narrative.choiceLine('caution');
                    const gains: string[] = [];
                    const lightGain = this.player.gainLight(ROOM_CONFIG.empty.scoutLightGain);
                    if (lightGain > 0) {
                        gains.push(`${lightGain} ${this.loc.t('lightShort')}`);
                    }

                    if (
                        this.player.isGoldUnlocked &&
                        Math.random() < ROOM_CONFIG.empty.scoutGoldChance
                    ) {
                        const gold = this.player.gainGold(
                            this.randomBetween(ROOM_CONFIG.empty.scoutGoldMin, ROOM_CONFIG.empty.scoutGoldMax)
                        );
                        gains.push(`${gold} ${this.loc.t('goldShort')}`);
                        if (gold > 0) this.tracker.record('goldEarned', gold);
                    }

                    if (gains.length === 0) {
                        const xp = this.player.gainXp(1);
                        gains.push(this.loc.t('plusXp', { value: xp }));
                    }

                    this.log.addMessage(this.loc.t('emptyScout', { parts: gains.join(', ') }), '#bbbbbb');
                    this.enemyIntelText.setText(line);
                    this.showReturnButton();
                },
                fill: 0x3d3d3d,
            },
            {
                label: this.loc.t('actionSteady'),
                callback: () => {
                    const line = this.narrative.choiceLine('craft');
                    if (this.player.isResolveUnlocked) {
                        const gained = this.player.gainResolve(ROOM_CONFIG.empty.steadyResolveGain);
                        this.log.addMessage(this.loc.t('emptySteady', { value: gained }), '#9bc8ff');
                    } else {
                        const gainedXp = this.player.gainXp(1);
                        this.log.addMessage(this.loc.t('emptyStudy', { value: gainedXp }), '#bbbbbb');
                    }
                    this.enemyIntelText.setText(line);
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
        _header: string,
        title: string,
        description: string,
        color: number,
        icon: string,
        intel: string
    ) {
        this.roomHeaderText.setText('').setVisible(false);
        this.enemyPortrait.setFillStyle(color);
        this.enemyIconText.setText(icon);
        this.enemyNameText.setText(this.compactText(title, 28));
        this.roomFlavorText.setPosition(496, 282);
        this.enemyIntelText.setPosition(496, 360);
        this.roomFlavorText.setText(this.compactText(description, 96));
        this.enemyIntelText.setText(this.compactText(intel, 92));
        this.enemyIntelText.setVisible(true);
        this.enemyHpBarBg.setVisible(false);
        this.enemyHpBar.setVisible(false);
        this.enemyHpText.setVisible(false);
        this.roomPanelGroup.setVisible(true);
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

        this.roomHeaderText.setText('').setVisible(false);
        this.enemyPortrait.setFillStyle(color);
        this.enemyIconText.setText(icon);
        this.enemyNameText.setText(this.compactText(name, 28));
        this.enemyIntelText.setPosition(496, 310);
        this.roomFlavorText.setPosition(496, 386);
        this.roomFlavorText.setText(this.compactText(description, 72));
        this.roomPanelGroup.setVisible(true);

        const ratio = Phaser.Math.Clamp(hp / maxHp, 0, 1);
        this.enemyHpBar.setDisplaySize(ratio * 244, 12);
        this.enemyHpBar.setFillStyle(ratio > 0.5 ? 0xc65a2e : ratio > 0.25 ? 0xcf9e16 : 0xc63d2d);
        this.enemyHpText.setText(`${this.loc.t('hp')} ${Math.max(0, hp)}/${maxHp}`);
        this.enemyHpBarBg.setVisible(unlocks.showEnemyHp);
        this.enemyHpBar.setVisible(unlocks.showEnemyHp);
        this.enemyHpText.setVisible(unlocks.showEnemyHp);
        this.enemyIntelText.setVisible(true);
        this.enemyIntelText.setText(
            unlocks.showEnemyHp
                ? this.compactText(this.buildCombatIntel(), 120)
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
            rewardLines.push(gainedPotions === 1 ? this.loc.t('plusPotion') : `+${gainedPotions} ${this.loc.t('potionShort')}`);
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
        this.log.addMessage(this.narrative.victoryLine(payload.enemyName), '#a8a8a8');
        this.log.addMessage(this.loc.t('victoryRewards', { parts: rewardLines.join(', ') }), '#9be0a7');
        this.enemyIntelText.setText(this.loc.t('pathOpen'));
        this.showReturnButton();
        this.refreshUI();
    }

    private onPlayerHit(damage: number) {
        this.tracker.record('damageTaken', damage);
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
    }

    private restartSceneSafely() {
        this.input.enabled = false;
        this.tweens.killAll();
        this.time.delayedCall(0, () => {
            this.scene.restart();
        });
    }

    private showDeathScreen() {
        this.mapContainer.setVisible(false);
        this.roomContainer.setVisible(false);
        this.uiContainer.setVisible(false);

        if (!this.prestigeAwarded) {
            this.prestigeReward = this.meta.awardPrestigeForRun(this.runBestDepth, this.runBossKills);
            this.prestigeAwarded = true;
        }

        this.tracker.trackMax('bestDepth', this.runBestDepth);
        this.tracker.trackMax('levelReached', this.player.stats.level);

        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.92).setDepth(100);
        const panel = this.add.rectangle(400, 300, 736, 530, 0x121212).setDepth(101);
        panel.setStrokeStyle(2, 0x5a2f2f);

        const title = this.add.text(400, 56, this.loc.t('deathTitle'), {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '28px',
            color: '#d65a5a',
        }).setOrigin(0.5).setDepth(102);

        const summaryLines = [
            this.loc.t('deathRunLine', {
                depth: this.runBestDepth,
                bosses: this.runBossKills,
                prestige: this.prestigeReward,
            }),
        ];
        const statLines = this.tracker.getSummaryLines(this.loc.language);
        const summary = this.add.text(
            400,
            88,
            `${this.loc.t('deathSummary', {
                depth: this.runBestDepth,
                bosses: this.runBossKills,
                prestige: this.prestigeReward,
                line: this.narrative.deathLine(),
            })}\n${this.tracker.getRunTitle(this.loc.language)}\n${summaryLines.join('\n')}\n${statLines.join('\n')}`,
            {
                fontFamily: 'Lucida Console, Consolas, monospace',
                fontSize: '11px',
                color: '#9a9a9a',
                align: 'center',
                lineSpacing: 3,
                wordWrap: { width: 660 },
            }
        ).setOrigin(0.5, 0).setDepth(102);

        const pointsText = this.add.text(400, 228, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '16px',
            color: '#ffd36e',
        }).setOrigin(0.5).setDepth(102);

        const unlockText = this.add.text(400, 250, '', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '11px',
            color: '#8fb8ff',
            align: 'center',
            wordWrap: { width: 580 },
        }).setOrigin(0.5).setDepth(102);

        const cards: UpgradeCardVisual[] = [];
        const cardPositions = [
            { x: 230, y: 304 },
            { x: 570, y: 304 },
            { x: 230, y: 382 },
            { x: 570, y: 382 },
            { x: 230, y: 460 },
            { x: 570, y: 460 },
        ];

        this.meta.getUpgradeCards().forEach((card, index) => {
            const position = cardPositions[index];

            const background = this.add
                .rectangle(position.x, position.y, 300, 68, 0x1c1c1c)
                .setStrokeStyle(1, 0x4a4a4a)
                .setDepth(102)
                .setInteractive({ useHandCursor: true });

            const cardTitle = this.add.text(position.x - 136, position.y - 22, this.loc.upgradeTitle(card.id, card.title), {
                fontFamily: 'Lucida Console, Consolas, monospace',
                fontSize: '15px',
                color: '#f0f0f0',
            }).setDepth(103);

            const cardLevel = this.add.text(position.x + 136, position.y - 22, '', {
                fontFamily: 'Lucida Console, Consolas, monospace',
                fontSize: '14px',
                color: '#a8a8a8',
            }).setOrigin(1, 0).setDepth(103);

            const cardBody = this.add.text(position.x - 136, position.y - 2, '', {
                fontFamily: 'Lucida Console, Consolas, monospace',
                fontSize: '12px',
                color: '#9a9a9a',
                wordWrap: { width: 220 },
            }).setDepth(103);

            const cardCost = this.add.text(position.x + 136, position.y + 14, '', {
                fontFamily: 'Lucida Console, Consolas, monospace',
                fontSize: '13px',
                color: '#ffd36e',
            }).setOrigin(1, 0).setDepth(103);

            const visual: UpgradeCardVisual = {
                id: card.id,
                background,
                title: cardTitle,
                level: cardLevel,
                body: cardBody,
                cost: cardCost,
            };

            background.on('pointerover', () => {
                if ((background as unknown as { canPurchase?: boolean }).canPurchase) {
                    background.setStrokeStyle(2, 0xffffff);
                }
            });
            background.on('pointerout', () => {
                const canPurchase = (background as unknown as { canPurchase?: boolean }).canPurchase;
                background.setStrokeStyle(1, canPurchase ? 0x8a8a8a : 0x4a4a4a);
            });
            background.on('pointerdown', () => {
                const info = this.meta.getUpgradeCards().find((upgrade) => upgrade.id === visual.id);
                if (!info?.canPurchase) {
                    return;
                }

                if (this.meta.purchaseUpgrade(visual.id)) {
                    refreshShop();
                }
            });

            cards.push(visual);
        });

        const restartButton = this.add.rectangle(400, 548, 260, 42, 0x2b2b2b).setDepth(102);
        restartButton.setStrokeStyle(1, 0x8a8a8a);
        restartButton.setInteractive({ useHandCursor: true });
        const restartText = this.add.text(400, 548, this.loc.t('restart'), {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '17px',
            color: '#f0f0f0',
        }).setOrigin(0.5).setDepth(103);

        const resetButton = this.add.rectangle(400, 592, 260, 34, 0x3a1818).setDepth(102);
        resetButton.setStrokeStyle(1, 0xa35a5a);
        resetButton.setInteractive({ useHandCursor: true });
        const resetText = this.add.text(400, 592, this.loc.t('reset'), {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '14px',
            color: '#ffd0d0',
        }).setOrigin(0.5).setDepth(103);

        restartButton.on('pointerover', () => restartButton.setStrokeStyle(2, 0xffffff));
        restartButton.on('pointerout', () => restartButton.setStrokeStyle(1, 0x8a8a8a));
        restartButton.on('pointerdown', () => this.restartSceneSafely());

        resetButton.on('pointerover', () => resetButton.setStrokeStyle(2, 0xffd7d7));
        resetButton.on('pointerout', () => resetButton.setStrokeStyle(1, 0xa35a5a));

        const refreshShop = () => {
            pointsText.setText(this.loc.t('prestigeBank', { value: this.meta.availablePrestige }));

            const nextUnlock = this.meta.getNextContentUnlock();
            unlockText.setText(
                nextUnlock
                    ? this.loc.t('nextDiscovery', {
                          requirement: this.loc.milestoneRequirement(nextUnlock.id, nextUnlock.requirement),
                          label: this.loc.milestoneLabel(nextUnlock.id, nextUnlock.label),
                      })
                    : this.loc.t('allDiscovered')
            );

            const upgradeCards = this.meta.getUpgradeCards();
            cards.forEach((card) => {
                const info = upgradeCards.find((upgrade) => upgrade.id === card.id);
                if (!info) {
                    return;
                }

                card.level.setText(this.loc.t('levelCard', { level: info.level, max: info.maxLevel }));
                card.body.setText(this.loc.upgradeDescription(info.id, info.description, info.level + 1));
                card.cost.setText(info.cost === null ? this.loc.t('max') : this.loc.t('cost', { cost: info.cost }));
                card.background.setFillStyle(info.canPurchase ? 0x242424 : 0x1c1c1c);
                card.background.setStrokeStyle(1, info.canPurchase ? 0x8a8a8a : 0x4a4a4a);
                (card.background as unknown as { canPurchase?: boolean }).canPurchase = info.canPurchase;
                card.cost.setColor(info.cost === null ? '#6acb7f' : info.canPurchase ? '#ffd36e' : '#6f6f6f');
                card.title.setColor(info.canPurchase ? '#f0f0f0' : '#a7a7a7');
                card.body.setColor(info.canPurchase ? '#9a9a9a' : '#727272');
            });
        };

        const confirmOverlay = this.add
            .rectangle(400, 300, 800, 600, 0x000000, 0.76)
            .setDepth(110)
            .setInteractive();
        const confirmPanel = this.add.rectangle(400, 300, 430, 190, 0x181818).setDepth(111);
        confirmPanel.setStrokeStyle(2, 0x8a4d4d);
        const confirmTitle = this.add.text(400, 244, this.loc.t('confirmResetTitle'), {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '22px',
            color: '#ffd2d2',
        }).setOrigin(0.5).setDepth(112);
        const confirmBody = this.add.text(
            400,
            290,
            this.loc.t('confirmResetBody'),
            {
                fontFamily: 'Lucida Console, Consolas, monospace',
                fontSize: '14px',
                color: '#d6d6d6',
                align: 'center',
                lineSpacing: 8,
                wordWrap: { width: 360 },
            }
        ).setOrigin(0.5).setDepth(112);
        const confirmResetButton = this.add.rectangle(320, 358, 170, 38, 0x5a1d1d).setDepth(112);
        confirmResetButton.setStrokeStyle(1, 0xc57d7d);
        confirmResetButton.setInteractive({ useHandCursor: true });
        const confirmResetText = this.add.text(320, 358, this.loc.t('confirmResetYes'), {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '14px',
            color: '#ffe8e8',
        }).setOrigin(0.5).setDepth(113);
        const cancelResetButton = this.add.rectangle(480, 358, 170, 38, 0x252525).setDepth(112);
        cancelResetButton.setStrokeStyle(1, 0x8a8a8a);
        cancelResetButton.setInteractive({ useHandCursor: true });
        const cancelResetText = this.add.text(480, 358, this.loc.t('cancel'), {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '14px',
            color: '#f0f0f0',
        }).setOrigin(0.5).setDepth(113);

        const confirmWidgets = [
            confirmOverlay,
            confirmPanel,
            confirmTitle,
            confirmBody,
            confirmResetButton,
            confirmResetText,
            cancelResetButton,
            cancelResetText,
        ];
        confirmWidgets.forEach((widget) => widget.setVisible(false));

        const setConfirmVisible = (visible: boolean) => {
            confirmWidgets.forEach((widget) => widget.setVisible(visible));
        };

        resetButton.on('pointerdown', () => setConfirmVisible(true));
        cancelResetButton.on('pointerdown', () => setConfirmVisible(false));
        confirmOverlay.on('pointerdown', () => setConfirmVisible(false));
        confirmResetButton.on('pointerdown', () => {
            this.meta.resetProgress();
            this.restartSceneSafely();
        });

        refreshShop();

        this.tweens.add({
            targets: [
                overlay,
                panel,
                title,
                summary,
                pointsText,
                unlockText,
                restartButton,
                restartText,
                resetButton,
                resetText,
            ],
            alpha: { from: 0, to: 1 },
            duration: 280,
            ease: 'Quad.out',
        });
    }

    private showUnlockBanner(label: string) {
        const bannerBg = this.add.rectangle(400, 580, 700, 36, 0x0a1a33, 0.92)
            .setStrokeStyle(1, 0x4488cc)
            .setDepth(200)
            .setAlpha(0);
        const bannerText = this.add.text(400, 580, `\u2726  ${this.compactText(label, 52)}`, {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '14px',
            color: '#88ccff',
        }).setOrigin(0.5).setDepth(201).setAlpha(0);

        this.tweens.add({
            targets: [bannerBg, bannerText],
            alpha: 1,
            duration: 300,
            ease: 'Quad.out',
            hold: 2400,
            yoyo: true,
            onComplete: () => { bannerBg.destroy(); bannerText.destroy(); },
        });
    }

    private getStartingLight(): number {
        return Math.min(
            EXPEDITION_CONFIG.maxLight,
            EXPEDITION_CONFIG.startingLight + this.meta.getBonuses().player.startingLightBonus
        );
    }

    private randomBetween(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    private compactText(text: string, maxLength: number): string {
        const clean = text.replace(/\s+/g, ' ').trim();
        if (clean.length <= maxLength) {
            return clean;
        }

        return `${clean.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
    }
}
