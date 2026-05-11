// Centralised heads-up-display theme: a single source of truth for the HUD's
// palette, fonts, and panel/bar/icon helpers. Other UI files should import the
// tokens here instead of hard-coding hex literals so panel restyles stay
// coherent across the dungeon-roguelike interface.

import * as Phaser from 'phaser';

/** Numeric colours for Phaser Graphics / Rectangle fills. */
export const HudColors = {
    panelOuter: 0x1d1923,
    panelBg: 0x0e0c12,
    panelHi: 0x2a2632,
    panelLo: 0x08070b,
    divider: 0x2c2738,

    barTrack: 0x150f1d,
    bloodFill: 0xc44a4a,
    bloodFillMid: 0xdb7a1c,
    bloodFillLow: 0xe04646,
    bloodTrack: 0x3a1414,
    expFill: 0xf0c878,
    expTrack: 0x2a2114,
    accentExp: 0xf0c878,
    accentResolve: 0x7da8d9,
    accentLight: 0xf0a050,
    accentGold: 0xc8a060,

    /** Bright gold rim used for the highlighted "PRESTIGE" cell. */
    cellGoldEdge: 0xe2b04a,
} as const;

/** String colours for Phaser Text styles. */
export const HudHex = {
    textPrimary: '#e8dfc9',
    textSecondary: '#a09898',
    textMuted: '#6a6377',

    accentBlood: '#d96868',
    accentBloodLow: '#e09494',
    accentExp: '#f0c878',
    accentResolve: '#9bbfe2',
    accentLight: '#f0a050',
    accentMoon: '#9bb6d8',
    accentGold: '#d4b070',
    accentPotion: '#86d49a',
    accentBoss: '#e08a7a',
    accentKills: '#c0a0a0',
    accentDepth: '#b0b8c0',
} as const;

/**
 * Centralised font stacks for the UI. Two roles:
 *
 *  - `HUD_FONT` — JetBrains Mono, used wherever columnar alignment
 *    matters: bottom-bar resource cells, top-bar stats, event log,
 *    relic slots / modal, boot-screen widgets, volume panel, scene
 *    chrome. The fallback stack keeps the column-alignment property
 *    if the web font fails to load.
 *  - `BODY_FONT` — EB Garamond, a proportional serif used for room
 *    descriptions, combat action button labels, end-screen narrative
 *    copy, and other "prose" surfaces where readability of full
 *    sentences matters more than digit alignment.
 *
 * The actual font files live in `public/fonts/` and are registered
 * via `@font-face` in `src/style.css`. `main.ts` blocks on
 * `document.fonts.ready` before booting Phaser so the canvas Text
 * objects render with the web font from the very first frame rather
 * than starting on a system fallback and snapping.
 */
export const HUD_FONT = "'JetBrains Mono', 'Lucida Console', Consolas, monospace";
export const BODY_FONT = "'EB Garamond', 'Times New Roman', Georgia, serif";
export const HUD_STROKE = '#020304';

/**
 * Renders a layered "carved stone" HUD panel as a single Graphics object.
 * Layers (outside in): outer 1-px border, fill, top-edge highlight, bottom-edge
 * shadow, plus four 2x2 rune-dot accents in the corners. Returns the Graphics
 * so callers can adjust depth or attach it to a container.
 */
export function drawHudPanel(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    h: number
): Phaser.GameObjects.Graphics {
    const g = scene.add.graphics();
    // outer 1-px border
    g.fillStyle(HudColors.panelOuter, 1);
    g.fillRect(x, y, w, h);
    // panel fill
    g.fillStyle(HudColors.panelBg, 1);
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
    // top edge highlight
    g.fillStyle(HudColors.panelHi, 1);
    g.fillRect(x + 1, y + 1, w - 2, 1);
    // bottom edge shadow
    g.fillStyle(HudColors.panelLo, 1);
    g.fillRect(x + 1, y + h - 2, w - 2, 1);
    // rune-dot corner accents
    g.fillStyle(HudColors.panelHi, 1);
    g.fillRect(x + 4, y + 4, 2, 2);
    g.fillRect(x + w - 6, y + 4, 2, 2);
    g.fillRect(x + 4, y + h - 6, 2, 2);
    g.fillRect(x + w - 6, y + h - 6, 2, 2);
    return g;
}

/**
 * Draws a carved frame around a horizontal bar so it reads as a
 * recessed gauge consistent with the rest of the HUD.
 *
 * Layered output (back-to-front):
 *   1. 2-px black drop shadow below the bar
 *   2. dark outer rim around the whole bar
 *   3. inner inset (1 px gold on the top edge, fainter gold on the
 *      bottom) — gives a metallic carved-frame feel
 *
 * The returned Graphics should be inserted into the scene/container
 * BEFORE the track + fill rectangles so they sit on top of the frame.
 */
export function drawBarFrame(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number
): Phaser.GameObjects.Graphics {
    const g = scene.add.graphics();
    const top = y - height / 2;
    // 1) drop shadow
    g.fillStyle(0x000000, 0.55);
    g.fillRect(x - 1, top + 2, width + 2, height + 1);
    // 2) outer rim
    g.fillStyle(HudColors.panelOuter, 1);
    g.fillRect(x - 2, top - 2, width + 4, height + 4);
    // panel surface (fills hole between rim and track so any AA
    // gap reads as dark stone instead of game canvas)
    g.fillStyle(HudColors.panelBg, 1);
    g.fillRect(x - 1, top - 1, width + 2, height + 2);
    // 3) gold highlight along top + dimmer bottom
    g.fillStyle(HudColors.cellGoldEdge, 0.65);
    g.fillRect(x - 1, top - 1, width + 2, 1);
    g.fillStyle(HudColors.cellGoldEdge, 0.28);
    g.fillRect(x - 1, top + height, width + 2, 1);
    return g;
}

/**
 * Draws segmented divisions on top of a bar so it reads as a notched gauge.
 * The divisions are rendered as `count - 1` 1-px vertical lines.
 */
export function drawBarSegments(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    count: number
): Phaser.GameObjects.Graphics {
    const g = scene.add.graphics();
    if (count <= 1) return g;
    g.fillStyle(HudColors.panelOuter, 0.9);
    for (let i = 1; i < count; i++) {
        const sx = Math.round(x + (width * i) / count);
        g.fillRect(sx, y - height / 2, 1, height);
    }
    return g;
}
