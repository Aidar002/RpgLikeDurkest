import * as Phaser from 'phaser';
import { BOTTOM_BAR_H, CENTER_X, CENTER_Y, GAME_HEIGHT, GAME_WIDTH, TOP_BAR_H } from './Layout';

export class VFX {

    /**
     * Dark vignette around the play-area edges only.
     *
     * The HUD bars (top/bottom) are intentionally excluded so labels and
     * values near the canvas edge stay legible — the vignette is a
     * stylistic atmosphere effect for the dungeon view, not a frame
     * around the whole screen.
     */
    static vignette(
        scene: Phaser.Scene,
        w = GAME_WIDTH,
        _h = GAME_HEIGHT,
        playTop = TOP_BAR_H,
        playBottom = GAME_HEIGHT - BOTTOM_BAR_H,
    ) {
        const playH = Math.max(1, playBottom - playTop);
        const g = scene.add.graphics().setDepth(210).setScrollFactor(0);
        // Top fade — fades down inside the play area only.
        g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.7, 0.7, 0, 0);
        g.fillRect(0, playTop, w, playH * 0.22);
        // Bottom fade — sits just above the bottom HUD bar.
        g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.7, 0.7);
        g.fillRect(0, playBottom - playH * 0.22, w, playH * 0.22);
        // Side fades — clipped to the play area's vertical band.
        g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.5, 0, 0.5, 0);
        g.fillRect(0, playTop, w * 0.1, playH);
        g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0.5, 0, 0.5);
        g.fillRect(w * 0.9, playTop, w * 0.1, playH);
    }

    /** CRT scanlines. */
    static scanlines(scene: Phaser.Scene, w = GAME_WIDTH, h = GAME_HEIGHT) {
        const g = scene.add.graphics().setDepth(209).setScrollFactor(0);
        g.lineStyle(1, 0x000000, 0.018);
        for (let y = 0; y < h; y += 6) {
            g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.strokePath();
        }
    }

    /** Floating combat text for damage and healing. */
    static floatText(scene: Phaser.Scene, x: number, y: number, text: string, color = '#ffffff') {
        const t = scene.add.text(x, y, text, {
            fontFamily: 'Lucida Console, Consolas, monospace', fontSize: '22px', color,
            stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(160);
        scene.tweens.add({ targets: t, y: y - 70, alpha: 0, duration: 900, ease: 'Quad.out', onComplete: () => t.destroy() });
    }

    /** Short object shake. */
    static shake(scene: Phaser.Scene, obj: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject, intensity = 6) {
        const bx = obj.x;
        const by = obj.y;
        scene.tweens.add({
            targets: obj, x: bx + intensity, duration: 40,
            yoyo: true, repeat: 3, ease: 'Sine.inOut',
            onComplete: () => { obj.setX(bx); obj.setY(by); }
        });
    }

    /** Temporary rectangle color flash. */
    static flash(scene: Phaser.Scene, rect: Phaser.GameObjects.Rectangle, color: number, ms = 150) {
        const orig = rect.fillColor;
        rect.setFillStyle(color);
        scene.time.delayedCall(ms, () => rect.setFillStyle(orig));
    }

    /** Pulsing glow behind an active map node. */
    static nodeGlow(scene: Phaser.Scene, x: number, y: number, color: number, size: number): Phaser.GameObjects.Graphics {
        const g = scene.add.graphics();
        [5, 9, 14].forEach((off, i) => {
            g.fillStyle(color, 0.12 - i * 0.03);
            g.fillRect(x - size / 2 - off, y - size / 2 - off, size + off * 2, size + off * 2);
        });
        scene.tweens.add({ targets: g, alpha: { from: 0.5, to: 1 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        return g;
    }

    /** Gold flash for critical hits. */
    static critFlash(scene: Phaser.Scene) {
        const flash = scene.add.rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0xffc800, 0.22).setDepth(89);
        scene.tweens.add({
            targets: flash, alpha: 0, duration: 250, ease: 'Quad.out',
            onComplete: () => flash.destroy()
        });
    }

    /** Green healing glow. */
    static healGlow(scene: Phaser.Scene, x: number, y: number) {
        const ring = scene.add.circle(x, y, 28, 0x44dd66, 0.35).setDepth(87);
        scene.tweens.add({
            targets: ring, scaleX: 2, scaleY: 2, alpha: 0, duration: 500, ease: 'Quad.out',
            onComplete: () => ring.destroy()
        });
    }

    /** Blue shield cue when guarding. */
    static shieldFlash(scene: Phaser.Scene, x: number, y: number) {
        const shield = scene.add.rectangle(x, y, 60, 60, 0x4488ff, 0.3).setDepth(87)
            .setStrokeStyle(2, 0x88bbff);
        scene.tweens.add({
            targets: shield, alpha: 0, scaleX: 1.3, scaleY: 1.3, duration: 400, ease: 'Quad.out',
            onComplete: () => shield.destroy()
        });
    }

    /** Looping background embers and dust. */
    static ambientEmbers(scene: Phaser.Scene, count = 18) {
        const spawn = () => {
            const x = 80 + Math.random() * (GAME_WIDTH - 160);
            const y = 100 + Math.random() * (GAME_HEIGHT - 200);
            const sz = Math.random() * 2 + 1;
            const col = Math.random() > 0.6 ? 0xffaa33 : 0xaaaaaa;
            const dot = scene.add.rectangle(x, y + 20, sz, sz, col, 0.4 + Math.random() * 0.2).setDepth(3);
            scene.tweens.add({
                targets: dot, y: y - 60 - Math.random() * 80, alpha: 0,
                duration: 2200 + Math.random() * 1800, ease: 'Quad.out',
                onComplete: () => { dot.destroy(); scene.time.delayedCall(Math.random() * 600, spawn); }
            });
        };
        for (let i = 0; i < count; i++) scene.time.delayedCall(i * 160, spawn);
    }
}
