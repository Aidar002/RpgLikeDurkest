/**
 * Stylised UI button helper.
 *
 * Wraps the six `btn_*` carved-stone spritesheets (loaded by
 * `BootScene.preload`) into a single nine-slice background plus a
 * centered text label. Falls back to a coloured `Rectangle + stroke`
 * when the texture is missing — mirrors the procedural fallback used
 * elsewhere in the HUD layer so tests and the brief loading window
 * still render *something*.
 *
 * Six variants map to the six spritesheets:
 *
 * | variant     | use                                              |
 * |-------------|--------------------------------------------------|
 * | `default`   | neutral confirm/back buttons                     |
 * | `gold`      | primary CTA (start run / new run / accept relic) |
 * | `dark`      | secondary CTA (cancel, close, skip)              |
 * | `silver`    | small in-HUD chrome buttons (escape / restart)   |
 * | `positive`  | "begin next run" — green tint                    |
 * | `danger`    | destructive (wipe save, restart confirm)         |
 *
 * The returned handle exposes the background hit-target as a
 * `NineSlice | Rectangle` union — both implement `setInteractive`,
 * `setStrokeStyle`, and the depth/visibility/scale components, so
 * call-sites can treat them uniformly.
 */
import * as Phaser from 'phaser';

import { hasTexture } from './AssetGuard';
import { HUD_FONT, HUD_STROKE, HudHex } from './HudTheme';

export type ButtonVariant = 'default' | 'gold' | 'dark' | 'silver' | 'positive' | 'danger';

const VARIANT_KEY: Record<ButtonVariant, string> = {
    default: 'btn_default',
    gold: 'btn_gold',
    dark: 'btn_dark',
    silver: 'btn_silver',
    positive: 'btn_positive',
    danger: 'btn_danger',
};

/**
 * Slice metrics in source-texture pixels. The L-shaped corner
 * ornaments span ~14×14 in the 184×68 PNGs; horizontal slices keep
 * full width while vertical slices match — Phaser clamps the corner
 * height to half the target so even 36-px tall buttons keep the rim
 * detail intact.
 */
const BUTTON_SLICE = { left: 14, right: 14, top: 14, bottom: 14 } as const;

/**
 * Procedural-fallback colours, picked so each variant still reads as
 * the same visual category when the spritesheet is missing.
 */
const VARIANT_FILL: Record<ButtonVariant, number> = {
    default: 0x1c1c1c,
    gold: 0x40331c,
    dark: 0x111111,
    silver: 0x1f1f24,
    positive: 0x1f3a25,
    danger: 0x3a1818,
};

const VARIANT_STROKE: Record<ButtonVariant, number> = {
    default: 0x5a5a5a,
    gold: 0xc8a060,
    dark: 0x6a6a6a,
    silver: 0x8a8a8a,
    positive: 0x6acb7f,
    danger: 0xc57d7d,
};

const VARIANT_HOVER_STROKE: Record<ButtonVariant, number> = {
    default: 0xffffff,
    gold: 0xffe8a0,
    dark: 0xffffff,
    silver: 0xffffff,
    positive: 0xa8e0b8,
    danger: 0xffd7d7,
};

/** Buttons rendered with a textured background expose the underlying
 *  NineSlice; the Rectangle fallback shape supports the same callable
 *  surface that existing call-sites use (`setInteractive`,
 *  `setStrokeStyle`, depth/visibility setters). */
export type ButtonBackground = Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle;

export interface UiButton {
    background: ButtonBackground;
    label: Phaser.GameObjects.Text;
    /** Variant in effect — call-sites use this so a hover/out handler
     *  can re-apply the correct rim colour without hard-coding it. */
    variant: ButtonVariant;
    /** Width / height the button was rendered at (Rectangle exposes
     *  `width`/`height` directly; NineSlice keeps `width`/`height` in
     *  sync with `setSize`, but reading the source displayed size is
     *  cleaner). */
    width: number;
    height: number;
    /** True when the textured spritesheet was used. False means the
     *  fallback Rectangle was rendered — call-sites that draw their
     *  own ornamentation may want to skip when textured. */
    textured: boolean;
}

export interface DrawButtonOptions {
    variant?: ButtonVariant;
    fontSize?: string;
    /** Text colour — defaults to {@link HudHex.textPrimary}. */
    color?: string;
    /** Render depth applied to both background and label. The label
     *  is auto-bumped by +1 so it sits above the background. */
    depth?: number;
    /** Origin for both background and label. Defaults to centred
     *  (matches the existing call-sites that pass `CENTER_X`-style
     *  coordinates). */
    originX?: number;
    originY?: number;
    /** When true, the button doesn't auto-bind hover styling. Useful
     *  when the call-site wants its own custom hover behaviour
     *  (e.g. arming a confirm window). Defaults to true. */
    autoHover?: boolean;
}

/**
 * Render a stylised button at `(x, y)` sized `width`×`height` with a
 * centered text label. Returns a {@link UiButton} handle so the
 * caller can wire up `pointerdown` / `pointerover` etc on the
 * background.
 *
 * The texture's L-corners are stamped at native size via Phaser's
 * built-in nine-slice; the centre stretches modestly between corners
 * (only ~10–20 px in the worst case at the typical button heights of
 * 36–48 px), which is well below the streak threshold the carved
 * panels suffered from.
 */
export function drawUiButton(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    opts: DrawButtonOptions = {}
): UiButton {
    const variant = opts.variant ?? 'default';
    const depth = opts.depth ?? 0;
    const originX = opts.originX ?? 0.5;
    const originY = opts.originY ?? 0.5;
    const autoHover = opts.autoHover ?? true;
    const key = VARIANT_KEY[variant];

    let background: ButtonBackground;
    let textured = false;
    if (hasTexture(scene, key)) {
        background = scene.add
            .nineslice(
                x,
                y,
                key,
                undefined,
                width,
                height,
                BUTTON_SLICE.left,
                BUTTON_SLICE.right,
                BUTTON_SLICE.top,
                BUTTON_SLICE.bottom
            )
            .setOrigin(originX, originY)
            .setDepth(depth);
        textured = true;
    } else {
        background = scene.add
            .rectangle(x, y, width, height, VARIANT_FILL[variant])
            .setStrokeStyle(1, VARIANT_STROKE[variant])
            .setOrigin(originX, originY)
            .setDepth(depth);
    }

    const label = scene.add
        .text(x, y, text, {
            fontFamily: HUD_FONT,
            fontSize: opts.fontSize ?? '15px',
            color: opts.color ?? HudHex.textPrimary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        })
        .setOrigin(originX, originY)
        .setDepth(depth + 1);

    background.setInteractive({ useHandCursor: true });

    if (autoHover) {
        // Default hover styling. Both NineSlice and Rectangle support
        // setTint; Rectangle uses the stroke instead so the fallback
        // still reads as "highlighted".
        if (textured) {
            const ns = background as Phaser.GameObjects.NineSlice;
            background.on('pointerover', () => ns.setTint(0xd0d0ff));
            background.on('pointerout', () => ns.clearTint());
        } else {
            const rect = background as Phaser.GameObjects.Rectangle;
            background.on('pointerover', () =>
                rect.setStrokeStyle(2, VARIANT_HOVER_STROKE[variant])
            );
            background.on('pointerout', () => rect.setStrokeStyle(1, VARIANT_STROKE[variant]));
        }
    }

    return { background, label, variant, width, height, textured };
}
