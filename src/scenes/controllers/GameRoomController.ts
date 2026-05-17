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
import { createRoomButtons } from '../../ui/RoomButtons';
import { LockpickOverlay, type LockpickShowOptions } from '../../ui/LockpickOverlay';
import type { GameScene } from '../GameScene';

/**
 * Dialog speech colours. NPC lines render in the warm accent orange,
 * the player's own choices stay muted grey — so each turn in the
 * chat log reads at a glance even though every line starts with the
 * same `- ` dash marker.
 */
const DIALOG_NPC_COLOR = '#f0a050';
const DIALOG_PLAYER_COLOR = '#a09898';

/** Strip the leading `[1] ` / `[2] ` button index off a localized
 *  offer label so the dialog window shows only the spoken phrase. */
function stripChoicePrefix(label: string): string {
    return label.replace(/^\[\d+\]\s*/, '');
}

/**
 * Owns the room-info panel: the right-hand portrait/name/HP/intel/flavor
 * widgets, the action-button row beneath it, plus the helpers that
 * `RoomFlow` / `CombatHud` lean on (`showRoomCard`, `showReturnButton`,
 * `applyTrapDamage`, `triggerActionButton`).
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
    /** Built lazily in `build()` after the scene's `loc`/`sfx` are
     *  set. Used by the treasure room's locked-chest path. */
    private lockpickOverlay!: LockpickOverlay;

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

    // --- Dialog log state -------------------------------------------------
    // `dialogScrollContent` holds one Text widget per chat-log entry,
    // stacked vertically. A geometry mask clips it to the dialog
    // inner rect so off-screen entries don't bleed out. The scrollbar
    // is drawn separately so it can sit on top of the mask.
    private dialogScrollContent!: Phaser.GameObjects.Container;
    private dialogScrollbar!: Phaser.GameObjects.Graphics;
    private dialogEntries: Phaser.GameObjects.Text[] = [];
    private dialogScrollOffset = 0;
    private dialogInnerX = 0;
    private dialogInnerY = 0;
    private dialogInnerW = 0;
    private dialogInnerH = 0;

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

        // Hand-authored mob and room art is the focal point of the
        // right panel, so the portrait is rendered at 250×250 (was
        // 140×140) per the design ask. The previous gray backdrop
        // rectangle has been stripped to fillAlpha=0 + no stroke —
        // the artwork already fills the entire portrait box, so any
        // visible frame around it just reads as a stray border.
        // The rectangle is still constructed (and sized in
        // {@link applyPortraitLayout}) so VFX.shake / VFX.flash in
        // CombatHud can still target it as a hit-target.
        const portraitCY = panelY + 132;
        // For NPC rooms the portrait slides over to the right side of
        // the panel so the dialog window can claim the left half.
        const rightCx = panelX + panelW - 160;
        this.centerLayoutCx = cx;
        this.rightLayoutCx = rightCx;
        this.portraitCY = portraitCY;
        scene.enemyPortrait = scene.add
            .rectangle(cx, portraitCY, 250, 250, 0x000000, 0)
            .setStrokeStyle(0, 0, 0);
        scene.enemyIconText = scene.add
            .text(cx, portraitCY + 14, '', {
                fontFamily: BODY_FONT,
                fontSize: '96px',
                color: '#ffffff',
            })
            .setOrigin(0.5);
        scene.enemySpriteImage = scene.add
            .image(cx, portraitCY, '__DEFAULT')
            .setVisible(false)
            .setOrigin(0.5);

        scene.enemyNameText = scene.add
            .text(cx, portraitCY + 128, '', {
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
        // damage indicator (was 280×14; bumped to 360×18). With the
        // 250×250 portrait it shifts to portraitCY + 162 so the bar
        // sits just below the name without crowding the action
        // buttons at the bottom of the panel.
        const hpBarY = portraitCY + 162;
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
        // (was 11px subtle; bumped to 14px and brighter blue). The
        // 250 portrait squeezes the panel vertically, so the gap to
        // the HP bar tightened from +22 to +12 — the action buttons
        // start at y≈432, leaving just enough room for one 14 px line.
        scene.enemyIntelText = scene.add
            .text(cx, hpBarY + 12, '', {
                fontFamily: BODY_FONT,
                fontSize: '14px',
                color: '#9ec3ff',
                align: 'center',
                stroke: '#0c1828',
                strokeThickness: 2,
                wordWrap: { width: panelW - 50 },
            })
            .setOrigin(0.5, 0);

        // Contextual flavour / dialogue block. Sits BELOW the name
        // (not below HP/intent like before) so non-combat room cards
        // — which hide the HP bar + intent — get a clean two-row
        // "name + description" layout right under the 250 portrait.
        // During combat the description is hidden in favour of the
        // HP bar + intent stack (see CombatHudController.updateEnemyUI).
        scene.roomFlavorText = scene.add
            .text(cx, portraitCY + 152, '', {
                fontFamily: BODY_FONT,
                fontSize: '13px',
                color: '#b0b0b0',
                align: 'center',
                wordWrap: { width: panelW - 50 },
                lineSpacing: 3,
            })
            .setOrigin(0.5, 0);

        // NPC dialog window. Fills the LEFT half of the panel between
        // the header and the action-button row; the portrait/name
        // stack moves over to the RIGHT half (see applyPortraitLayout).
        // The window is an append-only chat log: every new turn
        // (NPC or player) becomes its own Text widget stacked below
        // the previous one. We auto-scroll to keep the latest line in
        // view; a scrollbar only appears once content overflows.
        const dialogX = panelX + 16;
        const dialogW = 288;
        const dialogTop = panelY + 26;
        const dialogBottom = panelY + 312;
        const dialogH = dialogBottom - dialogTop;
        const dialogPad = 14;

        this.dialogInnerX = dialogX + dialogPad;
        this.dialogInnerY = dialogTop + dialogPad;
        this.dialogInnerW = dialogW - dialogPad * 2;
        this.dialogInnerH = dialogH - dialogPad * 2;

        const dialogBg = scene.add.graphics();
        dialogBg.fillStyle(0x16131c, 1);
        dialogBg.fillRect(dialogX, dialogTop, dialogW, dialogH);
        dialogBg.lineStyle(1, 0x2c2738, 1);
        dialogBg.strokeRect(dialogX + 0.5, dialogTop + 0.5, dialogW - 1, dialogH - 1);

        this.dialogScrollContent = scene.add.container(this.dialogInnerX, this.dialogInnerY);
        const maskGfx = scene.add.graphics({ x: 0, y: 0 });
        maskGfx.fillStyle(0xffffff);
        maskGfx.fillRect(
            this.dialogInnerX,
            this.dialogInnerY,
            this.dialogInnerW,
            this.dialogInnerH
        );
        maskGfx.setVisible(false);
        this.dialogScrollContent.setMask(maskGfx.createGeometryMask());

        this.dialogScrollbar = scene.add.graphics().setVisible(false);

        scene.roomDialogContainer = scene.add
            .container(0, 0, [dialogBg, this.dialogScrollContent, this.dialogScrollbar])
            .setVisible(false);

        // Mouse-wheel scroll over the dialog box. Global handler;
        // it no-ops unless the dialog is visible AND the pointer is
        // inside the dialog inner rect.
        scene.input.on(
            'wheel',
            (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
                this.handleDialogWheel(pointer, dy);
            }
        );

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

        // Lockpick mini-game modal — fully hidden until the treasure
        // room's locked-chest path calls `showLockpickModal`.
        this.lockpickOverlay = new LockpickOverlay(scene, {
            loc: scene.loc,
            sfx: scene.sfx,
        });
    }

    /** Move + resize the portrait/name/sprite block. NPC mode places
     *  a larger portrait in the right column, vertically aligned with
     *  the dialog window on the left. Center mode restores the
     *  default smaller portrait used by combat + generic room cards. */
    private applyPortraitLayout(npcMode: boolean): void {
        const scene = this.scene;
        if (npcMode) {
            const cx = this.rightLayoutCx;
            // Vertically centre the bigger portrait inside the dialog
            // window's y-range (top ≈ 134, bottom ≈ 420). NPC mode
            // stays at 200×200 because a 250 box would intrude on the
            // left-aligned dialog window.
            const cy = 248;
            scene.enemyPortrait.setPosition(cx, cy).setSize(200, 200);
            scene.enemyIconText.setPosition(cx, cy + 18).setFontSize('75px');
            scene.enemySpriteImage.setPosition(cx, cy);
            scene.enemyNameText.setPosition(cx, cy + 112);
        } else {
            const cx = this.centerLayoutCx;
            const cy = this.portraitCY;
            // Mob + room cards render the full 250×250 portrait so
            // the hand-authored art is the dominant element of the
            // right panel. Icon glyph + name positions track the new
            // size; the offsets below mirror the values set in
            // build() so the layout stays consistent when this method
            // is re-entered (e.g. after returning from an NPC scene).
            scene.enemyPortrait.setPosition(cx, cy).setSize(250, 250);
            scene.enemyIconText.setPosition(cx, cy + 14).setFontSize('96px');
            scene.enemySpriteImage.setPosition(cx, cy);
            scene.enemyNameText.setPosition(cx, cy + 128);
        }
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
        this.applyPortraitLayout(false);
        scene.roomHeaderText.setText(header);
        // Backdrop stays fully transparent — the hand-authored 250×250
        // art (or procedural fallback glyph) reads better without a
        // coloured square framing it. `color` is kept as the fill
        // colour for VFX.flash, which momentarily tints the rectangle
        // on hits, but the resting alpha is 0.
        scene.enemyPortrait.setFillStyle(color, 0);
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
        this.applyPortraitLayout(true);
        scene.roomHeaderText.setText(header);
        // Match the frameless look used for mob/room cards. The
        // 200×200 NPC portrait stays solid art on a transparent
        // backdrop — no grey square behind it.
        scene.enemyPortrait.setFillStyle(color, 0);
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

        this.clearDialogEntries();
        this.appendDialogEntry('npc', npcSpeech);
        scene.roomDialogContainer.setVisible(true);
        scene.roomPanelGroup.setVisible(true);
    }

    /**
     * Append turn(s) to the current NPC dialog log. If both `player`
     * and `npc` are provided the player line is added first — that
     * preserves natural conversation order: player picks an option,
     * NPC responds. Empty / undefined sides are skipped. The log
     * auto-scrolls so the newest entry stays in view.
     */
    public updateRoomDialog(opts: { npc?: string; player?: string }): void {
        if (opts.player) {
            this.appendDialogEntry('player', opts.player);
        }
        if (opts.npc) {
            this.appendDialogEntry('npc', opts.npc);
        }
        this.scene.roomDialogContainer.setVisible(true);
    }

    /** Add one chat-log entry. NPC lines render orange, player lines
     *  grey; both are prefixed with `- ` so the speaker change is
     *  obvious at a glance even on monochrome screenshots. */
    private appendDialogEntry(speaker: 'npc' | 'player', text: string): void {
        const scene = this.scene;
        const color = speaker === 'npc' ? DIALOG_NPC_COLOR : DIALOG_PLAYER_COLOR;
        const cleanText = speaker === 'player' ? stripChoicePrefix(text) : text;
        const formatted = `- ${cleanText}`;
        const lineGap = 8;

        let yPos = 0;
        const last = this.dialogEntries[this.dialogEntries.length - 1];
        if (last) {
            yPos = last.y + last.height + lineGap;
        }

        const entry = scene.add
            .text(0, yPos, formatted, {
                fontFamily: BODY_FONT,
                fontSize: '17px',
                color,
                stroke: '#0c1828',
                strokeThickness: 2,
                lineSpacing: 4,
                wordWrap: { width: this.dialogInnerW - 12 },
            })
            .setOrigin(0, 0);

        this.dialogScrollContent.add(entry);
        this.dialogEntries.push(entry);

        this.refreshDialogScroll(true);
    }

    /** Reset the dialog log — destroys every entry text widget and
     *  hides the scrollbar. Called whenever a new NPC conversation
     *  opens via `showRoomNpcCard`. */
    private clearDialogEntries(): void {
        for (const entry of this.dialogEntries) {
            entry.destroy();
        }
        this.dialogEntries = [];
        this.dialogScrollOffset = 0;
        this.dialogScrollContent.y = this.dialogInnerY;
        this.dialogScrollbar.clear().setVisible(false);
    }

    /** Recompute scroll offset + scrollbar visibility. When
     *  `scrollToBottom` is true the log jumps to the newest entry. */
    private refreshDialogScroll(scrollToBottom: boolean): void {
        const entries = this.dialogEntries;
        if (entries.length === 0) {
            this.dialogScrollOffset = 0;
            this.dialogScrollContent.y = this.dialogInnerY;
            this.dialogScrollbar.clear().setVisible(false);
            return;
        }
        const last = entries[entries.length - 1];
        const contentHeight = last.y + last.height;
        const viewH = this.dialogInnerH;

        if (contentHeight <= viewH) {
            this.dialogScrollOffset = 0;
            this.dialogScrollbar.clear().setVisible(false);
        } else {
            if (scrollToBottom) {
                this.dialogScrollOffset = contentHeight - viewH;
            }
            this.dialogScrollOffset = Math.max(
                0,
                Math.min(this.dialogScrollOffset, contentHeight - viewH)
            );
            this.drawScrollbar(contentHeight);
            this.dialogScrollbar.setVisible(true);
        }
        this.dialogScrollContent.y = this.dialogInnerY - this.dialogScrollOffset;
    }

    /** Paint the scrollbar track + thumb. Thumb height scales with
     *  visible-to-total ratio; thumb y reflects current scroll. */
    private drawScrollbar(contentHeight: number): void {
        const sb = this.dialogScrollbar;
        sb.clear();
        const trackX = this.dialogInnerX + this.dialogInnerW - 4;
        const trackY = this.dialogInnerY;
        const trackW = 4;
        const trackH = this.dialogInnerH;
        sb.fillStyle(0x2c2738, 0.6);
        sb.fillRect(trackX, trackY, trackW, trackH);

        const thumbH = Math.max(24, (this.dialogInnerH / contentHeight) * trackH);
        const scrollRange = contentHeight - this.dialogInnerH;
        const thumbY =
            trackY +
            (scrollRange > 0 ? (this.dialogScrollOffset / scrollRange) * (trackH - thumbH) : 0);
        sb.fillStyle(0xf0a050, 0.85);
        sb.fillRect(trackX, thumbY, trackW, thumbH);
    }

    /** Wheel handler installed on `scene.input`. Scrolls the dialog
     *  log when the pointer is over the dialog inner rect AND there
     *  is overflow content; otherwise no-op so other UI is unaffected. */
    private handleDialogWheel(pointer: Phaser.Input.Pointer, deltaY: number): void {
        const scene = this.scene;
        if (!scene.roomDialogContainer.visible) return;
        const px = pointer.x;
        const py = pointer.y;
        if (px < this.dialogInnerX || px > this.dialogInnerX + this.dialogInnerW) return;
        if (py < this.dialogInnerY || py > this.dialogInnerY + this.dialogInnerH) return;
        if (this.dialogEntries.length === 0) return;
        const last = this.dialogEntries[this.dialogEntries.length - 1];
        const contentHeight = last.y + last.height;
        if (contentHeight <= this.dialogInnerH) return;

        this.dialogScrollOffset = Math.max(
            0,
            Math.min(this.dialogScrollOffset + deltaY, contentHeight - this.dialogInnerH)
        );
        this.dialogScrollContent.y = this.dialogInnerY - this.dialogScrollOffset;
        this.drawScrollbar(contentHeight);
    }

    public showReturnButton(): void {
        const scene = this.scene;
        scene.roomButtons.setActions(
            [
                {
                    label: scene.loc.t('returnToMap'),
                    callback: () => scene.returnToMap(),
                    variant: 'dark',
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
     * Open the lockpick mini-game modal. The result is delivered
     * through `options.onResolve` exactly once. See
     * {@link LockpickOverlay} for the visual/input model.
     */
    public showLockpickModal(options: LockpickShowOptions): void {
        this.lockpickOverlay.show(options);
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
