/**
 * Bottom-bar relic display: a row of {@link MAX_RELICS} square cells
 * that show the player's currently equipped relics with hover
 * tooltips. Replaces the old below-bar text line ("Реликвии: …")
 * that used to be built in `GameHudController.buildBelowBarText`.
 *
 * Visual contract:
 *   - Empty slots render as a faded carved cell so the player can
 *     see how many relics are still available before the cap kicks
 *     in.
 *   - Filled slots draw a procedural icon (rarity-tinted border +
 *     1-2 letters from `RELICS[id].short`). When a real
 *     `relic_icons` spritesheet is shipped, swap the icon body
 *     here for `withTexture(scene, 'relic_icons', …)` — every
 *     other concern (positioning, hover, tooltip) is already wired.
 *
 * Hover contract:
 *   - `pointerover` on a filled slot pops the tooltip with the
 *     relic's localized name, full description, and rarity badge.
 *   - `pointerout` hides the tooltip.
 *   - Empty slots are non-interactive.
 *
 * The widget owns its `relicsChange` subscription and exposes only
 * `refresh()` / `destroy()` so the HUD controller stays thin.
 */
import * as Phaser from 'phaser';

import type { Localization } from '../systems/Localization';
import type { PlayerManager } from '../systems/PlayerManager';
import { RELICS, type RelicId, type RelicRarity } from '../systems/Relics';
import { Depths } from './Layout';
import { HUD_FONT, HUD_STROKE, HudColors, HudHex } from './HudTheme';

const SLOT_SIZE = 40;
const SLOT_GAP = 12;
const TOOLTIP_PAD = 12;
const TOOLTIP_W = 240;
const TOOLTIP_LINE_GAP = 4;

/** Numeric border colour by rarity. Common is muted, rare is gold,
 *  unique is amethyst — same palette the pickup-log line uses in
 *  `RelicDrops.maybeDropRelic`. */
const RARITY_BORDER: Record<RelicRarity, number> = {
    common: 0x8a8071,
    rare: 0xd9b35c,
    unique: 0xc97ad9,
};

/** Hex string variant for tooltip text colouring. */
const RARITY_TEXT: Record<RelicRarity, string> = {
    common: '#cfc7b8',
    rare: '#ffd36e',
    unique: '#f0a8ff',
};

interface RelicSlotsOptions {
    /** Slot row centred on this x in the HUD coordinate space. */
    centerX: number;
    /** Vertical centre of every slot (slots are 40×40). */
    centerY: number;
    /** Hard cap; matches `MAX_RELICS` from PlayerManager. */
    capacity: number;
}

interface SlotHandle {
    bg: Phaser.GameObjects.Rectangle;
    border: Phaser.GameObjects.Rectangle;
    label: Phaser.GameObjects.Text;
    container: Phaser.GameObjects.Container;
    /** Currently displayed relic, or null when the slot is empty. */
    relicId: RelicId | null;
}

export class RelicSlots {
    private readonly scene: Phaser.Scene;
    private readonly player: PlayerManager;
    private readonly loc: Localization;
    private readonly slots: SlotHandle[] = [];
    private readonly tooltip: TooltipHandle;
    private readonly listenerOff: () => void;

    constructor(
        scene: Phaser.Scene,
        player: PlayerManager,
        loc: Localization,
        options: RelicSlotsOptions
    ) {
        this.scene = scene;
        this.player = player;
        this.loc = loc;

        const totalW = options.capacity * SLOT_SIZE + (options.capacity - 1) * SLOT_GAP;
        const startX = options.centerX - totalW / 2 + SLOT_SIZE / 2;

        for (let i = 0; i < options.capacity; i++) {
            const x = startX + i * (SLOT_SIZE + SLOT_GAP);
            this.slots.push(this.createSlot(x, options.centerY));
        }

        this.tooltip = createTooltip(scene);

        // `Emitter.on` returns its own unsubscribe handle; stash it
        // so `destroy()` can detach cleanly when the scene tears
        // down (language toggle / death restart).
        this.listenerOff = player.relicsChange.on(() => this.refresh());
        // Initial paint.
        this.refresh();
    }

    private dead = false;

    /** Repaint every slot from `player.relics`. */
    public refresh(): void {
        if (this.dead) return;
        const ids = this.player.relics;
        for (let i = 0; i < this.slots.length; i++) {
            this.applySlot(this.slots[i], ids[i] ?? null);
        }
    }

    /** Hand back every Phaser game object so the HUD controller can
     *  drop them into `uiContainer` in one shot. Tooltip widgets are
     *  included so they inherit container depth. */
    public widgets(): Phaser.GameObjects.GameObject[] {
        return [
            ...this.slots.map((s) => s.container),
            this.tooltip.bg,
            this.tooltip.title,
            this.tooltip.body,
            this.tooltip.rarity,
        ];
    }

    public destroy(): void {
        this.dead = true;
        this.listenerOff();
        this.slots.forEach((s) => s.container.destroy());
        this.tooltip.bg.destroy();
        this.tooltip.title.destroy();
        this.tooltip.body.destroy();
        this.tooltip.rarity.destroy();
    }

    private createSlot(x: number, y: number): SlotHandle {
        const container = this.scene.add.container(x, y).setDepth(Depths.UiBase + 1);
        const bg = this.scene.add
            .rectangle(0, 0, SLOT_SIZE, SLOT_SIZE, HudColors.panelBg, 0.92)
            .setOrigin(0.5);
        const border = this.scene.add
            .rectangle(0, 0, SLOT_SIZE, SLOT_SIZE)
            .setOrigin(0.5)
            .setStrokeStyle(2, HudColors.panelOuter, 1);
        const label = this.scene.add
            .text(0, 1, '', {
                fontFamily: HUD_FONT,
                fontSize: '18px',
                color: HudHex.textMuted,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0.5);
        container.add([bg, border, label]);
        return { container, bg, border, label, relicId: null };
    }

    private applySlot(slot: SlotHandle, id: RelicId | null): void {
        slot.relicId = id;
        if (!id) {
            slot.bg.setFillStyle(HudColors.panelBg, 0.55);
            slot.border.setStrokeStyle(1, HudColors.divider, 0.6);
            slot.label.setText('');
            slot.container.disableInteractive();
            slot.container.removeAllListeners();
            return;
        }
        const relic = RELICS[id];
        const rarityColor = RARITY_BORDER[relic.rarity as RelicRarity];
        slot.bg.setFillStyle(HudColors.panelBg, 0.95);
        slot.border.setStrokeStyle(2, rarityColor, 1);
        slot.label.setText(letterFor(this.loc, id));
        slot.label.setColor(RARITY_TEXT[relic.rarity as RelicRarity]);

        slot.container.removeAllListeners();
        slot.container.setInteractive(
            new Phaser.Geom.Rectangle(-SLOT_SIZE / 2, -SLOT_SIZE / 2, SLOT_SIZE, SLOT_SIZE),
            Phaser.Geom.Rectangle.Contains
        );
        slot.container.on('pointerover', () => this.showTooltip(slot, id));
        slot.container.on('pointerout', () => this.hideTooltip());
    }

    private showTooltip(slot: SlotHandle, id: RelicId): void {
        const relic = RELICS[id];
        const name = this.loc.pick(relic.name);
        const desc = this.loc.pick(relic.description);
        const rarityLabel = this.loc.t(rarityKey(relic.rarity as RelicRarity));

        this.tooltip.title.setText(name);
        this.tooltip.body.setText(desc);
        this.tooltip.rarity.setText(rarityLabel);
        this.tooltip.rarity.setColor(RARITY_TEXT[relic.rarity as RelicRarity]);

        // Layout: anchor bottom-centre of the tooltip a few px above
        // the slot. Clamp horizontally so the tooltip never spills
        // past the canvas edge.
        const slotX = slot.container.x;
        const slotY = slot.container.y;
        const margin = 8;
        const titleH = this.tooltip.title.height;
        const rarityH = this.tooltip.rarity.height;
        const bodyH = this.tooltip.body.height;
        const totalH = titleH + rarityH + bodyH + 3 * TOOLTIP_LINE_GAP + 2 * TOOLTIP_PAD;

        let cx = slotX;
        const halfW = TOOLTIP_W / 2;
        const minX = halfW + 6;
        const maxX = this.scene.scale.width - halfW - 6;
        if (cx < minX) cx = minX;
        if (cx > maxX) cx = maxX;
        const cy = slotY - SLOT_SIZE / 2 - margin - totalH / 2;

        this.tooltip.bg.setPosition(cx, cy);
        this.tooltip.bg.setSize(TOOLTIP_W, totalH);

        const innerLeft = cx - TOOLTIP_W / 2 + TOOLTIP_PAD;
        const innerTop = cy - totalH / 2 + TOOLTIP_PAD;
        this.tooltip.title.setPosition(innerLeft, innerTop);
        this.tooltip.rarity.setPosition(innerLeft, innerTop + titleH + TOOLTIP_LINE_GAP);
        this.tooltip.body.setPosition(
            innerLeft,
            innerTop + titleH + rarityH + 2 * TOOLTIP_LINE_GAP
        );

        this.setTooltipVisible(true);
    }

    private hideTooltip(): void {
        this.setTooltipVisible(false);
    }

    private setTooltipVisible(visible: boolean): void {
        this.tooltip.bg.setVisible(visible);
        this.tooltip.title.setVisible(visible);
        this.tooltip.rarity.setVisible(visible);
        this.tooltip.body.setVisible(visible);
    }
}

interface TooltipHandle {
    bg: Phaser.GameObjects.Rectangle;
    title: Phaser.GameObjects.Text;
    rarity: Phaser.GameObjects.Text;
    body: Phaser.GameObjects.Text;
}

function createTooltip(scene: Phaser.Scene): TooltipHandle {
    const bg = scene.add
        .rectangle(0, 0, TOOLTIP_W, 80, HudColors.panelBg, 0.96)
        .setOrigin(0.5)
        .setStrokeStyle(1, HudColors.cellGoldEdge, 0.9)
        .setDepth(Depths.Tooltip);
    const title = scene.add
        .text(0, 0, '', {
            fontFamily: HUD_FONT,
            fontSize: '14px',
            color: HudHex.textPrimary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        })
        .setDepth(Depths.Tooltip + 1);
    const rarity = scene.add
        .text(0, 0, '', {
            fontFamily: HUD_FONT,
            fontSize: '11px',
            color: HudHex.accentGold,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        })
        .setDepth(Depths.Tooltip + 1);
    const body = scene.add
        .text(0, 0, '', {
            fontFamily: HUD_FONT,
            fontSize: '12px',
            color: HudHex.textSecondary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
            wordWrap: { width: TOOLTIP_W - 2 * TOOLTIP_PAD },
            lineSpacing: 2,
        })
        .setDepth(Depths.Tooltip + 1);

    [bg, title, rarity, body].forEach((w) => w.setVisible(false));
    return { bg, title, rarity, body };
}

function letterFor(loc: Localization, id: RelicId): string {
    const short = loc.pick(RELICS[id].short).trim();
    if (!short) return '·';
    // Keep the icon letter to ≤2 visible chars so it always fits the
    // 40×40 slot regardless of font metrics. Two chars give enough
    // signal for "Прокл. амул." vs "Прокл. кольцо" without rendering
    // the entire short label.
    return short.slice(0, Math.min(2, short.length)).toUpperCase();
}

function rarityKey(rarity: RelicRarity): 'rarityCommon' | 'rarityRare' | 'rarityUnique' {
    return rarity === 'common' ? 'rarityCommon' : rarity === 'rare' ? 'rarityRare' : 'rarityUnique';
}
