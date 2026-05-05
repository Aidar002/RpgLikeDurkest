import * as Phaser from 'phaser';
import { BOTTOM_BAR_H, CENTER_X, CENTER_Y, GAME_HEIGHT, GAME_WIDTH, HUD_BOTTOM_OFFSET, TOP_BAR_H } from './Layout';

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
        playBottom = GAME_HEIGHT - BOTTOM_BAR_H - HUD_BOTTOM_OFFSET,
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

    /**
     * Looping fire embers anchored on a single map node (campfire, altar).
     *
     * Four layered effects, all parented to the supplied container so
     * they follow the map's parallax/scroll:
     *
     *   1. Three concentric pulsing halos (cold-warm-bright) provide
     *      depth — the outermost is a wide soft atmospheric glow, the
     *      middle is the warm orange light pool, the innermost is the
     *      hot core flicker.
     *   2. A bed of rising ember *circles* (8 concurrent chains) with
     *      sinusoidal sway, scaled fade-out, and Sine easing for a
     *      smoother lift than the original square pixels.
     *   3. Occasional fast wisp sparks — small, very bright dots that
     *      shoot higher and fade quickly, breaking up the steady column.
     *   4. Periodic flicker flash that pops the centre brightness.
     *
     * `destroy` stops further spawns and removes everything in flight.
     */
    static nodeFire(
        scene: Phaser.Scene,
        parent: Phaser.GameObjects.Container,
        x: number,
        y: number,
    ): { destroy: () => void } {
        let alive = true;
        const particles = new Set<Phaser.GameObjects.GameObject>();
        const haloTweens: Phaser.Tweens.Tween[] = [];

        // ── Glow halo (3 layers) ────────────────────────────────
        // Outer atmospheric warmth, mid orange light pool, hot core.
        // Different breath durations let the layers drift in and out
        // of phase so the light never looks mechanically identical
        // between cycles.
        const haloOutermost = scene.add.circle(x, y + 4, 38, 0xff7a22, 0.10).setDepth(7);
        const haloMid = scene.add.circle(x, y + 4, 24, 0xffa040, 0.20).setDepth(8);
        const haloCore = scene.add.circle(x, y + 4, 14, 0xffe2a0, 0.42).setDepth(9);
        parent.add(haloOutermost);
        parent.add(haloMid);
        parent.add(haloCore);
        particles.add(haloOutermost);
        particles.add(haloMid);
        particles.add(haloCore);
        haloTweens.push(scene.tweens.add({
            targets: haloOutermost,
            scale: { from: 0.78, to: 1.20 },
            alpha: { from: 0.07, to: 0.16 },
            duration: 1700,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.inOut',
        }));
        haloTweens.push(scene.tweens.add({
            targets: haloMid,
            scale: { from: 0.88, to: 1.12 },
            alpha: { from: 0.15, to: 0.28 },
            duration: 1100,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.inOut',
        }));
        haloTweens.push(scene.tweens.add({
            targets: haloCore,
            scale: { from: 1.05, to: 0.82 },
            alpha: { from: 0.50, to: 0.30 },
            duration: 620,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.inOut',
        }));

        // ── Rising embers (smooth circles) ──────────────────────
        const spawnEmber = () => {
            if (!alive) return;
            // Mix of three sizes so the column doesn't read as uniform;
            // big embers are rarer but visually anchor the column.
            const big = Math.random() > 0.75;
            const radius = big ? 1.8 + Math.random() * 1.2 : 0.9 + Math.random() * 1.2;
            // Three-way colour roll, biased toward warm orange. The
            // softer mid orange (0xffa84a) reads better against the
            // dark map than the punchy 0xff8833 the old VFX used.
            const roll = Math.random();
            const col = roll > 0.78 ? 0xfff5d8 : roll > 0.32 ? 0xffa84a : 0xc4421a;
            const startX = x + (Math.random() - 0.5) * 12;
            const startY = y + 9;
            // 86% alpha at spawn so even the tip of a spark blends
            // into the halo instead of looking like a hard pixel.
            const dot = scene.add
                .circle(startX, startY, radius, col, 0.86)
                .setDepth(12);
            parent.add(dot);
            particles.add(dot);
            // Sway: the ember drifts to one side and comes back as it
            // rises, instead of a single straight line. Two-stage
            // tween chain via onComplete-internal-tween would feel
            // jerky, so we just use a wide horizontal target with
            // Sine.inOut so the spark slows naturally at the top.
            const sway = (Math.random() - 0.5) * 18;
            const lift = 36 + Math.random() * 22;
            const lifetime = 720 + Math.random() * 520;
            scene.tweens.add({
                targets: dot,
                y: startY - lift,
                x: startX + sway,
                alpha: 0,
                scale: big ? 0.45 : 0.70,
                duration: lifetime,
                ease: 'Sine.out',
                onComplete: () => {
                    particles.delete(dot);
                    dot.destroy();
                    if (alive) {
                        scene.time.delayedCall(60 + Math.random() * 100, spawnEmber);
                    }
                },
            });
        };
        // 8 overlapping spawn chains keep the column dense without
        // each individual ember having to be huge.
        for (let i = 0; i < 8; i++) {
            scene.time.delayedCall(i * 70, spawnEmber);
        }

        // ── Wisp sparks ─────────────────────────────────────────
        // Tiny bright dots that shoot up faster and farther than the
        // main embers, then fade. Adds a bit of "snap" to the loop.
        const spawnWisp = () => {
            if (!alive) return;
            const startX = x + (Math.random() - 0.5) * 8;
            const startY = y + 8;
            const wisp = scene.add
                .circle(startX, startY, 0.9 + Math.random() * 0.6, 0xfff8e0, 0.95)
                .setDepth(13);
            parent.add(wisp);
            particles.add(wisp);
            scene.tweens.add({
                targets: wisp,
                y: startY - 60 - Math.random() * 24,
                x: startX + (Math.random() - 0.5) * 22,
                alpha: 0,
                scale: 0.4,
                duration: 540 + Math.random() * 320,
                ease: 'Sine.out',
                onComplete: () => {
                    particles.delete(wisp);
                    wisp.destroy();
                    if (alive) {
                        scene.time.delayedCall(220 + Math.random() * 360, spawnWisp);
                    }
                },
            });
        };
        // Two staggered wisp chains so the snap is uneven.
        scene.time.delayedCall(200, spawnWisp);
        scene.time.delayedCall(560, spawnWisp);

        // ── Flicker flash ───────────────────────────────────────
        // Periodic short brightening at the centre — reads as a
        // popping coal. Sine.out keeps the fade soft instead of
        // snapping, matching the rest of the loop.
        const spawnFlicker = () => {
            if (!alive) return;
            const flash = scene.add
                .circle(x, y + 6, 7, 0xfff0c0, 0.78)
                .setDepth(11);
            parent.add(flash);
            particles.add(flash);
            scene.tweens.add({
                targets: flash,
                scale: 1.9,
                alpha: 0,
                duration: 320,
                ease: 'Sine.out',
                onComplete: () => {
                    particles.delete(flash);
                    flash.destroy();
                    if (alive) {
                        scene.time.delayedCall(520 + Math.random() * 760, spawnFlicker);
                    }
                },
            });
        };
        scene.time.delayedCall(300, spawnFlicker);

        return {
            destroy: () => {
                alive = false;
                haloTweens.forEach((t) => t.stop());
                particles.forEach((p) => p.destroy());
                particles.clear();
            },
        };
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
