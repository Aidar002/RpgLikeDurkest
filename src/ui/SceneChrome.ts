import * as Phaser from 'phaser';
import type { Localization } from '../systems/Localization';
import type { MusicManager } from '../systems/MusicManager';
import type { SoundManager } from '../systems/SoundManager';
import { compactText } from './TextHelpers';
import { CENTER_X, GAME_HEIGHT, GAME_WIDTH } from './Layout';
import { HUD_FONT, HUD_STROKE, HudColors, HudHex } from './HudTheme';
import { createVolumePanel, type VolumePanelHandle } from './VolumePanel';

// Small persistent scene-level UI helpers: the unlock banner that slides in
// when the player crosses a content milestone, and the bottom-right
// sound/language toggles. Extracted from GameScene so the scene file doesn't
// own trivial widget wiring.

/** Slides a highlight banner in and out to announce a new unlock. */
export function showUnlockBanner(scene: Phaser.Scene, label: string) {
    const bannerBg = scene.add
        .rectangle(CENTER_X, GAME_HEIGHT - 100, GAME_WIDTH - 80, 36, HudColors.panelBg, 0.94)
        .setStrokeStyle(1, HudColors.panelHi)
        .setDepth(200)
        .setAlpha(0);
    const bannerText = scene.add
        .text(CENTER_X, GAME_HEIGHT - 100, `\u2726\uFE0E  ${compactText(label, 60)}`, {
            fontFamily: HUD_FONT,
            fontSize: '14px',
            color: HudHex.accentExp,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setDepth(201)
        .setAlpha(0);

    scene.tweens.add({
        targets: [bannerBg, bannerText],
        alpha: 1,
        duration: 300,
        ease: 'Quad.out',
        hold: 2400,
        yoyo: true,
        onComplete: () => {
            bannerBg.destroy();
            bannerText.destroy();
        },
    });
}

interface IconButtonOptions {
    activeColor: string;
    mutedColor: string;
}

/**
 * Builds a small framed icon-button. Originally lived at the
 * bottom-right of the bottom HUD bar; now sits in the top-right
 * corner of the top bar so the bottom panel is reserved purely
 * for resource cells. Returns a handle so the caller can update
 * label/state.
 */
function createIconButton(
    scene: Phaser.Scene,
    x: number,
    y: number,
    initialLabel: string,
    fontSize: string,
    options: IconButtonOptions,
    initiallyMuted: boolean
): {
    label: Phaser.GameObjects.Text;
    setMuted(muted: boolean, nextLabel?: string): void;
    onClick(handler: () => void): void;
} {
    const w = 26;
    const h = 22;
    const frame = scene.add
        .rectangle(x, y, w, h, HudColors.panelBg, 1)
        .setStrokeStyle(1, HudColors.panelHi)
        .setOrigin(0.5)
        .setDepth(214)
        .setInteractive({ useHandCursor: true });

    let muted = initiallyMuted;
    const label = scene.add
        .text(x, y - 1, initialLabel, {
            fontFamily: HUD_FONT,
            fontSize,
            color: muted ? options.mutedColor : options.activeColor,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setDepth(215);

    frame.on('pointerover', () => {
        frame.setStrokeStyle(1, HudColors.accentExp);
        label.setColor(HudHex.textPrimary);
    });
    frame.on('pointerout', () => {
        frame.setStrokeStyle(1, HudColors.panelHi);
        label.setColor(muted ? options.mutedColor : options.activeColor);
    });

    return {
        label,
        setMuted(next: boolean, nextLabel?: string) {
            muted = next;
            if (nextLabel !== undefined) {
                label.setText(nextLabel);
            }
            label.setColor(muted ? options.mutedColor : options.activeColor);
        },
        onClick(handler: () => void) {
            frame.on('pointerdown', handler);
        },
    };
}

/**
 * Adds the top-right sound-mute, volume-options, and language toggle
 * buttons. They sit just inside the top HUD bar so they don't compete
 * with the carved bottom bar's resource cells.
 */
export function setupSceneChrome(
    scene: Phaser.Scene,
    sfx: SoundManager,
    loc: Localization,
    onLanguageToggle: () => void,
    music?: MusicManager
): Phaser.GameObjects.Text {
    const volumePanel: VolumePanelHandle | null = music
        ? createVolumePanel(scene, sfx, music, loc)
        : null;

    // Top-right icon row: roughly centred vertically inside the 96-px
    // top bar, hugging the right edge with 8 px of breathing room.
    const ICON_Y = 16;
    const ICON_RIGHT = GAME_WIDTH - 24;

    // The mute icon controls SFX. When music is wired in, its mute state is
    // kept in sync so a single click silences the whole game.
    if (music) music.setMuted(sfx.muted);
    const muteIcon = sfx.muted ? '\u266A' : '\u266B';
    const muteButton = createIconButton(
        scene,
        ICON_RIGHT - 64,
        ICON_Y,
        muteIcon,
        '15px',
        { activeColor: HudHex.textSecondary, mutedColor: HudHex.textMuted },
        sfx.muted
    );

    muteButton.onClick(() => {
        const muted = sfx.toggleMute();
        if (music) music.setMuted(muted);
        muteButton.setMuted(muted, muted ? '\u266A' : '\u266B');
    });

    const cogButton = createIconButton(
        scene,
        ICON_RIGHT - 32,
        ICON_Y,
        '\u2699',
        '15px',
        { activeColor: HudHex.textSecondary, mutedColor: HudHex.textMuted },
        false
    );
    cogButton.onClick(() => {
        volumePanel?.toggle();
    });
    if (!volumePanel) {
        cogButton.label.setVisible(false);
    }

    const langButton = createIconButton(
        scene,
        ICON_RIGHT,
        ICON_Y,
        loc.language === 'ru' ? 'RU' : 'EN',
        '12px',
        { activeColor: HudHex.textSecondary, mutedColor: HudHex.textMuted },
        false
    );
    langButton.onClick(() => {
        const next = loc.toggle();
        langButton.setMuted(false, next === 'ru' ? 'RU' : 'EN');
        volumePanel?.refreshLocalization();
        onLanguageToggle();
    });

    return muteButton.label;
}
