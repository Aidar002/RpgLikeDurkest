/**
 * Bottom-panel cell builder.
 *
 * A cell is a vertical pill containing an icon, an ALL-CAPS label, and a
 * value, in the style of the Darkest-Dungeon-inspired reference. Cells
 * are flat vertical strips separated by thin pillars drawn elsewhere
 * (the bottom-bar PNG provides them; the procedural fallback simulates
 * them with thin rectangles).
 *
 * The returned object exposes simple setters so the caller does not
 * have to track the underlying display objects.
 */
import * as Phaser from 'phaser';

import { createHudIcon, type IconKey } from './HudIcons';
import { HUD_FONT, HUD_STROKE, HudColors, HudHex } from './HudTheme';

export interface HudCellOptions {
    /** Pixel art icon shown above the label. */
    icon?: IconKey;
    /** ALL-CAPS label rendered below the icon. */
    label: string;
    /** Optional initial value (defaults to empty). */
    value?: string;
    /** Hex colour for the value text. */
    valueColor?: string;
    /** Hex colour for the label text. */
    labelColor?: string;
    /** Set true to draw a brighter gold border around the cell. */
    highlight?: boolean;
}

export interface HudCellHandle {
    /** Container holding all cell widgets, useful for depth-sorting. */
    root: Phaser.GameObjects.Container;
    setLabel(text: string): void;
    setValue(text: string): void;
    setVisible(visible: boolean): void;
}

/**
 * Build a single cell at `(x, y)` with width `w` and height `h`. Origin
 * is top-left.
 */
export function createHudCell(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    h: number,
    options: HudCellOptions,
): HudCellHandle {
    const labelColor = options.labelColor ?? HudHex.textSecondary;
    const valueColor = options.valueColor ?? HudHex.textPrimary;

    const cellCenterX = x + w / 2;

    const widgets: Phaser.GameObjects.GameObject[] = [];

    // When the bottom-bar PNG is missing we still want visible separators,
    // so draw a thin pill border under the cell.
    if (!scene.textures.exists('hud_bottom_bar')) {
        const border = scene.add.graphics();
        border.lineStyle(1, options.highlight ? HudColors.cellGoldEdge : HudColors.divider, 0.85);
        border.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        if (options.highlight) {
            border.lineStyle(1, HudColors.cellGoldEdge, 0.45);
            border.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
        }
        widgets.push(border);
    } else if (options.highlight) {
        // PNG already draws separators, but the highlight needs an
        // explicit gold rim on top.
        const border = scene.add.graphics();
        border.lineStyle(1, HudColors.cellGoldEdge, 0.9);
        border.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        widgets.push(border);
    }

    const innerTop = y + 6;
    const labelY = y + h - 28;
    const valueY = y + h - 14;

    if (options.icon) {
        const icon = createHudIcon(scene, cellCenterX, innerTop + 6, options.icon, {
            pixelSize: 14,
        });
        widgets.push(icon);
    }

    const labelText = scene.add
        .text(cellCenterX, labelY, options.label, {
            fontFamily: HUD_FONT,
            fontSize: '11px',
            color: labelColor,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        })
        .setOrigin(0.5);
    widgets.push(labelText);

    const valueText = scene.add
        .text(cellCenterX, valueY, options.value ?? '', {
            fontFamily: HUD_FONT,
            fontSize: '15px',
            fontStyle: options.highlight ? 'bold' : 'normal',
            color: valueColor,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        })
        .setOrigin(0.5);
    widgets.push(valueText);

    const root = scene.add.container(0, 0, widgets);

    return {
        root,
        setLabel(text: string) {
            labelText.setText(text);
        },
        setValue(text: string) {
            valueText.setText(text);
        },
        setVisible(visible: boolean) {
            root.setVisible(visible);
        },
    };
}

export interface HudInlineSlotHandle {
    root: Phaser.GameObjects.Container;
    setValue(text: string): void;
    setLabel(text: string): void;
    setVisible(visible: boolean): void;
}

export interface HudInlineSlotOptions {
    icon?: IconKey;
    iconSize?: number;
    label: string;
    value?: string;
    labelColor?: string;
    valueColor?: string;
    valueFontSize?: string;
    labelFontSize?: string;
    iconColor?: number;
}

/**
 * Build an inline stat slot at `(x, y)` (left-aligned) showing an icon, an
 * ALL-CAPS label, and a value all on the same baseline. Used for the
 * top-bar combat stats ("⚔ АТАКА 5"), where the slot is not boxed but
 * still needs to read as a unit.
 */
export function createHudInlineSlot(
    scene: Phaser.Scene,
    x: number,
    y: number,
    options: HudInlineSlotOptions,
): HudInlineSlotHandle {
    const labelColor = options.labelColor ?? HudHex.textSecondary;
    const valueColor = options.valueColor ?? HudHex.textPrimary;
    const valueFontSize = options.valueFontSize ?? '16px';
    const labelFontSize = options.labelFontSize ?? '13px';
    const iconSize = options.iconSize ?? 16;

    let cursorX = x;
    const widgets: Phaser.GameObjects.GameObject[] = [];

    if (options.icon) {
        const icon = createHudIcon(scene, cursorX + iconSize / 2, y + iconSize / 2, options.icon, {
            pixelSize: iconSize,
            tint: options.iconColor,
        });
        widgets.push(icon);
        cursorX += iconSize + 6;
    }

    const labelText = scene.add
        .text(cursorX, y, options.label, {
            fontFamily: HUD_FONT,
            fontSize: labelFontSize,
            color: labelColor,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        })
        .setOrigin(0, 0);
    widgets.push(labelText);
    cursorX += labelText.width + 10;

    const valueText = scene.add
        .text(cursorX, y - 1, options.value ?? '', {
            fontFamily: HUD_FONT,
            fontSize: valueFontSize,
            color: valueColor,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        })
        .setOrigin(0, 0);
    widgets.push(valueText);

    const root = scene.add.container(0, 0, widgets);

    return {
        root,
        setValue(text: string) {
            valueText.setText(text);
        },
        setLabel(text: string) {
            labelText.setText(text);
        },
        setVisible(visible: boolean) {
            root.setVisible(visible);
        },
    };
}
