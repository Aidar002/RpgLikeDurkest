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
import { RELICS, type RelicId, type RelicRarity, type RelicSetId } from '../systems/Relics';
import type { SoundManager } from '../systems/SoundManager';
import { playEffect } from './EffectsLibrary';
import { CENTER_X, Depths } from './Layout';
import { HUD_FONT, HUD_STROKE, HudColors, HudHex, RelicSetColors, RelicSetHex } from './HudTheme';
import { drawPanel, type PanelBackground } from './UiPanel';

const SLOT_SIZE = 60;
const SLOT_GAP = 18;
const TOOLTIP_PAD = 12;
const TOOLTIP_W = 240;
const TOOLTIP_LINE_GAP = 4;

/** Side length of the corner rune that signals set membership. */
const RUNE_SIZE = 12;
/** Inset of the rune from the slot's bottom-right edge. */
const RUNE_INSET = 4;
/** Inset of the partial-set counter from the slot's top-right edge. */
const COUNTER_INSET = 4;

/** Total roster size for each set — used to render the `owned/total`
 *  counter when the set isn't yet complete. */
const SET_TOTAL: Record<RelicSetId, number> = {
    wanderer: 3,
    flesh: 2,
    knight: 3,
    cursed: 2,
    sin: 2,
};

/** Locale key used for the centred toast that fires on set completion.
 *  Resolved lazily so the file stays free of explicit `loc.t(...)` calls
 *  at module load time. */
const SET_NAME_KEY: Record<
    RelicSetId,
    'setWanderer' | 'setFlesh' | 'setKnight' | 'setCursed' | 'setSin'
> = {
    wanderer: 'setWanderer',
    flesh: 'setFlesh',
    knight: 'setKnight',
    cursed: 'setCursed',
    sin: 'setSin',
};

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
    /** Hand-authored relic icon (preloaded as `relic_<RelicId>` in
     *  BootScene). Hidden until a relic with a registered texture is
     *  assigned to the slot; when shown, the procedural letter
     *  `label` is hidden so the two icon variants never overlap. */
    icon: Phaser.GameObjects.Image;
    label: Phaser.GameObjects.Text;
    /** Bottom-right corner marker tinted by the relic's set. Hidden for
     *  setless relics. Stays visible whether the set is partial or
     *  complete — completion is signalled instead by the border. */
    setRune: Phaser.GameObjects.Rectangle;
    /** Inner pip on the rune so it reads as a glyph rather than a flat
     *  square. Painted with a slightly brighter shade of the set
     *  colour for visual depth. */
    setRunePip: Phaser.GameObjects.Rectangle;
    /** Tiny `n/total` overlay on the top-right corner of the slot.
     *  Visible only while the slot's set is collected but incomplete. */
    setCounter: Phaser.GameObjects.Text;
    container: Phaser.GameObjects.Container;
    /** Currently displayed relic, or null when the slot is empty. */
    relicId: RelicId | null;
    /** Cached set of the displayed relic for fast brother lookup on
     *  hover. `null` for slot-less relics. */
    setId: RelicSetId | null;
    /** Active pulse tween on `border` while the slot's set is complete;
     *  stopped + cleared on every {@link applySlot} call. */
    pulseTween: Phaser.Tweens.Tween | null;
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
    /** Sets known to be complete after the most recent {@link refresh}.
     *  Used to detect false→true transitions so we only fire the
     *  set-complete celebration once per build of a set. */
    private completedSets: Set<RelicSetId> = new Set();
    /** Set ids whose owned count is currently > 0 — used by
     *  {@link refresh} to drive the partial-set counter on slot
     *  members. Recomputed every refresh from `player.relics`. */
    private setOwnedCount: Map<RelicSetId, number> = new Map();
    /** Slot the pointer is currently hovering over; cleared on
     *  `pointerout`. Drives brother-highlight glow on other slots
     *  of the same set. */
    private hoveredSlot: SlotHandle | null = null;
    /** True the very first time {@link refresh} runs — used to suppress
     *  the set-complete celebration on initial paint (e.g. a saved run
     *  loads with a set already built; we don't want to replay the
     *  fanfare). */
    private firstRefresh = true;

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
        // Scene-wide pointerdown watcher: cancels the armed discard
        // state when the player clicks anywhere outside the red ✕
        // slot. Phaser fires per-object `pointerdown` events *before*
        // the scene-level one, so when the user taps a slot the
        // slot's own handler in {@link applySlot} runs first and we
        // see the updated `armedSlot` here — meaning clicking the
        // same armed slot to confirm, or a different filled slot to
        // re-arm, both short-circuit cleanly. Detached in
        // {@link destroy}.
        scene.input.on('pointerdown', this.handleScenePointerDown);
        // Initial paint.
        this.refresh();
    }

    private dead = false;

    /** Repaint every slot from `player.relics`. Clears any pending
     *  discard arm — an external relic change (drop pickup, swap
     *  modal, or our own `onDiscard` callback) invalidates the
     *  player's prior click intent. Also hides any open tooltip:
     *  `applySlot(slot, null)` removes the slot's listeners, so a
     *  pointer that was over the slot at discard time will never
     *  fire `pointerout` and the tooltip would otherwise linger. */
    public refresh(): void {
        if (this.dead) return;
        this.clearArm(/* repaint */ false);
        this.hideTooltip();
        this.hoveredSlot = null;
        // Recompute owned counts per set up front so each
        // {@link applySlot} call can render its counter / completed
        // state in O(1) without re-walking the inventory.
        const ids = this.player.relics;
        const counts = new Map<RelicSetId, number>();
        for (const id of ids) {
            if (!id) continue;
            const set = setOf(id);
            if (!set) continue;
            counts.set(set, (counts.get(set) ?? 0) + 1);
        }
        this.setOwnedCount = counts;

        const nowComplete = new Set<RelicSetId>();
        (Object.keys(SET_TOTAL) as RelicSetId[]).forEach((s) => {
            if ((counts.get(s) ?? 0) >= SET_TOTAL[s]) nowComplete.add(s);
        });
        const justCompleted: RelicSetId[] = [];
        if (!this.firstRefresh) {
            for (const s of nowComplete) {
                if (!this.completedSets.has(s)) justCompleted.push(s);
            }
        }
        this.completedSets = nowComplete;
        this.firstRefresh = false;

        for (let i = 0; i < this.slots.length; i++) {
            this.applySlot(this.slots[i], ids[i] ?? null);
        }

        // Fire the set-complete celebration *after* every slot has
        // been repainted, so the brighter dust burst lands on the
        // recoloured set-borders rather than the prior rarity hue.
        for (const s of justCompleted) {
            this.celebrateSetComplete(s);
        }
    }

    /**
     * Return the on-screen centre of the slot currently displaying
     * `id`, or `null` when the relic isn't equipped. Used by the
     * HUD's `relicGained` listener to anchor the pickup VFX on the
     * exact slot the new relic just landed in.
     */
    public getSlotCenter(id: RelicId): { x: number; y: number } | null {
        for (const slot of this.slots) {
            if (slot.relicId === id) {
                return { x: slot.container.x, y: slot.container.y };
            }
        }
        return null;
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
        this.scene.input.off('pointerdown', this.handleScenePointerDown);
        if (this.armedTimer) {
            this.armedTimer.remove(false);
            this.armedTimer = null;
        }
        this.armedSlot = null;
        this.hoveredSlot = null;
        this.slots.forEach((s) => {
            if (s.pulseTween) {
                s.pulseTween.stop();
                s.pulseTween = null;
            }
            s.container.destroy();
        });
        this.tooltip.bg.destroy();
        this.tooltip.title.destroy();
        this.tooltip.body.destroy();
        this.tooltip.rarity.destroy();
    }

    /**
     * Scene-level pointerdown watcher. Wired in the constructor; runs
     * after any per-slot `pointerdown` handler has already fired (so
     * confirms, re-arms on a different slot, and the "click outside"
     * cancel case all read a consistent `armedSlot`).
     *
     * If a slot is armed and the click landed anywhere that isn't
     * the armed slot's container, we disarm and repaint — matching
     * the user's expectation that any tap outside the red ✕ cancels
     * the discard intent. Clicks on the armed slot itself (confirm)
     * or on a different filled slot (re-arm) are already handled by
     * the slot's own `pointerdown` listener, so we short-circuit
     * here when the cursor is over the armed container.
     */
    private readonly handleScenePointerDown = (
        _pointer: Phaser.Input.Pointer,
        currentlyOver: Phaser.GameObjects.GameObject[]
    ): void => {
        if (this.dead) return;
        const armed = this.armedSlot;
        if (!armed) return;
        if (currentlyOver.includes(armed.container)) return;
        this.clearArm(/* repaint */ true);
    };

    private createSlot(x: number, y: number): SlotHandle {
        const container = this.scene.add.container(x, y).setDepth(Depths.UiBase + 1);
        const panel = drawPanel(this.scene, 0, 0, SLOT_SIZE, SLOT_SIZE);
        const bg = panel.background;
        const border = this.scene.add
            .rectangle(0, 0, SLOT_SIZE, SLOT_SIZE)
            .setOrigin(0.5)
            .setStrokeStyle(2, HudColors.panelOuter, 1);
        // Pre-create the icon image with a placeholder visibility.
        // The texture is swapped in {@link applySlot} when a relic
        // with a registered `relic_<id>` key lands in this slot;
        // otherwise it stays hidden and the procedural letter shows.
        // Display size is the slot's inner area with a small inset
        // so the rarity border still reads clearly.
        const icon = this.scene.add
            .image(0, 0, '__MISSING')
            .setOrigin(0.5)
            .setDisplaySize(SLOT_SIZE - 8, SLOT_SIZE - 8)
            .setVisible(false);
        const label = this.scene.add
            .text(0, 1, '', {
                fontFamily: HUD_FONT,
                fontSize: '24px',
                color: HudHex.textMuted,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0.5);
        // Set-membership corner rune (bottom-right). Built hidden;
        // {@link applySlot} positions and tints it per relic. The pip
        // is a tiny rectangle inside the rune that lifts it off the
        // border so it doesn't read as a flat coloured chip.
        const runeX = SLOT_SIZE / 2 - RUNE_INSET - RUNE_SIZE / 2;
        const runeY = SLOT_SIZE / 2 - RUNE_INSET - RUNE_SIZE / 2;
        const setRune = this.scene.add
            .rectangle(runeX, runeY, RUNE_SIZE, RUNE_SIZE, 0xffffff, 1)
            .setOrigin(0.5)
            .setStrokeStyle(1, 0x111111, 0.85)
            .setVisible(false);
        const setRunePip = this.scene.add
            .rectangle(runeX, runeY, RUNE_SIZE - 6, RUNE_SIZE - 6, 0xffffff, 1)
            .setOrigin(0.5)
            .setVisible(false);
        // Partial-set counter (top-right). Right-aligned so multi-
        // digit totals would still hug the slot edge cleanly.
        const counterX = SLOT_SIZE / 2 - COUNTER_INSET;
        const counterY = -SLOT_SIZE / 2 + COUNTER_INSET;
        const setCounter = this.scene.add
            .text(counterX, counterY, '', {
                fontFamily: HUD_FONT,
                fontSize: '10px',
                color: HudHex.textMuted,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(1, 0)
            .setVisible(false);
        container.add([bg, border, icon, label, setRune, setRunePip, setCounter]);
        return {
            container,
            bg,
            bgTextured: panel.textured,
            border,
            icon,
            label,
            setRune,
            setRunePip,
            setCounter,
            relicId: null,
            setId: null,
            pulseTween: null,
        };
    }

    private applySlot(slot: SlotHandle, id: RelicId | null): void {
        // Tear down any prior set-complete pulse before we repaint —
        // the new relic (or empty slot) may not want it, and a stale
        // tween would keep mutating the freshly re-coloured border.
        if (slot.pulseTween) {
            slot.pulseTween.stop();
            slot.pulseTween = null;
        }
        slot.relicId = id;
        slot.setId = null;
        slot.setRune.setVisible(false);
        slot.setRunePip.setVisible(false);
        slot.setCounter.setVisible(false);
        slot.border.setAlpha(1);
        slot.icon.setVisible(false);
        if (!id) {
            paintSlotBg(slot, 0.45);
            slot.border.setStrokeStyle(1, HudColors.divider, 0.6);
            slot.label.setText('');
            slot.container.disableInteractive();
            slot.container.removeAllListeners();
            return;
        }
        const relic = RELICS[id];
        const setId = setOf(id);
        slot.setId = setId;
        const setComplete = setId !== null && this.completedSets.has(setId);
        const rarityColor = RARITY_BORDER[relic.rarity as RelicRarity];
        paintSlotBg(slot, 1);
        if (setComplete && setId !== null) {
            const setColor = RelicSetColors[setId];
            slot.border.setStrokeStyle(3, setColor, 1);
            // Gentle 0.3 Hz alpha pulse so completed sets read as
            // "alive" without distracting from gameplay. Stored on the
            // handle so {@link applySlot} can stop it on the next
            // repaint.
            slot.pulseTween = this.scene.tweens.add({
                targets: slot.border,
                alpha: 0.55,
                duration: 1600,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.inOut',
            });
        } else if (relic.rarity === 'common') {
            // Common relics rely on the carved panel_small frame as
            // their entire visual boundary — the muted-tan rarity
            // stroke was reading as a stray grey outline against the
            // bronze frame, so it's suppressed here. Rare / unique /
            // set-complete states still paint a coloured stroke so
            // their highlight remains legible.
            slot.border.setStrokeStyle();
        } else {
            slot.border.setStrokeStyle(2, rarityColor, 1);
        }
        // Prefer the hand-authored icon when its texture is registered
        // (BootScene preloads `relic_<id>.webp` for every shipped
        // relic). Falls back to the 1–2 letter procedural glyph if
        // the texture is missing — keeps tests and any future relic
        // without art rendering cleanly.
        const iconKey = `relic_${id}`;
        if (this.scene.textures.exists(iconKey)) {
            // `setTexture` resets `displayWidth`/`displayHeight` to the
            // source-image dimensions, so the inset we baked into
            // {@link createSlot} is lost the moment we swap art in.
            // Re-apply it here so hand-authored icons (typically
            // 128×128) always render inside the slot's rarity border
            // instead of overflowing past it.
            slot.icon
                .setTexture(iconKey)
                .setDisplaySize(SLOT_SIZE - 8, SLOT_SIZE - 8)
                .setVisible(true);
            slot.label.setText('');
        } else {
            slot.label.setText(letterFor(this.loc, id));
            slot.label.setColor(RARITY_TEXT[relic.rarity as RelicRarity]);
        }

        // Set-membership rune (permanent for any relic with a set).
        if (setId !== null) {
            const color = RelicSetColors[setId];
            slot.setRune.setFillStyle(color, 1);
            slot.setRune.setVisible(true);
            // Pip is a slightly desaturated overlay; on completed sets
            // it brightens to make the rune pop.
            slot.setRunePip.setFillStyle(
                setComplete ? 0xfff2c4 : 0x111111,
                setComplete ? 0.9 : 0.55
            );
            slot.setRunePip.setVisible(true);
            // Counter shown only while the set isn't yet complete.
            const owned = this.setOwnedCount.get(setId) ?? 0;
            const total = SET_TOTAL[setId];
            if (!setComplete && owned > 0 && total > 1) {
                slot.setCounter.setText(`${owned}/${total}`);
                slot.setCounter.setColor(RelicSetHex[setId]);
                slot.setCounter.setVisible(true);
            }
        }

        slot.container.removeAllListeners();
        slot.container.setInteractive(
            new Phaser.Geom.Rectangle(-SLOT_SIZE / 2, -SLOT_SIZE / 2, SLOT_SIZE, SLOT_SIZE),
            Phaser.Geom.Rectangle.Contains
        );
        slot.container.on('pointerover', () => {
            this.showTooltip(slot, id);
            this.setHovered(slot);
        });
        slot.container.on('pointerout', () => {
            this.hideTooltip();
            this.setHovered(null);
        });
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

    /**
     * Track the slot currently under the pointer and brighten its set
     * brothers. Passing `null` clears any active highlight, which is
     * what we want on `pointerout` and on every {@link refresh} (where
     * we tear down state before repainting).
     *
     * Brothers are highlighted by widening the border stroke and
     * temporarily painting it in the set colour. Completed sets are
     * left alone — they already pulse in the set colour and the extra
     * stroke would just steal contrast from the celebration.
     */
    private setHovered(slot: SlotHandle | null): void {
        const prev = this.hoveredSlot;
        if (prev === slot) return;
        // Restore any previously highlighted brothers.
        if (prev && prev.setId) {
            this.highlightBrothers(prev.setId, /* on */ false);
        }
        this.hoveredSlot = slot;
        if (slot && slot.setId && !this.completedSets.has(slot.setId)) {
            // Skip painting brothers while the set is complete — the
            // completion pulse already telegraphs membership and adding
            // a heavier stroke on top muddles the colour.
            this.highlightBrothers(slot.setId, /* on */ true);
        }
    }

    /**
     * Toggle the brother-highlight on every slot in `setId` whose
     * border isn't currently driven by a completion pulse. The
     * `setStrokeStyle` call is idempotent — passing the same values
     * twice is a no-op — so leaving stray prior calls in flight is
     * harmless if the slot was rearmed for discard mid-hover (the
     * armed paint state takes priority on the next pointerdown).
     */
    private highlightBrothers(setId: RelicSetId, on: boolean): void {
        const setColor = RelicSetColors[setId];
        for (const s of this.slots) {
            if (s.setId !== setId) continue;
            if (this.completedSets.has(setId)) continue;
            if (on) {
                s.border.setStrokeStyle(3, setColor, 1);
            } else {
                // Repaint from the relic's rarity. If the slot was
                // armed for discard the next click handler will paint
                // it red again anyway, so we keep this simple.
                if (s.relicId) {
                    const rarity = RELICS[s.relicId].rarity as RelicRarity;
                    s.border.setStrokeStyle(2, RARITY_BORDER[rarity], 1);
                }
            }
        }
    }

    /**
     * Fire the set-complete celebration: a brighter `dustImplosion`
     * burst on every slot in the set plus a centred toast naming the
     * set. The border recolour + pulsation are owned by
     * {@link applySlot}; this method just sprinkles the VFX on top so
     * the visual change has a clear "moment".
     */
    private celebrateSetComplete(setId: RelicSetId): void {
        const color = RelicSetColors[setId];
        for (const slot of this.slots) {
            if (slot.setId !== setId) continue;
            const x = slot.container.x;
            const y = slot.container.y;
            playEffect(this.scene, 'dustImplosion', x, y, {
                color,
                scale: 1.25,
                countScale: 2,
                depth: Depths.NotificationBanner,
            });
        }
        // Reuse the level-up cue as a positive milestone sound — the
        // SFX catalogue doesn't currently have a dedicated "set built"
        // chord and a brand-new procedural recipe is overkill for this
        // pass. Mirrors how `treasure`/`shrine` cues already double up
        // for thematically adjacent events.
        this.options.sfx?.play('levelUp');
        this.showSetToast(setId);
    }

    /**
     * Centred "Set complete: {name}" notification. Drawn directly on
     * the scene so it floats above every HUD layer and tears itself
     * down 1.6 s after appearing. Toast position is anchored to
     * canvas centre so it reads regardless of which slot fired.
     */
    private showSetToast(setId: RelicSetId): void {
        const name = this.loc.t(SET_NAME_KEY[setId]);
        const text = this.loc.t('relicSetComplete', { name });
        const setColor = RelicSetHex[setId];
        const cy = this.scene.scale.height / 2 - 40;
        const toast = this.scene.add
            .text(CENTER_X, cy, text, {
                fontFamily: HUD_FONT,
                fontSize: '22px',
                color: setColor,
                stroke: HUD_STROKE,
                strokeThickness: 3,
                align: 'center',
            })
            .setOrigin(0.5)
            .setDepth(Depths.NotificationBanner + 1)
            .setAlpha(0);
        this.scene.tweens.add({
            targets: toast,
            alpha: 1,
            y: cy - 12,
            duration: 220,
            ease: 'Sine.out',
            onComplete: () => {
                this.scene.tweens.add({
                    targets: toast,
                    alpha: 0,
                    y: cy - 28,
                    delay: 1100,
                    duration: 320,
                    ease: 'Sine.in',
                    onComplete: () => toast.destroy(),
                });
            },
        });
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

/**
 * Map every set-bearing relic id to its set, or `null` for the
 * standalone curiosities (currently `dread_lantern` and
 * `cracked_focus`). Centralised here so RelicSlots can decide whether
 * to render a corner rune / counter without re-walking `RELICS[id]`.
 */
function setOf(id: RelicId): RelicSetId | null {
    switch (id) {
        case 'worn_ring':
        case 'cracked_shield':
        case 'tattered_cloak':
            return 'wanderer';
        case 'vampire_amulet':
        case 'dark_chestplate':
            return 'flesh';
        case 'knight_sword':
        case 'knight_armor':
        case 'knight_helmet':
            return 'knight';
        case 'cursed_amulet':
        case 'cursed_ring':
            return 'cursed';
        case 'greed_crown':
        case 'longinus_shard':
            return 'sin';
        default:
            return null;
    }
}
