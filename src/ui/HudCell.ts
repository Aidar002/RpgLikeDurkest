/**
 * Bottom-panel cell builders.
 *
 * Two layouts shipping today:
 *  - {@link createHudStackedSlot} — centred icon stacked over an
 *    optional ALL-CAPS label and a value text (top-bar resource /
 *    progress trios).
 *  - {@link createHudInlineSlot} — left-aligned `icon | label | value`
 *    on the same baseline (top-bar ATK/DEF column).
 *
 * Each handle exposes simple setters so the caller does not have to
 * track the underlying display objects.
 */
import * as Phaser from 'phaser';

import { createHudIcon, type IconKey } from './HudIcons';
import { HUD_FONT, HUD_STROKE, HudHex } from './HudTheme';

export interface HudInlineSlotHandle {
    root: Phaser.GameObjects.Container;
    setValue(text: string): void;
    setLabel(text: string): void;
    setVisible(visible: boolean): void;
}

export interface HudStackedSlotHandle {
    root: Phaser.GameObjects.Container;
    setValue(text: string): void;
    setLabel(text: string): void;
    setVisible(visible: boolean): void;
}

interface HudStackedSlotOptions {
    /** Icon shown on top. */
    icon: IconKey;
    /** Square pixel size for the icon (origin 0.5/0.5). */
    iconSize?: number;
    /** Optional initial value (defaults to empty). */
    value?: string;
    /** Hex colour for the value text. */
    valueColor?: string;
    /** Pixel size for the value text. */
    valueFontSize?: string;
    /** Optional ALL-CAPS label rendered between the icon and value. */
    label?: string;
    /** Hex colour for the label text. */
    labelColor?: string;
    /** Pixel size for the label text. */
    labelFontSize?: string;
    /** Vertical gap between adjacent rows (icon→label, label→value,
     *  or icon→value when no label). */
    rowGap?: number;
    /** Optional tint applied to the icon image. */
    iconColor?: number;
}

/**
 * Build a centred icon-anchored slot at `(x, y)` (origin 0.5/0). The
 * icon sits at the top with an optional ALL-CAPS label below it and
 * a value below that (the typical readout layout for the gold /
 * potion / will and depth / kills / bosses trios in the top bar).
 * When `label` is omitted the slot collapses to a two-row icon +
 * value stack.
 */
export function createHudStackedSlot(
    scene: Phaser.Scene,
    x: number,
    y: number,
    options: HudStackedSlotOptions
): HudStackedSlotHandle {
    const labelColor = options.labelColor ?? HudHex.textPrimary;
    const labelFontSize = options.labelFontSize ?? '12px';
    const valueColor = options.valueColor ?? HudHex.textPrimary;
    const valueFontSize = options.valueFontSize ?? '18px';
    const iconSize = options.iconSize ?? 32;
    const gap = options.rowGap ?? 2;

    const iconCenterY = y + Math.ceil(iconSize / 2);
    const labelTopY = y + iconSize + gap;
    const labelHeight = options.label
        ? parseInt(labelFontSize, 10) + 2 // approx text height for fontSize
        : 0;
    const valueTopY = options.label ? labelTopY + labelHeight + gap : y + iconSize + gap;

    const widgets: Phaser.GameObjects.GameObject[] = [];

    const icon = createHudIcon(scene, x, iconCenterY, options.icon, {
        pixelSize: iconSize,
        tint: options.iconColor,
    });
    widgets.push(icon);

    let labelText: Phaser.GameObjects.Text | null = null;
    if (options.label) {
        labelText = scene.add
            .text(x, labelTopY, options.label, {
                fontFamily: HUD_FONT,
                fontSize: labelFontSize,
                color: labelColor,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0.5, 0);
        widgets.push(labelText);
    }

    const valueText = scene.add
        .text(x, valueTopY, options.value ?? '', {
            fontFamily: HUD_FONT,
            fontSize: valueFontSize,
            fontStyle: 'bold',
            color: valueColor,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        })
        .setOrigin(0.5, 0);
    widgets.push(valueText);

    const root = scene.add.container(0, 0, widgets);

    return {
        root,
        setValue(text: string) {
            valueText.setText(text);
        },
        setLabel(text: string) {
            if (labelText) labelText.setText(text);
        },
        setVisible(visible: boolean) {
            root.setVisible(visible);
        },
    };
}

interface HudInlineSlotOptions {
    icon?: IconKey;
    iconSize?: number;
    /**
     * If set, the value text is placed at exactly `x + valueOffsetX`
     * instead of immediately after the label. Use this when you want
     * a column of slots (e.g. ATTACK / DEFENSE) to have their values
     * line up vertically regardless of label length.
     */
    valueOffsetX?: number;
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
    options: HudInlineSlotOptions
): HudInlineSlotHandle {
    const labelColor = options.labelColor ?? HudHex.textSecondary;
    const valueColor = options.valueColor ?? HudHex.textPrimary;
    const valueFontSize = options.valueFontSize ?? '16px';
    const labelFontSize = options.labelFontSize ?? '13px';
    const iconSize = options.iconSize ?? 18;

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
    cursorX =
        options.valueOffsetX !== undefined
            ? x + options.valueOffsetX
            : cursorX + labelText.width + 10;

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
