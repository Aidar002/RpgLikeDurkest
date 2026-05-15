import * as Phaser from 'phaser';

import { BOTTOM_BAR_H, GAME_HEIGHT, HUD_BOTTOM_OFFSET, RoomLayout } from './Layout';

/**
 * EXPERIMENTAL — action-combat prototype.
 *
 * Two horizontal progress bars rendered above the [1] Strike and [2]
 * Guard room buttons. Pure visual layer — the CombatHud owns the fill
 * values and pushes them in via {@link setAttack} / {@link setDefend}
 * every frame. The bar positions are derived from the same constants
 * RoomButtons.ts uses so a future bump to `BOTTOM_BAR_H` or button
 * geometry slides both rows together with no manual sync.
 *
 * Defend bar colour signals state at a glance:
 *  - 'idle'     red (filling; an enemy hit is incoming)
 *  - 'guarded'  blue (the player's Guard buff is up; next hit blocks)
 *  - 'cooldown' grey (Guard is recovering and unusable)
 */
export type DefendBarState = 'idle' | 'guarded' | 'cooldown';

interface BarVisuals {
    bg: Phaser.GameObjects.Rectangle;
    fill: Phaser.GameObjects.Rectangle;
    label: Phaser.GameObjects.Text;
    leftX: number;
}

const BAR_H = 10;
const ATTACK_FILL_LOW = 0xc14a4a;
const ATTACK_FILL_FULL = 0xffcc66;
const DEFEND_FILL_IDLE = 0xa14a4a;
const DEFEND_FILL_GUARDED = 0x66ccff;
const DEFEND_FILL_COOLDOWN = 0x666666;

export class CombatBars {
    private readonly scene: Phaser.Scene;
    private readonly parent: Phaser.GameObjects.Container;
    private readonly attack: BarVisuals;
    private readonly defend: BarVisuals;
    private readonly width: number;

    constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container) {
        this.scene = scene;
        this.parent = parent;

        // Geometry mirrors src/ui/RoomButtons.ts so the bars track the
        // [1] / [2] buttons through layout changes.
        const BTN_H = 48;
        const BTN_ROW_GAP = 16;
        const BTN_PANEL_PAD = 10;
        const COL_GAP = 16;
        const COL_INSET = 14;
        const colWidth = Math.floor((RoomLayout.panelWidth - COL_INSET * 2 - COL_GAP) / 2);
        const leftColX = RoomLayout.panelX + COL_INSET + colWidth / 2;
        const rightColX = RoomLayout.panelX + COL_INSET + colWidth + COL_GAP + colWidth / 2;
        const panelBottom = GAME_HEIGHT - BOTTOM_BAR_H - HUD_BOTTOM_OFFSET;
        const wideButtonY = panelBottom - BTN_PANEL_PAD - BTN_H / 2;
        const middleRowY = wideButtonY - (BTN_H + BTN_ROW_GAP);
        const topRowY = middleRowY - (BTN_H + BTN_ROW_GAP);
        // Bar sits just above the [1] / [2] row with a tiny gap so the
        // button frame doesn't visually merge with the bar fill.
        const barY = topRowY - BTN_H / 2 - 14;

        this.width = colWidth - 6;
        this.attack = this.buildBar(leftColX, barY);
        this.defend = this.buildBar(rightColX, barY);
        this.setVisible(false);
    }

    private buildBar(x: number, y: number): BarVisuals {
        const scene = this.scene;
        const w = this.width;
        const leftX = x - w / 2;
        const bg = scene.add.rectangle(x, y, w, BAR_H, 0x202020).setStrokeStyle(1, 0x555555);
        const fill = scene.add.rectangle(leftX, y, 0, BAR_H, ATTACK_FILL_LOW).setOrigin(0, 0.5);
        const label = scene.add
            .text(x, y - 12, '', {
                fontFamily: 'monospace',
                fontSize: '10px',
                color: '#bbbbbb',
            })
            .setOrigin(0.5);
        this.parent.add([bg, fill, label]);
        return { bg, fill, label, leftX };
    }

    setAttack(progress: number): void {
        const p = Phaser.Math.Clamp(progress, 0, 1);
        this.attack.fill.setSize(this.width * p, BAR_H);
        this.attack.fill.setFillStyle(p >= 1 ? ATTACK_FILL_FULL : ATTACK_FILL_LOW);
    }

    setDefend(progress: number, state: DefendBarState): void {
        const p = Phaser.Math.Clamp(progress, 0, 1);
        this.defend.fill.setSize(this.width * p, BAR_H);
        const colour =
            state === 'guarded'
                ? DEFEND_FILL_GUARDED
                : state === 'cooldown'
                  ? DEFEND_FILL_COOLDOWN
                  : DEFEND_FILL_IDLE;
        this.defend.fill.setFillStyle(colour);
    }

    setLabels(attack: string, defend: string): void {
        this.attack.label.setText(attack);
        this.defend.label.setText(defend);
    }

    setVisible(v: boolean): void {
        [this.attack, this.defend].forEach((b) => {
            b.bg.setVisible(v);
            b.fill.setVisible(v);
            b.label.setVisible(v);
        });
    }
}
