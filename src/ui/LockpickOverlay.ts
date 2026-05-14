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
 * `panel_small` nine-slice frame holds three concentric ring arcs, a
 * descending "stick" sprite at the top, a small keyhole at the
 * center, the big "↓" pierce button to the right, and a "Уйти"
 * (Leave) button at the bottom for bailing without a penalty.
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
import { HUD_FONT, HUD_STROKE, HudColors, HudHex } from './HudTheme';
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

const PANEL_W = 520;
const PANEL_H = 540;
const RING_CX = CENTER_X - 70;
const RING_CY = CENTER_Y + 30;
const RING_RADII = [180, 130, 80] as const;
const RING_THICKNESS = 18;
const STICK_LEN = 70;
const STICK_THICKNESS = 8;
const KEYHOLE_RADIUS = 22;
const BUTTON_W = 100;
const BUTTON_H = 80;
/** Horizontal distance from the rings centre to the pierce button. */
const BUTTON_OFFSET_X = 230;

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
    private readonly title: Phaser.GameObjects.Text;
    private readonly difficultyLabel: Phaser.GameObjects.Text;
    private readonly status: Phaser.GameObjects.Text;
    private readonly ringGraphics: Phaser.GameObjects.Graphics;
    private readonly keyholeGraphics: Phaser.GameObjects.Graphics;
    private readonly stickGraphics: Phaser.GameObjects.Graphics;
    private readonly pierceButton: ButtonBackground;
    private readonly pierceLabel: Phaser.GameObjects.Text;
    private readonly leaveButton: ButtonBackground;
    private readonly leaveLabel: Phaser.GameObjects.Text;

    private game: LockpickGame | null = null;
    private active = false;
    private resolved = false;
    /** Locks user input while the stick descent tween is running. */
    private busy = false;
    /** Tracks the stick's logical position (0 = above outer ring, 3 = at keyhole). */
    private stickStage = 0;
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

        this.title = scene.add
            .text(CENTER_X, CENTER_Y - PANEL_H / 2 + 32, '', {
                fontFamily: HUD_FONT,
                fontSize: '22px',
                color: HudHex.accentGold,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0.5)
            .setDepth(Depths.ConfirmContent);
        this.widgets.push(this.title);

        this.difficultyLabel = scene.add
            .text(CENTER_X, CENTER_Y - PANEL_H / 2 + 58, '', {
                fontFamily: HUD_FONT,
                fontSize: '12px',
                color: HudHex.textSecondary,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0.5)
            .setDepth(Depths.ConfirmContent);
        this.widgets.push(this.difficultyLabel);

        this.status = scene.add
            .text(CENTER_X, CENTER_Y + PANEL_H / 2 - 86, '', {
                fontFamily: HUD_FONT,
                fontSize: '14px',
                color: HudHex.textPrimary,
                stroke: HUD_STROKE,
                strokeThickness: 2,
                align: 'center',
                wordWrap: { width: PANEL_W - 60 },
            })
            .setOrigin(0.5)
            .setDepth(Depths.ConfirmContent);
        this.widgets.push(this.status);

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
                fontSize: '34px',
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
        this.pierceButton.on('pointerdown', () => this.handlePierce());

        const leave = drawUiButton(scene, CENTER_X, CENTER_Y + PANEL_H / 2 - 40, 180, 36, '', {
            variant: 'dark',
            depth: Depths.ConfirmForeground,
            fontSize: '14px',
            sfx: deps.sfx,
        });
        this.leaveButton = leave.background;
        this.leaveLabel = leave.label;
        this.widgets.push(leave.background, leave.label);
        this.leaveButton.on('pointerdown', () => this.handleLeave());

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
        const { loc } = this.deps;
        this.game = new LockpickGame(options.difficulty, defaultRng);
        this.onResolve = options.onResolve;
        this.resolved = false;
        this.busy = false;
        this.stickStage = 0;

        this.title.setText(loc.t('lockpickTitle'));
        this.difficultyLabel.setText(
            loc.t('lockpickDifficulty', { value: loc.t(difficultyKey(options.difficulty)) })
        );
        this.status.setText(loc.t('lockpickStatusIdle'));
        this.status.setColor(HudHex.textSecondary);
        this.pierceLabel.setText('↓');
        this.leaveLabel.setText(loc.t('lockpickLeave'));

        this.active = true;
        this.widgets.forEach((w) => w.setVisible(true));
        this.pierceButton.setInteractive({ useHandCursor: true });
        this.leaveButton.setInteractive({ useHandCursor: true });

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
        this.drawRings();
    }

    private handlePierce(): void {
        if (!this.active || !this.game || this.busy || this.resolved) return;
        const result = this.game.attemptDescend();
        this.applyAttempt(result);
    }

    private applyAttempt(result: AttemptResult): void {
        const { loc, sfx } = this.deps;
        if (result.kind === 'ringLocked' || result.kind === 'success') {
            sfx?.play('lockpickClick');
            this.busy = true;
            // Animate stick descending one slot inward.
            this.tweenStickStage(this.stickStage + 1, () => {
                this.busy = false;
                if (result.kind === 'success') {
                    this.resolve('success');
                } else {
                    this.status.setText(
                        loc.t('lockpickStatusRingDown', { remaining: result.remaining })
                    );
                    this.status.setColor(HudHex.accentExp);
                }
            });
        } else {
            sfx?.play('lockpickBreak');
            this.status.setText(loc.t('lockpickStatusFail'));
            this.status.setColor(HudHex.accentBlood);
            // Brief visual: tint the stick red and shake it, then
            // resolve. Pierce button gets disabled immediately.
            this.pierceButton.disableInteractive();
            this.leaveButton.disableInteractive();
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

    private handleLeave(): void {
        if (!this.active || this.busy || this.resolved) return;
        this.resolve('leave');
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
        this.leaveButton.disableInteractive();
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
            const colour = ring.locked ? HudColors.cellGoldEdge : 0x9a917b;
            g.lineStyle(RING_THICKNESS, colour, 1);
            // Draw the solid wall: full circle, then erase the gap
            // arc by drawing it again in the panel's background colour.
            g.beginPath();
            g.arc(RING_CX, RING_CY, radius, 0, Math.PI * 2);
            g.strokePath();
            if (!ring.locked) {
                const halfRad = (ring.gapHalfWidthDeg * Math.PI) / 180;
                const centreRad = toPhaserRad(ring.gapAngleDeg);
                g.lineStyle(RING_THICKNESS + 2, HudColors.panelBg, 1);
                g.beginPath();
                g.arc(RING_CX, RING_CY, radius, centreRad - halfRad, centreRad + halfRad);
                g.strokePath();
            }
        }
    }

    private drawStick(): void {
        const g = this.stickGraphics;
        g.clear();
        const y = this.stickYForStage(this.stickStage);
        g.fillStyle(HudColors.accentLight, 1);
        g.fillRect(RING_CX - STICK_THICKNESS / 2, y, STICK_THICKNESS, STICK_LEN);
        g.lineStyle(1, HudColors.panelOuter, 1);
        g.strokeRect(RING_CX - STICK_THICKNESS / 2, y, STICK_THICKNESS, STICK_LEN);
    }

    /**
     * Pixel-y of the stick's top edge for stage:
     *  0 = above the outer ring (initial position)
     *  1 = between outer and middle ring (after locking ring 0)
     *  2 = between middle and inner ring (after locking ring 1)
     *  3 = at the keyhole (after locking ring 2 → success)
     */
    private stickYForStage(stage: number): number {
        const outer = RING_RADII[0];
        switch (stage) {
            case 0:
                return RING_CY - outer - STICK_LEN - 16;
            case 1:
                return RING_CY - (RING_RADII[0] + RING_RADII[1]) / 2 - STICK_LEN / 2;
            case 2:
                return RING_CY - (RING_RADII[1] + RING_RADII[2]) / 2 - STICK_LEN / 2;
            default:
                return RING_CY - KEYHOLE_RADIUS - STICK_LEN / 2;
        }
    }

    private tweenStickStage(targetStage: number, onComplete: () => void): void {
        const startY = this.stickYForStage(this.stickStage);
        const endY = this.stickYForStage(targetStage);
        const proxy = { t: 0 };
        this.scene.tweens.add({
            targets: proxy,
            t: 1,
            duration: LOCKPICK_CONFIG.descentMs,
            ease: 'sine.in',
            onUpdate: () => {
                const y = startY + (endY - startY) * proxy.t;
                this.stickGraphics.clear();
                this.stickGraphics.fillStyle(HudColors.accentLight, 1);
                this.stickGraphics.fillRect(
                    RING_CX - STICK_THICKNESS / 2,
                    y,
                    STICK_THICKNESS,
                    STICK_LEN
                );
                this.stickGraphics.lineStyle(1, HudColors.panelOuter, 1);
                this.stickGraphics.strokeRect(
                    RING_CX - STICK_THICKNESS / 2,
                    y,
                    STICK_THICKNESS,
                    STICK_LEN
                );
            },
            onComplete: () => {
                this.stickStage = targetStage;
                this.drawStick();
                onComplete();
            },
        });
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

function difficultyKey(d: LockpickDifficulty): 'lockpickEasy' | 'lockpickMedium' | 'lockpickHard' {
    switch (d) {
        case 'easy':
            return 'lockpickEasy';
        case 'medium':
            return 'lockpickMedium';
        case 'hard':
            return 'lockpickHard';
    }
}
