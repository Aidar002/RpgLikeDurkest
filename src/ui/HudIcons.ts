/**
 * HUD icon helpers.
 *
 * Each stat slot in the HUD shows an icon next to a label/value. We prefer
 * the hand-authored {@link iconKey `hud_icons`} spritesheet (8x2 grid of
 * 64×64 frames) registered in {@link import('../scenes/BootScene').BootScene}.
 * When that texture has not loaded — for example, the PNG is not yet in the
 * repo — we fall back to a small unicode glyph rendered with the HUD font
 * so the UI keeps working.
 *
 * The frame order is locked in {@link IconFrame}; if `hud_icons.png` ships
 * with a different order, update only this map.
 *
 * Frame layout (matches `public/assets/ui/hud_icons.png`):
 *   row 0:  heart  skull  star   xpArrow  sword   shield  coin    potion
 *   row 1:  resolve lantern shard depth   kills   boss    music   globe
 */
import * as Phaser from 'phaser';

import { HUD_FONT, HUD_STROKE, HudHex } from './HudTheme';

/**
 * Numeric frame index for each named icon inside `hud_icons`.
 *
 * Legacy keys (`torch`, `moon`, `quill`) are kept as aliases pointing at
 * the closest visual match in the current sheet so existing call sites
 * continue to work.
 */
export const IconFrame = {
    heart: 0,
    skull: 1,
    star: 2,
    xpArrow: 3,
    sword: 4,
    shield: 5,
    coin: 6,
    potion: 7,
    resolve: 8,
    lantern: 9,
    shard: 10,
    depth: 11,
    kills: 12,
    boss: 13,
    music: 14,
    globe: 15,
    // Legacy aliases.
    torch: 9,
    moon: 10,
    quill: 8,
} as const;

export type IconKey = keyof typeof IconFrame;

/** Unicode glyph + tint used when the spritesheet is unavailable. */
const ICON_FALLBACK: Record<IconKey, { glyph: string; color: string }> = {
    heart: { glyph: '\u2665', color: HudHex.accentBlood },
    skull: { glyph: '\u2620\uFE0E', color: HudHex.accentStress },
    star: { glyph: '\u2605', color: HudHex.accentExp },
    xpArrow: { glyph: '\u2191', color: HudHex.accentExp },
    sword: { glyph: '\u2694\uFE0E', color: HudHex.accentBlood },
    shield: { glyph: '\u26E8\uFE0E', color: HudHex.accentResolve },
    coin: { glyph: '\u00A4', color: HudHex.accentGold },
    potion: { glyph: '\u271A', color: HudHex.accentPotion },
    resolve: { glyph: '\u2666\uFE0E', color: HudHex.accentResolve },
    lantern: { glyph: '\u263C\uFE0E', color: HudHex.accentLight },
    shard: { glyph: '\u25C6\uFE0E', color: HudHex.accentShard },
    depth: { glyph: '\u25BC\uFE0E', color: HudHex.accentDepth },
    kills: { glyph: '\u2020\uFE0E', color: HudHex.accentKills },
    boss: { glyph: '\u03A9', color: HudHex.accentBoss },
    music: { glyph: '\u266B', color: HudHex.textPrimary },
    globe: { glyph: '\u29C9', color: HudHex.textPrimary },
    torch: { glyph: '\u2600\uFE0E', color: HudHex.accentLight },
    moon: { glyph: '\u263D\uFE0E', color: HudHex.accentMoon },
    quill: { glyph: '\u2666\uFE0E', color: HudHex.accentResolve },
};

const ICON_SHEET_KEY = 'hud_icons';

/**
 * Render an icon at `(x, y)` (origin 0.5/0.5).
 *
 * Returns a `GameObject` so callers can `setVisible`, `setPosition`,
 * include it in containers, etc., without caring whether the underlying
 * representation is an image frame or a text glyph.
 *
 * `pixelSize` is used only for the spritesheet branch; the text fallback
 * sizes itself via `HUD_FONT` and the colour from {@link HudHex}.
 */
export function createHudIcon(
    scene: Phaser.Scene,
    x: number,
    y: number,
    key: IconKey,
    options: { pixelSize?: number; tint?: number; fontSize?: string } = {},
): Phaser.GameObjects.GameObject {
    const pixelSize = options.pixelSize ?? 18;

    if (scene.textures.exists(ICON_SHEET_KEY)) {
        const img = scene.add
            .image(x, y, ICON_SHEET_KEY, IconFrame[key])
            .setOrigin(0.5)
            .setDisplaySize(pixelSize, pixelSize);
        if (options.tint != null) {
            img.setTint(options.tint);
        }
        return img;
    }

    const fallback = ICON_FALLBACK[key];
    const fontSize = options.fontSize ?? `${pixelSize}px`;
    return scene.add
        .text(x, y, fallback.glyph, {
            fontFamily: HUD_FONT,
            fontSize,
            color: fallback.color,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        })
        .setOrigin(0.5);
}
