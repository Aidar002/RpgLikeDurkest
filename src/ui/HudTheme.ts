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
    stressFill: 0x9d6ec7,
    stressFillMid: 0xa27bc4,
    stressFillHigh: 0xcb5ae8,
    stressTrack: 0x1a0c26,
    accentExp: 0xf0c878,
    accentResolve: 0x7da8d9,
    accentLight: 0xf0a050,
    accentGold: 0xc8a060,
    accentShard: 0xb89cd8,
    accentVirtue: 0x7fc88a,
    accentAffliction: 0xc46868,

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
    accentShard: '#c4abdf',
    accentStress: '#b48cd6',
    accentVirtue: '#9be0a7',
    accentAffliction: '#e09090',
    accentPotion: '#86d49a',
    accentRevive: '#f0d090',
    accentBoss: '#e08a7a',
    accentKills: '#c0a0a0',
    accentDepth: '#b0b8c0',
} as const;

export const HUD_FONT = 'Lucida Console, Consolas, monospace';
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

/** Thin vertical divider between HUD groups. */
export function drawHudDivider(
    scene: Phaser.Scene,
    x: number,
    y: number,
    h: number
): Phaser.GameObjects.Graphics {
    const g = scene.add.graphics();
    g.fillStyle(HudColors.divider, 1);
    g.fillRect(x, y, 1, h);
    g.fillStyle(HudColors.panelHi, 1);
    g.fillRect(x, y, 1, 2);
    g.fillRect(x, y + h - 2, 1, 2);
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

export interface IconStat {
    icon: Phaser.GameObjects.Text;
    value: Phaser.GameObjects.Text;
    setVisible(visible: boolean): void;
    setValue(text: string): void;
}

/**
 * Creates an inline stat slot (icon glyph + value text). The icon and value
 * share a baseline so the slot reads as a single unit; the value is offset to
 * the right of the icon by `iconWidth` pixels.
 */
export function createIconStat(
    scene: Phaser.Scene,
    x: number,
    y: number,
    iconChar: string,
    iconColor: string,
    options: {
        valueColor?: string;
        valueFontSize?: string;
        iconFontSize?: string;
        iconWidth?: number;
        valueOriginX?: number;
    } = {}
): IconStat {
    const valueFontSize = options.valueFontSize ?? '15px';
    const iconFontSize = options.iconFontSize ?? '14px';
    const iconWidth = options.iconWidth ?? 16;
    const valueColor = options.valueColor ?? HudHex.textPrimary;

    const icon = scene.add.text(x, y, iconChar, {
        fontFamily: HUD_FONT,
        fontSize: iconFontSize,
        color: iconColor,
        stroke: HUD_STROKE,
        strokeThickness: 2,
    });

    const value = scene.add.text(x + iconWidth, y, '', {
        fontFamily: HUD_FONT,
        fontSize: valueFontSize,
        color: valueColor,
        stroke: HUD_STROKE,
        strokeThickness: 2,
    });
    if (options.valueOriginX !== undefined) {
        value.setOrigin(options.valueOriginX, 0);
    }

    return {
        icon,
        value,
        setVisible(visible: boolean) {
            icon.setVisible(visible);
            value.setVisible(visible);
        },
        setValue(text: string) {
            value.setText(text);
        },
    };
}
