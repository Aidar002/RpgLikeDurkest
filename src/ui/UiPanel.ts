/**
 * Stylised UI panel helper.
 *
 * Wraps a textured nine-slice panel (`panel_small.png`, registered by
 * `BootScene.preload`) with a graceful procedural fallback when the
 * texture is missing. Used for the upgrade-shop cards and the
 * skill-points pilule on the escape screen so they share the
 * carved-bronze frame look of the rest of the HUD.
 *
 * The 240×212 source asset has the L-bracket corner ornaments fitting
 * within the first ~15 px from each edge; everything past that is the
 * thin bronze edge line + the dark navy fill. `PANEL_SLICE = 16`
 * captures the ornament with a one-pixel safety margin.
 *
 * Both code paths return the same union type — `setInteractive`,
 * depth/visibility/origin, and tint/stroke setters work uniformly so
 * call-sites don't need to branch on `textured`.
 */
import * as Phaser from 'phaser';

import { hasTexture } from './AssetGuard';

export const PANEL_TEXTURE_KEY = 'panel_small';

/** Source-pixel borders capturing the L-bracket corner ornaments. */
const PANEL_SLICE = { left: 16, right: 16, top: 16, bottom: 16 } as const;

/** Fallback Rectangle fill — matches the texture's dark navy centre so the
 *  panel still reads as the same visual category when the asset is missing. */
const FALLBACK_FILL = 0x14121c;
const FALLBACK_STROKE = 0x6a5028;

export type PanelBackground = Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle;

export interface UiPanel {
    background: PanelBackground;
    width: number;
    height: number;
    textured: boolean;
}

export interface DrawPanelOptions {
    depth?: number;
    originX?: number;
    originY?: number;
    /** Optional tint applied to the textured path (no-op on fallback). */
    tint?: number;
    /** Whether to make the background interactive. Defaults to false. */
    interactive?: boolean;
}

/**
 * Render a stylised panel at `(x, y)` sized `width`×`height`. The
 * returned handle exposes the background so the caller can attach
 * pointer handlers or swap tint/stroke for hover/disabled states.
 */
export function drawPanel(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    opts: DrawPanelOptions = {}
): UiPanel {
    const depth = opts.depth ?? 0;
    const originX = opts.originX ?? 0.5;
    const originY = opts.originY ?? 0.5;

    let background: PanelBackground;
    let textured = false;
    if (hasTexture(scene, PANEL_TEXTURE_KEY)) {
        background = scene.add
            .nineslice(
                x,
                y,
                PANEL_TEXTURE_KEY,
                undefined,
                width,
                height,
                PANEL_SLICE.left,
                PANEL_SLICE.right,
                PANEL_SLICE.top,
                PANEL_SLICE.bottom
            )
            .setOrigin(originX, originY)
            .setDepth(depth);
        if (opts.tint !== undefined) {
            background.setTint(opts.tint);
        }
        textured = true;
    } else {
        background = scene.add
            .rectangle(x, y, width, height, FALLBACK_FILL)
            .setStrokeStyle(1, FALLBACK_STROKE)
            .setOrigin(originX, originY)
            .setDepth(depth);
    }

    if (opts.interactive) {
        background.setInteractive({ useHandCursor: true });
    }

    return { background, width, height, textured };
}

/**
 * Apply a visual state (idle / disabled / hovered) to a panel
 * background. The textured path uses tint; the fallback path uses
 * stroke colour so it still reads as state-changed.
 */
export function applyPanelState(
    background: PanelBackground,
    state: 'idle' | 'hover' | 'disabled',
    textured: boolean
): void {
    if (textured) {
        const ns = background as Phaser.GameObjects.NineSlice;
        switch (state) {
            case 'idle':
                ns.clearTint();
                break;
            case 'hover':
                ns.setTint(0xfff2c0);
                break;
            case 'disabled':
                ns.setTint(0x707070);
                break;
        }
    } else {
        const rect = background as Phaser.GameObjects.Rectangle;
        switch (state) {
            case 'idle':
                rect.setStrokeStyle(1, FALLBACK_STROKE);
                break;
            case 'hover':
                rect.setStrokeStyle(2, 0xffe8a0);
                break;
            case 'disabled':
                rect.setStrokeStyle(1, 0x4a4a4a);
                break;
        }
    }
}
