/**
 * Carved-stone HUD frame renderer.
 *
 * Tries to use the hand-authored PNG (`hud_top_bar` / `hud_bottom_bar`)
 * loaded by {@link import('../scenes/BootScene').BootScene}. When the
 * texture is missing we fall back to drawing a thin layered rectangle
 * with subtle highlight/shadow so the HUD still has structure.
 *
 * Both rendering modes return a single `GameObject` so callers can add
 * it to a `Container` and depth-sort uniformly.
 */
import * as Phaser from 'phaser';

import { HudColors } from './HudTheme';

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
            .image(0, 0, 'hud_top_bar')
            .setOrigin(0, 0)
            .setDisplaySize(width, height);
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
            .image(0, y, 'hud_bottom_bar')
            .setOrigin(0, 0)
            .setDisplaySize(width, height);
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
