/**
 * Modal mini-game played on locked treasure chests.
 *
 * Wiring: {@link import('../systems/rooms/Treasure').handleTreasureRoom}
 * decides a chest is locked (per {@link LOCKPICK_CONFIG.lockedChance}),
 * shows "Взломать / Уйти" buttons in the room panel, and on "Взломать"
 * calls {@link LockpickOverlay.show}. The overlay owns the headless
 * {@link LockpickGame} that tracks ring rotation + success/failure
 * state; this file is the canvas/input layer on top of that.
 *
 * Lifecycle: the overlay is constructed once per `GameScene` and is
 * hidden by default. `show()` configures the game for a difficulty,
 * makes every widget visible, and subscribes to the Phaser scene's
 * per-frame UPDATE event so the rings can spin. `hide()` flips
 * everything back off and unsubscribes. `destroy()` is for unit tests
 * / scene teardown — production code never calls it.
 *
 * Visual layout: a dimming overlay covers the whole canvas; a centred
 * panel frame holds three concentric ring arcs, a descending "stick"
 * sprite anchored to the panel's top edge, a small keyhole at the
 * ring centre, and a "↓" pierce button to the right. The player can
 * still bail without a penalty from the room panel (the
 * `actionLockpickLeave` button shown before the modal opens), so the
 * modal itself stays uncluttered — it contains nothing but the lock.
 *
 * Stick mechanic: the pierce button is press-and-hold. While the
 * pointer is down on the button, the stick tip slides down at
 * `LOCKPICK_CONFIG.descentPxPerSec` px/s; on release it stops. Each
 * unlocked ring has a threshold Y at its outermost edge; when the
 * tip crosses that threshold the headless `LockpickGame.attemptDescend()`
 * is called once, which decides whether the gap was aligned (ring
 * locks, stick keeps moving) or not (stick breaks, game fails). The
 * player therefore has to time button releases so the tip never
 * crosses an unlocked ring's wall except through its gap.
 *
 * Coordinate system note: the headless logic in {@link LockpickGame}
 * treats `STICK_ANGLE_DEG = 0` as "where the stick lives". Visually
 * we want the stick to descend from the top of the screen, so this
 * file rotates each ring's render by −90° (i.e. world-angle 0 maps
 * to Phaser screen angle −π/2 = up). Everything else falls out of
 * that single mapping in {@link toPhaserRad}.
 */
import * as Phaser from 'phaser';

import { LOCKPICK_CONFIG } from '../data/GameConfig';
import {
    LockpickGame,
    STICK_ANGLE_DEG,
    type AttemptResult,
    type LockpickDifficulty,
} from '../systems/Lockpick';
import type { Localization } from '../systems/Localization';
import { defaultRng } from '../systems/Rng';
import type { SoundManager } from '../systems/SoundManager';
import { drawPanel } from './UiPanel';
import { drawUiButton, type ButtonBackground } from './UiButton';
import { HudColors } from './HudTheme';
import { CENTER_X, CENTER_Y, Depths, GAME_HEIGHT, GAME_WIDTH } from './Layout';

/** Result handed back to the caller via `onResolve`. */
export type LockpickResult = 'success' | 'failure' | 'leave';

export interface LockpickShowOptions {
    /** Difficulty to play at. Comes from `pickLockpickDifficulty`. */
    difficulty: LockpickDifficulty;
    /** Fired exactly once when the mini-game ends (any path). */
    onResolve: (result: LockpickResult) => void;
}

interface LockpickDeps {
    loc: Localization;
    /** Optional SFX manager. When omitted the modal still works (in
     *  tests, headless builds), it just runs silent. */
    sfx?: SoundManager;
}

// Panel + ring layout. Sized to be ~30 % smaller than the previous
// iteration: the modal sits more comfortably inside the canvas, the
// rings have generous gaps for timing the stick, and the pierce button
// still keeps a clear gutter from the outer ring without overlapping
// the frame ornament.
const PANEL_W = 546;
const PANEL_H = 504;
/** Outer edge of the panel along the top — i.e. the topmost pixel of
 *  the carved frame ornament. The stick anchors its top here so the
 *  visible tip of the pick reaches all the way up to the frame edge,
 *  per design feedback ("верхний край отмычки нужно удлинить, чтобы
 *  он касался рамки миниигры"). */
const PANEL_TOP_Y = CENTER_Y - PANEL_H / 2;
/** Horizontal offset of the ring centre from the panel centre. Pushed
 *  slightly left so the pierce button has its own column on the right
 *  without crowding the outer ring. Scaled down with the panel. */
const RING_CX = CENTER_X - 56;
/** Vertical centre of the rings inside the panel. Sits just below
 *  panel mid-line so the stick has a comfortable descent above it. */
const RING_CY = CENTER_Y + 20;
/** Outer → inner ring radii in pixels. Mirrored in `LOCKPICK_CONFIG.ringRadiiPx`
 *  so the headless game can size each ring's gap to match the visual width. */
const RING_RADII = LOCKPICK_CONFIG.ringRadiiPx;
const RING_THICKNESS = 13;
/** Extra stroke width painted underneath the ring's main fill so each
 *  ring shows a distinct dark contour on both inner and outer edges. */
const RING_EDGE_EXTRA = 3;
/** Outermost radial offset of a ring's drawn band, including the edge
 *  contour. Used by the stick to keep a clear gap from the ring wall. */
const RING_OUTER_HALF = (RING_THICKNESS + RING_EDGE_EXTRA) / 2;
/** Cool grey fill for unlocked ring walls. */
const RING_COLOUR_MAIN = 0x868691;
/** Darker contour stroke for unlocked rings. */
const RING_COLOUR_EDGE = 0x2c2a32;
/** Warm gold fill for a ring that has been locked open. */
const RING_COLOUR_LOCKED_MAIN = HudColors.cellGoldEdge;
/** Darker amber contour for the locked-ring contour. */
const RING_COLOUR_LOCKED_EDGE = 0x6a4a18;
const STICK_THICKNESS = LOCKPICK_CONFIG.stickWidthPx;
const KEYHOLE_RADIUS = 17;
const BUTTON_W = 77;
const BUTTON_H = 63;
/** Horizontal distance from the rings centre to the pierce button.
 *  Placed beyond the outer-ring radius plus a generous gutter so the
 *  button and the ring outline never overlap visually. */
const BUTTON_OFFSET_X = RING_RADII[0] + 42 + BUTTON_W / 2;

/** Starting Y of the stick tip. Sits a clear gap above the outermost
 *  edge of the outer ring (ring thickness + edge contour + an extra
 *  12 px visual gap) so the lockpick doesn't appear to touch the
 *  lock wall before the player has even pressed the button. */
const INITIAL_TIP_Y = RING_CY - RING_RADII[0] - RING_OUTER_HALF - 12;
/** Outermost-edge Y coordinate of each ring — the trigger line for
 *  calling `attemptDescend()` as the stick crosses it. Indices match
 *  {@link RING_RADII} (0 = outer, 2 = inner). */
const RING_THRESHOLDS_Y = RING_RADII.map((r) => RING_CY - r - RING_OUTER_HALF);
/** Final resting Y for the stick tip on a successful pick — sinks
 *  just past the keyhole rim so the success animation reads visually
 *  as the pick landing home. */
const SUCCESS_TIP_Y = RING_CY - KEYHOLE_RADIUS + LOCKPICK_CONFIG.successOvershootPx;
/** Hard ceiling for the tip while the button is held. Equal to the
 *  inner ring's threshold; the headless game decides success at that
 *  point and the tween animates the rest. Guards against runaway
 *  descent if frame deltas spike. */
const MAX_TIP_Y = RING_THRESHOLDS_Y[RING_THRESHOLDS_Y.length - 1];

type Widget =
    | Phaser.GameObjects.Rectangle
    | Phaser.GameObjects.Text
    | Phaser.GameObjects.Graphics
    | Phaser.GameObjects.NineSlice;

export class LockpickOverlay {
    private readonly scene: Phaser.Scene;
    private readonly deps: LockpickDeps;
    private readonly widgets: Widget[] = [];

    private readonly overlay: Phaser.GameObjects.Rectangle;
    private readonly ringGraphics: Phaser.GameObjects.Graphics;
    private readonly keyholeGraphics: Phaser.GameObjects.Graphics;
    private readonly stickGraphics: Phaser.GameObjects.Graphics;
    private readonly pierceButton: ButtonBackground;
    private readonly pierceLabel: Phaser.GameObjects.Text;

    private game: LockpickGame | null = null;
    private active = false;
    private resolved = false;
    /** Locks user input while the failure / success animation runs. */
    private busy = false;
    /** True while the player holds the pierce button down. The stick
     *  only advances while this is true. */
    private pressing = false;
    /** Continuous Y coordinate of the stick's tip in screen space.
     *  Drives both rendering (stick height = tipY − panel inner top)
     *  and ring-threshold detection. */
    private stickTipY = INITIAL_TIP_Y;
    private onResolve: ((result: LockpickResult) => void) | null = null;
    private readonly tick: (time: number, delta: number) => void;

    constructor(scene: Phaser.Scene, deps: LockpickDeps) {
        this.scene = scene;
        this.deps = deps;

        // Dimming backdrop. Marked interactive so it eats clicks that
        // miss the buttons (prevents stray taps from reaching the
        // underlying room panel through the modal).
        this.overlay = scene.add
            .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
            .setDepth(Depths.ConfirmOverlay)
            .setInteractive();
        this.widgets.push(this.overlay);

        const panel = drawPanel(scene, CENTER_X, CENTER_Y, PANEL_W, PANEL_H, {
            depth: Depths.ConfirmPanel,
        });
        this.widgets.push(panel.background);

        // No status caption / leave button inside the modal anymore.
        // The room panel already advertises a free walk-away choice
        // via `actionLockpickLeave`, so the modal stays minimal: only
        // the lock, the rings, the stick and the pierce button.

        this.keyholeGraphics = scene.add.graphics().setDepth(Depths.ConfirmContent);
        this.widgets.push(this.keyholeGraphics);

        this.ringGraphics = scene.add.graphics().setDepth(Depths.ConfirmContent + 1);
        this.widgets.push(this.ringGraphics);

        this.stickGraphics = scene.add.graphics().setDepth(Depths.ConfirmContent + 2);
        this.widgets.push(this.stickGraphics);

        const pierce = drawUiButton(
            scene,
            RING_CX + BUTTON_OFFSET_X,
            RING_CY,
            BUTTON_W,
            BUTTON_H,
            '↓',
            {
                variant: 'gold',
                depth: Depths.ConfirmForeground,
                fontSize: '28px',
                sfx: deps.sfx,
                // Suppress the auto buttonClick — we layer our own
                // `lockpickClick`/`lockpickBreak` cues on result so a
                // generic UI tick on top would muddy the cue.
                autoSfx: false,
            }
        );
        this.pierceButton = pierce.background;
        this.pierceLabel = pierce.label;
        this.widgets.push(pierce.background, pierce.label);
        // Press-and-hold mechanic. pointerdown starts the descent;
        // pointerup and pointerupoutside both stop it, so dragging the
        // cursor off the button while still holding the mouse also
        // releases the stick (matches typical UI expectations).
        this.pierceButton.on('pointerdown', () => this.handlePressStart());
        this.pierceButton.on('pointerup', () => this.handlePressEnd());
        this.pierceButton.on('pointerupoutside', () => this.handlePressEnd());
        this.pierceButton.on('pointerout', () => this.handlePressEnd());

        this.tick = (_time, delta) => this.onTick(delta);
        this.hideInternal();
    }

    /** Open the modal at the given difficulty and start spinning. */
    public show(options: LockpickShowOptions): void {
        if (this.active) {
            // Shouldn't happen — Treasure room is gated by the
            // showLockpickModal call — but guard anyway so we never
            // double-resolve and leak a stale `onResolve`.
            return;
        }
        this.game = new LockpickGame(options.difficulty, defaultRng);
        this.onResolve = options.onResolve;
        this.resolved = false;
        this.busy = false;
        this.pressing = false;
        this.stickTipY = INITIAL_TIP_Y;

        this.pierceLabel.setText('↓');

        this.active = true;
        this.widgets.forEach((w) => w.setVisible(true));
        this.pierceButton.setInteractive({ useHandCursor: true });

        this.drawKeyhole();
        this.drawRings();
        this.drawStick();

        this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    }

    /** Tear down the entire overlay (test-only). */
    public destroy(): void {
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
        this.widgets.forEach((w) => w.destroy());
        this.widgets.length = 0;
    }

    private onTick(deltaMs: number): void {
        if (!this.active || !this.game) return;
        this.game.update(deltaMs);

        // Advance the stick only while the player is holding the
        // pierce button and we're not animating a resolution. A
        // bounded delta avoids huge jumps after a tab-freeze.
        if (this.pressing && !this.busy && !this.resolved) {
            const dt = Math.min(deltaMs, 100) / 1000;
            const prevTip = this.stickTipY;
            this.stickTipY = Math.min(
                this.stickTipY + LOCKPICK_CONFIG.descentPxPerSec * dt,
                MAX_TIP_Y
            );
            this.checkRingCrossings(prevTip);
        }

        this.drawRings();
        this.drawStick();
    }

    /**
     * For every unlocked ring whose outer-edge threshold the tip just
     * crossed this frame, ask the headless game whether the gap is
     * currently aligned. Locks the ring on success, halts the stick
     * and triggers the failure animation on a miss. Multiple rings
     * can in theory be crossed in one frame (huge frame delta) — the
     * loop drains them in order so each gets its own attempt.
     */
    private checkRingCrossings(prevTip: number): void {
        const game = this.game;
        if (!game) return;
        while (
            game.currentRingIndex < game.rings.length &&
            this.stickTipY >= RING_THRESHOLDS_Y[game.currentRingIndex]
        ) {
            const idx = game.currentRingIndex;
            const threshold = RING_THRESHOLDS_Y[idx];
            // Guard against re-firing on a ring whose threshold was
            // already at-or-below prevTip (e.g. the very first frame
            // after a ring locked at threshold).
            if (prevTip >= threshold) break;
            const result = game.attemptDescend();
            this.applyAttempt(result, threshold);
            if (this.busy || this.resolved) break;
            // attemptDescend incremented currentRingIndex on success,
            // so the next loop iteration evaluates the next ring.
        }
    }

    private handlePressStart(): void {
        if (!this.active || this.busy || this.resolved) return;
        this.pressing = true;
    }

    private handlePressEnd(): void {
        this.pressing = false;
    }

    private applyAttempt(result: AttemptResult, ringThresholdY: number): void {
        const { sfx } = this.deps;
        if (result.kind === 'ringLocked') {
            sfx?.play('lockpickClick');
        } else if (result.kind === 'success') {
            sfx?.play('lockpickClick');
            this.busy = true;
            this.pressing = false;
            this.pierceButton.disableInteractive();
            // Animate the tip sinking the last little bit into the
            // keyhole so the success reads visually rather than just
            // popping straight to resolved.
            this.scene.tweens.add({
                targets: this,
                stickTipY: SUCCESS_TIP_Y,
                duration: 160,
                ease: 'linear',
                onUpdate: () => this.drawStick(),
                onComplete: () => this.resolve('success'),
            });
        } else {
            sfx?.play('lockpickBreak');
            // The tip stops dead at the ring wall it hit.
            this.stickTipY = ringThresholdY;
            this.pressing = false;
            this.busy = true;
            this.pierceButton.disableInteractive();
            this.drawStick();
            this.scene.tweens.add({
                targets: this.stickGraphics,
                x: { from: -6, to: 6 },
                yoyo: true,
                repeat: 2,
                duration: 60,
                onComplete: () => {
                    this.stickGraphics.setX(0);
                    this.resolve('failure');
                },
            });
        }
    }

    private resolve(result: LockpickResult): void {
        if (this.resolved) return;
        this.resolved = true;
        const cb = this.onResolve;
        this.onResolve = null;
        this.hideInternal();
        cb?.(result);
    }

    private hideInternal(): void {
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
        this.active = false;
        this.widgets.forEach((w) => w.setVisible(false));
        this.pierceButton.disableInteractive();
        this.game = null;
    }

    // -------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------

    private drawKeyhole(): void {
        const g = this.keyholeGraphics;
        g.clear();
        g.fillStyle(HudColors.panelBg, 1);
        g.fillCircle(RING_CX, RING_CY, KEYHOLE_RADIUS);
        g.lineStyle(2, HudColors.cellGoldEdge, 1);
        g.strokeCircle(RING_CX, RING_CY, KEYHOLE_RADIUS);
        // Tiny vertical slot to suggest a keyhole.
        g.fillStyle(0x000000, 1);
        g.fillRect(RING_CX - 3, RING_CY - 8, 6, 16);
    }

    private drawRings(): void {
        const game = this.game;
        if (!game) return;
        const g = this.ringGraphics;
        g.clear();
        for (let i = 0; i < game.rings.length; i++) {
            const ring = game.rings[i];
            const radius = RING_RADII[i];
            // Two-pass stroke: a slightly thicker dark outline sits
            // underneath the lighter main fill, so a 2-px contour line
            // is visible on both sides of every ring. Locked rings
            // switch to a warm gold to mark progress without losing
            // the contour treatment.
            const mainColour = ring.locked ? RING_COLOUR_LOCKED_MAIN : RING_COLOUR_MAIN;
            const edgeColour = ring.locked ? RING_COLOUR_LOCKED_EDGE : RING_COLOUR_EDGE;

            g.lineStyle(RING_THICKNESS + RING_EDGE_EXTRA, edgeColour, 1);
            g.beginPath();
            g.arc(RING_CX, RING_CY, radius, 0, Math.PI * 2);
            g.strokePath();

            g.lineStyle(RING_THICKNESS, mainColour, 1);
            g.beginPath();
            g.arc(RING_CX, RING_CY, radius, 0, Math.PI * 2);
            g.strokePath();

            if (!ring.locked) {
                // Erase the gap with a brush thick enough to clear both
                // the main fill and its edge contour, so no faint sliver
                // of the contour shows up across the opening.
                const halfRad = (ring.gapHalfWidthDeg * Math.PI) / 180;
                const centreRad = toPhaserRad(ring.gapAngleDeg);
                g.lineStyle(RING_THICKNESS + RING_EDGE_EXTRA + 4, HudColors.panelBg, 1);
                g.beginPath();
                g.arc(RING_CX, RING_CY, radius, centreRad - halfRad, centreRad + halfRad);
                g.strokePath();
            }
        }
    }

    /**
     * Render the stick as a rectangle that starts at the panel's outer
     * frame edge and ends at {@link stickTipY}. The top of the stick
     * visually touches the carved frame ornament — the implied handle
     * lives just behind/above the frame. The visible portion grows as
     * the tip is pushed deeper into the lock.
     */
    private drawStick(): void {
        const g = this.stickGraphics;
        g.clear();
        const topY = PANEL_TOP_Y;
        const height = Math.max(STICK_THICKNESS, this.stickTipY - topY);
        const x = RING_CX - STICK_THICKNESS / 2;
        g.fillStyle(HudColors.accentLight, 1);
        g.fillRect(x, topY, STICK_THICKNESS, height);
        g.lineStyle(1, HudColors.panelOuter, 1);
        g.strokeRect(x, topY, STICK_THICKNESS, height);
    }
}

/**
 * Map an angle from our headless coordinate system (0° = stick
 * direction) to Phaser's screen-radian convention (0 rad = right,
 * π/2 rad = down). We anchor the stick at the top of the screen, so
 * world-0 maps to −π/2 rad.
 */
function toPhaserRad(worldAngleDeg: number): number {
    return ((worldAngleDeg + STICK_ANGLE_DEG - 90) * Math.PI) / 180;
}
