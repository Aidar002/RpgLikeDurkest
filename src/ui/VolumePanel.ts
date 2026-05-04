import * as Phaser from 'phaser';
import type { Localization } from '../systems/Localization';
import type { SoundManager } from '../systems/SoundManager';
import type { MusicManager } from '../systems/MusicManager';
import { GAME_HEIGHT, GAME_WIDTH } from './Layout';
import { drawHudPanel, HUD_FONT, HUD_STROKE, HudColors, HudHex } from './HudTheme';

// Floating "Sound Options" panel: anchored to the bottom-right HUD chrome,
// shown/hidden by the gear icon next to the existing mute/language toggles.
// Two sliders (music + SFX) read/write the corresponding manager state and
// persist via the manager's own setters. Click outside closes the panel.

const PANEL_W = 240;
const PANEL_H = 132;
const PANEL_DEPTH = 220;
const SLIDER_WIDTH = 160;

interface Slider {
    track: Phaser.GameObjects.Rectangle;
    fill: Phaser.GameObjects.Rectangle;
    knob: Phaser.GameObjects.Rectangle;
    valueLabel: Phaser.GameObjects.Text;
    setValue(value: number): void;
}

export interface VolumePanelHandle {
    toggle(): void;
    isOpen(): boolean;
    refreshLocalization(): void;
    destroy(): void;
}

export function createVolumePanel(
    scene: Phaser.Scene,
    sfx: SoundManager,
    music: MusicManager,
    loc: Localization
): VolumePanelHandle {
    const x = GAME_WIDTH - PANEL_W - 12;
    const y = GAME_HEIGHT - PANEL_H - 56;

    const root = scene.add.container(0, 0).setDepth(PANEL_DEPTH).setVisible(false);

    // Translucent veil that catches outside-clicks for dismissal.
    const veil = scene.add
        .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0)
        .setOrigin(0, 0)
        .setInteractive();

    const panel = drawHudPanel(scene, x, y, PANEL_W, PANEL_H);
    // Soak pointer events so they don't leak through to the veil.
    const panelHit = scene.add
        .rectangle(x + PANEL_W / 2, y + PANEL_H / 2, PANEL_W, PANEL_H, 0x000000, 0)
        .setInteractive();

    const title = scene.add
        .text(x + 12, y + 10, loc.t('soundOptionsTitle').toUpperCase(), {
            fontFamily: HUD_FONT,
            fontSize: '13px',
            color: HudHex.accentExp,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        });

    const closeBtn = scene.add
        .text(x + PANEL_W - 14, y + 8, '×', {
            fontFamily: HUD_FONT,
            fontSize: '16px',
            color: HudHex.textSecondary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        })
        .setOrigin(1, 0)
        .setInteractive({ useHandCursor: true });
    closeBtn.on('pointerdown', () => hide());
    closeBtn.on('pointerover', () => closeBtn.setColor(HudHex.textPrimary));
    closeBtn.on('pointerout', () => closeBtn.setColor(HudHex.textSecondary));

    const musicLabel = scene.add
        .text(x + 12, y + 36, loc.t('musicVolumeLabel'), {
            fontFamily: HUD_FONT,
            fontSize: '12px',
            color: HudHex.textSecondary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        });

    const musicSlider = createSlider(
        scene,
        x + PANEL_W - 12 - SLIDER_WIDTH,
        y + 42,
        SLIDER_WIDTH,
        music.volume,
        HudColors.accentResolve,
        (value) => {
            music.setVolume(value);
        }
    );

    const sfxLabel = scene.add
        .text(x + 12, y + 70, loc.t('sfxVolumeLabel'), {
            fontFamily: HUD_FONT,
            fontSize: '12px',
            color: HudHex.textSecondary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        });

    const sfxSlider = createSlider(
        scene,
        x + PANEL_W - 12 - SLIDER_WIDTH,
        y + 76,
        SLIDER_WIDTH,
        sfx.volume,
        HudColors.accentExp,
        (value) => {
            sfx.setVolume(value);
        }
    );

    const hint = scene.add
        .text(x + 12, y + PANEL_H - 18, loc.t('soundOptionsHint'), {
            fontFamily: HUD_FONT,
            fontSize: '10px',
            color: HudHex.textMuted,
            stroke: HUD_STROKE,
            strokeThickness: 1,
        });

    veil.on('pointerdown', () => hide());
    panelHit.on('pointerdown', () => { /* swallow */ });

    root.add([
        veil,
        panel,
        panelHit,
        title,
        closeBtn,
        musicLabel,
        musicSlider.track,
        musicSlider.fill,
        musicSlider.knob,
        musicSlider.valueLabel,
        sfxLabel,
        sfxSlider.track,
        sfxSlider.fill,
        sfxSlider.knob,
        sfxSlider.valueLabel,
        hint,
    ]);

    let visible = false;
    function show() {
        if (visible) return;
        visible = true;
        // Pull the latest values in case localStorage changed under us.
        musicSlider.setValue(music.volume);
        sfxSlider.setValue(sfx.volume);
        root.setVisible(true);
    }
    function hide() {
        if (!visible) return;
        visible = false;
        root.setVisible(false);
    }

    return {
        toggle() {
            if (visible) hide(); else show();
        },
        isOpen() {
            return visible;
        },
        refreshLocalization() {
            title.setText(loc.t('soundOptionsTitle').toUpperCase());
            musicLabel.setText(loc.t('musicVolumeLabel'));
            sfxLabel.setText(loc.t('sfxVolumeLabel'));
            hint.setText(loc.t('soundOptionsHint'));
        },
        destroy() {
            root.destroy(true);
        },
    };
}

function createSlider(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    initialValue: number,
    fillColor: number,
    onChange: (value: number) => void
): Slider {
    const trackHeight = 4;
    const knobW = 10;
    const knobH = 18;

    const track = scene.add
        .rectangle(x, y, width, trackHeight, HudColors.panelLo, 1)
        .setOrigin(0, 0.5)
        .setStrokeStyle(1, HudColors.panelOuter)
        .setDepth(PANEL_DEPTH + 1);

    const fill = scene.add
        .rectangle(x, y, Math.max(0, Math.min(1, initialValue)) * width, trackHeight, fillColor, 1)
        .setOrigin(0, 0.5)
        .setDepth(PANEL_DEPTH + 2);

    const knob = scene.add
        .rectangle(x + initialValue * width, y, knobW, knobH, HudColors.panelHi, 1)
        .setStrokeStyle(1, fillColor)
        .setOrigin(0.5)
        .setDepth(PANEL_DEPTH + 3);

    const valueLabel = scene.add
        .text(x + width + 8, y - 7, formatPct(initialValue), {
            fontFamily: HUD_FONT,
            fontSize: '11px',
            color: HudHex.textPrimary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        })
        .setDepth(PANEL_DEPTH + 3);

    // Click anywhere on the track to jump.
    const trackHit = scene.add
        .rectangle(x, y, width, knobH + 8, 0x000000, 0)
        .setOrigin(0, 0.5)
        .setDepth(PANEL_DEPTH + 1)
        .setInteractive({ useHandCursor: true });

    let dragging = false;

    function applyFromX(rawX: number) {
        const clamped = Math.max(x, Math.min(x + width, rawX));
        const v = (clamped - x) / width;
        knob.x = clamped;
        fill.width = Math.max(0, v * width);
        valueLabel.setText(formatPct(v));
        onChange(v);
    }

    trackHit.on('pointerdown', (p: Phaser.Input.Pointer) => {
        dragging = true;
        applyFromX(p.x);
    });
    trackHit.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (dragging) applyFromX(p.x);
    });
    trackHit.on('pointerup', () => {
        dragging = false;
    });
    trackHit.on('pointerout', () => {
        dragging = false;
    });
    scene.input.on('pointerup', () => {
        dragging = false;
    });

    knob.setInteractive({ useHandCursor: true, draggable: true });
    scene.input.setDraggable(knob);
    knob.on('drag', (_p: Phaser.Input.Pointer, dragX: number) => {
        applyFromX(dragX);
    });

    return {
        track,
        fill,
        knob,
        valueLabel,
        setValue(value: number) {
            const clamped = Math.max(0, Math.min(1, value));
            knob.x = x + clamped * width;
            fill.width = clamped * width;
            valueLabel.setText(formatPct(clamped));
        },
    };
}

function formatPct(value: number): string {
    return `${Math.round(value * 100)}%`;
}
