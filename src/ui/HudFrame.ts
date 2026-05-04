/**
 * Carved-stone HUD frame renderer.
 *
 * Tries to use the hand-authored PNG (`hud_top_bar` / `hud_bottom_bar`)
 * loaded by {@link import('../scenes/BootScene').BootScene}. When the
 * texture is missing we fall back to drawing a thin layered rectangle
 * with subtle highlight/shadow so the HUD still has structure.
 *
 * The PNG path uses Phaser's {@link Phaser.GameObjects.NineSlice}: the
 * 32×32 corner ornaments are rendered at native pixel size, the four
 * edges stretch only along their long axis, and the center stone tile
 * stretches to fill the remainder. This preserves the carved Greek-key
 * corners (and the right-side skull on the top bar) regardless of how
 * tall or wide the panel is, instead of squeezing the entire image.
 *
 * Both rendering modes return a single `GameObject` so callers can add
 * it to a `Container` and depth-sort uniformly.
 */
import * as Phaser from 'phaser';

import { HudColors } from './HudTheme';

/**
 * Slice metrics, in source-texture pixels. The L-shaped Greek-key
 * ornaments end at roughly x=24-28 / y=22-26 in both top_bar.png
 * (134px tall) and bottom_bar.png (155px tall). Vertical slices are
 * deliberately tighter than horizontal ones so the visible top/bottom
 * gold rim does not eat half of the panel's interior — the L-corner
 * still stays sharp because its main mass sits above y=22.
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
 * @returns the visual game object representing the frame.
 */
export function drawTopFrame(
    scene: Phaser.Scene,
    width: number,
    height: number,
): Phaser.GameObjects.GameObject {
    if (scene.textures.exists('hud_top_bar')) {
        return scene.add
            .nineslice(
                0,
                0,
                'hud_top_bar',
                undefined,
                width,
                height,
                PANEL_SLICE.left,
                PANEL_SLICE.right,
                PANEL_SLICE.top,
                PANEL_SLICE.bottom,
            )
            .setOrigin(0, 0);
    }
    return drawFallbackPanel(scene, 0, 0, width, height);
}

/** Draw the bottom HUD frame. */
export function drawBottomFrame(
    scene: Phaser.Scene,
    y: number,
    width: number,
    height: number,
): Phaser.GameObjects.GameObject {
    if (scene.textures.exists('hud_bottom_bar')) {
        return scene.add
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
            .setOrigin(0, 0);
    }
    return drawFallbackPanel(scene, 0, y, width, height);
}

/**
 * Render the optional stone-wall background between the two HUD bars.
 * Returns `null` if the texture is unavailable so callers know not to
 * insert anything into the scene graph.
 */
export function drawStoneBackdrop(
    scene: Phaser.Scene,
    y: number,
    width: number,
    height: number,
): Phaser.GameObjects.Image | null {
    if (!scene.textures.exists('hud_stone_wall')) {
        return null;
    }
    return scene.add
        .image(0, y, 'hud_stone_wall')
        .setOrigin(0, 0)
        .setDisplaySize(width, height);
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
