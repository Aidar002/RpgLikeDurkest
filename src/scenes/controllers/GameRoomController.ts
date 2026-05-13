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
 * Dialog speech colours. NPC lines render in the warm accent orange
 * (same hex the HUD uses for the accent-light tone) so the speaker
 * reads as an active voice; the player's own replies stay muted grey
 * so they read as the silent side of the conversation.
 */
const DIALOG_NPC_COLOR = '#f0a050';
const DIALOG_PLAYER_COLOR = '#a09898';

/** Strip the leading `[1] ` / `[2] ` button index off a localized
 *  offer label so the dialog window shows only the spoken phrase. */
function stripChoicePrefix(label: string): string {
    return label.replace(/^\[\d+\]\s*/, '');
}

/** Dash markers framing dialog lines so the speaker is unambiguous
 *  even at a glance: NPC line ends with ` -`, player line starts with
 *  `- `. Matches the styling brief from the room-card redesign. */
function formatNpcLine(line: string): string {
    return line ? `${line} -` : '';
}
function formatPlayerLine(line: string): string {
    const trimmed = line ? stripChoicePrefix(line) : '';
    return trimmed ? `- ${trimmed}` : '';
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

    /** Portrait centre when no NPC dialog is active (combat, generic
     *  room cards). Computed in `build()`. */
    private centerLayoutCx = 0;
    /** Portrait centre when an NPC dialog window is open — portrait
     *  shifts to the right column so the dialog can fill the left
     *  half of the panel. Computed in `build()`. */
    private rightLayoutCx = 0;
    /** Cached Y of the portrait centre, shared by both layouts. */
    private portraitCY = 0;

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
        // For NPC rooms the portrait slides over to the right side of
        // the panel so the dialog window can claim the left half.
        const rightCx = panelX + panelW - 160;
        this.centerLayoutCx = cx;
        this.rightLayoutCx = rightCx;
        this.portraitCY = portraitCY;
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

        // NPC dialog window. Fills the LEFT half of the panel between
        // the header and the action-button row. The portrait/name
        // stack moves over to the RIGHT half (see showRoomNpcCard).
        // Two stacked text lines:
        //   • NPC speech on top, orange, suffixed with " -"
        //   • Player reply below, grey, prefixed with "- "
        // The player text re-positions itself dynamically below the
        // NPC text on every dialog update so a long NPC line never
        // collides with the player reply. Hidden by default — shown
        // via showRoomNpcCard() / updateRoomDialog().
        const dialogX = panelX + 16;
        const dialogW = 320;
        const dialogTop = panelY + 26;
        const dialogBottom = panelY + 312;
        const dialogH = dialogBottom - dialogTop;
        const dialogPad = 14;

        const dialogBg = scene.add.graphics();
        dialogBg.fillStyle(0x16131c, 1);
        dialogBg.fillRect(dialogX, dialogTop, dialogW, dialogH);
        dialogBg.lineStyle(1, 0x2c2738, 1);
        dialogBg.strokeRect(dialogX + 0.5, dialogTop + 0.5, dialogW - 1, dialogH - 1);

        const dialogTextStyle = {
            fontFamily: BODY_FONT,
            fontSize: '17px',
            stroke: '#0c1828',
            strokeThickness: 2,
            lineSpacing: 4,
        } as const;
        const wrapWidth = dialogW - dialogPad * 2;

        scene.dialogNpcText = scene.add
            .text(dialogX + dialogPad, dialogTop + dialogPad, '', {
                ...dialogTextStyle,
                color: DIALOG_NPC_COLOR,
                align: 'left',
                wordWrap: { width: wrapWidth },
            })
            .setOrigin(0, 0);
        scene.dialogPlayerText = scene.add
            .text(dialogX + dialogPad, dialogTop + dialogPad, '', {
                ...dialogTextStyle,
                color: DIALOG_PLAYER_COLOR,
                align: 'left',
                wordWrap: { width: wrapWidth },
            })
            .setOrigin(0, 0);

        scene.roomDialogContainer = scene.add
            .container(0, 0, [dialogBg, scene.dialogNpcText, scene.dialogPlayerText])
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

    /** Move the portrait/name/sprite block to either the panel centre
     *  (combat + generic rooms) or the right column (NPC dialog).
     *  Internal helper for show* methods. */
    private positionPortrait(toRight: boolean): void {
        const scene = this.scene;
        const targetCx = toRight ? this.rightLayoutCx : this.centerLayoutCx;
        const y = this.portraitCY;
        scene.enemyPortrait.setPosition(targetCx, y);
        scene.enemyIconText.setPosition(targetCx, y + 14);
        scene.enemySpriteImage.setPosition(targetCx, y);
        scene.enemyNameText.setPosition(targetCx, y + 84);
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
        this.positionPortrait(false);
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
        this.positionPortrait(true);
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
        scene.dialogNpcText.setText(formatNpcLine(compactText(npcSpeech, 220)));
        this.layoutDialogTexts();
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
            scene.dialogPlayerText.setText(formatPlayerLine(compactText(opts.player, 160)));
        }
        if (opts.npc !== undefined) {
            scene.dialogNpcText.setText(formatNpcLine(compactText(opts.npc, 220)));
        }
        this.layoutDialogTexts();
        scene.roomDialogContainer.setVisible(true);
    }

    /** Re-flow the dialog window so the player line sits just below
     *  the NPC line regardless of how long either wraps. Keeps the
     *  two speech blocks visually grouped without overlapping. */
    private layoutDialogTexts(): void {
        const scene = this.scene;
        const npc = scene.dialogNpcText;
        const player = scene.dialogPlayerText;
        const gap = 14;
        const npcBottom = npc.text.length > 0 ? npc.y + npc.height + gap : npc.y;
        player.setPosition(npc.x, npcBottom);
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
