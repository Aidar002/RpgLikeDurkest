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
import { PlayerManager } from '../systems/PlayerManager';
import { EventLog } from '../ui/EventLog';
import { VFX } from '../ui/VFX';

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
    private log!: EventLog;

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
        this.meta = new MetaProgressionManager();
        const metaBonuses = this.meta.getBonuses();

        this.player = new PlayerManager(metaBonuses.player, {
            gold: this.meta.isUnlocked('currency_gold'),
            potions: this.meta.isUnlocked('resource_potions'),
            resolve: this.meta.isUnlocked('resource_resolve'),
            light: this.meta.isUnlocked('resource_light'),
            relicShards: this.meta.isUnlocked('currency_relic_shards'),
        });

        this.mapGen = new MapGenerator(this.getUnlockedRoomTypes(this.meta.getUnlockedContent()));

        this.visuals = new Map();
        this.glowMap = new Map();
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

        this.log = new EventLog(this, 18, 82, 410, 490);
        this.roomContainer.add(this.log.view);

        this.setupGlobalUI();

        this.combat = new CombatManager(
            this.player,
            this.log,
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

        VFX.vignette(this, 800, 600);
        VFX.scanlines(this, 800, 600);
        VFX.ambientEmbers(this, 22);

        this.log.addMessage('The expedition begins in silence.', '#999999');
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

        const hpLabel = this.add.text(12, 10, 'VITAL', {
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
            this.log.addMessage(`You rise to level ${level}.`, '#fff17a');
            VFX.floatText(this, 300, 20, `LVL ${level}`, '#fff17a');
            const flash = this.add.rectangle(400, 300, 800, 600, 0xfff17a, 0.08).setDepth(88);
            this.tweens.add({ targets: flash, alpha: 0, duration: 500, onComplete: () => flash.destroy() });
            this.refreshUI();
        };
        this.player.onRevive = (remaining) => {
            this.log.addMessage(`Last Stand keeps you alive. Revives left: ${remaining}.`, '#ffcb73');
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
        this.hpValueText.setText(`HP ${stats.hp}/${stats.maxHp}`);

        const xpRatio = Phaser.Math.Clamp(stats.xp / this.player.xpToNextLevel, 0, 1);
        this.xpBar.setDisplaySize(132 * xpRatio, 8);
        this.levelText.setText(`LVL ${stats.level}  XP ${stats.xp}/${this.player.xpToNextLevel}`);

        const statParts = [`A${this.player.getAttackPower()}`, `D${stats.defense}`];
        if (this.player.remainingRevives > 0) {
            statParts.push(`R${this.player.remainingRevives}`);
        }
        if (this.player.hasHighLight) {
            statParts.push('\u2600');
        } else if (this.player.hasLowLight) {
            statParts.push('\u263D');
        }
        this.statsText.setText(statParts.join(' '));

        const resourceParts: string[] = [];
        if (unlocks.showGold) {
            resourceParts.push(`G ${resources.gold}`);
        }
        if (unlocks.showPotions) {
            resourceParts.push(`P ${resources.potions}`);
        }
        if (unlocks.showResolve) {
            resourceParts.push(`R ${resources.resolve}/${resources.maxResolve}`);
        }
        if (unlocks.showLight) {
            resourceParts.push(`L ${resources.light}/${EXPEDITION_CONFIG.maxLight}`);
        }
        if (unlocks.showRelicShards) {
            resourceParts.push(`S ${resources.relicShards}`);
        }
        this.resourceText.setText(resourceParts.join('  '));

        const progressParts = [`D ${this.runBestDepth}`];
        if (unlocks.showKillCounter) {
            progressParts.push(`K ${this.player.killCount}`);
        }
        if (unlocks.showRunMetrics) {
            progressParts.push(`B ${this.runBossKills}`);
        }
        this.progressText.setText(progressParts.join('  '));

        const prestigeForecast = this.runBestDepth + this.runBossKills * 2;
        this.prestigeText.setText(unlocks.showPrestigeForecast ? `PRESTIGE +${prestigeForecast}` : '');
        this.mapDepthText.setText(`DEPTH ${this.dungeon.currentDepth}`);

        const nextUnlock = this.meta.getNextContentUnlock();
        this.hintText.setText(nextUnlock ? this.compactText(`Next: ${nextUnlock.requirement}`, 30) : '');

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
        button.label.setText(this.compactText(action.label, button.defaultWidth > 200 ? 34 : 16));
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
                .rectangle(x, y, NODE_SZ, NODE_SZ, color)
                .setStrokeStyle(2, stroke)
                .setAlpha(alpha);

            const icon = this.add
                .text(x, y, revealed && knowsType ? this.roomIcon(node.type) : '?', {
                    fontFamily: 'Courier New',
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
        });
        rect.on('pointerout', () => {
            const isCurrent = node.id === this.dungeon.currentNode.id;
            const isForward = this.dungeon.canMoveTo(node.id) && !node.cleared;
            rect.setStrokeStyle(2, isCurrent ? 0xffffff : isForward ? 0x6d6d6d : 0x333333);
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
                const laneX = x1 + ((x2 - x1) * (index + 1)) / (totalEdges + 1);

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
            this.log.addMessage(`Unlocked forever: ${milestone.label}.`, '#66b8ff');
            this.showUnlockBanner(milestone.label);
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
                const glow = VFX.nodeGlow(this, this.nodeX(node), this.nodeY(node), this.roomColor(node), NODE_SZ);
                this.mapContainer.add(glow);
                this.glowMap.set(id, glow);
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

    private enterRoom(node: MapNode) {
        this.lastEnemyHp = 0;

        if (this.player.isLightUnlocked) {
            if (this.skipLightSpendThisRoom) {
                this.skipLightSpendThisRoom = false;
            } else {
                const spent = this.player.spendLight(EXPEDITION_CONFIG.lightLossPerRoom);
                if (spent > 0) {
                    this.log.addMessage(`Your lantern burns lower: -${spent} light.`, '#e0c873');
                }
            }
        }

        this.log.addDivider(`Depth ${this.dungeon.currentDepth}`);

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
                this.showRoomCard('START', 'Camp', 'The entry is behind you. The only path now is deeper.', 0x555555, '@', 'Continue when you are ready.');
                this.showReturnButton();
                return;
        }
    }

    private startCombatEncounter(kind: 'normal' | 'elite' | 'boss') {
        const card = kind === 'boss'
            ? {
                  header: 'BOSS',
                  title: 'A ruler of this floor rises.',
                  description: 'Every system you earned is being tested at once.',
                  color: 0xa52f2f,
                  icon: 'B',
              }
            : kind === 'elite'
              ? {
                    header: 'ELITE',
                    title: 'A hardened threat bars the corridor.',
                    description: 'Winning here should feel costly and worth it.',
                    color: 0xa14a4a,
                    icon: 'E',
                }
              : {
                    header: 'HOSTILE',
                    title: 'Threat detected',
                    description: 'The corridor narrows. Something waits in the dark.',
                    color: 0x6b3030,
                    icon: 'X',
                };

        this.showRoomCard(card.header, card.title, card.description, card.color, card.icon, 'Choose your next move.');
        this.combat.startCombat(this.dungeon.currentDepth, kind);
        this.refreshCombatButtons();
    }

    private refreshCombatButtons() {
        if (!this.combat.enemy) {
            this.setRoomButtons([]);
            return;
        }

        const actions: RoomButtonAction[] = [
            {
                label: '[1] Attack',
                callback: () => this.performCombatAction('attack'),
                fill: 0x5a1d1d,
            },
            {
                label: '[2] Defend',
                callback: () => this.performCombatAction('defend'),
                fill: 0x1b335b,
            },
        ];

        if (this.meta.isUnlocked('action_skill')) {
            actions.push({
                label: '[3] Skill',
                callback: () => this.performCombatAction('skill'),
                enabled: this.player.resources.resolve >= COMBAT_CONFIG.skillCost,
                fill: 0x5a2d78,
            });
        }

        if (this.meta.isUnlocked('action_potion')) {
            actions.push({
                label: `[${actions.length + 1}] Potion`,
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

        this.combat.processTurn(action);
        if (this.combat.enemy) {
            this.refreshCombatButtons();
        }
    }

    private buildCombatIntel(): string {
        if (!this.combat.enemy) {
            return 'Collect yourself and continue deeper.';
        }

        const hints = ['Attack and defend are always available.'];

        if (this.meta.isUnlocked('action_skill')) {
            hints.push(`Skill costs ${COMBAT_CONFIG.skillCost} resolve.`);
        }
        if (this.meta.isUnlocked('action_potion')) {
            hints.push('Potions heal immediately, then the enemy acts.');
        }

        return hints.join(' ');
    }

    private resolveTreasureRoom() {
        const goldUnlocked = this.meta.isUnlocked('currency_gold');
        const xpGained = this.player.gainXp(ROOM_CONFIG.treasure.xpReward);

        let goldGained = 0;
        let potionGained = 0;
        if (goldUnlocked) {
            goldGained = this.player.gainGold(this.randomBetween(ROOM_CONFIG.treasure.goldMin, ROOM_CONFIG.treasure.goldMax));
            if (this.player.isPotionUnlocked && Math.random() < ROOM_CONFIG.treasure.potionChance) {
                potionGained = this.player.gainPotions(1);
            }
        }

        const rewardParts = [`+${xpGained} XP`];
        if (goldGained > 0) {
            rewardParts.push(`+${goldGained} gold`);
        }
        if (potionGained > 0) {
            rewardParts.push('+1 potion');
        }

        this.showRoomCard(
            'TREASURE',
            'Forgotten Cache',
            `A cracked chest still rewards careful hands. ${rewardParts.join(', ')}.`,
            0x8d6a21,
            '$',
            'Claim the spoils and move on.'
        );
        this.log.addMessage(`Treasure secured: ${rewardParts.join(', ')}.`, '#f7d46b');
        this.showReturnButton();
    }

    private showTrapOptions() {
        this.showRoomCard(
            'TRAP',
            'Mechanical Snare',
            'A pressure plate snaps awake under your boot.',
            0x75458a,
            '^',
            'Rush through or try to disarm it.'
        );

        this.setRoomButtons([
            {
                label: '[1] Rush',
                callback: () => {
                    const damage = this.applyTrapDamage(
                        this.randomBetween(ROOM_CONFIG.trap.rushDamageMin, ROOM_CONFIG.trap.rushDamageMax)
                    );
                    this.log.addMessage(`You rush the trap and suffer ${damage} damage.`, '#ff7777');
                    if (this.player.stats.hp > 0) {
                        this.showReturnButton();
                        this.enemyIntelText.setText('The worst is behind you.');
                    }
                },
                fill: 0x5a1d1d,
            },
            {
                label: '[2] Disarm',
                callback: () => {
                    if (Math.random() < ROOM_CONFIG.trap.disarmChance) {
                        const gold = this.player.gainGold(
                            this.randomBetween(ROOM_CONFIG.trap.disarmGoldMin, ROOM_CONFIG.trap.disarmGoldMax)
                        );
                        this.log.addMessage(`You disarm it cleanly and salvage ${gold} gold.`, '#f7d46b');
                        this.enemyIntelText.setText('The mechanism falls apart in your hands.');
                    } else {
                        const damage = this.applyTrapDamage(
                            this.randomBetween(
                                ROOM_CONFIG.trap.disarmFailDamageMin,
                                ROOM_CONFIG.trap.disarmFailDamageMax
                            )
                        );
                        this.log.addMessage(`The mechanism snaps shut for ${damage} damage.`, '#ff7777');
                        this.enemyIntelText.setText('The trap bites before you can pull away.');
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
        this.showRoomCard(
            'REST',
            'Campfire',
            'The coals are low, but still warm enough to matter.',
            0x2f8b4b,
            '+',
            'Recover your body or focus your mind.'
        );

        this.setRoomButtons([
            {
                label: '[1] Recover',
                callback: () => {
                    const healed = this.player.heal(ROOM_CONFIG.rest.recoverHeal + this.meta.getBonuses().rooms.restHealBonus);
                    const lightGained = this.player.gainLight(ROOM_CONFIG.rest.recoverLight);
                    const summary = [`${healed} HP`];
                    if (lightGained > 0) {
                        summary.push(`${lightGained} light`);
                    }
                    this.log.addMessage(`You rest and recover ${summary.join(', ')}.`, '#79e28f');
                    this.enemyIntelText.setText('The room feels less hostile for a moment.');
                    this.showReturnButton();
                },
                fill: 0x1f5b2f,
            },
            {
                label: '[2] Focus',
                callback: () => {
                    if (this.player.isResolveUnlocked) {
                        const gained = this.player.gainResolve(ROOM_CONFIG.rest.focusResolve);
                        this.log.addMessage(`You focus and gain ${gained} resolve.`, '#9bc8ff');
                    } else {
                        const gainedXp = this.player.gainXp(ROOM_CONFIG.rest.focusXp);
                        this.log.addMessage(`You study the quiet and gain ${gainedXp} XP.`, '#f7d46b');
                    }
                    this.enemyIntelText.setText('You leave steadier than you arrived.');
                    this.showReturnButton();
                },
                fill: 0x1b335b,
            },
        ]);
    }

    private showShrineOptions() {
        const actions: RoomButtonAction[] = [
            {
                label: '[1] Pray',
                callback: () => {
                    if (Math.random() < ROOM_CONFIG.shrine.prayBlessChance) {
                        this.player.addAttackBonus(ROOM_CONFIG.shrine.prayAttackBonus);
                        this.log.addMessage('The shrine answers: +1 attack for this run.', '#d7b6ff');
                    } else {
                        const damage = this.player.takeDamage(ROOM_CONFIG.shrine.prayDamage);
                        const resolve = this.player.gainResolve(ROOM_CONFIG.shrine.prayResolveGain);
                        this.log.addMessage(
                            `The shrine wounds you for ${damage}, but grants ${resolve} resolve.`,
                            '#c99cff'
                        );
                    }
                    if (this.player.stats.hp > 0) {
                        this.enemyIntelText.setText('The shrine remembers your name.');
                        this.showReturnButton();
                    }
                },
                fill: 0x5f4e8a,
            },
            {
                label: `[2] Offer ${ROOM_CONFIG.shrine.offerGoldCost}g`,
                callback: () => {
                    if (!this.player.spendGold(ROOM_CONFIG.shrine.offerGoldCost)) {
                        return;
                    }
                    this.player.addMaxHpBonus(ROOM_CONFIG.shrine.offerMaxHpBonus);
                    this.log.addMessage(
                        `You offer gold and gain +${ROOM_CONFIG.shrine.offerMaxHpBonus} max HP for this run.`,
                        '#ffd36e'
                    );
                    this.enemyIntelText.setText('The altar gives strength, not kindness.');
                    this.showReturnButton();
                },
                enabled: this.player.resources.gold >= ROOM_CONFIG.shrine.offerGoldCost,
                fill: 0x8a5d2d,
            },
        ];

        if (this.meta.isUnlocked('shrine_premium')) {
            actions.push({
                label: `[3] Rite ${ROOM_CONFIG.shrine.premiumShardCost}s`,
                callback: () => {
                    if (!this.player.spendRelicShard(ROOM_CONFIG.shrine.premiumShardCost)) {
                        return;
                    }
                    this.player.addMaxHpBonus(
                        ROOM_CONFIG.shrine.premiumMaxHpBonus,
                        ROOM_CONFIG.shrine.premiumMaxHpBonus
                    );
                    this.player.gainResolve(ROOM_CONFIG.shrine.premiumResolveBonus);
                    this.log.addMessage(
                        `The relic rite grants +${ROOM_CONFIG.shrine.premiumMaxHpBonus} max HP and +${ROOM_CONFIG.shrine.premiumResolveBonus} resolve.`,
                        '#ffd9f7'
                    );
                    this.enemyIntelText.setText('Old power bends around you for one more descent.');
                    this.showReturnButton();
                },
                enabled: this.player.resources.relicShards >= ROOM_CONFIG.shrine.premiumShardCost,
                fill: 0x7a3d6a,
            });
        }

        actions.push({
            label: `[${actions.length + 1}] Leave`,
            callback: () => this.showReturnButton(),
            fill: 0x202020,
        });

        this.showRoomCard(
            'SHRINE',
            'Forgotten Altar',
            'Something old still listens from beneath the stone.',
            0x5f4e8a,
            'S',
            'A prayer, an offering, or a careful retreat.'
        );
        this.setRoomButtons(actions);
    }

    private showMerchantOptions() {
        const actions: RoomButtonAction[] = [
            {
                label: `[1] Potion ${ROOM_CONFIG.merchant.potionCost}g`,
                callback: () => {
                    if (!this.player.spendGold(ROOM_CONFIG.merchant.potionCost)) {
                        return;
                    }
                    this.player.gainPotions(1);
                    this.log.addMessage('You buy a potion.', '#9be0a7');
                    this.enemyIntelText.setText('The merchant counts the coins and looks away.');
                    this.showReturnButton();
                },
                enabled: this.player.resources.gold >= ROOM_CONFIG.merchant.potionCost,
                fill: 0x1f5b2f,
            },
        ];

        if (this.player.isLightUnlocked) {
            actions.push({
                label: `[${actions.length + 1}] Lantern ${ROOM_CONFIG.merchant.lanternCost}g`,
                callback: () => {
                    if (!this.player.spendGold(ROOM_CONFIG.merchant.lanternCost)) {
                        return;
                    }
                    const gainedLight = this.player.gainLight(ROOM_CONFIG.merchant.lanternLightGain);
                    this.log.addMessage(`You refill your lantern: +${gainedLight} light.`, '#ffe08a');
                    this.enemyIntelText.setText('The oil smells cleaner than the dungeon air.');
                    this.showReturnButton();
                },
                enabled: this.player.resources.gold >= ROOM_CONFIG.merchant.lanternCost,
                fill: 0x8a5d2d,
            });
        }

        actions.push({
            label: `[${actions.length + 1}] Armor ${ROOM_CONFIG.merchant.armorCost}g`,
            callback: () => {
                if (!this.player.spendGold(ROOM_CONFIG.merchant.armorCost)) {
                    return;
                }
                this.player.addDefenseBonus(ROOM_CONFIG.merchant.armorDefenseGain);
                this.log.addMessage(`You reinforce your armor: +${ROOM_CONFIG.merchant.armorDefenseGain} defense.`, '#b8d3ff');
                this.enemyIntelText.setText('A fair trade, by dungeon standards.');
                this.showReturnButton();
            },
            enabled: this.player.resources.gold >= ROOM_CONFIG.merchant.armorCost,
            fill: 0x355070,
        });

        if (this.meta.isUnlocked('merchant_premium')) {
            actions.push({
                label: `[${actions.length + 1}] Relic ${ROOM_CONFIG.merchant.premiumShardCost}s`,
                callback: () => {
                    if (!this.player.spendRelicShard(ROOM_CONFIG.merchant.premiumShardCost)) {
                        return;
                    }
                    this.player.addAttackBonus(ROOM_CONFIG.merchant.premiumAttackBonus);
                    this.player.gainPotions(ROOM_CONFIG.merchant.premiumPotionBonus);
                    this.log.addMessage(
                        `Relic oil grants +${ROOM_CONFIG.merchant.premiumAttackBonus} attack and +${ROOM_CONFIG.merchant.premiumPotionBonus} potion.`,
                        '#ffd9f7'
                    );
                    this.enemyIntelText.setText('The merchant smiles only when relics change hands.');
                    this.showReturnButton();
                },
                enabled: this.player.resources.relicShards >= ROOM_CONFIG.merchant.premiumShardCost,
                fill: 0x6b4c96,
            });
        }

        actions.push({
            label: `[${actions.length + 1}] Leave`,
            callback: () => this.showReturnButton(),
            fill: 0x202020,
        });

        this.showRoomCard(
            'MERCHANT',
            'Shadow Trader',
            'A hooded figure has already decided what your fear is worth.',
            0x2e6c87,
            'M',
            'Spend carefully. This room lasts one choice.'
        );
        this.setRoomButtons(actions);
    }

    private showEmptyOptions() {
        this.showRoomCard(
            'EMPTY',
            'Dusty Chamber',
            'Stillness can hide a cache or steady a shaking hand.',
            0x444444,
            '.',
            'Search the room or keep your footing.'
        );

        this.setRoomButtons([
            {
                label: '[1] Scout',
                callback: () => {
                    const gains: string[] = [];
                    const lightGain = this.player.gainLight(ROOM_CONFIG.empty.scoutLightGain);
                    if (lightGain > 0) {
                        gains.push(`${lightGain} light`);
                    }

                    if (
                        this.player.isGoldUnlocked &&
                        Math.random() < ROOM_CONFIG.empty.scoutGoldChance
                    ) {
                        const gold = this.player.gainGold(
                            this.randomBetween(ROOM_CONFIG.empty.scoutGoldMin, ROOM_CONFIG.empty.scoutGoldMax)
                        );
                        gains.push(`${gold} gold`);
                    }

                    if (gains.length === 0) {
                        const xp = this.player.gainXp(1);
                        gains.push(`${xp} XP`);
                    }

                    this.log.addMessage(`Your search yields ${gains.join(', ')}.`, '#bbbbbb');
                    this.enemyIntelText.setText('You leave with a slightly clearer picture of the dark.');
                    this.showReturnButton();
                },
                fill: 0x3d3d3d,
            },
            {
                label: '[2] Steady',
                callback: () => {
                    if (this.player.isResolveUnlocked) {
                        const gained = this.player.gainResolve(ROOM_CONFIG.empty.steadyResolveGain);
                        this.log.addMessage(`You steady yourself and gain ${gained} resolve.`, '#9bc8ff');
                    } else {
                        const gainedXp = this.player.gainXp(1);
                        this.log.addMessage(`You study the silence and gain ${gainedXp} XP.`, '#bbbbbb');
                    }
                    this.enemyIntelText.setText('The room gives nothing, and that helps.');
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
        intel: string
    ) {
        this.roomHeaderText.setText(header);
        this.enemyPortrait.setFillStyle(color);
        this.enemyIconText.setText(icon);
        this.enemyNameText.setText(this.compactText(title, 28));
        this.roomFlavorText.setText(this.compactText(description, 72));
        this.enemyIntelText.setText(this.compactText(intel, 54));
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
                    label: '[Space] Return to map',
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
        const description = this.combat.enemy?.description ?? 'An unnamed threat emerges.';

        this.roomHeaderText.setText(
            this.combat.enemy?.kind === 'boss'
                ? 'BOSS'
                : this.combat.enemy?.kind === 'elite'
                  ? 'ELITE'
                  : 'HOSTILE'
        );
        this.enemyPortrait.setFillStyle(color);
        this.enemyIconText.setText(icon);
        this.enemyNameText.setText(this.compactText(name, 28));
        this.roomFlavorText.setText(this.compactText(description, 72));
        this.roomPanelGroup.setVisible(true);

        const ratio = Phaser.Math.Clamp(hp / maxHp, 0, 1);
        this.enemyHpBar.setDisplaySize(ratio * 220, 12);
        this.enemyHpBar.setFillStyle(ratio > 0.5 ? 0xc65a2e : ratio > 0.25 ? 0xcf9e16 : 0xc63d2d);
        this.enemyHpText.setText(`HP ${Math.max(0, hp)}/${maxHp}`);
        this.enemyHpBarBg.setVisible(unlocks.showEnemyHp);
        this.enemyHpBar.setVisible(unlocks.showEnemyHp);
        this.enemyHpText.setVisible(unlocks.showEnemyHp);
        this.enemyIntelText.setVisible(true);
        this.enemyIntelText.setText(
            unlocks.showEnemyHp
                ? this.compactText(this.buildCombatIntel(), 54)
                : 'Enemy info unlocks deeper down.'
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

        if (payload.kind === 'boss') {
            this.runBossKills += 1;
            const bossMilestones = this.meta.registerBossKill();
            this.handleMilestoneUnlocks(bossMilestones);
        }

        const gainedXp = this.player.gainXp(payload.rewards.xp);
        rewardLines.push(`+${gainedXp} XP`);

        const gainedGold = this.player.gainGold(payload.rewards.gold);
        if (gainedGold > 0) {
            rewardLines.push(`+${gainedGold} gold`);
        }

        const gainedPotions = this.player.gainPotions(payload.rewards.potions);
        if (gainedPotions > 0) {
            rewardLines.push(`+${gainedPotions} potion`);
        }

        if (payload.rewards.attackBonus > 0) {
            this.player.addAttackBonus(payload.rewards.attackBonus);
            rewardLines.push(`+${payload.rewards.attackBonus} attack`);
        }

        const gainedShards = this.player.gainRelicShards(payload.rewards.relicShards);
        if (gainedShards > 0) {
            rewardLines.push(`+${gainedShards} shard`);
        }

        this.player.registerKill();
        this.log.addMessage(`Victory rewards: ${rewardLines.join(', ')}.`, '#9be0a7');
        this.enemyIntelText.setText('The path forward is open again.');
        this.showReturnButton();
        this.refreshUI();
    }

    private onPlayerHit(damage: number) {
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

    private showDeathScreen() {
        this.mapContainer.setVisible(false);
        this.roomContainer.setVisible(false);
        this.uiContainer.setVisible(false);

        if (!this.prestigeAwarded) {
            this.prestigeReward = this.meta.awardPrestigeForRun(this.runBestDepth, this.runBossKills);
            this.prestigeAwarded = true;
        }

        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.92).setDepth(100);
        const panel = this.add.rectangle(400, 300, 736, 500, 0x121212).setDepth(101);
        panel.setStrokeStyle(2, 0x5a2f2f);

        const title = this.add.text(400, 78, 'THE EXPEDITION ENDS', {
            fontFamily: 'Courier New',
            fontSize: '34px',
            color: '#d65a5a',
        }).setOrigin(0.5).setDepth(102);

        const summary = this.add.text(
            400,
            122,
            `Best depth: ${this.runBestDepth}\nBosses defeated: ${this.runBossKills}\nPrestige earned: +${this.prestigeReward}`,
            {
                fontFamily: 'Courier New',
                fontSize: '16px',
                color: '#d7d7d7',
                align: 'center',
                lineSpacing: 8,
            }
        ).setOrigin(0.5).setDepth(102);

        const pointsText = this.add.text(400, 184, '', {
            fontFamily: 'Courier New',
            fontSize: '16px',
            color: '#ffd36e',
        }).setOrigin(0.5).setDepth(102);

        const unlockText = this.add.text(400, 208, '', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#8fb8ff',
            align: 'center',
            wordWrap: { width: 580 },
        }).setOrigin(0.5).setDepth(102);

        const cards: UpgradeCardVisual[] = [];
        const cardPositions = [
            { x: 230, y: 282 },
            { x: 570, y: 282 },
            { x: 230, y: 366 },
            { x: 570, y: 366 },
            { x: 230, y: 450 },
            { x: 570, y: 450 },
        ];

        this.meta.getUpgradeCards().forEach((card, index) => {
            const position = cardPositions[index];

            const background = this.add
                .rectangle(position.x, position.y, 300, 68, 0x1c1c1c)
                .setStrokeStyle(1, 0x4a4a4a)
                .setDepth(102)
                .setInteractive({ useHandCursor: true });

            const cardTitle = this.add.text(position.x - 136, position.y - 22, card.title, {
                fontFamily: 'Courier New',
                fontSize: '15px',
                color: '#f0f0f0',
            }).setDepth(103);

            const cardLevel = this.add.text(position.x + 136, position.y - 22, '', {
                fontFamily: 'Courier New',
                fontSize: '14px',
                color: '#a8a8a8',
            }).setOrigin(1, 0).setDepth(103);

            const cardBody = this.add.text(position.x - 136, position.y - 2, '', {
                fontFamily: 'Courier New',
                fontSize: '12px',
                color: '#9a9a9a',
                wordWrap: { width: 220 },
            }).setDepth(103);

            const cardCost = this.add.text(position.x + 136, position.y + 14, '', {
                fontFamily: 'Courier New',
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

        const restartButton = this.add.rectangle(400, 540, 260, 42, 0x2b2b2b).setDepth(102);
        restartButton.setStrokeStyle(1, 0x8a8a8a);
        restartButton.setInteractive({ useHandCursor: true });
        const restartText = this.add.text(400, 540, 'Begin New Expedition', {
            fontFamily: 'Courier New',
            fontSize: '17px',
            color: '#f0f0f0',
        }).setOrigin(0.5).setDepth(103);

        const resetButton = this.add.rectangle(400, 586, 260, 34, 0x3a1818).setDepth(102);
        resetButton.setStrokeStyle(1, 0xa35a5a);
        resetButton.setInteractive({ useHandCursor: true });
        const resetText = this.add.text(400, 586, 'Развеять опыт души', {
            fontFamily: 'Courier New',
            fontSize: '14px',
            color: '#ffd0d0',
        }).setOrigin(0.5).setDepth(103);

        restartButton.on('pointerover', () => restartButton.setStrokeStyle(2, 0xffffff));
        restartButton.on('pointerout', () => restartButton.setStrokeStyle(1, 0x8a8a8a));
        restartButton.on('pointerdown', () => this.scene.restart());

        resetButton.on('pointerover', () => resetButton.setStrokeStyle(2, 0xffd7d7));
        resetButton.on('pointerout', () => resetButton.setStrokeStyle(1, 0xa35a5a));

        const refreshShop = () => {
            pointsText.setText(`Prestige bank: ${this.meta.availablePrestige}`);

            const nextUnlock = this.meta.getNextContentUnlock();
            unlockText.setText(
                nextUnlock
                    ? `Next permanent discovery: ${nextUnlock.requirement} -> ${nextUnlock.label}.`
                    : 'Every planned layer of permanent content has been unlocked.'
            );

            const upgradeCards = this.meta.getUpgradeCards();
            cards.forEach((card) => {
                const info = upgradeCards.find((upgrade) => upgrade.id === card.id);
                if (!info) {
                    return;
                }

                card.level.setText(`Lv ${info.level}/${info.maxLevel}`);
                card.body.setText(info.description);
                card.cost.setText(info.cost === null ? 'MAX' : `Cost ${info.cost}`);
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
        const confirmTitle = this.add.text(400, 244, 'Сбросить весь прогресс?', {
            fontFamily: 'Courier New',
            fontSize: '22px',
            color: '#ffd2d2',
        }).setOrigin(0.5).setDepth(112);
        const confirmBody = this.add.text(
            400,
            290,
            'Вы точно хотите потерять все, чего добились?\nЭто полностью очистит престиж, открытия и улучшения.',
            {
                fontFamily: 'Courier New',
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
        const confirmResetText = this.add.text(320, 358, 'Да, удалить всё', {
            fontFamily: 'Courier New',
            fontSize: '14px',
            color: '#ffe8e8',
        }).setOrigin(0.5).setDepth(113);
        const cancelResetButton = this.add.rectangle(480, 358, 170, 38, 0x252525).setDepth(112);
        cancelResetButton.setStrokeStyle(1, 0x8a8a8a);
        cancelResetButton.setInteractive({ useHandCursor: true });
        const cancelResetText = this.add.text(480, 358, 'Отмена', {
            fontFamily: 'Courier New',
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
            this.scene.restart();
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
            fontFamily: 'Courier New',
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
