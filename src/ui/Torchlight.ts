/**
 * Torchlight overlay — a radial darkening gradient that simulates a
 * lantern/torch shedding light over the play area. The center of the
 * gradient stays mostly clear so room cards and the carved panel stay
 * visible, while the edges fade nearly to black so the rest of the
 * stone wall reads as "swallowed by the dungeon".
 *
 * The overlay is drawn into an offscreen canvas via the native HTML5
 * `CanvasRenderingContext2D.createRadialGradient` (Phaser's Graphics
 * does not expose radial gradients), then registered as a `CanvasTexture`
 * and added as a regular `Image`. Cached by parameter set, so repeated
 * calls with the same options reuse the texture.
 */
import * as Phaser from 'phaser';

const KEY_PREFIX = 'torchlight_overlay';

export interface TorchlightOptions {
    /** Distance from the centre at which the overlay reaches `centerAlpha`.
     *  Inside this radius the wall reads as the brightest point. */
    innerRadius: number;
    /** Distance at which the overlay reaches `edgeAlpha`. Beyond this the
     *  stone is uniformly dark. */
    outerRadius: number;
    /** Alpha applied at and within `innerRadius` (0 = fully clear, 1 =
     *  solid black). A small non-zero value gently dims the centre too. */
    centerAlpha?: number;
    /** Alpha applied at and beyond `outerRadius`. Higher = darker edges. */
    edgeAlpha?: number;
    /** Cache-key suffix override. Defaults to a deterministic hash of the
     *  width/height/radii/alphas. */
    keySuffix?: string;
}

/**
 * Ensure a torchlight gradient texture exists and return its key.
 * Idempotent — calls with identical parameters reuse the cached texture.
 */
export function ensureTorchlightTexture(
    scene: Phaser.Scene,
    width: number,
    height: number,
    opts: TorchlightOptions,
): string {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const innerR = Math.max(0, opts.innerRadius);
    const outerR = Math.max(innerR + 1, opts.outerRadius);
    const centerA = clamp01(opts.centerAlpha ?? 0);
    const edgeA = clamp01(opts.edgeAlpha ?? 0.9);
    const suffix =
        opts.keySuffix ??
        `${w}x${h}_r${Math.round(innerR)}-${Math.round(outerR)}_a${Math.round(
            centerA * 100,
        )}-${Math.round(edgeA * 100)}`;
    const key = `${KEY_PREFIX}_${suffix}`;
    if (scene.textures.exists(key)) return key;

    const tx = scene.textures.createCanvas(key, w, h);
    if (tx == null) return key;
    const ctx = tx.context;
    const cx = w / 2;
    const cy = h / 2;
    const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    grad.addColorStop(0, `rgba(0,0,0,${centerA})`);
    grad.addColorStop(1, `rgba(0,0,0,${edgeA})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    tx.refresh();
    return key;
}

/**
 * Add a torchlight overlay as a scene-level `Image`. Caller positions it
 * via `setPosition` / `setOrigin` and assigns the depth (typically just
 * above the stone wall and below the room content).
 */
export function createTorchlightOverlay(
    scene: Phaser.Scene,
    width: number,
    height: number,
    opts: TorchlightOptions,
): Phaser.GameObjects.Image {
    const key = ensureTorchlightTexture(scene, width, height, opts);
    return scene.add.image(0, 0, key).setOrigin(0, 0);
}

function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}
