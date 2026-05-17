/**
 * Modal that interrupts a relic drop when the inventory is full.
 *
 * Wiring: `RelicDrops.maybeDropRelic` calls
 * `player.addRelic(candidate)`; if the cap is hit the manager fires
 * `player.relicOffer.emit({ id })`. The HUD listens to that emitter
 * and calls {@link RelicSwapModal.show} with the candidate. The
 * player then either:
 *   - clicks one of the five equipped cards → `onSwap(droppedId)`
 *     swaps it for the candidate (via `removeRelic` + `addRelic`).
 *   - clicks the SKIP button → `onSkip()` is invoked (no relic
 *     change, no log line by default).
 *
 * Visuals mirror `RestartConfirmModal` (same depth tier, same panel
 * shading) so the two confirm flows feel like one component. The
 * panel is taller because it has to fit six relic cards + Skip
 * button + body copy.
 */
import * as Phaser from 'phaser';

import type { Localization } from '../systems/Localization';
import type { PlayerManager } from '../systems/PlayerManager';
import { RELICS, type RelicId, type RelicRarity } from '../systems/Relics';
import type { SoundManager } from '../systems/SoundManager';
import { CENTER_X, CENTER_Y, Depths, GAME_HEIGHT, GAME_WIDTH } from './Layout';
import { HUD_FONT, HUD_STROKE, HudColors, HudHex } from './HudTheme';
import { drawUiButton, type ButtonBackground } from './UiButton';

const PANEL_W = 720;
const PANEL_H = 360;
const CARD_W = 110;
const CARD_H = 150;
const CARD_GAP = 12;
const CARD_ROW_Y = CENTER_Y - 16;

const RARITY_BORDER: Record<RelicRarity, number> = {
    common: 0x8a8071,
    rare: 0xd9b35c,
    unique: 0xc97ad9,
};
const RARITY_TEXT: Record<RelicRarity, string> = {
    common: '#cfc7b8',
    rare: '#ffd36e',
    unique: '#f0a8ff',
};

interface RelicSwapModalOptions {
    loc: Localization;
    player: PlayerManager;
    /** Shared SFX bank; when supplied the Skip button inherits the
     *  standard `buttonHover` / `buttonClick` cues via
     *  {@link drawUiButton}'s `sfx` option. Optional so tests can
     *  mount the modal without a full audio stack. */
    sfx?: SoundManager;
    /** Fired when the player picks a relic to drop in favour of the
     *  candidate. The caller is responsible for the actual
     *  `removeRelic`/`addRelic` swap so this widget stays UI-only. */
    onSwap: (droppedId: RelicId, candidateId: RelicId) => void;
    /** Fired when the player declines the candidate. */
    onSkip: (candidateId: RelicId) => void;
}

type Widget =
    | Phaser.GameObjects.Rectangle
    | Phaser.GameObjects.Text
    | Phaser.GameObjects.Container
    | Phaser.GameObjects.NineSlice;

export class RelicSwapModal {
    private readonly scene: Phaser.Scene;
    private readonly options: RelicSwapModalOptions;
    private readonly widgets: Widget[];
    private readonly title: Phaser.GameObjects.Text;
    private readonly body: Phaser.GameObjects.Text;
    private readonly cards: CardHandle[];
    private readonly skipBg: ButtonBackground;
    private readonly skipLabel: Phaser.GameObjects.Text;
    private candidate: RelicId | null = null;

    constructor(scene: Phaser.Scene, options: RelicSwapModalOptions) {
        this.scene = scene;
        this.options = options;

        const overlay = scene.add
            .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
            .setDepth(Depths.ConfirmOverlay)
            .setInteractive();
        const panel = scene.add
            .rectangle(CENTER_X, CENTER_Y, PANEL_W, PANEL_H, 0x181420)
            .setDepth(Depths.ConfirmPanel)
            .setStrokeStyle(2, HudColors.cellGoldEdge);

        this.title = scene.add
            .text(CENTER_X, CENTER_Y - PANEL_H / 2 + 28, '', {
                fontFamily: HUD_FONT,
                fontSize: '20px',
                color: HudHex.accentGold,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0.5)
            .setDepth(Depths.ConfirmContent);

        this.body = scene.add
            .text(CENTER_X, CENTER_Y - PANEL_H / 2 + 60, '', {
                fontFamily: HUD_FONT,
                fontSize: '13px',
                color: HudHex.textPrimary,
                stroke: HUD_STROKE,
                strokeThickness: 2,
                align: 'center',
                wordWrap: { width: PANEL_W - 60 },
                lineSpacing: 4,
            })
            .setOrigin(0.5, 0)
            .setDepth(Depths.ConfirmContent);

        // Six cards: five for the equipped relics, one for the
        // candidate. The candidate card is read-only (it's "what
        // you'd take if you accept the swap") and sits on the right
        // with a thicker border and an arrow-prefixed label.
        this.cards = [];
        const totalCards = 6;
        const totalW = totalCards * CARD_W + (totalCards - 1) * CARD_GAP;
        const startX = CENTER_X - totalW / 2 + CARD_W / 2;
        for (let i = 0; i < totalCards; i++) {
            const x = startX + i * (CARD_W + CARD_GAP);
            const role: CardRole = i === totalCards - 1 ? 'candidate' : 'equipped';
            this.cards.push(this.createCard(x, CARD_ROW_Y, role));
        }

        const skipUi = drawUiButton(scene, CENTER_X, CENTER_Y + PANEL_H / 2 - 40, 200, 38, '', {
            variant: 'dark',
            fontSize: '14px',
            color: HudHex.textPrimary,
            depth: Depths.ConfirmContent,
            sfx: options.sfx,
        });
        this.skipBg = skipUi.background;
        this.skipLabel = skipUi.label;
        this.skipLabel.setDepth(Depths.ConfirmForeground);
        this.skipBg.on('pointerdown', () => this.handleSkip());

        this.widgets = [
            overlay,
            panel,
            this.title,
            this.body,
            ...this.cards.map((c) => c.container),
            this.skipBg,
            this.skipLabel,
        ];
        this.hide();
    }

    /**
     * Show the modal for `candidate`, populating equipped cards from
     * the current `player.relics`. Re-callable; will refresh the UI
     * if a previous offer was queued.
     */
    public show(candidate: RelicId): void {
        const { loc, player } = this.options;
        this.candidate = candidate;

        const candidateRelic = RELICS[candidate];
        this.title.setText(loc.t('relicCapTitle'));
        this.body.setText(
            loc.t('relicCapBody', {
                value: loc.pick(candidateRelic.name),
            })
        );
        this.skipLabel.setText(loc.t('relicCapSkip'));

        const equipped = player.relics;
        for (let i = 0; i < this.cards.length; i++) {
            const card = this.cards[i];
            if (card.role === 'candidate') {
                this.paintCard(card, candidate, /* clickable */ false);
                continue;
            }
            const id = equipped[i] ?? null;
            if (id) {
                this.paintCard(card, id, /* clickable */ true);
            } else {
                this.paintEmpty(card);
            }
        }
        this.setVisible(true);
    }

    public hide(): void {
        this.setVisible(false);
        this.candidate = null;
    }

    private createCard(x: number, y: number, role: CardRole): CardHandle {
        const scene = this.scene;
        const container = scene.add.container(x, y).setDepth(Depths.ConfirmContent);
        const bg = scene.add
            .rectangle(0, 0, CARD_W, CARD_H, HudColors.panelBg, 0.96)
            .setOrigin(0.5);
        const border = scene.add
            .rectangle(0, 0, CARD_W, CARD_H)
            .setOrigin(0.5)
            .setStrokeStyle(2, HudColors.panelOuter, 1);
        const icon = scene.add.rectangle(0, -CARD_H / 2 + 36, 56, 56, 0x202028).setOrigin(0.5);
        const iconLabel = scene.add
            .text(0, -CARD_H / 2 + 36, '', {
                fontFamily: HUD_FONT,
                fontSize: '24px',
                color: HudHex.textPrimary,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0.5);
        const name = scene.add
            .text(0, -CARD_H / 2 + 80, '', {
                fontFamily: HUD_FONT,
                fontSize: '12px',
                color: HudHex.textPrimary,
                align: 'center',
                wordWrap: { width: CARD_W - 12 },
            })
            .setOrigin(0.5, 0);
        const rarity = scene.add
            .text(0, CARD_H / 2 - 18, '', {
                fontFamily: HUD_FONT,
                fontSize: '10px',
                color: HudHex.accentGold,
            })
            .setOrigin(0.5);
        const action = scene.add
            .text(0, CARD_H / 2 - 4, '', {
                fontFamily: HUD_FONT,
                fontSize: '10px',
                color: HudHex.textMuted,
            })
            .setOrigin(0.5);

        container.add([bg, border, icon, iconLabel, name, rarity, action]);
        return {
            container,
            bg,
            border,
            icon,
            iconLabel,
            name,
            rarity,
            action,
            role,
            relicId: null,
        };
    }

    private paintCard(card: CardHandle, id: RelicId, clickable: boolean): void {
        const { loc } = this.options;
        const relic = RELICS[id];
        const rarity = relic.rarity as RelicRarity;
        card.relicId = id;
        card.bg.setFillStyle(HudColors.panelBg, 0.96);
        card.border.setStrokeStyle(card.role === 'candidate' ? 3 : 2, RARITY_BORDER[rarity], 1);
        card.icon.setFillStyle(0x121017, 1);
        card.iconLabel.setText(letterFor(loc, id));
        card.iconLabel.setColor(RARITY_TEXT[rarity]);
        card.name.setText(loc.pick(relic.name));
        card.rarity.setText(loc.t(rarityKey(rarity)));
        card.rarity.setColor(RARITY_TEXT[rarity]);
        card.action.setText(
            card.role === 'candidate'
                ? loc.t('relicCapNew')
                : clickable
                  ? loc.t('relicCapDrop')
                  : ''
        );
        card.action.setColor(card.role === 'candidate' ? HudHex.accentGold : HudHex.textMuted);

        card.container.removeAllListeners();
        if (clickable) {
            card.container.setInteractive(
                new Phaser.Geom.Rectangle(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H),
                Phaser.Geom.Rectangle.Contains
            );
            card.container.on('pointerover', () => card.border.setStrokeStyle(3, 0xffffff, 1));
            card.container.on('pointerout', () =>
                card.border.setStrokeStyle(2, RARITY_BORDER[rarity], 1)
            );
            card.container.on('pointerdown', () => this.handleSwap(id));
        } else {
            card.container.disableInteractive();
        }
    }

    private paintEmpty(card: CardHandle): void {
        // Only matters in the (very rare) case the modal opens with
        // fewer than 5 equipped relics — `relicOffer` is only meant
        // to fire when `player.relics.length === MAX_RELICS`, but
        // paint a sensible empty state just in case.
        card.relicId = null;
        card.bg.setFillStyle(HudColors.panelBg, 0.55);
        card.border.setStrokeStyle(1, HudColors.divider, 0.7);
        card.icon.setFillStyle(HudColors.panelHi, 0.6);
        card.iconLabel.setText('');
        card.name.setText('');
        card.rarity.setText('');
        card.action.setText('');
        card.container.removeAllListeners();
        card.container.disableInteractive();
    }

    private handleSwap(droppedId: RelicId): void {
        const candidate = this.candidate;
        if (!candidate) return;
        this.hide();
        this.options.onSwap(droppedId, candidate);
    }

    private handleSkip(): void {
        const candidate = this.candidate;
        if (!candidate) return;
        this.hide();
        this.options.onSkip(candidate);
    }

    private setVisible(visible: boolean): void {
        this.widgets.forEach((w) => w.setVisible(visible));
    }
}

type CardRole = 'equipped' | 'candidate';

interface CardHandle {
    container: Phaser.GameObjects.Container;
    bg: Phaser.GameObjects.Rectangle;
    border: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Rectangle;
    iconLabel: Phaser.GameObjects.Text;
    name: Phaser.GameObjects.Text;
    rarity: Phaser.GameObjects.Text;
    action: Phaser.GameObjects.Text;
    role: CardRole;
    relicId: RelicId | null;
}

function letterFor(loc: Localization, id: RelicId): string {
    const short = loc.pick(RELICS[id].short).trim();
    if (!short) return '·';
    return short.slice(0, Math.min(2, short.length)).toUpperCase();
}

function rarityKey(rarity: RelicRarity): 'rarityCommon' | 'rarityRare' | 'rarityUnique' {
    return rarity === 'common' ? 'rarityCommon' : rarity === 'rare' ? 'rarityRare' : 'rarityUnique';
}
