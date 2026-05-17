/**
 * Room-action button row.
 *
 * Five carved nine-slice buttons stacked into the right side of the
 * room info panel:
 *
 *   [1] [2]
 *   [3] [4]
 *   [   5  ]   <- wide button used when there is only one option
 *
 * Each button is keyboard-shortcutted (1-5; SPACE prefers [5] when
 * visible, otherwise [1]). Hover/click feedback is identical across
 * buttons: brighter tint + subtle scale-up on hover, yoyo shrink on
 * press, plus matching SFX.
 *
 * Y values are derived from `GAME_HEIGHT - BOTTOM_BAR_H -
 * HUD_BOTTOM_OFFSET` so a future bump to `BOTTOM_BAR_H` automatically
 * lifts the buttons off the HUD bar (this used to be inline in
 * `GameScene` and was the source of PR #54's "wide button slips under
 * the HUD" bug).
 */
import * as Phaser from 'phaser';

import type { SoundManager } from '../systems/SoundManager';
import { compactText } from './TextHelpers';
import { BODY_FONT } from './HudTheme';
import { BOTTOM_BAR_H, GAME_HEIGHT, HUD_BOTTOM_OFFSET, RoomLayout } from './Layout';
import type { RoomButtonVariant } from './RoomButtonVariant';

/**
 * Visual variants for room-choice buttons. The variant catalog and
 * the legacy-fill heuristic both live in {@link RoomButtonVariant}
 * so data-side call sites can import them without touching Phaser.
 */
export type { RoomButtonVariant } from './RoomButtonVariant';

const BUTTON_TEXTURES: Record<RoomButtonVariant, string> = {
    default: 'btn_default',
    gold: 'btn_gold',
    dark: 'btn_dark',
    silver: 'btn_silver',
    positive: 'btn_positive',
    danger: 'btn_danger',
};

/**
 * Nineslice insets for the button frames (native 183-184 × 67-68 px).
 * The ornate corners occupy ~16 × 14 px so the middle 152 × 40 px
 * stretches.
 */
const BUTTON_SLICE = { left: 16, right: 16, top: 14, bottom: 14 };

/**
 * Map a legacy fill colour to the closest variant the new
 * spritesheet provides. Re-exported here for backward compat;
 * the implementation now lives in {@link RoomButtonVariant}.
 */
export { variantFromFill } from './RoomButtonVariant';

interface ActionButton {
    background: Phaser.GameObjects.NineSlice;
    label: Phaser.GameObjects.Text;
    callback: (() => void) | null;
    enabled: boolean;
    variant: RoomButtonVariant;
    defaultX: number;
    defaultY: number;
    defaultWidth: number;
}

/** Action descriptor passed to `setActions`. */
export interface RoomButtonAction {
    label: string;
    callback: () => void;
    enabled?: boolean;
    variant?: RoomButtonVariant;
}

/**
 * External handle returned by {@link createRoomButtons}. Callers go
 * through this instead of touching the underlying button objects, so
 * the room-button visuals can change without changing call sites.
 */
export interface RoomButtonsHandle {
    /** Re-configure the buttons with the given actions. Pass an empty
     *  array to hide all of them. `useWideOnly` puts a single action
     *  into the [5] slot regardless of array index. */
    setActions(actions: RoomButtonAction[], useWideOnly?: boolean): void;
    /** Programmatically trigger button[index] (1-5 keyboard
     *  shortcuts). Returns true when the callback actually ran. */
    trigger(index: number): boolean;
    /** True iff the wide [5] button is visible AND enabled. SPACE
     *  uses this to decide whether to fire [5] or [1]. */
    wideEnabled(): boolean;
    /** Mark every button as disabled (used during combat
     *  resolution to prevent re-entry while the action is animating).
     *  Does not change visibility — only the `enabled` flag. */
    disableAll(): void;
}

/**
 * Build the row of five room-action buttons inside `parent` and
 * return a handle for setting actions / triggering buttons.
 *
 * The buttons are added to `parent` as children so the whole row
 * follows the parent's visibility/depth/transform.
 */
export function createRoomButtons(
    scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    sfx: SoundManager
): RoomButtonsHandle {
    const buttons: ActionButton[] = [];

    // Y values derived from the layout constants so they automatically
    // follow the panel's bottom edge whenever BOTTOM_BAR_H changes
    // (otherwise the wide [5] button slips under the HUD bar — see
    // PR #54).
    //
    // Buttons sit inside the right combat / room panel
    // (RoomLayout.panelX..panelX+panelWidth, centred at panelCenterX).
    // BTN_H + BTN_ROW_GAP got bumped so each row reads as its own
    // option with breathing room rather than a tight block, and the
    // column anchors track RoomLayout instead of hard-coded x values.
    const BTN_H = 48;
    const BTN_ROW_GAP = 16;
    const BTN_PANEL_PAD = 10;
    const COL_GAP = 16;
    const COL_INSET = 14;
    const colWidth = Math.floor((RoomLayout.panelWidth - COL_INSET * 2 - COL_GAP) / 2);
    const wideWidth = RoomLayout.panelWidth - COL_INSET * 2;
    const leftColX = RoomLayout.panelX + COL_INSET + colWidth / 2;
    const rightColX = RoomLayout.panelX + COL_INSET + colWidth + COL_GAP + colWidth / 2;
    const wideX = RoomLayout.panelCenterX;
    const panelBottom = GAME_HEIGHT - BOTTOM_BAR_H - HUD_BOTTOM_OFFSET;
    const wideButtonY = panelBottom - BTN_PANEL_PAD - BTN_H / 2;
    const middleRowY = wideButtonY - (BTN_H + BTN_ROW_GAP);
    const topRowY = middleRowY - (BTN_H + BTN_ROW_GAP);
    const buttonSpecs = [
        { x: leftColX, y: topRowY, width: colWidth },
        { x: rightColX, y: topRowY, width: colWidth },
        { x: leftColX, y: middleRowY, width: colWidth },
        { x: rightColX, y: middleRowY, width: colWidth },
        { x: wideX, y: wideButtonY, width: wideWidth },
    ];

    buttonSpecs.forEach((spec) => {
        const background = scene.add
            .nineslice(
                spec.x,
                spec.y,
                BUTTON_TEXTURES.default,
                undefined,
                spec.width,
                BTN_H,
                BUTTON_SLICE.left,
                BUTTON_SLICE.right,
                BUTTON_SLICE.top,
                BUTTON_SLICE.bottom
            )
            .setInteractive({ useHandCursor: true });

        const label = scene.add
            .text(spec.x, spec.y, '', {
                fontFamily: BODY_FONT,
                fontSize: '16px',
                color: '#dddddd',
            })
            .setOrigin(0.5);

        const button: ActionButton = {
            background,
            label,
            callback: null,
            enabled: false,
            variant: 'default',
            defaultX: spec.x,
            defaultY: spec.y,
            defaultWidth: spec.width,
        };

        background.on('pointerover', () => {
            if (button.enabled) {
                // Hover: lighter tint + a subtle scale-up so the
                // active option visibly "pops" relative to the
                // other buttons. Tint went 0xfff2c2 → 0xfff8df
                // (closer to white) for a brighter highlight.
                background.setTint(0xfff8df);
                scene.tweens.killTweensOf([background, label]);
                scene.tweens.add({
                    targets: [background, label],
                    scaleX: 1.04,
                    scaleY: 1.04,
                    duration: 90,
                    ease: 'Sine.out',
                });
                sfx.play('buttonHover');
            }
        });
        background.on('pointerout', () => {
            background.clearTint();
            scene.tweens.killTweensOf([background, label]);
            scene.tweens.add({
                targets: [background, label],
                scaleX: 1,
                scaleY: 1,
                duration: 90,
                ease: 'Sine.out',
            });
        });
        background.on('pointerdown', () => {
            if (button.enabled && button.callback) {
                sfx.play('buttonClick');
                // Press feedback: yoyo a quick shrink so the button
                // reads as "depressed" before the callback either
                // swaps the room or rebuilds the panel.
                scene.tweens.killTweensOf([background, label]);
                scene.tweens.add({
                    targets: [background, label],
                    scaleX: 0.94,
                    scaleY: 0.9,
                    duration: 60,
                    ease: 'Quad.out',
                    yoyo: true,
                });
                button.callback();
            }
        });

        buttons.push(button);
        parent.add([background, label]);
    });

    function applyAction(button: ActionButton, action: RoomButtonAction): void {
        const enabled = action.enabled ?? true;
        const variant = action.variant ?? 'default';
        button.callback = action.callback;
        button.enabled = enabled;
        button.variant = variant;
        button.background.setVisible(true);
        button.label.setVisible(true);
        button.background.setInteractive({ useHandCursor: true });
        button.background.setTexture(BUTTON_TEXTURES[variant]);
        // Disabled buttons render dimmer + desaturated grey tint so
        // the unavailable option visually recedes; enabled buttons
        // keep the variant's full colour at full alpha so the
        // active actions stand out.
        if (enabled) {
            button.background.clearTint();
            button.background.setAlpha(1);
            button.label.setColor('#f4f0e0');
            button.label.setAlpha(1);
        } else {
            button.background.setTint(0x4a4d54);
            button.background.setAlpha(0.55);
            button.label.setColor('#5a5d63');
            button.label.setAlpha(0.85);
        }
        button.label.setText(
            compactText(action.label, button.defaultWidth > wideWidth - 40 ? 60 : 32)
        );
    }

    const handle: RoomButtonsHandle = {
        setActions(actions: RoomButtonAction[], useWideOnly: boolean = false) {
            buttons.forEach((button) => {
                // Kill any in-flight hover/press tween so re-configured
                // buttons don't inherit a stale scale or partial yoyo.
                scene.tweens.killTweensOf([button.background, button.label]);
                button.background.setScale(1, 1);
                button.label.setScale(1, 1);
                button.background.setPosition(button.defaultX, button.defaultY);
                button.background.setSize(button.defaultWidth, BTN_H);
                button.label.setPosition(button.defaultX, button.defaultY);
                button.background.setVisible(false);
                button.label.setVisible(false);
                button.background.disableInteractive();
                button.background.clearTint();
                button.background.setAlpha(1);
                button.label.setAlpha(1);
                button.callback = null;
                button.enabled = false;
            });

            if (useWideOnly && actions.length === 1) {
                applyAction(buttons[4], actions[0]);
                return;
            }

            actions.forEach((action, index) => {
                const button = buttons[index];
                if (!button) {
                    return;
                }
                applyAction(button, action);
            });
        },

        trigger(index: number): boolean {
            const button = buttons[index];
            if (!button || !button.enabled || !button.callback || !button.background.visible) {
                return false;
            }
            button.callback();
            return true;
        },

        wideEnabled(): boolean {
            const wide = buttons[4];
            return Boolean(wide && wide.background.visible && wide.enabled);
        },

        disableAll(): void {
            buttons.forEach((b) => {
                b.enabled = false;
            });
        },
    };

    handle.setActions([]);
    return handle;
}
