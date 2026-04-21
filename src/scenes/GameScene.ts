import * as Phaser from 'phaser';
import { MapGenerator, RoomType } from '../systems/MapGenerator';
import type { MapNode } from '../systems/MapGenerator';
import { DungeonManager } from '../systems/DungeonManager';
import { PlayerManager } from '../systems/PlayerManager';
import { CombatManager } from '../systems/CombatManager';
import { EventLog } from '../ui/EventLog';

export class GameScene extends Phaser.Scene {
    private mapGenerator!: MapGenerator;
    private dungeonManager!: DungeonManager;
    private playerManager!: PlayerManager;
    private combatManager!: CombatManager;
    private eventLog!: EventLog;
    private nodes: MapNode[] = [];
    
    // UI Elements
    private mapContainer!: Phaser.GameObjects.Container;
    private roomContainer!: Phaser.GameObjects.Container;
    private uiContainer!: Phaser.GameObjects.Container;
    private graphics!: Phaser.GameObjects.Graphics;
    
    // Player UI
    private hpText!: Phaser.GameObjects.Text;
    private levelText!: Phaser.GameObjects.Text;
    
    // Config
    private gridPx = 60;
    private nodeSize = 40;
    
    constructor() {
        super('GameScene');
    }

    create() {
        this.playerManager = new PlayerManager();
        this.mapGenerator = new MapGenerator();
        this.generateMap();
        
        this.dungeonManager = new DungeonManager(this.nodes, '0,0', (node) => {
            this.enterRoom(node);
        });

        // Containers
        this.mapContainer = this.add.container(400, 300);
        this.roomContainer = this.add.container(0, 0);
        this.uiContainer = this.add.container(0, 0);
        
        this.roomContainer.setVisible(false);

        // Global UI (Stats)
        this.setupGlobalUI();

        // Event Log
        this.eventLog = new EventLog(this, 10, 50, 400, 540); // Adjusted for global UI
        this.roomContainer.add(this.eventLog['container']); 
        
        // Combat Manager
        this.combatManager = new CombatManager(this.playerManager, this.eventLog, () => {
            this.showReturnButton();
        });

        // Setup Room UI
        this.setupRoomUI();

        // Start
        this.drawMap();
    }
    
    private setupGlobalUI() {
        const bg = this.add.rectangle(0, 0, 800, 40, 0x222222).setOrigin(0);
        this.uiContainer.add(bg);
        
        this.hpText = this.add.text(10, 10, '', { fontSize: '18px', color: '#ff5555' });
        this.levelText = this.add.text(600, 10, '', { fontSize: '18px', color: '#ffffaa' });
        
        this.uiContainer.add([this.hpText, this.levelText]);
        
        this.playerManager.onHpChange = () => this.updateGlobalUI();
        this.playerManager.onLevelUp = () => {
            this.eventLog.addMessage('*** УРОВЕНЬ ПОВЫШЕН! ***', '#ffff55');
            this.updateGlobalUI();
        };
        this.playerManager.onDeath = () => {
            this.eventLog.addMessage('*** ВЫ МЕРТВЫ ***', '#ff0000');
            this.time.delayedCall(2000, () => {
                this.scene.restart(); // Simple restart for now
            });
        };
        
        this.updateGlobalUI();
    }
    
    private updateGlobalUI() {
        const stats = this.playerManager.stats;
        this.hpText.setText(`HP: ${stats.hp} / ${stats.maxHp}`);
        this.levelText.setText(`Ур: ${stats.level} | XP: ${stats.xp}/${stats.level * 10} | АТК: ${stats.attack}`);
    }

    private setupRoomUI() {
        // Combat actions are only visible during combat, but we can keep them in the container
        const attackBtn = this.add.rectangle(500, 400, 100, 40, 0x550000).setInteractive({ useHandCursor: true });
        const attackTxt = this.add.text(500, 400, 'Атака', { fontSize: '18px' }).setOrigin(0.5);
        attackBtn.setName('attackBtn');
        attackTxt.setName('attackTxt');
        
        attackBtn.on('pointerdown', () => {
            if (this.combatManager.enemy) this.combatManager.processTurn('attack');
        });

        const defendBtn = this.add.rectangle(650, 400, 100, 40, 0x000055).setInteractive({ useHandCursor: true });
        const defendTxt = this.add.text(650, 400, 'Защита', { fontSize: '18px' }).setOrigin(0.5);
        defendBtn.setName('defendBtn');
        defendTxt.setName('defendTxt');
        
        defendBtn.on('pointerdown', () => {
            if (this.combatManager.enemy) this.combatManager.processTurn('defend');
        });

        this.roomContainer.add([attackBtn, attackTxt, defendBtn, defendTxt]);
    }

    private generateMap() {
        this.nodes = this.mapGenerator.generateGraph(15);
    }
    
    private drawMap() {
        this.mapContainer.removeAll(true);
        this.graphics = this.add.graphics();
        this.mapContainer.add(this.graphics);
        
        let minX = 0, minY = 0, maxX = 0, maxY = 0;
        this.nodes.forEach(n => {
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.x > maxX) maxX = n.x;
            if (n.y > maxY) maxY = n.y;
        });
        
        const offsetX = -((minX + maxX) / 2) * this.gridPx;
        const offsetY = -((minY + maxY) / 2) * this.gridPx;
        
        this.graphics.lineStyle(4, 0x555555);
        this.nodes.forEach(node => {
            node.edges.forEach(edgeId => {
                const target = this.nodes.find(n => n.id === edgeId);
                if (target) {
                    this.graphics.beginPath();
                    this.graphics.moveTo(offsetX + node.x * this.gridPx, offsetY + node.y * this.gridPx);
                    this.graphics.lineTo(offsetX + target.x * this.gridPx, offsetY + target.y * this.gridPx);
                    this.graphics.strokePath();
                }
            });
        });

        this.nodes.forEach(node => {
            const nx = offsetX + node.x * this.gridPx;
            const ny = offsetY + node.y * this.gridPx;
            
            const isCurrent = this.dungeonManager.currentNode.id === node.id;
            const isConnected = this.dungeonManager.getConnectedNodes().some(n => n.id === node.id);
            const isVisited = node.visited;
            
            let color = 0x444444;
            if (isVisited || isConnected || isCurrent) {
                switch(node.type) {
                    case RoomType.START: color = 0xaaaaaa; break;
                    case RoomType.ENEMY: color = 0xaa3333; break;
                    case RoomType.TREASURE: color = 0xaaaa33; break;
                    case RoomType.TRAP: color = 0xaa33aa; break;
                    case RoomType.REST: color = 0x33aa33; break;
                    case RoomType.BOSS: color = 0xff0000; break;
                    case RoomType.EMPTY: color = 0x666666; break;
                }
            } else {
                color = 0x222222;
            }

            const rect = this.add.rectangle(nx, ny, this.nodeSize, this.nodeSize, color);
            rect.setStrokeStyle(2, isCurrent ? 0xffffff : 0x000000);
            
            if (isConnected) {
                rect.setInteractive({ useHandCursor: true });
                rect.on('pointerdown', () => {
                    this.dungeonManager.moveTo(node.id);
                    this.drawMap();
                });
                rect.on('pointerover', () => rect.setStrokeStyle(2, 0xaaaaaa));
                rect.on('pointerout', () => rect.setStrokeStyle(2, 0x000000));
            }
            
            this.mapContainer.add(rect);

            if (isVisited || isConnected || isCurrent) {
                let iconStr = '';
                switch(node.type) {
                    case RoomType.START: iconStr = 'S'; break;
                    case RoomType.ENEMY: iconStr = 'E'; break;
                    case RoomType.TREASURE: iconStr = 'T'; break;
                    case RoomType.TRAP: iconStr = '!'; break;
                    case RoomType.REST: iconStr = 'R'; break;
                    case RoomType.BOSS: iconStr = 'B'; break;
                }
                const text = this.add.text(nx, ny, iconStr, { fontSize: '20px', color: '#ffffff' }).setOrigin(0.5);
                this.mapContainer.add(text);
            }
        });
    }

    private enterRoom(node: MapNode) {
        this.mapContainer.setVisible(false);
        this.roomContainer.setVisible(true);
        
        this.eventLog.addMessage(`\n--- Вы вошли в новую комнату ---`, '#ffffff');

        // Hide return button if exists
        const oldReturn = this.roomContainer.getByName('returnBtn');
        if (oldReturn) oldReturn.destroy();
        const oldReturnTxt = this.roomContainer.getByName('returnTxt');
        if (oldReturnTxt) oldReturnTxt.destroy();
        
        // Hide/Show Combat buttons
        const isCombat = node.type === RoomType.ENEMY || node.type === RoomType.BOSS;
        this.setCombatButtonsVisible(isCombat);

        if (isCombat) {
            this.combatManager.startCombat(
                node.type === RoomType.BOSS ? 'Босс: Древний Ужас' : 'Скелет-страж', 
                node.type === RoomType.BOSS ? 30 : 10,
                node.type === RoomType.BOSS ? 5 : 2
            );
        } else if (node.type === RoomType.TREASURE) {
            this.eventLog.addMessage(`Вы нашли сундук! Золото и опыт получены.`, '#ffff55');
            this.playerManager.gainXp(10);
            this.showReturnButton();
        } else if (node.type === RoomType.TRAP) {
            this.eventLog.addMessage(`Ловушка! Вы получаете 3 урона.`, '#ff0000');
            this.playerManager.takeDamage(3);
            this.showReturnButton();
        } else if (node.type === RoomType.REST) {
            this.eventLog.addMessage(`Костер. Вы отдыхаете и восстанавливаете 10 HP.`, '#55ff55');
            this.playerManager.heal(10);
            this.showReturnButton();
        } else {
            this.eventLog.addMessage(`Пустая темная комната...`, '#aaaaaa');
            this.showReturnButton();
        }
    }
    
    private setCombatButtonsVisible(visible: boolean) {
        this.roomContainer.getByName('attackBtn')?.setVisible(visible);
        this.roomContainer.getByName('attackTxt')?.setVisible(visible);
        this.roomContainer.getByName('defendBtn')?.setVisible(visible);
        this.roomContainer.getByName('defendTxt')?.setVisible(visible);
    }

    private showReturnButton() {
        this.setCombatButtonsVisible(false); // Hide combat buttons
        
        const returnBtn = this.add.rectangle(575, 500, 200, 40, 0x333333).setInteractive({ useHandCursor: true });
        returnBtn.setName('returnBtn');
        const returnTxt = this.add.text(575, 500, 'Вернуться на карту', { fontSize: '18px' }).setOrigin(0.5);
        returnTxt.setName('returnTxt');
        
        returnBtn.on('pointerdown', () => {
            this.roomContainer.setVisible(false);
            this.mapContainer.setVisible(true);
        });

        this.roomContainer.add([returnBtn, returnTxt]);
    }
}
