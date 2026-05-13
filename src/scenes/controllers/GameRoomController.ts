import {
    BOTTOM_BAR_H,
    GAME_HEIGHT,
    HUD_BOTTOM_OFFSET,
    RoomLayout,
    TOP_BAR_H,
} from '../../ui/Layout';
import { hasTexture } from '../../ui/AssetGuard';
import { BODY_FONT } from '../../ui/HudTheme';
import { PixelSprite } from '../../ui/PixelSprite';
import { fitEnemySprite } from '../../ui/RoomVisuals';
import { compactText } from '../../ui/TextHelpers';
import { createRoomButtons, type RoomButtonAction } from '../../ui/RoomButtons';
import type { GameScene } from '../GameScene';

/**
 * Blue tone shared by all dialog speech (NPC and player lines) so a
 * spoken line reads visually distinct from the white/grey room
 * description text. Matches the legacy `enemyIntelText` blue so the
 * eye doesn't have to relearn the colour when switching rooms.
 */
const DIALOG_SPEECH_COLOR = '#9ec3ff';

/** Strip the leading `[1] ` / `[2] ` button index off a localized
 *  offer label so the dialog window shows only the spoken phrase. */
function stripChoicePrefix(label: string): string {
    return label.replace(/^\[\d+\]\s*/, '');
}

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
        // Right panel — 65 % of the play area (see Layout.RoomLayout
        // for the full split rationale and ratios).
        const panelY = TOP_BAR_H + 12;
        const panelH = GAME_HEIGHT - TOP_BAR_H - BOTTOM_BAR_H - HUD_BOTTOM_OFFSET - 12;
        const panelX = RoomLayout.panelX;
        const panelW = RoomLayout.panelWidth;
        const cx = RoomLayout.panelCenterX;
        const panel = scene.add.rectangle(panelX, panelY, panelW, panelH, 0x111111).setOrigin(0);
        panel.setStrokeStyle(2, 0x353535);

        scene.roomHeaderText = scene.add.text(panelX + 20, panelY + 6, '', {
            fontFamily: BODY_FONT,
            fontSize: '14px',
            color: '#8b8b8b',
        });

        // Bigger portrait so the enemy reads as the focal point of
        // the right panel (was 120×120; bumped to 140×140 along with
        // matching ENEMY_SPRITE_MAX_DIM in RoomVisuals). 140 is the
        // sweet spot — bigger than before while still leaving room
        // beneath for the name + HP + intent + flavour stack above
        // the taller action buttons.
        const portraitCY = panelY + 82;
        scene.enemyPortrait = scene.add
            .rectangle(cx, portraitCY, 140, 140, 0x333333)
            .setStrokeStyle(2, 0x555555);
        scene.enemyIconText = scene.add
            .text(cx, portraitCY + 14, '', {
                fontFamily: BODY_FONT,
                fontSize: '52px',
                color: '#ffffff',
            })
            .setOrigin(0.5);
        scene.enemySpriteImage = scene.add
            .image(cx, portraitCY, '__DEFAULT')
            .setVisible(false)
            .setOrigin(0.5);

        scene.enemyNameText = scene.add
            .text(cx, portraitCY + 84, '', {
                fontFamily: BODY_FONT,
                fontSize: '20px',
                color: '#f4f0e0',
                align: 'center',
                stroke: '#000000',
                strokeThickness: 2,
                wordWrap: { width: panelW - 40 },
            })
            .setOrigin(0.5, 0);

        // HP bar gets wider + taller so it reads as the primary
        // damage indicator (was 280×14; bumped to 360×18).
        const hpBarY = portraitCY + 116;
        scene.enemyHpBarBg = scene.add
            .rectangle(cx - 180, hpBarY, 360, 18, 0x331111)
            .setStrokeStyle(1, 0x5a1a1a)
            .setOrigin(0, 0.5);
        scene.enemyHpBar = scene.add
            .rectangle(cx - 180, hpBarY, 360, 18, 0xc93d2f)
            .setOrigin(0, 0.5);
        scene.enemyHpText = scene.add
            .text(cx, hpBarY + 1, '', {
                fontFamily: BODY_FONT,
                fontSize: '14px',
                color: '#ffd9d2',
                stroke: '#000000',
                strokeThickness: 2,
            })
            .setOrigin(0.5);

        // Intent gets a dedicated highlighted line so the player can
        // tell at a glance what the enemy is winding up to do
        // (was 11px subtle; bumped to 14px and brighter blue).
        scene.enemyIntelText = scene.add
            .text(cx, hpBarY + 22, '', {
                fontFamily: BODY_FONT,
                fontSize: '14px',
                color: '#9ec3ff',
                align: 'center',
                stroke: '#0c1828',
                strokeThickness: 2,
                wordWrap: { width: panelW - 50 },
            })
            .setOrigin(0.5, 0);

        // Contextual flavour / dialogue block sits below the intent
        // and above the action buttons. Wider word wrap and a hair
        // larger font than before so room descriptions and merchant
        // dialogue lines read naturally inside the wider panel.
        scene.roomFlavorText = scene.add
            .text(cx, hpBarY + 58, '', {
                fontFamily: BODY_FONT,
                fontSize: '13px',
                color: '#b0b0b0',
                align: 'center',
                wordWrap: { width: panelW - 50 },
                lineSpacing: 3,
            })
            .setOrigin(0.5, 0);

        // NPC dialog window. Replaces the description block whenever
        // the player is talking to an NPC: the NPC's current line
        // sits on the right (right-aligned, blue), the player's last
        // line sits on the left (left-aligned, blue). Sized to fit
        // between the name row and the top action-button row without
        // ever overlapping the buttons, regardless of how long either
        // speech line wraps. Hidden by default — shown via
        // showRoomNpcCard() / updateRoomDialog().
        const dialogTop = hpBarY - 6; // ~y=300, just under the name row
        const dialogH = 130;
        const dialogX = panelX + 18;
        const dialogW = panelW - 36;
        const dialogColGap = 18;
        const dialogColW = Math.floor((dialogW - dialogColGap) / 2);
        const dialogPad = 12;

        const dialogBg = scene.add.graphics();
        dialogBg.fillStyle(0x16131c, 1);
        dialogBg.fillRect(dialogX, dialogTop, dialogW, dialogH);
        dialogBg.lineStyle(1, 0x2c2738, 1);
        dialogBg.strokeRect(dialogX + 0.5, dialogTop + 0.5, dialogW - 1, dialogH - 1);
        const dividerX = dialogX + dialogColW + dialogColGap / 2;
        dialogBg.lineStyle(1, 0x2c2738, 1);
        dialogBg.beginPath();
        dialogBg.moveTo(dividerX, dialogTop + 14);
        dialogBg.lineTo(dividerX, dialogTop + dialogH - 14);
        dialogBg.strokePath();

        const dialogTextStyle = {
            fontFamily: BODY_FONT,
            fontSize: '14px',
            color: DIALOG_SPEECH_COLOR,
            stroke: '#0c1828',
            strokeThickness: 2,
            lineSpacing: 3,
        } as const;

        scene.dialogPlayerText = scene.add
            .text(dialogX + dialogPad, dialogTop + dialogPad, '', {
                ...dialogTextStyle,
                align: 'left',
                wordWrap: { width: dialogColW - dialogPad * 2 },
            })
            .setOrigin(0, 0);
        scene.dialogNpcText = scene.add
            .text(dialogX + dialogW - dialogPad, dialogTop + dialogPad, '', {
                ...dialogTextStyle,
                align: 'right',
                wordWrap: { width: dialogColW - dialogPad * 2 },
            })
            .setOrigin(1, 0);

        scene.roomDialogContainer = scene.add
            .container(0, 0, [dialogBg, scene.dialogPlayerText, scene.dialogNpcText])
            .setVisible(false);

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
            scene.roomDialogContainer,
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
        spriteKey: string = header
    ): void {
        const scene = this.scene;
        scene.roomHeaderText.setText(header);
        scene.enemyPortrait.setFillStyle(color);
        scene.enemyIconText.setText(icon);
        scene.enemyNameText.setText(compactText(title, 36));
        scene.roomFlavorText.setText(compactText(description, 160));
        scene.roomFlavorText.setVisible(true);
        // Non-NPC rooms render a single description line — the legacy
        // "intel hint" row and the NPC dialog window both stay hidden.
        scene.enemyIntelText.setText('');
        scene.enemyIntelText.setVisible(false);
        scene.roomDialogContainer.setVisible(false);
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

    /**
     * Open the NPC dialog window for an encounter. Used by every NPC
     * room (Sara, Gogi, future NPCs) through `presentNpcRoom`, so all
     * conversations share the same NPC-right / player-left layout.
     * The description/intel rows are hidden in favour of the dialog
     * window. Call {@link updateRoomDialog} on subsequent choices to
     * advance the conversation.
     */
    public showRoomNpcCard(
        header: string,
        title: string,
        color: number,
        icon: string,
        npcSpeech: string
    ): void {
        const scene = this.scene;
        scene.roomHeaderText.setText(header);
        scene.enemyPortrait.setFillStyle(color);
        scene.enemyIconText.setText(icon);
        scene.enemyNameText.setText(compactText(title, 36));
        scene.roomFlavorText.setText('');
        scene.roomFlavorText.setVisible(false);
        scene.enemyIntelText.setText('');
        scene.enemyIntelText.setVisible(false);
        scene.enemyHpBarBg.setVisible(false);
        scene.enemyHpBar.setVisible(false);
        scene.enemyHpText.setVisible(false);
        scene.enemySpriteImage.setVisible(false);
        scene.enemyIconText.setVisible(true);
        scene.dialogPlayerText.setText('');
        scene.dialogNpcText.setText(compactText(npcSpeech, 220));
        scene.roomDialogContainer.setVisible(true);
        scene.roomPanelGroup.setVisible(true);
    }

    /**
     * Advance the current NPC dialog. Either side accepts a string
     * (replaces the visible line) or `undefined` (keeps the existing
     * text). Pass an empty string to clear a side.
     */
    public updateRoomDialog(opts: { npc?: string; player?: string }): void {
        const scene = this.scene;
        if (opts.player !== undefined) {
            scene.dialogPlayerText.setText(
                opts.player ? compactText(stripChoicePrefix(opts.player), 160) : ''
            );
        }
        if (opts.npc !== undefined) {
            scene.dialogNpcText.setText(opts.npc ? compactText(opts.npc, 220) : '');
        }
        scene.roomDialogContainer.setVisible(true);
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
