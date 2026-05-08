/**
 * Modal dialog that confirms a HUD restart action.
 *
 * Shown when the player clicks the in-run RESTART button. Accepting
 * wipes the entire meta-progression profile and returns to the boot
 * scene; the actual wipe is performed by the caller-supplied
 * `onConfirm` callback because it touches scene-level state
 * (`meta.resetProgress()`, `scene.start('BootScene', …)`) that this
 * widget should not know about.
 *
 * Visual contract mirrors the death-screen reset modal in
 * `src/ui/end/DeathScreen.ts` (same panel size, depth tier, button
 * geometry) so the two confirm paths feel like one component.
 *
 * Localisation keys consumed:
 *   `confirmRestartTitle` / `confirmRestartBody` /
 *   `confirmRestartYes` / `cancel`.
 */
import * as Phaser from 'phaser';

import type { Localization } from '../systems/Localization';
import { CENTER_X, CENTER_Y, Depths, GAME_HEIGHT, GAME_WIDTH } from './Layout';

type Widget = Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text;

export interface RestartConfirmModalOptions {
    /** Localisation runtime; used to translate the four user-facing
     *  strings on the modal. */
    loc: Localization;
    /** Invoked when the player accepts the wipe. The caller is
     *  responsible for actually resetting progress and switching
     *  scenes — the modal only hides itself before delegating. */
    onConfirm: () => void;
}

export class RestartConfirmModal {
    private readonly widgets: Widget[];

    constructor(scene: Phaser.Scene, options: RestartConfirmModalOptions) {
        const { loc, onConfirm } = options;
        const overlay = scene.add
            .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.76)
            .setDepth(Depths.ConfirmOverlay)
            .setInteractive();
        const panel = scene.add
            .rectangle(CENTER_X, CENTER_Y, 460, 200, 0x181818)
            .setDepth(Depths.ConfirmPanel);
        panel.setStrokeStyle(2, 0x8a4d4d);
        const title = scene.add
            .text(CENTER_X, CENTER_Y - 50, loc.t('confirmRestartTitle'), {
                fontFamily: 'Courier New',
                fontSize: '22px',
                color: '#ffd2d2',
            })
            .setOrigin(0.5)
            .setDepth(Depths.ConfirmContent);
        const body = scene.add
            .text(CENTER_X, CENTER_Y, loc.t('confirmRestartBody'), {
                fontFamily: 'Courier New',
                fontSize: '14px',
                color: '#d6d6d6',
                align: 'center',
                lineSpacing: 8,
                wordWrap: { width: 360 },
            })
            .setOrigin(0.5)
            .setDepth(Depths.ConfirmContent);
        const yesBtn = scene.add
            .rectangle(CENTER_X - 90, CENTER_Y + 66, 170, 38, 0x5a1d1d)
            .setDepth(Depths.ConfirmContent);
        yesBtn.setStrokeStyle(1, 0xc57d7d);
        yesBtn.setInteractive({ useHandCursor: true });
        const yesText = scene.add
            .text(CENTER_X - 90, CENTER_Y + 66, loc.t('confirmRestartYes'), {
                fontFamily: 'Courier New',
                fontSize: '14px',
                color: '#ffe8e8',
            })
            .setOrigin(0.5)
            .setDepth(Depths.ConfirmForeground);
        const noBtn = scene.add
            .rectangle(CENTER_X + 90, CENTER_Y + 66, 170, 38, 0x252525)
            .setDepth(Depths.ConfirmContent);
        noBtn.setStrokeStyle(1, 0x8a8a8a);
        noBtn.setInteractive({ useHandCursor: true });
        const noText = scene.add
            .text(CENTER_X + 90, CENTER_Y + 66, loc.t('cancel'), {
                fontFamily: 'Courier New',
                fontSize: '14px',
                color: '#f0f0f0',
            })
            .setOrigin(0.5)
            .setDepth(Depths.ConfirmForeground);

        yesBtn.on('pointerover', () => yesBtn.setStrokeStyle(2, 0xffd7d7));
        yesBtn.on('pointerout', () => yesBtn.setStrokeStyle(1, 0xc57d7d));
        yesBtn.on('pointerdown', () => {
            this.hide();
            onConfirm();
        });

        noBtn.on('pointerover', () => noBtn.setStrokeStyle(2, 0xffffff));
        noBtn.on('pointerout', () => noBtn.setStrokeStyle(1, 0x8a8a8a));
        noBtn.on('pointerdown', () => this.hide());
        overlay.on('pointerdown', () => this.hide());

        this.widgets = [overlay, panel, title, body, yesBtn, yesText, noBtn, noText];
        this.hide();
    }

    show(): void {
        this.setVisible(true);
    }

    hide(): void {
        this.setVisible(false);
    }

    private setVisible(visible: boolean): void {
        this.widgets.forEach((widget) => widget.setVisible(visible));
    }
}
