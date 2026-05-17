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
import type { SoundManager } from '../systems/SoundManager';
import { Depths } from './Layout';
import { HUD_FONT, HUD_STROKE, HudColors, HudHex } from './HudTheme';
import { drawPanel, type PanelBackground } from './UiPanel';

const SLOT_SIZE = 60;
const SLOT_GAP = 18;
const TOOLTIP_PAD = 12;
const TOOLTIP_W = 240;
const TOOLTIP_LINE_GAP = 4;

/** Click on a filled slot arms a discard confirm; a second click on
 *  the same slot within this window commits the drop. Matches the
 *  `ESCAPE_CONFIRM_MS` cadence so both confirm-on-second-click flows
 *  feel the same. */
const DISCARD_CONFIRM_MS = 3000;

/** Red border / glyph used to signal an armed-for-discard slot.
 *  Numeric form for {@link Phaser.GameObjects.Rectangle.setStrokeStyle};
 *  hex-string form for the label color. */
const DISCARD_ARMED_TINT = 0xff5a5a;
const DISCARD_ARMED_TEXT = '#ff5a5a';

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
    /** Vertical centre of every slot (slots are 60×60). */
    centerY: number;
    /** Hard cap; matches `MAX_RELICS` from PlayerManager. */
    capacity: number;
    /** Shared SFX bank; click-to-arm plays `buttonClick`, confirmed
     *  discard plays `relicDrop`. Optional so tests / boot screens
     *  can mount the widget without an audio stack. */
    sfx?: SoundManager;
    /** Invoked when the player confirms a discard (second click on the
     *  armed slot within {@link DISCARD_CONFIRM_MS}). The widget only
     *  signals intent — the caller owns `removeRelic` + any pickup
     *  log line — so the discard log can be written once with the
     *  caller's preferred wording. Omit to disable the discard flow
     *  entirely (slots stay hover-only). */
    onDiscard?: (id: RelicId) => void;
}

interface SlotHandle {
    /** Carved-bronze backdrop (panel_small.png nine-slice with procedural
     *  fallback). Filled slots paint it at near-full alpha; empty slots
     *  fade it so the row reads as available-but-empty capacity. */
    bg: PanelBackground;
    /** Whether `bg` is the textured NineSlice path — controls how we
     *  modulate state (tint+alpha vs fillStyle). */
    bgTextured: boolean;
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
    private readonly options: RelicSlotsOptions;
    private readonly slots: SlotHandle[] = [];
    private readonly tooltip: TooltipHandle;
    private readonly listenerOff: () => void;
    /** Slot currently armed for discard; cleared on confirm, timeout,
     *  another slot click, or an external `relicsChange` refresh. */
    private armedSlot: SlotHandle | null = null;
    private armedTimer: Phaser.Time.TimerEvent | null = null;

    constructor(
        scene: Phaser.Scene,
        player: PlayerManager,
        loc: Localization,
        options: RelicSlotsOptions
    ) {
        this.scene = scene;
        this.player = player;
        this.loc = loc;
        this.options = options;

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

    /** Repaint every slot from `player.relics`. Clears any pending
     *  discard arm — an external relic change (drop pickup, swap
     *  modal, or our own `onDiscard` callback) invalidates the
     *  player's prior click intent. */
    public refresh(): void {
        if (this.dead) return;
        this.clearArm(/* repaint */ false);
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
        if (this.armedTimer) {
            this.armedTimer.remove(false);
            this.armedTimer = null;
        }
        this.armedSlot = null;
        this.slots.forEach((s) => s.container.destroy());
        this.tooltip.bg.destroy();
        this.tooltip.title.destroy();
        this.tooltip.body.destroy();
        this.tooltip.rarity.destroy();
    }

    private createSlot(x: number, y: number): SlotHandle {
        const container = this.scene.add.container(x, y).setDepth(Depths.UiBase + 1);
        const panel = drawPanel(this.scene, 0, 0, SLOT_SIZE, SLOT_SIZE);
        const bg = panel.background;
        const border = this.scene.add
            .rectangle(0, 0, SLOT_SIZE, SLOT_SIZE)
            .setOrigin(0.5)
            .setStrokeStyle(2, HudColors.panelOuter, 1);
        const label = this.scene.add
            .text(0, 1, '', {
                fontFamily: HUD_FONT,
                fontSize: '24px',
                color: HudHex.textMuted,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0.5);
        container.add([bg, border, label]);
        return {
            container,
            bg,
            bgTextured: panel.textured,
            border,
            label,
            relicId: null,
        };
    }

    private applySlot(slot: SlotHandle, id: RelicId | null): void {
        slot.relicId = id;
        if (!id) {
            paintSlotBg(slot, 0.45);
            slot.border.setStrokeStyle(1, HudColors.divider, 0.6);
            slot.label.setText('');
            slot.container.disableInteractive();
            slot.container.removeAllListeners();
            return;
        }
        const relic = RELICS[id];
        const rarityColor = RARITY_BORDER[relic.rarity as RelicRarity];
        paintSlotBg(slot, 1);
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
        // Discard flow is opt-in via `onDiscard`. Without a callback
        // wired we leave the slot hover-only — no click reactions — so
        // pre-existing call sites that just want a read-only relic row
        // (e.g. future end-of-run summary panes) keep their old
        // behaviour.
        if (this.options.onDiscard) {
            slot.container.on('pointerdown', () => this.handleSlotClick(slot, id));
        }
    }

    /**
     * Two-step discard handler. First click on a filled slot arms the
     * slot (red ✕ glyph, red border) and starts a
     * {@link DISCARD_CONFIRM_MS} timeout. Second click on the *same*
     * slot within the window commits the drop — we hand the relic id
     * to the host's `onDiscard` callback and let it own
     * `removeRelic` + log. Clicking a different slot disarms the
     * previous one and arms the new one.
     */
    private handleSlotClick(slot: SlotHandle, id: RelicId): void {
        const onDiscard = this.options.onDiscard;
        if (!onDiscard) return;
        if (this.armedSlot === slot) {
            // Confirm: commit the drop. The `relicsChange` listener
            // will repaint the row (and `refresh` clears our arm
            // state via `clearArm`), so we don't repaint here.
            this.options.sfx?.play('relicDrop');
            this.armedSlot = null;
            if (this.armedTimer) {
                this.armedTimer.remove(false);
                this.armedTimer = null;
            }
            onDiscard(id);
            return;
        }
        // Switch arm from any previously armed slot to this one.
        this.clearArm(/* repaint */ true);
        this.armedSlot = slot;
        this.paintArmed(slot);
        this.options.sfx?.play('buttonClick');
        this.armedTimer = this.scene.time.delayedCall(DISCARD_CONFIRM_MS, () => {
            this.armedTimer = null;
            if (this.armedSlot === slot) {
                // Timeout: silently revert to the normal painted state.
                this.armedSlot = null;
                this.applySlot(slot, slot.relicId);
            }
        });
    }

    /**
     * Tear down any active arm. When `repaint` is true (called from
     * a fresh user click or timeout), the previously armed slot is
     * re-rendered in its normal state. When false (called from
     * {@link refresh}), the caller will overwrite the slot a moment
     * later so we skip the redundant paint pass.
     */
    private clearArm(repaint: boolean): void {
        if (this.armedTimer) {
            this.armedTimer.remove(false);
            this.armedTimer = null;
        }
        const prev = this.armedSlot;
        this.armedSlot = null;
        if (repaint && prev) {
            this.applySlot(prev, prev.relicId);
        }
    }

    /** Paint a slot in its armed-for-discard state. Reverted by
     *  either {@link clearArm} (with `repaint`) or the timeout
     *  branch in {@link handleSlotClick}, which re-applies the
     *  normal state via {@link applySlot}. */
    private paintArmed(slot: SlotHandle): void {
        slot.label.setText('✕');
        slot.label.setColor(DISCARD_ARMED_TEXT);
        slot.border.setStrokeStyle(3, DISCARD_ARMED_TINT, 1);
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

/**
 * Apply a brightness state to the slot backdrop. The textured
 * NineSlice path uses `setAlpha` so the carved-bronze art reads
 * through; the procedural Rectangle fallback re-applies the same
 * fill colour at a matching alpha so it visually approximates the
 * textured version.
 */
function paintSlotBg(slot: SlotHandle, alpha: number): void {
    if (slot.bgTextured) {
        (slot.bg as Phaser.GameObjects.NineSlice).setAlpha(alpha);
    } else {
        (slot.bg as Phaser.GameObjects.Rectangle).setFillStyle(HudColors.panelBg, alpha);
    }
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
