/**
 * Centred "Level Up" celebration banner.
 *
 * Pops in above every HUD layer (just below the tooltip tier) the
 * moment {@link PlayerManager.levelUp} fires. Reads as a self-contained
 * moment of "this is important" without interrupting input — the
 * banner is purely cosmetic, runs on its own tweens, and removes
 * itself when the celebration ends.
 *
 * Composition (back to front):
 *   1. Soft gold radial-ish halo behind the panel — fades in/out with
 *      the banner so the eye is drawn toward the centre.
 *   2. Carved-stone {@link drawHudPanel} backdrop sized to fit both
 *      lines of text — matches the rest of the HUD's frame language
 *      so the banner doesn't feel like a foreign overlay.
 *   3. Gold rim (single 2-px stroke) hugging the panel edge.
 *   4. ALL-CAPS title ("LEVEL UP" / "УРОВЕНЬ ПОВЫШЕН") above the
 *      transition line ("{prev}  →  {next}") rendered with the same
 *      gold accent used for the level-up flash + log lines.
 *   5. A staggered ring of small gold sparks orbiting the panel —
 *      reads as celebratory without obscuring the underlying scene.
 *
 * Animation timeline (≈1.8 s total):
 *   t=0       — banner enters from above with scale-bounce + alpha
 *               fade-in (`Back.out`, 360 ms).
 *   t=360 ms  — sparkle ring spawns, panel idles with a subtle
 *               breathing scale (Sine yoyo).
 *   t=1240 ms — banner glides back upward, fading out (`Sine.in`,
 *               420 ms) and destroys all owned objects on complete.
 *
 * Depth: `Depths.NotificationBanner + 2` for the halo,
 * `+3` for the panel, `+4` for the text. The base `NotificationBanner`
 * tier (160) sits above every HUD frame, end-screen overlay, and
 * combat flash but below the tooltip tier so hover tooltips can
 * still surface if the player moves the mouse while the banner is
 * up.
 */

import * as Phaser from 'phaser';

import { CENTER_X, Depths, GAME_HEIGHT } from './Layout';
import { HUD_FONT, HUD_STROKE, HudHex, drawHudPanel } from './HudTheme';

const BANNER_W = 360;
const BANNER_H = 120;
const FINAL_Y = Math.round(GAME_HEIGHT * 0.32);
const ENTER_Y = FINAL_Y - 60;
const EXIT_Y = FINAL_Y - 28;
const ACCENT_HEX = '#fff17a';
const ACCENT_NUM = 0xfff17a;
const HALO_COLOR = 0xfff0a0;

/**
 * Show the level-up celebration banner. Caller is responsible for
 * timing this with the `levelUp` SFX so the visual + audio land in
 * the same frame — the banner itself does not play any sound.
 */
export function showLevelUpBanner(
    scene: Phaser.Scene,
    prevLevel: number,
    nextLevel: number,
    titleText: string,
    transitionTemplate: string
): void {
    const transitionText = transitionTemplate
        .replaceAll('{prev}', String(prevLevel))
        .replaceAll('{next}', String(nextLevel));

    const baseDepth = Depths.NotificationBanner + 2;
    const owned: Phaser.GameObjects.GameObject[] = [];

    // 1) Soft radial halo. Two stacked circles (outer atmospheric
    // wash, inner hot core) give the gold a "lit from within" feel
    // without needing a custom shader. Both render below the panel
    // and breathe in/out for the banner's lifetime.
    const haloOuter = scene.add
        .circle(CENTER_X, FINAL_Y, BANNER_W * 0.78, HALO_COLOR, 0.16)
        .setDepth(baseDepth)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0);
    const haloInner = scene.add
        .circle(CENTER_X, FINAL_Y, BANNER_W * 0.42, HALO_COLOR, 0.28)
        .setDepth(baseDepth)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0);
    owned.push(haloOuter, haloInner);

    // 2) Carved-stone panel. Centred origin via a container so we
    // can tween a single anchor for the whole banner group.
    const panelContainer = scene.add.container(CENTER_X, ENTER_Y);
    panelContainer.setDepth(baseDepth + 1);
    panelContainer.setAlpha(0);
    const panel = drawHudPanel(scene, -BANNER_W / 2, -BANNER_H / 2, BANNER_W, BANNER_H);
    panelContainer.add(panel);

    // 3) Gold rim — drawn into the same Graphics layer as the
    // panel so it inherits the container's transform.
    const rim = scene.add.graphics();
    rim.lineStyle(2, ACCENT_NUM, 0.85);
    rim.strokeRect(-BANNER_W / 2 + 2, -BANNER_H / 2 + 2, BANNER_W - 4, BANNER_H - 4);
    rim.lineStyle(1, ACCENT_NUM, 0.4);
    rim.strokeRect(-BANNER_W / 2 + 6, -BANNER_H / 2 + 6, BANNER_W - 12, BANNER_H - 12);
    panelContainer.add(rim);

    // 4) Title + transition text.
    const title = scene.add
        .text(0, -BANNER_H / 2 + 30, titleText, {
            fontFamily: HUD_FONT,
            fontSize: '22px',
            color: ACCENT_HEX,
            stroke: HUD_STROKE,
            strokeThickness: 3,
            align: 'center',
        })
        .setOrigin(0.5);
    const transition = scene.add
        .text(0, BANNER_H / 2 - 32, transitionText, {
            fontFamily: HUD_FONT,
            fontSize: '32px',
            color: HudHex.textPrimary,
            stroke: HUD_STROKE,
            strokeThickness: 3,
            align: 'center',
        })
        .setOrigin(0.5);
    panelContainer.add([title, transition]);
    owned.push(panelContainer);

    // ── Enter: pop in from above with a tiny overshoot bounce.
    panelContainer.setScale(0.78);
    scene.tweens.add({
        targets: panelContainer,
        y: FINAL_Y,
        alpha: 1,
        scale: 1,
        duration: 360,
        ease: 'Back.out',
    });
    scene.tweens.add({
        targets: [haloOuter, haloInner],
        alpha: { from: 0, to: 1 },
        duration: 360,
        ease: 'Sine.out',
    });

    // ── Idle: subtle breathing scale on the panel + halo so the
    // moment doesn't feel frozen between enter and exit.
    const breathe = scene.tweens.add({
        targets: panelContainer,
        scale: { from: 1, to: 1.04 },
        duration: 520,
        delay: 360,
        yoyo: true,
        repeat: 0,
        ease: 'Sine.inOut',
    });
    const haloPulse = scene.tweens.add({
        targets: [haloOuter, haloInner],
        scale: { from: 1, to: 1.15 },
        alpha: { from: 1, to: 0.7 },
        duration: 620,
        delay: 360,
        yoyo: true,
        repeat: 0,
        ease: 'Sine.inOut',
    });

    // ── Spark ring: 12 small gold dots radiating outward and
    // fading. Spawned 200 ms after the banner lands so the sparks
    // read as a reaction to the banner, not part of its entry.
    scene.time.delayedCall(200, () => {
        const SPARK_COUNT = 14;
        for (let i = 0; i < SPARK_COUNT; i++) {
            const angle = (i / SPARK_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
            const reach = 110 + Math.random() * 60;
            const spark = scene.add
                .circle(CENTER_X, FINAL_Y, 2.4 + Math.random() * 1.4, ACCENT_NUM, 1)
                .setDepth(baseDepth + 1)
                .setBlendMode(Phaser.BlendModes.ADD);
            owned.push(spark);
            scene.tweens.add({
                targets: spark,
                x: CENTER_X + Math.cos(angle) * reach,
                y: FINAL_Y + Math.sin(angle) * reach,
                alpha: 0,
                scale: 0.3,
                duration: 720 + Math.random() * 240,
                ease: 'Quad.out',
                onComplete: () => spark.destroy(),
            });
        }
    });

    // ── Exit: glide upward, fade out, tear everything down.
    scene.time.delayedCall(1240, () => {
        breathe.stop();
        haloPulse.stop();
        scene.tweens.add({
            targets: panelContainer,
            y: EXIT_Y,
            alpha: 0,
            duration: 420,
            ease: 'Sine.in',
        });
        scene.tweens.add({
            targets: [haloOuter, haloInner],
            alpha: 0,
            scale: 1.3,
            duration: 420,
            ease: 'Sine.in',
            onComplete: () => {
                for (const obj of owned) obj.destroy();
            },
        });
    });
}
