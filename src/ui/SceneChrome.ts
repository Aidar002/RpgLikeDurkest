import * as Phaser from 'phaser';
import type { Localization } from '../systems/Localization';
import type { SoundManager } from '../systems/SoundManager';
import { compactText } from './TextHelpers';
import { CENTER_X, GAME_HEIGHT, GAME_WIDTH } from './Layout';

// Small persistent scene-level UI helpers: the unlock banner that slides in
// when the player crosses a content milestone, and the bottom-left
// sound/language toggles. Extracted from GameScene so the scene file doesn't
// own trivial widget wiring.

/** Slides a highlight banner in and out to announce a new unlock. */
export function showUnlockBanner(scene: Phaser.Scene, label: string) {
    const bannerBg = scene.add
        .rectangle(CENTER_X, GAME_HEIGHT - 80, GAME_WIDTH - 80, 36, 0x0a1a33, 0.92)
        .setStrokeStyle(1, 0x4488cc)
        .setDepth(200)
        .setAlpha(0);
    const bannerText = scene.add
        .text(CENTER_X, GAME_HEIGHT - 80, `\u2726  ${compactText(label, 60)}`, {
            fontFamily: 'Courier New',
            fontSize: '14px',
            color: '#88ccff',
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

/**
 * Adds the bottom-left sound-mute button and the language (RU/EN) toggle.
 * Returns the mute button so the scene can keep a handle (e.g. for later
 * updates on mute state from other UI paths).
 */
export function setupSceneChrome(
    scene: Phaser.Scene,
    sfx: SoundManager,
    loc: Localization,
    onLanguageToggle: () => void
): Phaser.GameObjects.Text {
    const muteIcon = sfx.muted ? '\u266A' : '\u266B';
    const muteButton = scene.add
        .text(GAME_WIDTH - 60, GAME_HEIGHT - 80, muteIcon, {
            fontFamily: 'Courier New',
            fontSize: '16px',
            color: sfx.muted ? '#555555' : '#aaaaaa',
        })
        .setDepth(215)
        .setInteractive({ useHandCursor: true });

    muteButton.on('pointerdown', () => {
        const muted = sfx.toggleMute();
        muteButton.setText(muted ? '\u266A' : '\u266B');
        muteButton.setColor(muted ? '#555555' : '#aaaaaa');
    });
    muteButton.on('pointerover', () => muteButton.setColor('#ffffff'));
    muteButton.on('pointerout', () => muteButton.setColor(sfx.muted ? '#555555' : '#aaaaaa'));

    const langBtn = scene.add
        .text(GAME_WIDTH - 34, GAME_HEIGHT - 80, loc.language === 'ru' ? 'RU' : 'EN', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#aaaaaa',
        })
        .setDepth(215)
        .setInteractive({ useHandCursor: true });

    langBtn.on('pointerdown', () => {
        const next = loc.toggle();
        langBtn.setText(next === 'ru' ? 'RU' : 'EN');
        onLanguageToggle();
    });
    langBtn.on('pointerover', () => langBtn.setColor('#ffffff'));
    langBtn.on('pointerout', () => langBtn.setColor('#aaaaaa'));

    return muteButton;
}
