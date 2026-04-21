import * as Phaser from 'phaser';
import { MapGenerator, RoomType } from '../systems/MapGenerator';
import type { MapNode } from '../systems/MapGenerator';
import { DungeonManager } from '../systems/DungeonManager';
import { PlayerManager } from '../systems/PlayerManager';
import { CombatManager } from '../systems/CombatManager';
import { EventLog } from '../ui/EventLog';

// ── Layout ────────────────────────────────────────────────────────────────────
const COL_W   = 150;
const ROW_H   = 110;
const NODE_SZ = 44;
const MAP_X   = 280;
const MAP_Y   = 300;

interface NodeVisual { rect: Phaser.GameObjects.Rectangle; icon: Phaser.GameObjects.Text; }

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
    private dead = false;

    // Global UI
    private hpBar!: Phaser.GameObjects.Rectangle;
    private hpText!: Phaser.GameObjects.Text;
    private levelText!: Phaser.GameObjects.Text;

    // Enemy UI (shown in roomContainer)
    private enemyPortrait!: Phaser.GameObjects.Rectangle;
    private enemyNameText!: Phaser.GameObjects.Text;
    private enemyHpBar!: Phaser.GameObjects.Rectangle;
    private enemyHpBarBg!: Phaser.GameObjects.Rectangle;
    private enemyHpText!: Phaser.GameObjects.Text;
    private enemyCombatGroup!: Phaser.GameObjects.Container;

    constructor() { super('GameScene'); }

    // ────────────────────────────────────────────────────────────────────────
    create() {
        this.visuals   = new Map();
        this.animating = false;
        this.dead      = false;

        this.player = new PlayerManager();
        this.mapGen = new MapGenerator();
        const nodes = this.mapGen.generateInitialMap(4);

        this.dungeon = new DungeonManager(
            nodes,
            (node, prev) => this.afterMove(node, prev),
            (fromDepth)  => this.appendLayer(fromDepth)
        );

        this.mapContainer  = this.add.container(0, 0);
        this.roomContainer = this.add.container(0, 0);
        this.uiContainer   = this.add.container(0, 0);
        this.roomContainer.setVisible(false);

        this.edgeGfx = this.add.graphics();
        this.mapContainer.add(this.edgeGfx);

        this.setupGlobalUI();

        this.log = new EventLog(this, 10, 50, 400, 540);
        this.roomContainer.add((this.log as any)['container']);

        this.combat = new CombatManager(
            this.player, this.log,
            () => this.showReturnBtn(),
            (dmg) => this.onPlayerHit(dmg)
        );
        this.combat.onEnemyUpdate = (hp, max, color, name) => this.updateEnemyUI(hp, max, color, name);

        this.setupRoomUI();
        this.buildAllVisuals(false);
        this.redrawEdges();
    }

    // ── Coordinates ───────────────────────────────────────────────────────────
    private nodeX(n: MapNode) { return MAP_X + (n.depth - this.dungeon.currentDepth) * COL_W; }
    private nodeY(n: MapNode) {
        const sibs = this.dungeon.getAllNodes().filter(x => x.depth === n.depth);
        const idx  = sibs.findIndex(x => x.id === n.id);
        return MAP_Y + (idx - (sibs.length - 1) / 2) * ROW_H;
    }
    private roomColor(n: MapNode): number {
        switch (n.type) {
            case RoomType.START:    return 0x888888;
            case RoomType.ENEMY:   return 0x882222;
            case RoomType.TREASURE:return 0x887722;
            case RoomType.TRAP:    return 0x882288;
            case RoomType.REST:    return 0x228822;
            case RoomType.BOSS:    return 0xcc1111;
            case RoomType.EMPTY:   return 0x444444;
        }
    }
    private roomIcon(t: RoomType): string {
        switch (t) {
            case RoomType.START:    return 'S';
            case RoomType.ENEMY:   return '💀';
            case RoomType.TREASURE:return '💰';
            case RoomType.TRAP:    return '⚡';
            case RoomType.REST:    return '🔥';
            case RoomType.BOSS:    return '👁';
            case RoomType.EMPTY:   return '·';
        }
    }

    // ── Map visuals ───────────────────────────────────────────────────────────
    private buildAllVisuals(fadeIn: boolean) {
        const cur    = this.dungeon.currentNode.id;
        const fwdIds = new Set(this.dungeon.getForwardNodes().map(n => n.id));
        this.dungeon.getAllNodes().forEach(node => {
            if (node.cleared || this.visuals.has(node.id)) return;
            const x = this.nodeX(node), y = this.nodeY(node);
            const revealed = node.visited || fwdIds.has(node.id) || node.id === cur;
            const color  = revealed ? this.roomColor(node) : 0x1a1a1a;
            const stroke = node.id === cur ? 0xffffff : fwdIds.has(node.id) ? 0x666666 : 0x333333;
            const rect = this.add.rectangle(x, y, NODE_SZ, NODE_SZ, color).setStrokeStyle(2, stroke);
            const icon = this.add.text(x, y, revealed ? this.roomIcon(node.type) : '?', {
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
        rect.on('pointerdown', () => { if (!this.animating && !this.dead) this.dungeon.moveTo(node.id); });
        rect.on('pointerover', () => rect.setStrokeStyle(3, 0xffffff));
        rect.on('pointerout',  () => rect.setStrokeStyle(2, 0x666666));
    }

    private redrawEdges() {
        this.edgeGfx.clear();
        const cur    = this.dungeon.currentDepth;
        const fwdIds = new Set(this.dungeon.getForwardNodes().map(n => n.id));
        this.dungeon.getAllNodes().forEach(node => {
            if (node.cleared || node.depth < cur) return;
            node.edges.forEach(eid => {
                const target = this.dungeon.getAllNodes().find(n => n.id === eid);
                if (!target) return;
                const active = fwdIds.has(target.id) && node.id === this.dungeon.currentNode.id;
                this.edgeGfx.lineStyle(active ? 3 : 2, active ? 0x888888 : 0x444444, active ? 1 : 0.4);
                this.edgeGfx.beginPath();
                this.edgeGfx.moveTo(this.nodeX(node),   this.nodeY(node));
                this.edgeGfx.lineTo(this.nodeX(target), this.nodeY(target));
                this.edgeGfx.strokePath();
            });
        });
    }

    // ── Move pipeline ─────────────────────────────────────────────────────────
    private afterMove(node: MapNode, _prev: MapNode) {
        this.animating = true;
        this.animateClearedOut(() => {
            this.animateShift(() => {
                this.buildAllVisuals(true);
                this.redrawEdges();
                this.refreshInteractivity();
                this.animating = false;
                this.enterRoom(node);
            });
        });
    }

    private animateClearedOut(done: () => void) {
        const ids = this.dungeon.getAllNodes()
            .filter(n => n.cleared).map(n => n.id)
            .filter(id => this.visuals.has(id));
        if (!ids.length) { done(); return; }
        let rem = ids.length;
        ids.forEach(id => {
            const v = this.visuals.get(id)!;
            this.tweens.add({
                targets: [v.rect, v.icon], alpha: 0, scaleX: 0.2, scaleY: 0.2,
                duration: 320, ease: 'Quad.in',
                onComplete: () => { v.rect.destroy(); v.icon.destroy(); this.visuals.delete(id); if (--rem === 0) done(); }
            });
        });
    }

    private animateShift(done: () => void) {
        const moves: { obj: any; x: number; y: number }[] = [];
        this.visuals.forEach((vis, id) => {
            const node = this.dungeon.getAllNodes().find(n => n.id === id);
            if (!node) return;
            moves.push({ obj: vis.rect, x: this.nodeX(node), y: this.nodeY(node) });
            moves.push({ obj: vis.icon, x: this.nodeX(node), y: this.nodeY(node) });
        });
        if (!moves.length) { done(); return; }
        let rem = moves.length;
        moves.forEach(({ obj, x, y }) => {
            this.tweens.add({ targets: obj, x, y, duration: 380, ease: 'Quad.inOut',
                onComplete: () => { if (--rem === 0) done(); } });
        });
    }

    private refreshInteractivity() {
        const cur    = this.dungeon.currentNode.id;
        const fwdIds = new Set(this.dungeon.getForwardNodes().map(n => n.id));
        this.visuals.forEach((vis, id) => {
            const node = this.dungeon.getAllNodes().find(n => n.id === id);
            if (!node) return;
            vis.rect.removeInteractive(); vis.rect.removeAllListeners();
            const isCur = id === cur, isFwd = fwdIds.has(id);
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
    }

    // ── Room / Event view ─────────────────────────────────────────────────────
    private enterRoom(node: MapNode) {
        this.mapContainer.setVisible(false);
        this.roomContainer.setVisible(true);
        this.log.addMessage(`\n--- Глубина ${this.dungeon.currentDepth} ---`, '#555555');

        ['returnBtn', 'returnTxt'].forEach(name => {
            const o = this.roomContainer.getByName(name);
            if (o) (o as any).destroy();
        });

        const isBoss   = node.type === RoomType.BOSS;
        const isCombat = node.type === RoomType.ENEMY || isBoss;
        this.setCombatBtns(isCombat);
        this.enemyCombatGroup.setVisible(isCombat);

        if (isCombat) {
            this.combat.startCombat(this.dungeon.currentDepth, isBoss);
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
            this.log.addMessage(`Пустая тёмная комната.`, '#aaaaaa');
            this.showReturnBtn();
        }
    }

    private showReturnBtn() {
        this.setCombatBtns(false);
        this.enemyCombatGroup.setVisible(false);
        const btn = this.add.rectangle(600, 490, 210, 42, 0x1e1e1e).setInteractive({ useHandCursor: true });
        btn.setName('returnBtn'); btn.setStrokeStyle(1, 0x555555);
        const txt = this.add.text(600, 490, 'Вернуться на карту', {
            fontFamily: 'Courier New', fontSize: '15px', color: '#aaaaaa'
        }).setOrigin(0.5);
        txt.setName('returnTxt');
        btn.on('pointerover', () => btn.setStrokeStyle(2, 0xaaaaaa));
        btn.on('pointerout',  () => btn.setStrokeStyle(1, 0x555555));
        btn.on('pointerdown', () => {
            this.roomContainer.setVisible(false);
            this.mapContainer.setVisible(true);
        });
        this.roomContainer.add([btn, txt]);
    }

    // ── Enemy UI ──────────────────────────────────────────────────────────────
    private updateEnemyUI(hp: number, maxHp: number, color: number, name: string) {
        this.enemyPortrait.setFillStyle(color);
        this.enemyNameText.setText(name);
        const ratio = Math.max(0, hp / maxHp);
        const maxW  = 220;
        this.enemyHpBar.setDisplaySize(ratio * maxW, 12);
        // color gradient: green → yellow → red
        const barColor = hp / maxHp > 0.5 ? 0xcc6622 : hp / maxHp > 0.25 ? 0xccaa00 : 0xcc2222;
        this.enemyHpBar.setFillStyle(barColor);
        this.enemyHpText.setText(`${Math.max(0, hp)} / ${maxHp}`);
    }

    // ── Camera shake on player hit ────────────────────────────────────────────
    private onPlayerHit(dmg: number) {
        const intensity = Math.min(0.015, 0.004 * dmg);
        this.cameras.main.shake(220, intensity);
        // red flash
        const flash = this.add.rectangle(400, 300, 800, 600, 0xff0000, 0.18);
        this.tweens.add({ targets: flash, alpha: 0, duration: 300, onComplete: () => flash.destroy() });
    }

    // ── Death screen ──────────────────────────────────────────────────────────
    private showDeathScreen() {
        this.dead = true;
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0).setDepth(100);
        this.tweens.add({ targets: overlay, alpha: 0.88, duration: 800, ease: 'Quad.in' });

        const title = this.add.text(400, 160, 'ВЫ ПОГИБЛИ', {
            fontFamily: 'Courier New', fontSize: '42px', color: '#cc2222',
            stroke: '#000000', strokeThickness: 4
        }).setOrigin(0.5).setAlpha(0).setDepth(101);

        const flavour = this.add.text(400, 220, 'Тьма поглотила вашу душу.', {
            fontFamily: 'Courier New', fontSize: '16px', color: '#555555'
        }).setOrigin(0.5).setAlpha(0).setDepth(101);

        const stats = this.add.text(400, 300,
            `Глубина:  ${this.dungeon.currentDepth}\n` +
            `Убито:    ${this.player.killCount}\n` +
            `Уровень:  ${this.player.stats.level}`, {
            fontFamily: 'Courier New', fontSize: '20px', color: '#aaaaaa',
            lineSpacing: 10, align: 'center'
        }).setOrigin(0.5).setAlpha(0).setDepth(101);

        const btnBg = this.add.rectangle(400, 430, 220, 46, 0x1a0000).setAlpha(0).setDepth(101);
        btnBg.setStrokeStyle(1, 0x882222);
        const btnTxt = this.add.text(400, 430, 'Начать заново', {
            fontFamily: 'Courier New', fontSize: '18px', color: '#cc4444'
        }).setOrigin(0.5).setAlpha(0).setDepth(101);

        this.time.delayedCall(600, () => {
            this.tweens.add({ targets: [title, flavour, stats, btnBg, btnTxt], alpha: 1, duration: 700, ease: 'Quad.out' });
            btnBg.setInteractive({ useHandCursor: true });
            btnBg.on('pointerover',  () => btnBg.setStrokeStyle(2, 0xcc2222));
            btnBg.on('pointerout',   () => btnBg.setStrokeStyle(1, 0x882222));
            btnBg.on('pointerdown',  () => this.scene.restart());
        });
    }

    // ── Global UI ─────────────────────────────────────────────────────────────
    private setupGlobalUI() {
        const bar = this.add.rectangle(0, 0, 800, 42, 0x111111).setOrigin(0).setStrokeStyle(1, 0x333333);
        const hpBg = this.add.rectangle(12, 21, 160, 14, 0x440000).setOrigin(0, 0.5);
        this.hpBar  = this.add.rectangle(12, 21, 160, 14, 0xcc2222).setOrigin(0, 0.5);
        this.hpText = this.add.text(182, 12, '', { fontFamily: 'Courier New', fontSize: '14px', color: '#ff8888' });
        this.levelText = this.add.text(360, 12, '', { fontFamily: 'Courier New', fontSize: '14px', color: '#ffffaa' });
        this.uiContainer.add([bar, hpBg, this.hpBar, this.hpText, this.levelText]);

        this.player.onHpChange = () => this.refreshUI();
        this.player.onLevelUp  = () => { this.log.addMessage('*** УРОВЕНЬ ПОВЫШЕН! ***', '#ffff55'); this.refreshUI(); };
        this.player.onDeath    = () => {
            this.cameras.main.shake(700, 0.04);
            this.time.delayedCall(300, () => this.showDeathScreen());
        };
        this.refreshUI();
    }

    private refreshUI() {
        const s = this.player.stats;
        this.hpBar.setDisplaySize(Math.max(0, 160 * (s.hp / s.maxHp)), 14);
        const c = s.hp / s.maxHp > 0.5 ? 0xcc2222 : s.hp / s.maxHp > 0.25 ? 0xcc8800 : 0xff2222;
        this.hpBar.setFillStyle(c);
        this.hpText.setText(`HP ${s.hp}/${s.maxHp}`);
        this.levelText.setText(`Ур.${s.level}  XP ${s.xp}/${s.level * 10}  АТК ${s.attack}  ГЛ.${this.dungeon.currentDepth}  💀${this.player.killCount}`);
    }

    // ── Room UI setup ─────────────────────────────────────────────────────────
    private setCombatBtns(v: boolean) {
        ['attackBtn', 'attackTxt', 'defendBtn', 'defendTxt'].forEach(name => {
            const o = this.roomContainer.getByName(name);
            if (o) (o as any).setVisible(v);
        });
    }

    private setupRoomUI() {
        // ── Enemy combat group ──
        this.enemyCombatGroup = this.add.container(0, 0);

        // Portrait
        this.enemyPortrait = this.add.rectangle(600, 155, 90, 90, 0x333333).setStrokeStyle(2, 0x555555);
        // Name
        this.enemyNameText = this.add.text(600, 215, '', {
            fontFamily: 'Courier New', fontSize: '17px', color: '#ff8888'
        }).setOrigin(0.5);
        // HP bar
        this.enemyHpBarBg = this.add.rectangle(490, 242, 220, 12, 0x330000).setOrigin(0, 0.5);
        this.enemyHpBar   = this.add.rectangle(490, 242, 220, 12, 0xcc2222).setOrigin(0, 0.5);
        this.enemyHpText  = this.add.text(600, 256, '', {
            fontFamily: 'Courier New', fontSize: '12px', color: '#884444'
        }).setOrigin(0.5);

        this.enemyCombatGroup.add([
            this.enemyPortrait, this.enemyNameText,
            this.enemyHpBarBg, this.enemyHpBar, this.enemyHpText
        ]);
        this.roomContainer.add(this.enemyCombatGroup);
        this.enemyCombatGroup.setVisible(false);

        // ── Combat buttons ──
        const mkBtn = (x: number, label: string, color: number, bname: string) => {
            const btn = this.add.rectangle(x, 380, 115, 44, color).setInteractive({ useHandCursor: true });
            btn.setStrokeStyle(1, 0x888888); btn.setName(bname);
            const txt = this.add.text(x, 380, label, {
                fontFamily: 'Courier New', fontSize: '16px', color: '#ffffff'
            }).setOrigin(0.5); txt.setName(bname + 'Txt');
            btn.on('pointerover', () => btn.setStrokeStyle(2, 0xffffff));
            btn.on('pointerout',  () => btn.setStrokeStyle(1, 0x888888));
            this.roomContainer.add([btn, txt]);
            return btn;
        };

        const atkBtn = mkBtn(515, 'Атака',  0x550000, 'attackBtn');
        atkBtn.on('pointerdown', () => { if (this.combat.enemy) this.combat.processTurn('attack'); });

        const defBtn = mkBtn(685, 'Защита', 0x000055, 'defendBtn');
        defBtn.on('pointerdown', () => { if (this.combat.enemy) this.combat.processTurn('defend'); });
    }
}
