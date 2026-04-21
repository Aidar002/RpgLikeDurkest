import * as Phaser from 'phaser';
import { MapGenerator, RoomType } from '../systems/MapGenerator';
import type { MapNode } from '../systems/MapGenerator';
import { DungeonManager } from '../systems/DungeonManager';
import { PlayerManager } from '../systems/PlayerManager';
import { CombatManager } from '../systems/CombatManager';
import { EventLog } from '../ui/EventLog';

// ── Layout constants ──────────────────────────────────────────────────────────
const COL_W   = 150;  // px between depth columns
const ROW_H   = 110;  // px between slots in same column
const NODE_SZ = 44;   // node square size
const MAP_X   = 280;  // x-coordinate of the current depth column on screen
const MAP_Y   = 300;  // vertical center of map

interface NodeVisual {
    rect: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
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
    private animating = false;

    private hpBar!: Phaser.GameObjects.Rectangle;
    private hpBarBg!: Phaser.GameObjects.Rectangle;
    private hpText!: Phaser.GameObjects.Text;
    private levelText!: Phaser.GameObjects.Text;

    constructor() { super('GameScene'); }

    // ────────────────────────────────────────────────────────────────────────
    create() {
        this.visuals  = new Map();
        this.animating = false;

        this.player = new PlayerManager();
        this.mapGen = new MapGenerator();

        const nodes = this.mapGen.generateInitialMap(4);

        this.dungeon = new DungeonManager(
            nodes,
            (node, prev) => this.afterMove(node, prev),
            (fromDepth) => this.appendLayer(fromDepth)
        );

        // Containers
        this.mapContainer  = this.add.container(0, 0);
        this.roomContainer = this.add.container(0, 0);
        this.uiContainer   = this.add.container(0, 0);
        this.roomContainer.setVisible(false);

        this.edgeGfx = this.add.graphics();
        this.mapContainer.add(this.edgeGfx);

        this.setupGlobalUI();
        this.log = new EventLog(this, 10, 50, 400, 540);
        this.roomContainer.add((this.log as any)['container']);

        this.combat = new CombatManager(this.player, this.log, () => this.showReturnBtn());
        this.setupRoomUI();

        this.buildAllVisuals(false);
        this.redrawEdges();
    }

    // ── Coordinate helpers ───────────────────────────────────────────────────
    private nodeX(node: MapNode): number {
        return MAP_X + (node.depth - this.dungeon.currentDepth) * COL_W;
    }

    private nodeY(node: MapNode): number {
        const siblings = this.dungeon.getAllNodes().filter(n => n.depth === node.depth);
        const idx = siblings.findIndex(n => n.id === node.id);
        return MAP_Y + (idx - (siblings.length - 1) / 2) * ROW_H;
    }

    private roomColor(node: MapNode): number {
        switch (node.type) {
            case RoomType.START:    return 0x888888;
            case RoomType.ENEMY:   return 0x882222;
            case RoomType.TREASURE:return 0x887722;
            case RoomType.TRAP:    return 0x882288;
            case RoomType.REST:    return 0x228822;
            case RoomType.BOSS:    return 0xcc1111;
            case RoomType.EMPTY:   return 0x444444;
        }
    }

    private roomIcon(type: RoomType): string {
        switch (type) {
            case RoomType.START:    return 'S';
            case RoomType.ENEMY:   return '💀';
            case RoomType.TREASURE:return '💰';
            case RoomType.TRAP:    return '⚡';
            case RoomType.REST:    return '🔥';
            case RoomType.BOSS:    return '👁';
            case RoomType.EMPTY:   return '·';
        }
    }

    // ── Visual creation ──────────────────────────────────────────────────────
    private buildAllVisuals(fadeIn: boolean) {
        const cur   = this.dungeon.currentNode.id;
        const fwdIds = new Set(this.dungeon.getForwardNodes().map(n => n.id));

        this.dungeon.getAllNodes().forEach(node => {
            if (node.cleared) return;
            if (this.visuals.has(node.id)) return; // already exists

            const x = this.nodeX(node);
            const y = this.nodeY(node);
            const revealed = node.visited || fwdIds.has(node.id) || node.id === cur;

            const color = revealed ? this.roomColor(node) : 0x1a1a1a;
            const stroke = node.id === cur ? 0xffffff : fwdIds.has(node.id) ? 0x666666 : 0x333333;
            const iconStr = revealed ? this.roomIcon(node.type) : '?';

            const rect = this.add.rectangle(x, y, NODE_SZ, NODE_SZ, color);
            rect.setStrokeStyle(2, stroke);

            const icon = this.add.text(x, y, iconStr, {
                fontFamily: 'Courier New', fontSize: '18px', color: '#ffffff'
            }).setOrigin(0.5);

            if (fadeIn) {
                rect.setAlpha(0); icon.setAlpha(0);
                this.tweens.add({ targets: [rect, icon], alpha: 1, duration: 450, ease: 'Quad.out' });
            }

            if (fwdIds.has(node.id)) this.makeClickable(rect, node);

            this.mapContainer.add([rect, icon]);
            this.visuals.set(node.id, { rect, icon });
        });
    }

    private makeClickable(rect: Phaser.GameObjects.Rectangle, node: MapNode) {
        rect.setInteractive({ useHandCursor: true });
        rect.on('pointerdown', () => {
            if (!this.animating) this.dungeon.moveTo(node.id);
        });
        rect.on('pointerover', () => rect.setStrokeStyle(3, 0xffffff));
        rect.on('pointerout',  () => rect.setStrokeStyle(2, 0x666666));
    }

    // ── Edge drawing ─────────────────────────────────────────────────────────
    private redrawEdges() {
        this.edgeGfx.clear();
        const cur   = this.dungeon.currentDepth;
        const fwdIds = new Set(this.dungeon.getForwardNodes().map(n => n.id));

        this.dungeon.getAllNodes().forEach(node => {
            if (node.cleared || node.depth < cur) return;
            node.edges.forEach(eid => {
                const target = this.dungeon.getAllNodes().find(n => n.id === eid);
                if (!target) return;

                const x1 = this.nodeX(node),  y1 = this.nodeY(node);
                const x2 = this.nodeX(target), y2 = this.nodeY(target);

                const isActive = fwdIds.has(target.id) && node.id === this.dungeon.currentNode.id;
                const alpha = isActive ? 1.0 : 0.4;
                const clr   = isActive ? 0x888888 : 0x444444;

                this.edgeGfx.lineStyle(isActive ? 3 : 2, clr, alpha);
                this.edgeGfx.beginPath();
                this.edgeGfx.moveTo(x1, y1);
                this.edgeGfx.lineTo(x2, y2);
                this.edgeGfx.strokePath();
            });
        });
    }

    // ── Move pipeline ────────────────────────────────────────────────────────
    private afterMove(node: MapNode, _prev: MapNode) {
        this.animating = true;

        // Step 1: animate cleared nodes fading out
        this.animateClearedOut(() => {
            // Step 2: slide remaining nodes left
            this.animateShift(() => {
                // Step 3: spawn new nodes (already added by appendLayer)
                this.buildAllVisuals(true);
                this.redrawEdges();
                this.refreshInteractivity();
                this.animating = false;
                // Step 4: enter room
                this.enterRoom(node);
            });
        });
    }

    private animateClearedOut(done: () => void) {
        const clearedIds = this.dungeon.getAllNodes()
            .filter(n => n.cleared)
            .map(n => n.id)
            .filter(id => this.visuals.has(id));

        if (!clearedIds.length) { done(); return; }

        let remaining = clearedIds.length;
        clearedIds.forEach(id => {
            const v = this.visuals.get(id)!;
            this.tweens.add({
                targets: [v.rect, v.icon],
                alpha: 0, scaleX: 0.2, scaleY: 0.2,
                duration: 320, ease: 'Quad.in',
                onComplete: () => {
                    v.rect.destroy(); v.icon.destroy();
                    this.visuals.delete(id);
                    if (--remaining === 0) done();
                }
            });
        });
    }

    private animateShift(done: () => void) {
        const targets: { obj: Phaser.GameObjects.GameObject, x: number, y: number }[] = [];

        this.visuals.forEach((vis, id) => {
            const node = this.dungeon.getAllNodes().find(n => n.id === id);
            if (!node) return;
            targets.push({ obj: vis.rect, x: this.nodeX(node), y: this.nodeY(node) });
            targets.push({ obj: vis.icon, x: this.nodeX(node), y: this.nodeY(node) });
        });

        if (!targets.length) { done(); return; }

        let remaining = targets.length;
        targets.forEach(({ obj, x, y }) => {
            this.tweens.add({
                targets: obj, x, y,
                duration: 380, ease: 'Quad.inOut',
                onComplete: () => { if (--remaining === 0) done(); }
            });
        });
    }

    private refreshInteractivity() {
        const cur    = this.dungeon.currentNode.id;
        const fwdIds = new Set(this.dungeon.getForwardNodes().map(n => n.id));

        this.visuals.forEach((vis, id) => {
            const node = this.dungeon.getAllNodes().find(n => n.id === id);
            if (!node) return;

            vis.rect.removeInteractive();
            vis.rect.removeAllListeners();

            const isCur = id === cur;
            const isFwd = fwdIds.has(id);
            const revealed = isCur || isFwd || node.visited;

            vis.rect.setFillStyle(revealed ? this.roomColor(node) : 0x1a1a1a);
            vis.rect.setStrokeStyle(2, isCur ? 0xffffff : isFwd ? 0x666666 : 0x333333);
            vis.icon.setText(revealed ? this.roomIcon(node.type) : '?');

            if (isFwd) this.makeClickable(vis.rect, node);
        });
    }

    private appendLayer(fromDepth: number) {
        const newNodes = this.mapGen.generateNextLayer(this.dungeon.getAllNodes(), fromDepth);
        this.dungeon.addNodes(newNodes);
        // visuals will be built in buildAllVisuals(true) after shift
    }

    // ── Room / Event view ────────────────────────────────────────────────────
    private enterRoom(node: MapNode) {
        this.mapContainer.setVisible(false);
        this.roomContainer.setVisible(true);
        this.log.addMessage(`\n--- Вы вошли в новую комнату ---`, '#ffffff');

        // clean old return btn
        ['returnBtn','returnTxt'].forEach(name => {
            const obj = this.roomContainer.getByName(name);
            if (obj) (obj as Phaser.GameObjects.GameObject).destroy();
        });

        const isCombat = node.type === RoomType.ENEMY || node.type === RoomType.BOSS;
        this.setCombatBtns(isCombat);

        if (isCombat) {
            const name = node.type === RoomType.BOSS ? 'Босс: Древний Ужас' : 'Скелет-страж';
            const hp   = node.type === RoomType.BOSS ? 30 : 10;
            const atk  = node.type === RoomType.BOSS ? 5  : 2;
            this.combat.startCombat(name, hp, atk);
        } else if (node.type === RoomType.TREASURE) {
            this.log.addMessage(`Вы нашли сундук! Опыт получен.`, '#ffff55');
            this.player.gainXp(10);
            this.showReturnBtn();
        } else if (node.type === RoomType.TRAP) {
            this.log.addMessage(`Ловушка! Вы получаете 3 урона.`, '#ff4444');
            this.player.takeDamage(3);
            this.showReturnBtn();
        } else if (node.type === RoomType.REST) {
            this.log.addMessage(`Костёр. Вы восстанавливаете 10 HP.`, '#55ff55');
            this.player.heal(10);
            this.showReturnBtn();
        } else {
            this.log.addMessage(`Пустая тёмная комната...`, '#aaaaaa');
            this.showReturnBtn();
        }
    }

    private showReturnBtn() {
        this.setCombatBtns(false);
        const btn = this.add.rectangle(575, 500, 200, 42, 0x2a2a2a).setInteractive({ useHandCursor: true });
        btn.setName('returnBtn');
        btn.setStrokeStyle(1, 0x666666);
        const txt = this.add.text(575, 500, 'Вернуться на карту', {
            fontFamily: 'Courier New', fontSize: '16px', color: '#cccccc'
        }).setOrigin(0.5);
        txt.setName('returnTxt');
        btn.on('pointerover', () => btn.setStrokeStyle(2, 0xaaaaaa));
        btn.on('pointerout',  () => btn.setStrokeStyle(1, 0x666666));
        btn.on('pointerdown', () => {
            this.roomContainer.setVisible(false);
            this.mapContainer.setVisible(true);
        });
        this.roomContainer.add([btn, txt]);
    }

    private setCombatBtns(visible: boolean) {
        ['attackBtn','attackTxt','defendBtn','defendTxt'].forEach(name => {
            const obj = this.roomContainer.getByName(name);
            if (obj) (obj as Phaser.GameObjects.GameObject & { setVisible: (v: boolean) => void }).setVisible(visible);
        });
    }

    // ── Global UI ────────────────────────────────────────────────────────────
    private setupGlobalUI() {
        const bar = this.add.rectangle(0, 0, 800, 42, 0x1a1a1a).setOrigin(0);
        bar.setStrokeStyle(1, 0x333333);
        this.uiContainer.add(bar);

        this.hpBarBg = this.add.rectangle(12, 21, 160, 14, 0x550000).setOrigin(0, 0.5);
        this.hpBar   = this.add.rectangle(12, 21, 160, 14, 0xcc2222).setOrigin(0, 0.5);
        this.hpText  = this.add.text(180, 12, '', { fontFamily: 'Courier New', fontSize: '14px', color: '#ff8888' });
        this.levelText = this.add.text(400, 12, '', { fontFamily: 'Courier New', fontSize: '14px', color: '#ffffaa' });

        this.uiContainer.add([this.hpBarBg, this.hpBar, this.hpText, this.levelText]);

        this.player.onHpChange = () => this.refreshUI();
        this.player.onLevelUp  = () => {
            this.log.addMessage('*** УРОВЕНЬ ПОВЫШЕН! ***', '#ffff55');
            this.refreshUI();
        };
        this.player.onDeath = () => {
            this.log.addMessage('*** ВЫ ПОГИБЛИ. КОНЕЦ ПУТИ ***', '#ff0000');
            this.cameras.main.shake(600, 0.03);
            this.time.delayedCall(2500, () => this.scene.restart());
        };
        this.refreshUI();
    }

    private refreshUI() {
        const s = this.player.stats;
        const ratio = s.hp / s.maxHp;
        this.hpBar.setDisplaySize(Math.max(0, 160 * ratio), 14);
        this.hpText.setText(`HP ${s.hp}/${s.maxHp}`);
        this.levelText.setText(`Ур.${s.level}  XP ${s.xp}/${s.level * 10}  АТК ${s.attack}  ГЛ.${this.dungeon.currentDepth}`);
    }

    // ── Room UI buttons ──────────────────────────────────────────────────────
    private setupRoomUI() {
        const mkBtn = (x: number, label: string, color: number, name: string) => {
            const btn = this.add.rectangle(x, 420, 110, 42, color).setInteractive({ useHandCursor: true });
            btn.setStrokeStyle(1, 0x888888); btn.setName(name);
            const txt = this.add.text(x, 420, label, {
                fontFamily: 'Courier New', fontSize: '16px', color: '#ffffff'
            }).setOrigin(0.5);
            txt.setName(name + 'Txt');
            btn.on('pointerover', () => btn.setStrokeStyle(2, 0xffffff));
            btn.on('pointerout',  () => btn.setStrokeStyle(1, 0x888888));
            this.roomContainer.add([btn, txt]);
            return btn;
        };

        const atkBtn = mkBtn(500, 'Атака', 0x550000, 'attackBtn');
        atkBtn.on('pointerdown', () => { if (this.combat.enemy) this.combat.processTurn('attack'); });

        const defBtn = mkBtn(640, 'Защита', 0x000055, 'defendBtn');
        defBtn.on('pointerdown', () => { if (this.combat.enemy) this.combat.processTurn('defend'); });
    }
}
