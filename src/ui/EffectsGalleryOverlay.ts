/**
 * Effects-and-particles gallery overlay.
 *
 * Modal-style scrollable grid that lists every recipe in
 * {@link EFFECT_RECIPES}. Each tile shows a localized label and, on
 * click, fires the recipe at the tile's centre so the player can see
 * exactly what the effect looks like. The grid scrolls vertically
 * (mouse wheel + dragable scrollbar thumb) so the registry can grow
 * past the visible viewport without forcing the overlay to grow.
 *
 * Mounted via {@link showEffectsGallery}; dismissed by the close
 * button, the Escape key, or by clicking outside the panel onto the
 * darkened backdrop. The handle returned by the mount fn exposes
 * `destroy()` so the host can also force-dismiss the overlay (e.g.
 * when the map screen tears down).
 */
import * as Phaser from 'phaser';

import type { Localization } from '../systems/Localization';
import type { SoundManager } from '../systems/SoundManager';
import { EFFECT_RECIPES, playEffect } from './EffectsLibrary';
import { HUD_FONT, HUD_STROKE, HudHex } from './HudTheme';
import { CENTER_X, CENTER_Y, GAME_HEIGHT, GAME_WIDTH } from './Layout';
import { drawUiButton } from './UiButton';
import { applyPanelState, drawPanel } from './UiPanel';

/** Base depth for the overlay. Sits above gameplay (≤ 200) and
 *  HUD chrome (≤ 220) so it always paints on top. Internal layers
 *  derive from this anchor in fixed offsets so adding a new layer
 *  is a one-line edit. */
const OVERLAY_DEPTH = 300;

/** Grid metrics. Tuned so 3 columns × 5 rows fit cleanly inside the
 *  panel viewport and the row step matches the tile height + gap. */
const COLS = 3;
const TILE_W = 280;
const TILE_H = 70;
const GAP_X = 20;
const GAP_Y = 16;
const PANEL_W = 960;
const PANEL_H = 680;

export interface EffectsGalleryHandle {
    /** Tear down the overlay. Idempotent: calling twice is a no-op. */
    destroy(): void;
}

/**
 * Mount the gallery overlay onto `scene`. Returns a handle so the
 * caller can force-dismiss the overlay if needed; otherwise the
 * close button, Escape key, and backdrop click all tear it down on
 * their own.
 */
export function showEffectsGallery(
    scene: Phaser.Scene,
    loc: Localization,
    sfx?: SoundManager
): EffectsGalleryHandle {
    const objects: Phaser.GameObjects.GameObject[] = [];
    const teardown: Array<() => void> = [];

    const panelLeft = CENTER_X - PANEL_W / 2;
    const panelTop = CENTER_Y - PANEL_H / 2;

    // ── Backdrop ────────────────────────────────────────────────
    // Full-screen interactive dimmer. Clicking the dimmer (outside
    // the panel) dismisses the gallery — mirrors the modal pattern
    // used by RelicSwapModal and the death-screen reset confirm.
    const backdrop = scene.add
        .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
        .setDepth(OVERLAY_DEPTH)
        .setInteractive();
    objects.push(backdrop);

    // ── Panel chrome ────────────────────────────────────────────
    const panel = drawPanel(scene, CENTER_X, CENTER_Y, PANEL_W, PANEL_H, {
        depth: OVERLAY_DEPTH + 1,
        interactive: true,
    });
    // Eat clicks on the panel itself so they don't reach the
    // backdrop's pointerdown handler (which dismisses the overlay).
    panel.background.on(
        'pointerdown',
        (_p: unknown, _x: unknown, _y: unknown, e: { stopPropagation?: () => void }) => {
            e?.stopPropagation?.();
        }
    );
    objects.push(panel.background);

    const title = scene.add
        .text(CENTER_X, panelTop + 36, loc.t('effectsGalleryTitle'), {
            fontFamily: HUD_FONT,
            fontSize: '22px',
            color: HudHex.textPrimary,
            stroke: HUD_STROKE,
            strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(OVERLAY_DEPTH + 3);
    objects.push(title);

    const subtitle = scene.add
        .text(CENTER_X, panelTop + 64, loc.t('effectsGalleryHint'), {
            fontFamily: HUD_FONT,
            fontSize: '13px',
            color: '#a8a8a8',
        })
        .setOrigin(0.5)
        .setDepth(OVERLAY_DEPTH + 3);
    objects.push(subtitle);

    // Close button (top-right of the panel). Variant `dark` matches
    // the cancel buttons on the other modals (relic swap, restart
    // confirm) so the dismissal CTA reads consistently.
    const closeBtn = drawUiButton(
        scene,
        panelLeft + PANEL_W - 56,
        panelTop + 36,
        80,
        38,
        loc.t('effectsGalleryClose'),
        {
            variant: 'dark',
            fontSize: '14px',
            depth: OVERLAY_DEPTH + 3,
            sfx,
        }
    );
    objects.push(closeBtn.background, closeBtn.label);

    // ── Grid viewport ───────────────────────────────────────────
    const gridTop = panelTop + 96;
    const gridBottom = panelTop + PANEL_H - 32;
    const gridHeight = gridBottom - gridTop;
    const rows = Math.ceil(EFFECT_RECIPES.length / COLS);
    const rowStep = TILE_H + GAP_Y;
    const contentHeight = rows * TILE_H + (rows - 1) * GAP_Y;

    const totalGridW = COLS * TILE_W + (COLS - 1) * GAP_X;
    const gridLeft = CENTER_X - totalGridW / 2;

    // Container holds every tile + label so we can translate the
    // whole grid by a single y offset when scrolling.
    const content = scene.add.container(0, 0).setDepth(OVERLAY_DEPTH + 4);
    objects.push(content);

    // Geometry mask clipping content to the visible grid band.
    // `scene.make.graphics({}, false)` builds a mask source without
    // adding it to the display list so it never paints itself.
    const maskShape = scene.make.graphics({}, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(panelLeft + 24, gridTop, PANEL_W - 48, gridHeight);
    const mask = maskShape.createGeometryMask();
    content.setMask(mask);
    teardown.push(() => {
        // Mask owns the source graphics; destroy both so we don't
        // leak them when the overlay tears down.
        mask.destroy();
        maskShape.destroy();
    });

    // Tile factory. The Container draws every tile relative to its
    // own (0,0); we set the container's y to implement scrolling.
    EFFECT_RECIPES.forEach((recipe, idx) => {
        const col = idx % COLS;
        const row = Math.floor(idx / COLS);
        const tileX = gridLeft + TILE_W / 2 + col * (TILE_W + GAP_X);
        const tileY = gridTop + TILE_H / 2 + row * rowStep;

        const tilePanel = drawPanel(scene, tileX, tileY, TILE_W, TILE_H, {
            depth: OVERLAY_DEPTH + 5,
            interactive: true,
        });
        applyPanelState(tilePanel.background, 'idle', tilePanel.textured);
        const label = scene.add
            .text(tileX, tileY, loc.t(recipe.labelKey), {
                fontFamily: HUD_FONT,
                fontSize: '15px',
                color: HudHex.textPrimary,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0.5)
            .setDepth(OVERLAY_DEPTH + 6);
        content.add(tilePanel.background);
        content.add(label);

        const bg = tilePanel.background;
        bg.on('pointerover', () => {
            applyPanelState(bg, 'hover', tilePanel.textured);
            sfx?.play('buttonHover');
        });
        bg.on('pointerout', () => {
            applyPanelState(bg, 'idle', tilePanel.textured);
        });
        bg.on('pointerdown', () => {
            sfx?.play('buttonClick');
            // Preview at the tile centre. Depth bumped above the
            // overlay so the effect's GameObjects paint on top of
            // the panel chrome (otherwise the panel would occlude
            // the procedural shapes).
            playEffect(scene, recipe.kind, tileX, tileY + content.y, {
                depth: OVERLAY_DEPTH + 10,
            });
        });
    });

    // ── Scrollbar ───────────────────────────────────────────────
    const maxScroll = Math.max(0, contentHeight - gridHeight);
    let scrollY = 0;

    const scrollbarX = panelLeft + PANEL_W - 28;
    const scrollbarTrack = scene.add
        .rectangle(scrollbarX, gridTop + gridHeight / 2, 6, gridHeight, 0x2a2a2a, 1)
        .setDepth(OVERLAY_DEPTH + 3)
        .setVisible(maxScroll > 0);
    objects.push(scrollbarTrack);

    const thumbHeight =
        maxScroll > 0 ? Math.max(40, (gridHeight / contentHeight) * gridHeight) : gridHeight;
    const thumbTrackRange = gridHeight - thumbHeight;
    const thumbTopY = gridTop + thumbHeight / 2;
    const scrollbarThumb = scene.add
        .rectangle(scrollbarX, thumbTopY, 8, thumbHeight, 0xa8a8a8, 1)
        .setDepth(OVERLAY_DEPTH + 4)
        .setVisible(maxScroll > 0);
    if (maxScroll > 0) {
        scrollbarThumb.setInteractive({ useHandCursor: true, draggable: true });
        scene.input.setDraggable(scrollbarThumb);
    }
    objects.push(scrollbarThumb);

    const applyScroll = (next: number): void => {
        scrollY = Phaser.Math.Clamp(next, 0, maxScroll);
        content.setY(-scrollY);
        if (maxScroll > 0) {
            scrollbarThumb.setY(thumbTopY + (scrollY / maxScroll) * thumbTrackRange);
        }
    };

    if (maxScroll > 0) {
        scrollbarThumb.on('drag', (_p: Phaser.Input.Pointer, _dragX: number, dragY: number) => {
            const clampedY = Phaser.Math.Clamp(dragY, thumbTopY, thumbTopY + thumbTrackRange);
            const ratio = thumbTrackRange > 0 ? (clampedY - thumbTopY) / thumbTrackRange : 0;
            applyScroll(ratio * maxScroll);
        });
    }

    // ── Mouse-wheel scrolling ──────────────────────────────────
    const wheelHandler = (
        _p: Phaser.Input.Pointer,
        _over: Phaser.GameObjects.GameObject[],
        _dx: number,
        dy: number
    ): void => {
        if (maxScroll <= 0) return;
        applyScroll(scrollY + dy * 0.5);
    };
    scene.input.on('wheel', wheelHandler);
    teardown.push(() => scene.input.off('wheel', wheelHandler));

    // ── Dismiss handlers ───────────────────────────────────────
    let alive = true;
    const close = (): void => {
        if (!alive) return;
        alive = false;
        teardown.forEach((fn) => fn());
        // Containers don't auto-destroy their children when the
        // parent goes away unless the children were added via
        // `container.add`. We collected every standalone object in
        // `objects`; the container's own destroy walks its children.
        objects.forEach((o) => o.destroy());
    };

    backdrop.on('pointerdown', close);
    closeBtn.background.on('pointerdown', close);

    // Escape key dismissal. Use addCapture to keep the keystroke
    // out of the run's keybindings while the overlay is up so
    // gameplay shortcuts don't fire underneath.
    const keyboard = scene.input.keyboard;
    if (keyboard) {
        const escListener = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close();
            }
        };
        keyboard.on('keydown', escListener);
        teardown.push(() => keyboard.off('keydown', escListener));
    }

    return { destroy: close };
}
