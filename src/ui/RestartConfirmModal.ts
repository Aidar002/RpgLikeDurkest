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
import { drawUiButton } from './UiButton';

type Widget = Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text | Phaser.GameObjects.NineSlice;

interface RestartConfirmModalOptions {
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
        const yesUi = drawUiButton(
            scene,
            CENTER_X - 90,
            CENTER_Y + 66,
            170,
            38,
            loc.t('confirmRestartYes'),
            {
                variant: 'danger',
                fontSize: '14px',
                color: '#ffe8e8',
                depth: Depths.ConfirmContent,
            }
        );
        const yesBtn = yesUi.background;
        const yesText = yesUi.label;
        yesText.setDepth(Depths.ConfirmForeground);

        const noUi = drawUiButton(scene, CENTER_X + 90, CENTER_Y + 66, 170, 38, loc.t('cancel'), {
            variant: 'dark',
            fontSize: '14px',
            color: '#f0f0f0',
            depth: Depths.ConfirmContent,
        });
        const noBtn = noUi.background;
        const noText = noUi.label;
        noText.setDepth(Depths.ConfirmForeground);

        yesBtn.on('pointerdown', () => {
            this.hide();
            onConfirm();
        });
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
