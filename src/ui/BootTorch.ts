/**
 * Boot-screen torch: a single animated wall torch with an "ignition"
 * intro and a steady burning loop after. Used on the title screen to
 * flank the game logo with two lit torches.
 *
 * Lifecycle, driven by `delayMs` and optionally `sfxLeadMs`:
 *
 *   1. Hidden  (alpha 0)
 *   2. delayMs - sfxLeadMs (only if `sfxLeadMs > 0`): play `torchIgnite`
 *      SFX. This lets the host pre-roll the flint/whoosh cue so the
 *      audible spark lands a beat before the visible flame.
 *   3. delayMs: fade the torch sprite in, spawn an additive glow halo
 *      (also fades in), kick the loop animation. If the SFX has not
 *      yet been triggered above, it fires here so single-step ignition
 *      still works without configuring a lead.
 *   4. After ignition the sprite keeps cycling the loop animation; the
 *      glow gently flickers (sine-wave alpha breathing) to read as a
 *      live flame instead of a static halo.
 *
 * The flame texture is loaded by `BootScene.preload` as the spritesheet
 * `boot_torch` (horizontal strip; frame size auto-detected as a square
 * cell using the texture height). If the texture is missing — typical
 * on a clean checkout before the artist drops the PNG — the helper
 * still produces the glow + sound + a tiny flame placeholder so the
 * intro sequence can be reviewed without art.
 */
import * as Phaser from 'phaser';

import type { SoundManager } from '../systems/SoundManager';

/** Public asset key for the boot-screen torch spritesheet. */
export const BOOT_TORCH_TEXTURE_KEY = 'boot_torch';
/** Animation key produced by {@link ensureBootTorchAnim}. */
export const BOOT_TORCH_ANIM_KEY = 'boot_torch_loop';
/**
 * Frame size (px) for `torch.png`. The spritesheet is authored as a
 * square-cell grid laid out row-major (left → right, top → bottom).
 * Phaser auto-derives the frame count from `imageWidth × imageHeight /
 * frameSize²`, so the artist can ship 4, 9, or 16 frames without
 * changes here — but if the cell size itself changes, bump this
 * constant and `public/assets/ui/README.md` together.
 */
export const BOOT_TORCH_FRAME_SIZE = 96;

export interface BootTorchOptions {
    /** Milliseconds from now until the torch ignites. */
    delayMs: number;
    /** SFX bank for the ignition sound. */
    sfx: SoundManager;
    /**
     * Display height for the torch sprite. The torch is rendered with
     * `origin.y = 1`, so the position passed to {@link createBootTorch}
     * is the BOTTOM of the torch (i.e. where the handle should sit).
     * Default 128 px.
     */
    displayHeight?: number;
    /** Z-depth for the sprite. Glow sits one below. */
    depth?: number;
    /**
     * Tint colour for the additive glow halo behind the flame.
     * Default warm orange `(255, 170, 70)`.
     */
    glowColor?: { r: number; g: number; b: number };
    /** Radius of the glow at peak (px). Default 140. */
    glowRadius?: number;
    /**
     * Flame-loop frame rate. Default 7 fps (reads as a calm wall
     * torch; bump to 12–16 for a more frantic flame). Each spawned
     * sprite further jitters its playback speed by ±15 % through
     * `sprite.anims.timeScale` so the two flanking torches on the
     * boot screen drift out of phase as they loop.
     */
    frameRate?: number;
    /**
     * Fade-in duration (ms) for the torch sprite when it ignites.
     * Default 800.
     */
    fadeDuration?: number;
    /**
     * Fade-in duration (ms) for the glow halo when the torch ignites.
     * Default 1000.
     */
    glowFadeDuration?: number;
    /**
     * If > 0, fire the `torchIgnite` SFX this many milliseconds
     * *before* the visible ignition tween starts. Lets the host
     * schedule the spark/flint cue so the audible click lands before
     * the flame visibly catches, instead of both popping in on the
     * same frame. Clamped against `delayMs`: never fires earlier than
     * the torch's own scheduling window.
     */
    sfxLeadMs?: number;
}

export interface BootTorch {
    /** Force-show the torch immediately (for skip-intro debug). */
    igniteNow(): void;
    /** Phaser objects produced, in case the host scene needs to nudge them. */
    sprite: Phaser.GameObjects.Sprite;
    glow: Phaser.GameObjects.Image | null;
    /** Removes the torch from the scene and frees its tweens. */
    destroy(): void;
}

/**
 * Create one boot-screen torch at `(x, y)`. `y` is the BOTTOM of the
 * torch (origin.y = 1) so callers can position by the handle tip.
 */
export function createBootTorch(
    scene: Phaser.Scene,
    x: number,
    y: number,
    opts: BootTorchOptions
): BootTorch {
    const displayHeight = opts.displayHeight ?? 128;
    const depth = opts.depth ?? 5;
    const glowRadius = opts.glowRadius ?? 140;
    const glowColor = opts.glowColor ?? { r: 255, g: 170, b: 70 };
    const frameRate = opts.frameRate ?? 7;
    const fadeDuration = opts.fadeDuration ?? 800;
    const glowFadeDuration = opts.glowFadeDuration ?? 1000;
    const sfxLeadMs = Math.max(0, Math.min(opts.sfxLeadMs ?? 0, opts.delayMs));

    ensureBootTorchAnim(scene, frameRate);

    const hasTexture = scene.textures.exists(BOOT_TORCH_TEXTURE_KEY);
    // Initialise on the first non-empty frame rather than Phaser's
    // default `__BASE` (the whole spritesheet). Otherwise `setDisplaySize`
    // computes its scale against the 288×288 sheet and the sprite
    // collapses when the animation later swaps in 96×96 frames. The
    // first-opaque pick also matters because AI-generated sheets
    // occasionally seed frame 0 as a fully transparent cell.
    const initialFrame = hasTexture ? (getBootTorchOpaqueFrames(scene)[0] ?? 0) : 0;
    const sprite = hasTexture
        ? scene.add.sprite(x, y, BOOT_TORCH_TEXTURE_KEY, initialFrame)
        : scene.add.sprite(x, y, '__MISSING');
    sprite.setOrigin(0.5, 1);
    sprite.setDepth(depth);
    sprite.setAlpha(0);
    if (hasTexture) {
        const aspect = sprite.frame.width / Math.max(1, sprite.frame.height);
        sprite.setDisplaySize(displayHeight * aspect, displayHeight);
    } else {
        // Hidden placeholder so layout still works on a clean checkout
        // that hasn't received the artist's PNG yet.
        sprite.setVisible(false);
    }

    let glow: Phaser.GameObjects.Image | null = null;
    let glowTween: Phaser.Tweens.Tween | null = null;
    let igniteTimer: Phaser.Time.TimerEvent | null = null;
    let sfxLeadTimer: Phaser.Time.TimerEvent | null = null;
    let igniteFadeTween: Phaser.Tweens.Tween | null = null;
    let placeholderGfx: Phaser.GameObjects.Graphics | null = null;
    let ignited = false;
    let sfxFired = false;

    // Single funnel for the ignition SFX so the pre-roll path and the
    // in-line ignite path never double-trigger when both run (e.g.
    // pre-roll fires, then a subsequent `igniteNow` rushes the visual
    // half of the cue).
    const fireIgniteSfx = () => {
        if (sfxFired) return;
        sfxFired = true;
        opts.sfx.play('torchIgnite');
    };

    const ignite = () => {
        if (ignited) return;
        ignited = true;
        fireIgniteSfx();

        // Glow halo (additive blend so the stone wall brightens
        // around the flame without occluding it).
        const glowKey = ensureGlowTexture(scene, glowRadius * 2, glowColor);
        // Glow centre offset upwards by ~75% of displayHeight so it
        // sits over the flame portion of the torch, not the handle.
        const glowY = y - displayHeight * 0.75;
        glow = scene.add
            .image(x, glowY, glowKey)
            .setDepth(depth - 1)
            .setAlpha(0)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setScale(0.55);

        igniteFadeTween = scene.tweens.add({
            targets: sprite,
            alpha: { from: 0, to: 1 },
            duration: fadeDuration,
            ease: 'Quad.out',
        });
        if (!hasTexture) {
            // Show a tiny tear-drop placeholder so the intro is
            // visible even without the artist asset. Removed when
            // the real texture lands.
            placeholderGfx = scene.add.graphics().setDepth(depth);
            placeholderGfx.fillStyle((glowColor.r << 16) | (glowColor.g << 8) | glowColor.b, 1);
            placeholderGfx.fillCircle(x, y - displayHeight * 0.65, 6);
            placeholderGfx.setAlpha(0);
            scene.tweens.add({
                targets: placeholderGfx,
                alpha: 1,
                duration: fadeDuration,
            });
        }
        scene.tweens.add({
            targets: glow,
            alpha: { from: 0, to: 1 },
            scale: { from: 0.55, to: 1.0 },
            duration: glowFadeDuration,
            ease: 'Quad.out',
            onComplete: () => {
                // Once lit, fall through to a self-rescheduling
                // "ragged flicker" instead of a clean sinusoidal
                // yoyo. Each cycle picks a fresh random target
                // alpha / scale / duration / ease, with an
                // occasional sharp "gust" dip mixed in. Two
                // independent BootTorch instances therefore never
                // share a flicker phase — each one rolls its own
                // schedule — and the eye reads them as live flames
                // rather than identical breathing halos.
                if (glow == null) return;
                scheduleGlowFlicker();
            },
        });

        if (hasTexture && scene.anims.exists(BOOT_TORCH_ANIM_KEY)) {
            const anim = scene.anims.get(BOOT_TORCH_ANIM_KEY);
            const frameCount = Math.max(1, anim?.frames.length ?? 1);
            // Per-instance start frame + playback-rate jitter so the
            // two flanking torches step through the same loop out of
            // phase. The ±15 % rate spread also guarantees they
            // never re-sync over time — even if they happened to
            // ignite on the same frame, the drift accumulates.
            const startFrame = Math.floor(Math.random() * frameCount);
            sprite.play({ key: BOOT_TORCH_ANIM_KEY, startFrame });
            sprite.anims.timeScale = 0.85 + Math.random() * 0.3;
        }
    };

    /**
     * Drive an irregular flame flicker by chaining short tweens, each
     * with randomised targets / duration / ease. Cancels itself when
     * the glow has been destroyed (see {@link BootTorch.destroy}).
     * Called inside {@link ignite} once the initial halo fade-in
     * resolves.
     */
    const scheduleGlowFlicker = (): void => {
        if (glow == null || !glow.active) return;
        // ~12 % chance of a sharp "gust" dip — fast alpha drop that
        // reads as a draught hitting the flame, then the next cycle
        // recovers via the regular range. Without this the flicker
        // can settle into a too-even oscillation.
        const gust = Math.random() < 0.12;
        const targetAlpha = gust ? 0.45 + Math.random() * 0.15 : 0.78 + Math.random() * 0.22;
        const targetScale = gust ? 0.85 + Math.random() * 0.06 : 0.94 + Math.random() * 0.16;
        const duration = gust ? 70 + Math.random() * 90 : 180 + Math.random() * 520;
        const ease = Math.random() < 0.5 ? 'Sine.inOut' : 'Quad.inOut';
        glowTween = scene.tweens.add({
            targets: glow,
            alpha: targetAlpha,
            scale: targetScale,
            duration,
            ease,
            onComplete: scheduleGlowFlicker,
        });
    };

    // Optional SFX pre-roll: fire the ignite cue a touch before the
    // visible flame catches, so the audible spark lands ahead of the
    // sprite/glow fade-in. No-op when `sfxLeadMs` is 0 or larger than
    // `delayMs` (clamped above).
    if (sfxLeadMs > 0) {
        sfxLeadTimer = scene.time.delayedCall(opts.delayMs - sfxLeadMs, fireIgniteSfx);
    }
    igniteTimer = scene.time.delayedCall(opts.delayMs, ignite);

    return {
        sprite,
        get glow() {
            return glow;
        },
        igniteNow() {
            sfxLeadTimer?.remove();
            sfxLeadTimer = null;
            igniteTimer?.remove();
            igniteTimer = null;
            ignite();
        },
        destroy() {
            sfxLeadTimer?.remove();
            sfxLeadTimer = null;
            igniteTimer?.remove();
            igniteFadeTween?.remove();
            glowTween?.remove();
            sprite.destroy();
            glow?.destroy();
            // Null the local ref so any in-flight `scheduleGlowFlicker`
            // re-entry (e.g. from a tween onComplete that fires the
            // same tick as destroy) early-returns instead of pushing
            // a new tween onto a destroyed halo.
            glow = null;
            placeholderGfx?.destroy();
        },
    };
}

/**
 * Build the boot-torch loop animation. Idempotent — calling twice with
 * the same scene reuses the registered animation. Picks the frame
 * count from the loaded texture so artist-driven changes to the
 * spritesheet length take effect automatically.
 */
function ensureBootTorchAnim(scene: Phaser.Scene, frameRate: number): void {
    if (scene.anims.exists(BOOT_TORCH_ANIM_KEY)) return;
    if (!scene.textures.exists(BOOT_TORCH_TEXTURE_KEY)) return;
    const opaque = getBootTorchOpaqueFrames(scene);
    if (opaque.length < 2) return;
    scene.anims.create({
        key: BOOT_TORCH_ANIM_KEY,
        frames: opaque.map((index) => ({ key: BOOT_TORCH_TEXTURE_KEY, frame: index })),
        frameRate,
        repeat: -1,
    });
}

/**
 * Return the indices of frames in the boot-torch spritesheet that
 * have non-trivial opaque pixel content, in source order. AI-generated
 * spritesheets occasionally seed blank cells (e.g. a transparent
 * frame 0 at the grid origin); skipping them keeps the loop animation
 * from flashing empty every revolution.
 *
 * The result is cached on the scene's texture-manager registry so
 * the per-pixel scan only runs once per session.
 */
function getBootTorchOpaqueFrames(scene: Phaser.Scene): number[] {
    const cacheKey = '__bootTorchOpaqueFrames';
    const cached = (scene.textures as unknown as Record<string, number[] | undefined>)[cacheKey];
    if (cached) return cached;
    if (!scene.textures.exists(BOOT_TORCH_TEXTURE_KEY)) return [];
    const tex = scene.textures.get(BOOT_TORCH_TEXTURE_KEY);
    const sheetFrames = tex.frameTotal - 1; // exclude `__BASE`
    if (sheetFrames < 1) return [];
    const src = tex.getSourceImage();
    const canvas = document.createElement('canvas');
    const imgWidth = (src as HTMLImageElement).width;
    const imgHeight = (src as HTMLImageElement).height;
    canvas.width = imgWidth;
    canvas.height = imgHeight;
    const ctx = canvas.getContext('2d');
    if (ctx == null) {
        // Can't sample — assume every frame is good.
        const all = Array.from({ length: sheetFrames }, (_, i) => i);
        (scene.textures as unknown as Record<string, number[]>)[cacheKey] = all;
        return all;
    }
    ctx.drawImage(src as HTMLImageElement, 0, 0);
    const result: number[] = [];
    for (let i = 0; i < sheetFrames; i++) {
        const frame = tex.get(i);
        const data = ctx.getImageData(frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight).data;
        let opaque = 0;
        for (let j = 3; j < data.length; j += 4) {
            if (data[j] > 8) opaque++;
        }
        // Require at least 1% of the cell to carry visible art so an
        // accidentally-seeded blank or near-blank frame is excluded.
        if (opaque > (frame.cutWidth * frame.cutHeight) / 100) {
            result.push(i);
        }
    }
    const final = result.length >= 2 ? result : Array.from({ length: sheetFrames }, (_, i) => i);
    (scene.textures as unknown as Record<string, number[]>)[cacheKey] = final;
    return final;
}

const GLOW_KEY_PREFIX = 'boot_torch_glow';

/**
 * Ensure a soft additive glow texture exists. Cached per (size, color)
 * tuple so two torches share one texture.
 */
function ensureGlowTexture(
    scene: Phaser.Scene,
    diameter: number,
    color: { r: number; g: number; b: number }
): string {
    const size = Math.max(8, Math.floor(diameter));
    const key = `${GLOW_KEY_PREFIX}_${size}_${color.r}_${color.g}_${color.b}`;
    if (scene.textures.exists(key)) return key;

    const tx = scene.textures.createCanvas(key, size, size);
    if (tx == null) return key;
    const ctx = tx.context;
    const cx = size / 2;
    const cy = size / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
    // Bright warm core fading to fully transparent at the edge.
    grad.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 0.95)`);
    grad.addColorStop(0.35, `rgba(${color.r}, ${color.g}, ${color.b}, 0.5)`);
    grad.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    tx.refresh();
    return key;
}
