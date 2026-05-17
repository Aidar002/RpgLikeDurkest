/**
 * HUD frame renderer.
 *
 * Both bars use hand-authored carved-stone PNGs. The bottom bar uses
 * Phaser nine-slice because it must remain crisp if `GAME_WIDTH`
 * changes; the top bar PNG is authored at exactly the render size
 * (1024×96) so a plain image is sufficient. A procedural fallback
 * exists for both in case the PNG fails to load (e.g. in tests).
 *
 * Free-floating panels (death/escape screen) use a *tiled* nine-slice
 * (corners stamped at native size, edges tiled from a narrow source
 * sliver, center filled flat) — Phaser's built-in `add.nineslice`
 * stretches the center of the source PNG, which produces visible
 * vertical streaks when the carved-stone texture is sized to e.g.
 * 940×700 on the death screen. See {@link drawTiledNineSlice}.
 *
 * Both modes return a single `GameObject` so callers can add it to a
 * `Container` and depth-sort uniformly.
 */
import * as Phaser from 'phaser';

import { hasTexture, withTexture } from './AssetGuard';
import { HudColors } from './HudTheme';
import { createStoneBackdrop } from './StoneBackdrop';

/**
 * Slice metrics, in source-texture pixels. The L-shaped Greek-key
 * ornaments end at roughly x=24-28 / y=22-26 in bottom_bar.png
 * (155px tall). Vertical slices are deliberately tighter than
 * horizontal ones so the visible top/bottom gold rim does not eat
 * half of the panel's interior — the L-corner still stays sharp
 * because its main mass sits above y=22.
 */
const PANEL_SLICE = {
    left: 32,
    right: 32,
    top: 22,
    bottom: 22,
} as const;

/**
 * Width of the narrow source sliver tiled along each panel edge. Has
 * to be small enough that several copies fit between the corners (so
 * the rim's gold + dark stone band reads as a continuous bar) and
 * large enough that any subtle per-pixel noise in the source averages
 * out. 32 px matches the corner slice width and gives ~28 repetitions
 * across a 940-px panel — well above the perceptual seam threshold
 * for an essentially-uniform gold rim.
 */
const EDGE_TILE = 32;

/**
 * Flat fill colour stamped behind the tiled rim pieces. Sampled from
 * the centres of `bottom_bar.png` (avg #0f1012) and `top_bar.png`
 * (avg #09090b), rounded to {@link HudColors.panelBg} so a tone-shift
 * of those PNGs only needs one constant updated.
 */
const PANEL_CENTER_FILL = HudColors.panelBg;

const SLICE_FRAME_PREFIX = 'nine_slice__';
const SLICE_FRAMES = [
    'corner_tl',
    'corner_tr',
    'corner_bl',
    'corner_br',
    'edge_top',
    'edge_bottom',
    'edge_left',
    'edge_right',
] as const;

/**
 * Lazily register 8 sub-frames (4 corners + 4 narrow edge slivers) on
 * the source texture. Phaser's `Texture.add` is idempotent only if we
 * gate on a sentinel — repeat registrations log a warning. Returns
 * `false` when the texture isn't loaded so callers fall back to the
 * procedural panel.
 */
function ensureSliceFrames(scene: Phaser.Scene, key: string): boolean {
    if (!hasTexture(scene, key)) {
        return false;
    }
    const texture = scene.textures.get(key);
    const sentinel = `${SLICE_FRAME_PREFIX}${SLICE_FRAMES[0]}`;
    if (texture.has(sentinel)) {
        return true;
    }
    const src = texture.source[0];
    const w = src.width;
    const h = src.height;
    const { left, right, top, bottom } = PANEL_SLICE;
    const midX = Math.floor((w - EDGE_TILE) / 2);
    const midY = Math.floor((h - EDGE_TILE) / 2);

    texture.add(`${SLICE_FRAME_PREFIX}corner_tl`, 0, 0, 0, left, top);
    texture.add(`${SLICE_FRAME_PREFIX}corner_tr`, 0, w - right, 0, right, top);
    texture.add(`${SLICE_FRAME_PREFIX}corner_bl`, 0, 0, h - bottom, left, bottom);
    texture.add(`${SLICE_FRAME_PREFIX}corner_br`, 0, w - right, h - bottom, right, bottom);
    texture.add(`${SLICE_FRAME_PREFIX}edge_top`, 0, midX, 0, EDGE_TILE, top);
    texture.add(`${SLICE_FRAME_PREFIX}edge_bottom`, 0, midX, h - bottom, EDGE_TILE, bottom);
    texture.add(`${SLICE_FRAME_PREFIX}edge_left`, 0, 0, midY, left, EDGE_TILE);
    texture.add(`${SLICE_FRAME_PREFIX}edge_right`, 0, w - right, midY, right, EDGE_TILE);

    // `Texture.add` re-points `firstFrame` to the first user-added
    // frame whenever the texture had only `__BASE` registered, which
    // means any subsequent `scene.add.image('key')` (no frame arg)
    // would resolve to one of the 32×22 corner pieces instead of the
    // full bar — manifesting as a visibly garbled HUD after the
    // death-screen mounts. Pin it back so the default frame keeps
    // representing the whole texture.
    texture.firstFrame = '__BASE';
    return true;
}

/**
 * Compose a nine-slice panel where the four corners are stamped at
 * native size, the four edges *tile* a narrow source sliver, and the
 * center is a flat dark fill.
 *
 * Why not Phaser's `add.nineslice`? Both `bottom_bar.png` (1024×155)
 * and `top_bar.png` (1024×96) are authored at HUD-bar size. Used
 * unmodified for a near-1:1 HUD frame they look great, but on the
 * death screen the carved panel is sized 940×700 — a 4.5× vertical
 * stretch of the center, which paints the source's stone-mortar lines
 * as long vertical streaks. Tiling preserves the rim detail without
 * stretching the inner texture.
 *
 * Returns a Container so callers can `setDepth` / `setVisible` /
 * `setAlpha` the assembly as one unit.
 */
function drawTiledNineSlice(
    scene: Phaser.Scene,
    key: string,
    x: number,
    y: number,
    width: number,
    height: number
): Phaser.GameObjects.Container {
    const { left, right, top, bottom } = PANEL_SLICE;
    const innerW = Math.max(1, width - left - right);
    const innerH = Math.max(1, height - top - bottom);

    // Flat fill behind the rim picks up any sub-pixel gap at the seams
    // so the canvas colour never bleeds through.
    const fill = scene.add.rectangle(0, 0, width, height, PANEL_CENTER_FILL, 1).setOrigin(0, 0);

    // Four corners — exact rim pieces, never scaled.
    const cornerTL = scene.add.image(0, 0, key, `${SLICE_FRAME_PREFIX}corner_tl`).setOrigin(0, 0);
    const cornerTR = scene.add
        .image(width - right, 0, key, `${SLICE_FRAME_PREFIX}corner_tr`)
        .setOrigin(0, 0);
    const cornerBL = scene.add
        .image(0, height - bottom, key, `${SLICE_FRAME_PREFIX}corner_bl`)
        .setOrigin(0, 0);
    const cornerBR = scene.add
        .image(width - right, height - bottom, key, `${SLICE_FRAME_PREFIX}corner_br`)
        .setOrigin(0, 0);

    // Four edges — TileSprite repeats the narrow source sliver along
    // its long axis. The rim's gold band sits at the same pixel offset
    // in every tile so the joint between corner and edge is seamless.
    const edgeTop = scene.add
        .tileSprite(left, 0, innerW, top, key, `${SLICE_FRAME_PREFIX}edge_top`)
        .setOrigin(0, 0);
    const edgeBottom = scene.add
        .tileSprite(left, height - bottom, innerW, bottom, key, `${SLICE_FRAME_PREFIX}edge_bottom`)
        .setOrigin(0, 0);
    const edgeLeft = scene.add
        .tileSprite(0, top, left, innerH, key, `${SLICE_FRAME_PREFIX}edge_left`)
        .setOrigin(0, 0);
    const edgeRight = scene.add
        .tileSprite(width - right, top, right, innerH, key, `${SLICE_FRAME_PREFIX}edge_right`)
        .setOrigin(0, 0);

    return scene.add.container(x, y, [
        fill,
        edgeTop,
        edgeBottom,
        edgeLeft,
        edgeRight,
        cornerTL,
        cornerTR,
        cornerBL,
        cornerBR,
    ]);
}

/**
 * Draw the top HUD frame.
 *
 * Uses the carved-stone `hud_top_bar` PNG when available — the asset
 * is authored at exactly the rendered size so a plain `Image` works
 * (no need for nine-slice). Falls back to a procedural panel when the
 * texture is missing.
 *
 * @returns the visual game object representing the frame.
 */
export function drawTopFrame(
    scene: Phaser.Scene,
    width: number,
    height: number
): Phaser.GameObjects.GameObject {
    return withTexture(
        scene,
        'hud_top_bar',
        () =>
            // Pass `'__BASE'` explicitly so the image always resolves to
            // the full bar, even after `ensureSliceFrames` has registered
            // sub-frames on this texture for the death-screen panels.
            scene.add
                .image(0, 0, 'hud_top_bar', '__BASE')
                .setOrigin(0, 0)
                .setDisplaySize(width, height),
        () => drawProceduralTopBar(scene, 0, 0, width, height)
    );
}

/** Draw the bottom HUD frame. */
export function drawBottomFrame(
    scene: Phaser.Scene,
    y: number,
    width: number,
    height: number
): Phaser.GameObjects.GameObject {
    return withTexture(
        scene,
        'hud_bottom_bar',
        () =>
            // Same `'__BASE'` belt-and-braces as `drawTopFrame` — the
            // texture may have nine-slice sub-frames registered if the
            // death screen has been mounted earlier in the run.
            scene.add
                .nineslice(
                    0,
                    y,
                    'hud_bottom_bar',
                    '__BASE',
                    width,
                    height,
                    PANEL_SLICE.left,
                    PANEL_SLICE.right,
                    PANEL_SLICE.top,
                    PANEL_SLICE.bottom
                )
                .setOrigin(0, 0),
        () => drawFallbackPanel(scene, 0, y, width, height)
    );
}

/**
 * Draw a free-floating carved-stone panel anywhere on the screen.
 *
 * Composes the panel from native-size corners + tiled edges + a flat
 * dark fill (see {@link drawTiledNineSlice}). Falls back to the
 * procedural fallback panel (darker fill with rune-dot corners) when
 * the texture is missing — used by tests and for the brief loading
 * window before BootScene completes.
 *
 * Returns a Container so callers can chain `.setDepth(...)` /
 * `.setVisible(...)` / `.setAlpha(...)` uniformly across the textured
 * and procedural branches.
 */
export function drawCarvedPanel(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number
): Phaser.GameObjects.Container {
    if (ensureSliceFrames(scene, 'hud_bottom_bar')) {
        return drawTiledNineSlice(scene, 'hud_bottom_bar', x, y, width, height);
    }
    return drawFallbackPanel(scene, x, y, width, height);
}

/**
 * Draw a sub-panel using the `hud_top_bar` PNG.
 *
 * Used for inner sections on the death/victory screen (e.g. summary
 * panel, skill-points sub-panel). Same tiled nine-slice composition
 * as {@link drawCarvedPanel}; falls back to the procedural panel when
 * the texture is missing.
 */
export function drawTopBarPanel(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number
): Phaser.GameObjects.Container {
    if (ensureSliceFrames(scene, 'hud_top_bar')) {
        return drawTiledNineSlice(scene, 'hud_top_bar', x, y, width, height);
    }
    return drawFallbackPanel(scene, x, y, width, height);
}

/**
 * Render the carved stone-wall background between the two HUD bars.
 *
 * Prefers the authored `hud_stone_wall` PNG when it is loaded, and
 * falls back to the procedural `StoneBackdrop` renderer otherwise so
 * the play area always reads as a dungeon wall instead of the bare
 * canvas colour.
 */
export function drawStoneBackdrop(
    scene: Phaser.Scene,
    y: number,
    width: number,
    height: number
): Phaser.GameObjects.Image {
    if (hasTexture(scene, 'hud_stone_wall')) {
        return scene.add
            .image(0, y, 'hud_stone_wall')
            .setOrigin(0, 0)
            .setDisplaySize(width, height);
    }
    return createStoneBackdrop(scene, 0, y, width, height);
}

/**
 * Layered procedural top bar:
 *   1. solid outer rim
 *   2. dark fill
 *   3. 1-px gradient band along the top edge (warm gold, 50%→0% alpha)
 *   4. 2-px inner shadow on the bottom so the play area visually drops
 *      away from the bar
 *   5. faint divider line below the rim
 */
function drawProceduralTopBar(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    h: number
): Phaser.GameObjects.Container {
    const g = scene.add.graphics();
    // Outer rim — same colour as the panel border tokens.
    g.fillStyle(HudColors.panelOuter, 1);
    g.fillRect(x, y, w, h);
    // Main fill, slightly lighter than `panelBg` so the bar reads as
    // raised relative to the play area below.
    g.fillStyle(0x12101a, 1);
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
    // Subtle top-to-bottom darkening — the upper band is a hint
    // brighter so the rim catches the eye.
    g.fillGradientStyle(0x1a1622, 0x1a1622, 0x0a0810, 0x0a0810, 1, 1, 1, 1);
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
    // Top gold rim — 1 px solid + 1 px softer.
    g.fillStyle(HudColors.cellGoldEdge, 0.7);
    g.fillRect(x + 1, y + 1, w - 2, 1);
    g.fillStyle(HudColors.cellGoldEdge, 0.18);
    g.fillRect(x + 1, y + 2, w - 2, 1);
    // Faint divider 4 px below the rim — frames the icon row.
    g.fillStyle(HudColors.panelHi, 0.45);
    g.fillRect(x + 8, y + 6, w - 16, 1);
    // Bottom inner shadow — fades the bar into the play area.
    g.fillStyle(HudColors.panelLo, 0.9);
    g.fillRect(x + 1, y + h - 3, w - 2, 1);
    g.fillStyle(0x000000, 0.55);
    g.fillRect(x + 1, y + h - 2, w - 2, 1);
    // Side gold accents — short vertical strokes flanking the bar.
    g.fillStyle(HudColors.cellGoldEdge, 0.55);
    g.fillRect(x + 1, y + 1, 1, h - 2);
    g.fillRect(x + w - 2, y + 1, 1, h - 2);
    return scene.add.container(0, 0, [g]);
}

function drawFallbackPanel(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    h: number
): Phaser.GameObjects.Container {
    const g = scene.add.graphics();
    // Outer rim.
    g.fillStyle(HudColors.panelOuter, 1);
    g.fillRect(x, y, w, h);
    // Inner panel surface.
    g.fillStyle(HudColors.panelBg, 1);
    g.fillRect(x + 2, y + 2, w - 4, h - 4);
    // Top highlight strip.
    g.fillStyle(HudColors.panelHi, 0.4);
    g.fillRect(x + 2, y + 2, w - 4, 1);
    // Bottom shadow strip.
    g.fillStyle(HudColors.panelLo, 0.7);
    g.fillRect(x + 2, y + h - 3, w - 4, 1);

    // Corner rune dots — matches the PNG decorations in spirit.
    g.fillStyle(HudColors.panelHi, 0.9);
    const r = 2;
    const offset = 6;
    g.fillRect(x + offset, y + offset, r, r);
    g.fillRect(x + w - offset - r, y + offset, r, r);
    g.fillRect(x + offset, y + h - offset - r, r, r);
    g.fillRect(x + w - offset - r, y + h - offset - r, r, r);

    return scene.add.container(0, 0, [g]);
}
