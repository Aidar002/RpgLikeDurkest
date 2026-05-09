/**
 * Procedural carved-stone backdrop.
 *
 * Bakes a tiled-brick stone-wall image (irregular brick rows, mortar
 * gaps, per-brick colour jitter, occasional cracks and grime, soft
 * vignette around the edges) into the scene's texture cache so it can
 * be reused as a static `Image`. The pattern is deterministic — the
 * same dimensions + seed always produce the same wall, so reloading
 * the page does not shuffle the visible cracks.
 *
 * Used as the play-area backdrop in `GameScene`, the menu backdrop in
 * `BootScene`, and behind the death/victory overlays.
 */
import * as Phaser from 'phaser';

import { Mulberry32, type Rng } from '../systems/Rng';

const KEY_PREFIX = 'procedural_stone_backdrop';
const SEED_DEFAULT = 0x5746;

/** Mortar / gap colour — what shows between bricks. */
const MORTAR_COLOR = 0x14110e;
/** Top-edge highlight (torchlight catching the brick face). */
const HIGHLIGHT_COLOR = 0x5a5045;
/** Bottom-edge shadow under each brick. */
const SHADOW_COLOR = 0x1c1814;
/** Crack hairline colour. */
const CRACK_COLOR = 0x100d0a;
/** Dirt / grime blotch colour. */
const GRIME_COLOR = 0x241f1a;
/** Brick base colours — picked at random per brick for variation. */
const BRICK_PALETTE = [0x3a3530, 0x423b34, 0x4a423a, 0x352e29, 0x3d3530] as const;

interface StoneBackdropOptions {
    /**
     * Cache-key suffix override. The full key is
     * `procedural_stone_backdrop_<suffix>`. Defaults to `<width>x<height>`,
     * so callers asking for the same dimensions share the texture.
     * Pass an explicit suffix when you need distinct variants for the
     * same dimensions (e.g. menu vs. end-screen).
     */
    keySuffix?: string;
    /** Seed for the brick layout / cracks. Same seed → same wall. */
    seed?: number;
    /**
     * Multiplier applied to every brick / highlight / shadow channel.
     * `1` is the default; lower values darken the wall (useful behind
     * end-screen panels where the foreground UI must dominate).
     */
    brightness?: number;
}

/**
 * Ensure a procedural stone-wall texture exists in the scene's texture
 * cache and return its key. Idempotent — calling twice with the same
 * dimensions / options reuses the cached texture.
 */
function ensureStoneTexture(
    scene: Phaser.Scene,
    width: number,
    height: number,
    opts: StoneBackdropOptions = {}
): string {
    const dims = `${Math.max(1, Math.floor(width))}x${Math.max(1, Math.floor(height))}`;
    const suffix = opts.keySuffix ?? dims;
    const brightnessTag = opts.brightness != null ? `_b${Math.round(opts.brightness * 100)}` : '';
    const key = `${KEY_PREFIX}_${suffix}${brightnessTag}`;
    if (scene.textures.exists(key)) return key;

    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    drawStone(g, Math.floor(width), Math.floor(height), opts);
    g.generateTexture(key, Math.floor(width), Math.floor(height));
    g.destroy();
    return key;
}

/**
 * Add a stone-wall `Image` to the scene at `(x, y)` with the given
 * dimensions. Caller is responsible for depth ordering; the image
 * uses `setOrigin(0, 0)` so `(x, y)` is its top-left.
 *
 * If the authored `hud_stone_wall` PNG has been preloaded, that
 * raster is used and the procedural pipeline is skipped. The
 * `brightness` option is then applied as a tint on the image so
 * end-screen variants still read as darker than the play area.
 */
export function createStoneBackdrop(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    opts: StoneBackdropOptions = {}
): Phaser.GameObjects.Image {
    if (scene.textures.exists('hud_stone_wall')) {
        const img = scene.add
            .image(x, y, 'hud_stone_wall')
            .setOrigin(0, 0)
            .setDisplaySize(width, height);
        const brightness = opts.brightness ?? 1;
        if (brightness < 1) {
            const v = Math.max(0, Math.min(255, Math.round(255 * brightness)));
            img.setTint(Phaser.Display.Color.GetColor(v, v, v));
        }
        return img;
    }
    const key = ensureStoneTexture(scene, width, height, opts);
    return scene.add.image(x, y, key).setOrigin(0, 0);
}

// ─── private rendering ─────────────────────────────────────────────────

function drawStone(
    g: Phaser.GameObjects.Graphics,
    width: number,
    height: number,
    opts: StoneBackdropOptions
): void {
    const rng = new Mulberry32((opts.seed ?? SEED_DEFAULT) >>> 0 || 1);
    const brightness = opts.brightness ?? 1;

    // Mortar fills everywhere a brick does not cover, which gives the
    // mortar lines for free.
    g.fillStyle(adjustBrightness(MORTAR_COLOR, brightness), 1);
    g.fillRect(0, 0, width, height);

    layBricks(g, rng, width, height, brightness);
    layVignette(g, width, height);
}

function layBricks(
    g: Phaser.GameObjects.Graphics,
    rng: Rng,
    width: number,
    height: number,
    brightness: number
): void {
    const ROW_H_MIN = 26;
    const ROW_H_MAX = 38;
    const BRICK_W_MIN = 84;
    const BRICK_W_MAX = 132;
    const MORTAR_GAP = 3;

    let cy = 0;
    let rowIndex = 0;
    while (cy < height) {
        const rowH = randInt(rng, ROW_H_MIN, ROW_H_MAX);
        // Stagger every other row by ~half a brick so vertical mortar
        // lines do not stack — the running-bond pattern reads as
        // proper masonry instead of a grid.
        const stagger =
            rowIndex % 2 === 0
                ? 0
                : -randInt(rng, Math.floor(BRICK_W_MIN / 2) - 8, Math.floor(BRICK_W_MIN / 2) + 12);

        let cx = stagger;
        while (cx < width) {
            const brickW = randInt(rng, BRICK_W_MIN, BRICK_W_MAX);
            const visibleX = Math.max(cx, 0);
            const visibleRight = Math.min(cx + brickW, width);
            const visibleW = visibleRight - visibleX;
            const visibleH = Math.min(rowH, height - cy);

            if (visibleW > 4 && visibleH > 4) {
                const halfGap = MORTAR_GAP / 2;
                const brickX = visibleX + halfGap;
                const brickY = cy + halfGap;
                const w = visibleW - MORTAR_GAP;
                const h = visibleH - MORTAR_GAP;
                drawBrickFace(g, rng, brickX, brickY, w, h, brightness);
            }

            cx += brickW;
        }
        cy += rowH;
        rowIndex += 1;
    }
}

function drawBrickFace(
    g: Phaser.GameObjects.Graphics,
    rng: Rng,
    x: number,
    y: number,
    w: number,
    h: number,
    brightness: number
): void {
    if (w <= 0 || h <= 0) return;

    const baseIdx = Math.floor(rng.next() * BRICK_PALETTE.length);
    const baseColor = adjustBrightness(BRICK_PALETTE[baseIdx] ?? BRICK_PALETTE[0], brightness);
    g.fillStyle(baseColor, 1);
    g.fillRect(x, y, w, h);

    // Vertical micro-banding inside the brick — three thin slabs at
    // slightly different brightness so the brick is not a flat block.
    const slabCount = randInt(rng, 2, 4);
    for (let i = 0; i < slabCount; i++) {
        const slabW = Math.max(2, Math.floor(w / slabCount) + randInt(rng, -3, 3));
        const slabX = x + Math.floor(rng.next() * Math.max(1, w - slabW));
        const slabH = Math.max(1, h - 2);
        const tint = rng.next() < 0.5 ? 1.07 : 0.92;
        g.fillStyle(adjustBrightness(baseColor, tint * brightness), 0.18);
        g.fillRect(slabX, y + 1, slabW, slabH);
    }

    // Top highlight — 1 px catching torchlight.
    g.fillStyle(adjustBrightness(HIGHLIGHT_COLOR, brightness), 0.55);
    g.fillRect(x, y, w, 1);

    // Bottom shadow — 1 px under-edge.
    g.fillStyle(SHADOW_COLOR, 0.55);
    g.fillRect(x, y + h - 1, w, 1);

    // Per-brick grime / soot blotches.
    const grimeCount = Math.floor(rng.next() * 3);
    for (let i = 0; i < grimeCount; i++) {
        const gw = randInt(rng, 4, 14);
        const gh = randInt(rng, 2, 5);
        const gx = x + Math.floor(rng.next() * Math.max(1, w - gw));
        const gy = y + Math.floor(rng.next() * Math.max(1, h - gh));
        g.fillStyle(GRIME_COLOR, 0.4);
        g.fillRect(gx, gy, gw, gh);
    }

    // Occasional hairline crack across the brick face.
    if (rng.next() < 0.09) {
        const cx0 = x + Math.floor(rng.next() * w);
        const cy0 = y + Math.floor(rng.next() * h);
        const len = randInt(rng, 8, Math.max(10, Math.floor(w * 0.6)));
        const dir = rng.next() < 0.5 ? -1 : 1;
        const cx1 = Math.max(x, Math.min(x + w, cx0 + Math.floor(len * dir * 0.7)));
        const cy1 = Math.max(y, Math.min(y + h, cy0 + randInt(rng, -2, 2)));
        g.lineStyle(1, CRACK_COLOR, 0.9);
        g.lineBetween(cx0, cy0, cx1, cy1);
    }
}

function layVignette(g: Phaser.GameObjects.Graphics, width: number, height: number): void {
    // Soft edge darkening applied as four gradient bands. Phaser's
    // Graphics gradient fills only support 4-corner stops, so we
    // render the four edges separately instead of a single radial.
    const dark = 0x000000;
    const strength = 0.45;
    const topBand = Math.min(96, Math.max(20, Math.floor(height * 0.35)));
    const bottomBand = Math.min(96, Math.max(20, Math.floor(height * 0.35)));
    const sideBand = Math.min(96, Math.max(20, Math.floor(width * 0.18)));

    g.fillGradientStyle(dark, dark, dark, dark, strength, strength, 0, 0);
    g.fillRect(0, 0, width, topBand);

    g.fillGradientStyle(dark, dark, dark, dark, 0, 0, strength, strength);
    g.fillRect(0, height - bottomBand, width, bottomBand);

    g.fillGradientStyle(dark, dark, dark, dark, strength, 0, strength, 0);
    g.fillRect(0, 0, sideBand, height);

    g.fillGradientStyle(dark, dark, dark, dark, 0, strength, 0, strength);
    g.fillRect(width - sideBand, 0, sideBand, height);
}

function randInt(rng: Rng, min: number, max: number): number {
    return Math.floor(rng.next() * (max - min + 1)) + min;
}

function adjustBrightness(color: number, factor: number): number {
    if (factor === 1) return color;
    const r = clampByte(((color >> 16) & 0xff) * factor);
    const g = clampByte(((color >> 8) & 0xff) * factor);
    const b = clampByte((color & 0xff) * factor);
    return (r << 16) | (g << 8) | b;
}

function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}
