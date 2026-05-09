import { BOTTOM_BAR_H, GAME_HEIGHT, HUD_BOTTOM_OFFSET, TOP_BAR_H } from '../../ui/Layout';
import { hasTexture } from '../../ui/AssetGuard';
import { PixelSprite } from '../../ui/PixelSprite';
import { fitEnemySprite } from '../../ui/RoomVisuals';
import { compactText } from '../../ui/TextHelpers';
import { createRoomButtons, type RoomButtonAction } from '../../ui/RoomButtons';
import type { GameScene } from '../GameScene';

/**
 * Owns the room-info panel: the right-hand portrait/name/HP/intel/flavor
 * widgets, the action-button row beneath it, plus the helpers that
 * `RoomFlow` / `CombatHud` lean on (`showRoomCard`, `showReturnButton`,
 * `setRoomButtons`, `applyTrapDamage`, `triggerActionButton`).
 *
 * The widget fields are still declared on `GameScene` — both
 * controllers (`RoomFlow` / `CombatHud`) reach into them directly to
 * tweak text/visibility during play, so the controller writes back to
 * `scene.<widget>` during `build()` to keep those call sites unchanged.
 * This file owns only the construction + public surface; the storage
 * and the `RoomFlow` / `CombatHud` wiring stay where they are.
 */
export class GameRoomController {
    private readonly scene: GameScene;

    constructor(scene: GameScene) {
        this.scene = scene;
    }

    /**
     * Build the room-panel widgets and attach them to
     * `scene.roomContainer`. Must be called after `roomContainer`
     * exists (i.e. inside `GameScene.create`, after the container is
     * added).
     */
    public build(): void {
        const scene = this.scene;
        const panelY = TOP_BAR_H + 12;
        const panelH = GAME_HEIGHT - TOP_BAR_H - BOTTOM_BAR_H - HUD_BOTTOM_OFFSET - 12;
        const panel = scene.add.rectangle(570, panelY, 434, panelH, 0x111111).setOrigin(0);
        panel.setStrokeStyle(2, 0x353535);

        scene.roomHeaderText = scene.add.text(590, panelY + 4, '', {
            fontFamily: 'Courier New',
            fontSize: '13px',
            color: '#8b8b8b',
        });

        scene.enemyPortrait = scene.add
            .rectangle(787, 190, 120, 120, 0x333333)
            .setStrokeStyle(2, 0x555555);
        scene.enemyIconText = scene.add
            .text(787, 204, '', {
                fontFamily: 'Courier New',
                fontSize: '42px',
                color: '#ffffff',
            })
            .setOrigin(0.5);
        scene.enemySpriteImage = scene.add
            .image(787, 190, '__DEFAULT')
            .setVisible(false)
            .setOrigin(0.5);

        scene.enemyNameText = scene.add
            .text(787, 266, '', {
                fontFamily: 'Courier New',
                fontSize: '18px',
                color: '#f0f0f0',
                align: 'center',
                wordWrap: { width: 280 },
            })
            .setOrigin(0.5, 0);

        scene.enemyHpBarBg = scene.add.rectangle(647, 326, 280, 14, 0x331111).setOrigin(0, 0.5);
        scene.enemyHpBar = scene.add.rectangle(647, 326, 280, 14, 0xc93d2f).setOrigin(0, 0.5);
        scene.enemyHpText = scene.add
            .text(787, 342, '', {
                fontFamily: 'Courier New',
                fontSize: '12px',
                color: '#ad6767',
            })
            .setOrigin(0.5);

        scene.enemyIntelText = scene.add
            .text(787, 370, '', {
                fontFamily: 'Courier New',
                fontSize: '11px',
                color: '#7ea4ff',
                align: 'center',
                wordWrap: { width: 300 },
            })
            .setOrigin(0.5, 0);

        scene.roomFlavorText = scene.add
            .text(787, 416, '', {
                fontFamily: 'Courier New',
                fontSize: '12px',
                color: '#9b9b9b',
                align: 'center',
                wordWrap: { width: 300 },
                lineSpacing: 2,
            })
            .setOrigin(0.5, 0);

        scene.roomPanelGroup = scene.add.container(0, 0, [
            panel,
            scene.roomHeaderText,
            scene.enemyPortrait,
            scene.enemyIconText,
            scene.enemySpriteImage,
            scene.enemyNameText,
            scene.enemyHpBarBg,
            scene.enemyHpBar,
            scene.enemyHpText,
            scene.enemyIntelText,
            scene.roomFlavorText,
        ]);

        scene.roomContainer.add(scene.roomPanelGroup);

        // Buttons live inside the right info panel (x=570..1004, centred at
        // 787). The left column was previously at x=650 which spilled past
        // the panel border and overlapped the EVENT LOG seam — shift the
        // pair so each column sits ~22 px inside the panel walls. The
        // actual button creation lives in `../../ui/RoomButtons.ts`; the
        // returned handle exposes setActions / trigger / wideEnabled /
        // disableAll for keyboard shortcuts and combat to call.
        scene.roomButtons = createRoomButtons(scene, scene.roomContainer, scene.sfx);
    }

    /**
     * @deprecated Use `scene.roomButtons.setActions(...)` directly.
     * Kept as a thin shim so RoomFlow / CombatHud call sites compile
     * unchanged after the RoomButtons extraction.
     */
    public setRoomButtons(actions: RoomButtonAction[], useWideOnly: boolean = false): void {
        this.scene.roomButtons.setActions(actions, useWideOnly);
    }

    public showRoomCard(
        header: string,
        title: string,
        description: string,
        color: number,
        icon: string,
        intel: string,
        spriteKey: string = header
    ): void {
        const scene = this.scene;
        scene.roomHeaderText.setText(header);
        scene.enemyPortrait.setFillStyle(color);
        scene.enemyIconText.setText(icon);
        scene.enemyNameText.setText(compactText(title, 28));
        scene.roomFlavorText.setText(compactText(description, 72));
        scene.enemyIntelText.setText(compactText(intel, 54));
        scene.enemyIntelText.setVisible(true);
        scene.enemyHpBarBg.setVisible(false);
        scene.enemyHpBar.setVisible(false);
        scene.enemyHpText.setVisible(false);
        scene.roomPanelGroup.setVisible(true);

        const roomKey = PixelSprite.roomKey(spriteKey);
        if (hasTexture(scene, roomKey)) {
            scene.enemySpriteImage.setTexture(roomKey).setVisible(true);
            fitEnemySprite(scene.enemySpriteImage);
            scene.enemyIconText.setVisible(false);
        } else {
            scene.enemySpriteImage.setVisible(false);
            scene.enemyIconText.setVisible(true);
        }
    }

    public showReturnButton(): void {
        const scene = this.scene;
        this.setRoomButtons(
            [
                {
                    label: scene.loc.t('returnToMap'),
                    callback: () => scene.returnToMap(),
                    fill: 0x202020,
                },
            ],
            true
        );
    }

    /**
     * Apply a trap-typed damage hit to the player. Returns the actual
     * damage dealt (after defense + status modifiers).
     */
    public applyTrapDamage(rawDamage: number): number {
        return this.scene.player.takeDamage(rawDamage, 0, 'trap');
    }

    /**
     * Fire the action-button at `index` if the room panel is currently
     * the active surface. Used by the keyboard-shortcut handlers in
     * `GameScene.setupKeyboardShortcuts` (1..5 / Space).
     */
    public triggerActionButton(index: number): void {
        const scene = this.scene;
        if (!scene.roomContainer.visible || scene.dead) {
            return;
        }
        scene.roomButtons.trigger(index);
    }
}
