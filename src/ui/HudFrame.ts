/**
 * HUD frame renderer.
 *
 * Both bars use hand-authored carved-stone PNGs. The bottom bar uses
 * Phaser nine-slice because it must remain crisp if `GAME_WIDTH`
 * changes; the top bar PNG is authored at exactly the render size
 * (1024×96) so a plain image is sufficient. A procedural fallback
 * exists for both in case the PNG fails to load (e.g. in tests).
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
    height: number,
): Phaser.GameObjects.GameObject {
    return withTexture(
        scene,
        'hud_top_bar',
        () =>
            scene.add
                .image(0, 0, 'hud_top_bar')
                .setOrigin(0, 0)
                .setDisplaySize(width, height),
        () => drawProceduralTopBar(scene, 0, 0, width, height),
    );
}

/** Draw the bottom HUD frame. */
export function drawBottomFrame(
    scene: Phaser.Scene,
    y: number,
    width: number,
    height: number,
): Phaser.GameObjects.GameObject {
    return withTexture(
        scene,
        'hud_bottom_bar',
        () =>
            scene.add
                .nineslice(
                    0,
                    y,
                    'hud_bottom_bar',
                    undefined,
                    width,
                    height,
                    PANEL_SLICE.left,
                    PANEL_SLICE.right,
                    PANEL_SLICE.top,
                    PANEL_SLICE.bottom,
                )
                .setOrigin(0, 0),
        () => drawFallbackPanel(scene, 0, y, width, height),
    );
}

/**
 * Draw a free-floating carved-stone panel anywhere on the screen.
 *
 * Reuses the same `hud_bottom_bar` PNG via Phaser nine-slice when the
 * texture is available, so the L-shaped corner ornaments stay sharp at
 * any width/height. Falls back to the procedural fallback panel (a
 * darker fill with rune-dot corners) when the texture is missing — used
 * by tests and for the brief loading window before BootScene completes.
 *
 * Both branches return objects that implement the Depth component, so
 * the union return type lets callers chain `.setDepth(...)` without a
 * cast.
 */
export function drawCarvedPanel(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
): Phaser.GameObjects.NineSlice | Phaser.GameObjects.Container {
    return withTexture(
        scene,
        'hud_bottom_bar',
        () =>
            scene.add
                .nineslice(
                    x,
                    y,
                    'hud_bottom_bar',
                    undefined,
                    width,
                    height,
                    PANEL_SLICE.left,
                    PANEL_SLICE.right,
                    PANEL_SLICE.top,
                    PANEL_SLICE.bottom,
                )
                .setOrigin(0, 0),
        () => drawFallbackPanel(scene, x, y, width, height),
    );
}

/**
 * Draw a sub-panel using the `hud_top_bar` PNG via nine-slice.
 *
 * Used for inner sections on the death/victory screen (e.g. summary
 * panel, prestige upgrade panel). Falls back to the same procedural
 * panel used by `drawCarvedPanel` when the texture is missing.
 */
export function drawTopBarPanel(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
): Phaser.GameObjects.NineSlice | Phaser.GameObjects.Container {
    return withTexture(
        scene,
        'hud_top_bar',
        () =>
            scene.add
                .nineslice(
                    x,
                    y,
                    'hud_top_bar',
                    undefined,
                    width,
                    height,
                    PANEL_SLICE.left,
                    PANEL_SLICE.right,
                    PANEL_SLICE.top,
                    PANEL_SLICE.bottom,
                )
                .setOrigin(0, 0),
        () => drawFallbackPanel(scene, x, y, width, height),
    );
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
    height: number,
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
    h: number,
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
    h: number,
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
