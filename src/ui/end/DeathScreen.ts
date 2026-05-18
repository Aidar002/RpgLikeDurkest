/**
 * End-of-run overlay. The same component renders both “you died” and
 * “you escaped” outcomes — GameScene flips `runState.escaped` before
 * showing it, and most of the UI is gated on that flag.
 *
 * On escape: title + subtitle + run summary (left column) + NPC roster
 * (right column) + skill-points-bank banner + 4 permanent-upgrade
 * cards (damage/hp/defense/goldGain) + restart/reset buttons.
 *
 * On death: title + minimal copy explaining the wipe, then just a
 * restart button. No upgrade grid because `meta.resetProgress()` has
 * already wiped the bank and every upgrade.
 *
 * The screen is composed of independent layout blocks (backdrop +
 * panel, title/subtitle, skill-point banner, upgrade card grid,
 * discovery-progress rows, action button row, log popup, reset
 * confirm modal). Each block has its own `build*` helper that returns
 * the widgets it owns; {@link showDeathScreen} is the orchestrator
 * that wires them together and runs the fade-in.
 *
 * This module is intentionally kept self-contained — it's pure
 * layout/wiring with no game-state coupling beyond the
 * {@link EndScreenContext}.
 */
import * as Phaser from 'phaser';

import type { UpgradeId } from '../../systems/MetaProgressionManager';
import { EscapeHintGlow } from '../EscapeHintGlow';
import { drawCarvedPanel } from '../HudFrame';
import { BODY_FONT } from '../HudTheme';
import { createHudIcon, type IconKey } from '../HudIcons';
import { CENTER_X, CENTER_Y, Depths, GAME_HEIGHT, GAME_WIDTH } from '../Layout';
import { createStoneBackdrop } from '../StoneBackdrop';
import { drawUiButton } from '../UiButton';
import type { PanelBackground } from '../UiPanel';
import { applyPanelState, drawPanel } from '../UiPanel';
import { bankSkillPointsOnce, hideLiveContainers } from './shared';
import type { EndScreenContext } from './types';

/** Per-upgrade icon for the carved card. Mirrors the in-HUD stat
 *  glyphs so a damage upgrade reads as "sword", an HP upgrade as
 *  "heart", etc. Kept in this module so a future upgrade id only
 *  needs one map entry to inherit the same look. */
const UPGRADE_ICON: Record<UpgradeId, IconKey> = {
    damage: 'sword',
    hp: 'heart',
    defense: 'shield',
    goldGain: 'coin',
};

/**
 * Phaser GameObjects in this module need `setAlpha` so we can dim the
 * card icon when the upgrade is unaffordable; both `Image` (the
 * spritesheet path of `createHudIcon`) and `Text` (the fallback) expose
 * it, so a structural cast is enough.
 */
type DimmableIcon = Phaser.GameObjects.GameObject & {
    setDepth(d: number): unknown;
    setAlpha(value: number): unknown;
};

interface UpgradeCardVisual {
    id: UpgradeId;
    background: PanelBackground;
    textured: boolean;
    icon: DimmableIcon;
    title: Phaser.GameObjects.Text;
    level: Phaser.GameObjects.Text;
    body: Phaser.GameObjects.Text;
    cost: Phaser.GameObjects.Text;
    /** Perimeter comet that lights up when the player has enough
     *  banked points to buy this upgrade. Same widget used by the
     *  HUD escape button so the visual cue carries between screens. */
    glow: EscapeHintGlow;
    canPurchase: boolean;
}

interface MilestoneRowVisual {
    label: Phaser.GameObjects.Text;
    barBg: Phaser.GameObjects.Rectangle;
    barFill: Phaser.GameObjects.Rectangle;
    status: Phaser.GameObjects.Text;
}

interface PanelLayout {
    stoneBackdrop: Phaser.GameObjects.GameObject;
    overlay: Phaser.GameObjects.Rectangle;
    panel: Phaser.GameObjects.Container;
    panelLeft: number;
    panelTop: number;
    panelBottom: number;
    panelW: number;
}

interface HeaderWidgets {
    title: Phaser.GameObjects.Text;
    subtitle: Phaser.GameObjects.Text;
    divider1: Phaser.GameObjects.Rectangle;
}

interface BannerWidgets {
    background: PanelBackground;
    pointsLabel: Phaser.GameObjects.Text;
    pointsValue: Phaser.GameObjects.Text;
    bannerY: number;
    bannerHeight: number;
    pointsValueGold: string;
    pointsValueRed: string;
}

interface UpgradeGridResult {
    cards: UpgradeCardVisual[];
    cardsBottomY: number;
    refreshShop: () => void;
}

interface ProgressBlockWidgets {
    progressHeader: Phaser.GameObjects.Text;
    progressRows: MilestoneRowVisual[];
    divider2: Phaser.GameObjects.Rectangle;
}

interface ActionButtonsWidgets {
    restartButton: PanelBackground;
    restartText: Phaser.GameObjects.Text;
    logButton: PanelBackground;
    logButtonText: Phaser.GameObjects.Text;
    resetButton: PanelBackground | null;
    resetText: Phaser.GameObjects.Text | null;
}

/**
 * `setVisible`-only contract; matches the toggleable widgets used by
 * the log popup and the reset confirm modal. Local interface so we
 * don't take a dependency on Phaser's class hierarchy here.
 */
type Toggleable = { setVisible(v: boolean): unknown };

export function showDeathScreen(ctx: EndScreenContext) {
    const { scene, loc, tracker, player, runState } = ctx;

    hideLiveContainers(ctx);
    bankSkillPointsOnce(ctx);

    tracker.trackMax('bestDepth', runState.runBestDepth);
    tracker.trackMax('levelReached', player.stats.level);

    const escaped = runState.escaped;
    const isRu = loc.language === 'ru';

    const layout = buildBackdropAndPanel(ctx);
    const header = buildTitleAndSubtitle(ctx, escaped, layout);
    const banner = buildSkillPointsBanner(ctx, escaped, layout.panelTop);
    const grid = buildUpgradeCards(ctx, escaped, banner);
    const progress = buildDiscoveryProgress(ctx, escaped, grid.cardsBottomY, layout);
    const actions = buildActionButtons(ctx, escaped, layout.panelBottom);
    const logModal = buildLogModal(ctx, isRu);

    actions.restartButton.on('pointerdown', () => ctx.safeRestart());
    actions.logButton.on('pointerdown', () => logModal.setVisible(true));

    if (actions.resetButton && escaped) {
        buildResetConfirmModal(ctx, actions.resetButton);
    }

    grid.refreshShop();

    runEntryFadeIn(scene, layout, header, banner, progress, actions, escaped);
}

/**
 * Backdrop + carved panel that frame the whole end screen. The
 * stone-textured backdrop sits below the dimming overlay so the
 * dungeon wall still reads through the dark wash, while the carved
 * nine-slice panel reuses the same chrome as the bottom HUD bar so
 * the modal feels like part of the world rather than a flat dialog.
 *
 * Returns the panel rect (`panelLeft`/`panelTop`/`panelBottom`/
 * `panelW`) so downstream `build*` helpers can anchor their content
 * against the panel rim instead of recomputing the layout.
 */
function buildBackdropAndPanel(ctx: EndScreenContext): PanelLayout {
    const { scene } = ctx;
    // ── Backdrop + carved panel ─────────────────────────────
    // The new layout uses the same carved-stone nine-slice as the
    // bottom HUD bar so the screen reads as part of the same world,
    // not a flat dialog box. Sections (title, two-column body,
    // skill-points banner, upgrade grid, action buttons) are anchored
    // to fixed offsets from the panel rim, with the body section
    // measured dynamically so a long stat run never overlaps the
    // skill-points banner below.
    const PANEL_W = 940;
    // PANEL_H bumped 700 → 720 to absorb the larger upgrade cards
    // (+34 px) and bigger discovery progress rows. The cards drove
    // most of the change; the extra 20 px keep the bottom action
    // row from kissing the discovery section when RU labels wrap to
    // two lines (e.g. "Навык: Подготовка и уникальные реликвии").
    const PANEL_H = 720;
    const panelLeft = CENTER_X - PANEL_W / 2;
    const panelTop = CENTER_Y - PANEL_H / 2;
    const panelBottom = panelTop + PANEL_H;

    // Stone backdrop sits below the dimming overlay so the dungeon
    // wall still reads through the dark wash. Brightness is dialled
    // down so the foreground panel stays the focal point.
    const stoneBackdrop = createStoneBackdrop(scene, 0, 0, GAME_WIDTH, GAME_HEIGHT, {
        keySuffix: 'death_screen',
        seed: 0x7a1f,
        brightness: 0.7,
    }).setDepth(Depths.EndScreenOverlay - 1);
    const overlay = scene.add
        .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55)
        .setDepth(Depths.EndScreenOverlay);
    const panel = drawCarvedPanel(scene, panelLeft, panelTop, PANEL_W, PANEL_H);
    panel.setDepth(Depths.EndScreenPanel);

    return {
        stoneBackdrop,
        overlay,
        panel,
        panelLeft,
        panelTop,
        panelBottom,
        panelW: PANEL_W,
    };
}

/**
 * Title + subtitle headline pair, plus the gold rule line beneath
 * them. The headline switches copy + accent colour between the
 * "you died" and "you escaped" branches; the subtitle either shows
 * the run summary (escape) or the meta-wipe warning (death).
 */
function buildTitleAndSubtitle(
    ctx: EndScreenContext,
    escaped: boolean,
    layout: PanelLayout
): HeaderWidgets {
    const { scene, loc, tracker, runState } = ctx;
    const { panelTop, panelW } = layout;

    // ── Title ────────────────────────────────────────────────
    // The HUD escape button reuses this layout for the meta-progression
    // screen, so swap in the escape headline (and a calmer accent) when
    // the run was bailed on instead of lost.
    const titleText = escaped ? loc.t('escapeScreenTitle') : tracker.getRunTitle(loc.language);
    const titleColor = escaped ? '#c9a050' : '#d65a5a';
    const title = scene.add
        .text(CENTER_X, panelTop + 40, titleText, {
            fontFamily: BODY_FONT,
            fontSize: '28px',
            color: titleColor,
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenContent);

    // Subtitle one-liner.
    //  - On escape: depth + bosses + skill points banked.
    //  - On death: a single line warning that the entire profile was
    //    wiped (the bank and every upgrade are gone, the player starts
    //    over from scratch on the next run).
    const subtitleText = escaped
        ? loc.t('escapeRunLine', {
              depth: runState.runBestDepth,
              bosses: runState.runBossKills,
              points: runState.skillPointsBanked,
          })
        : loc.t('deathWipeLine', {
              depth: runState.runBestDepth,
              bosses: runState.runBossKills,
          });
    // Subtitle font bumped from 14 → 20 (≈ +43 %) so the run summary
    // reads at a glance against the carved-bronze backdrop. The colour
    // was nudged from `#c9a880` to a brighter parchment so the line
    // no longer reads as mid-grey on a dark panel.
    const subtitle = scene.add
        .text(CENTER_X, panelTop + 80, subtitleText, {
            fontFamily: BODY_FONT,
            fontSize: '20px',
            color: '#f0d9a0',
            align: 'center',
            wordWrap: { width: panelW - 96 },
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenContent);

    const divider1 = scene.add
        .rectangle(CENTER_X, panelTop + 108, panelW - 96, 1, 0x6a4f38, 0.6)
        .setDepth(Depths.EndScreenContent);

    return { title, subtitle, divider1 };
}

/**
 * "Очки прокачки: N" banner that sits between the title block and
 * the upgrade cards. The label + value are split into two text
 * objects so the value can switch colour (gold ↔ red) without
 * disturbing the label, and the pair is re-centred dynamically by
 * `refreshShop` after either side's width changes (locale flip /
 * digit count step).
 */
function buildSkillPointsBanner(
    ctx: EndScreenContext,
    escaped: boolean,
    panelTop: number
): BannerWidgets {
    const { scene } = ctx;

    // ── Skill-point banner + upgrade grid (escape only) ─────
    // The banner + 4 carved cards sit at the TOP of the panel so the
    // first thing the player sees after the headline is what they
    // earned and what they can spend it on. The run summary (left
    // column) and acquaintances (right column) moved BELOW the cards
    // because they're reference info, not the call to action. On a
    // death run the meta profile has already been wiped, so we hide
    // the banner + grid entirely and the body section anchors to
    // `divider1` directly.
    // Banner enlarged (34 → 44 high, font 15 → 22) per the same
    // "make it bigger and brighter" feedback that drove the card
    // tweaks below — the banked-points readout is now legible at a
    // glance instead of squinting at a 15-px parchment line.
    const BANNER_H = 44;
    const bannerY = panelTop + 108 + 16 + BANNER_H / 2;
    const skillPointsBannerHandle = drawPanel(scene, CENTER_X, bannerY, 420, BANNER_H, {
        depth: Depths.EndScreenContent,
    });
    const skillPointsBanner = skillPointsBannerHandle.background;
    skillPointsBanner.setVisible(escaped);
    // Banner text is split into a fixed gold label ("Очки прокачки:")
    // and a dynamic value glyph so the value can switch to red when
    // the player can't afford any upgrade. `refreshShop` recomputes
    // the centred layout after both `.setText` calls so the pair
    // stays visually centred regardless of locale / digit count.
    const POINTS_VALUE_GOLD = '#ffd86a';
    const POINTS_VALUE_RED = '#ff6b6b';
    const pointsLabel = scene.add
        .text(CENTER_X, bannerY, '', {
            fontFamily: BODY_FONT,
            fontSize: '22px',
            color: POINTS_VALUE_GOLD,
        })
        .setOrigin(0, 0.5)
        .setDepth(Depths.EndScreenForeground)
        .setVisible(escaped);
    const pointsValue = scene.add
        .text(CENTER_X, bannerY, '', {
            fontFamily: BODY_FONT,
            fontSize: '22px',
            color: POINTS_VALUE_GOLD,
        })
        .setOrigin(0, 0.5)
        .setDepth(Depths.EndScreenForeground)
        .setVisible(escaped);

    return {
        background: skillPointsBanner,
        pointsLabel,
        pointsValue,
        bannerY,
        bannerHeight: BANNER_H,
        pointsValueGold: POINTS_VALUE_GOLD,
        pointsValueRed: POINTS_VALUE_RED,
    };
}

/**
 * 2×2 grid of meta-upgrade cards plus the `refreshShop` closure that
 * re-renders the banner + cards after any state change (a purchase
 * or initial mount). Card click handlers invoke `meta.purchaseUpgrade`
 * and call `refreshShop` on success. On the death branch the grid is
 * skipped entirely, but the closure still runs as a no-op so the
 * caller's wiring stays uniform.
 */
function buildUpgradeCards(
    ctx: EndScreenContext,
    escaped: boolean,
    banner: BannerWidgets
): UpgradeGridResult {
    const { scene, loc, meta } = ctx;
    const { bannerY, bannerHeight, pointsLabel, pointsValue, pointsValueGold, pointsValueRed } =
        banner;

    // Upgrade cards now sit at 420×130 (was 420×96) to make room for
    // text that is roughly +40 % bigger across the board (title 22 →
    // 30, body 16 → 22, level/cost 16 → 22). The 2-line description
    // block still fits comfortably above the cost row, and the icon
    // column is unchanged so the visual identity of each card carries
    // forward unchanged.
    const CARD_W = 420;
    const CARD_H = 130;
    const CARD_GAP_X = 24;
    const CARD_GAP_Y = 18;
    const ICON_SIZE = 56;
    const ICON_OFFSET_X = 42;
    const TEXT_OFFSET_X = ICON_OFFSET_X + ICON_SIZE / 2 + 14;
    const cardsStartY = bannerY + bannerHeight / 2 + 8 + CARD_H / 2;
    const cards: UpgradeCardVisual[] = [];
    const cardPositions = [
        { x: CENTER_X - CARD_W / 2 - CARD_GAP_X / 2, y: cardsStartY },
        { x: CENTER_X + CARD_W / 2 + CARD_GAP_X / 2, y: cardsStartY },
        {
            x: CENTER_X - CARD_W / 2 - CARD_GAP_X / 2,
            y: cardsStartY + (CARD_H + CARD_GAP_Y),
        },
        {
            x: CENTER_X + CARD_W / 2 + CARD_GAP_X / 2,
            y: cardsStartY + (CARD_H + CARD_GAP_Y),
        },
    ];
    const cardsBottomY = cardsStartY + (CARD_H + CARD_GAP_Y) + CARD_H / 2;

    /**
     * Card-specific wrapper around {@link applyPanelState}. The
     * textured path overrides every state with a saturated gold tint
     * so the carved-bronze panel reads as a glowing plaque rather
     * than a charcoal placeholder — purchasable cards glow brightest,
     * unaffordable cards drop to a desaturated grey so the player can
     * see at a glance that the upgrade is out of reach, and hover
     * lifts the idle gold up to a near-white highlight. Falls back to
     * the rect-stroke states for the procedural path so headless /
     * first-frame renders still look sensible.
     */
    const applyCardState = (
        background: PanelBackground,
        state: 'idle' | 'hover' | 'disabled',
        textured: boolean
    ) => {
        if (!textured) {
            applyPanelState(background, state, textured);
            return;
        }
        const ns = background as Phaser.GameObjects.NineSlice;
        switch (state) {
            case 'idle':
                ns.setTint(0xffd866);
                break;
            case 'hover':
                ns.setTint(0xfff2b0);
                break;
            case 'disabled':
                // Desaturated grey so a card the player can't afford
                // reads as inactive next to the bright gold of the
                // affordable cards. Matches the global disabled tint
                // used by `applyPanelState` so the whole UI stays
                // visually consistent.
                ns.setTint(0x707070);
                break;
        }
    };

    const refreshShop = () => {
        if (!escaped) {
            return;
        }
        // Re-layout the points banner so the label + value pair stays
        // centred after either side changes width (e.g. switching
        // RU↔EN or stepping the digit count from `9` to `10`). The
        // value's colour flips to red iff the player has at least one
        // non-maxed upgrade and can't afford any of them — a maxed-
        // out profile keeps the gold tint because there's nothing to
        // spend on.
        const upgradeCards = meta.getUpgradeCards(loc.language);
        const hasNonMaxed = upgradeCards.some((c) => c.cost !== null);
        const anyAffordable = upgradeCards.some((c) => c.canPurchase);
        const cantAffordAny = hasNonMaxed && !anyAffordable;
        pointsLabel.setText(`${loc.t('shopSkillPointsBank')}: `);
        pointsValue.setText(`${meta.availableSkillPoints}`);
        pointsValue.setColor(cantAffordAny ? pointsValueRed : pointsValueGold);
        const pointsTotalW = pointsLabel.width + pointsValue.width;
        pointsLabel.setPosition(CENTER_X - pointsTotalW / 2, bannerY);
        pointsValue.setPosition(CENTER_X - pointsTotalW / 2 + pointsLabel.width, bannerY);

        cards.forEach((card) => {
            const info = upgradeCards.find((upgrade) => upgrade.id === card.id);
            if (!info) {
                return;
            }

            card.level.setText(`Lv ${info.level}/${info.maxLevel}`);
            card.body.setText(info.description);
            card.cost.setText(
                info.cost === null
                    ? loc.t('shopMaxLabel')
                    : `${loc.t('shopCostLabel')} ${info.cost}`
            );
            applyCardState(card.background, info.canPurchase ? 'idle' : 'disabled', card.textured);
            card.canPurchase = info.canPurchase;
            // Cost colour: green for maxed-out (no further spend
            // possible), gold when affordable, red when the player
            // can't afford the next tier — the red signal pairs with
            // the grey card body so an inaccessible upgrade reads
            // unambiguously at a glance.
            card.cost.setColor(
                info.cost === null ? '#9bf0ad' : info.canPurchase ? '#ffd86a' : '#ff6b6b'
            );
            // Affordable cards keep their bright parchment palette.
            // Unaffordable cards drop to a clearly desaturated grey
            // on every text element so the whole card reads as
            // "can't buy this yet" rather than the previous near-
            // identical bright-on-bright look. Icon alpha follows the
            // same axis — full-bright when buyable, dimmed to ~45 %
            // when not.
            card.title.setColor(info.canPurchase ? '#ffffff' : '#9a9a9a');
            card.body.setColor(info.canPurchase ? '#fff4cc' : '#8a8a8a');
            card.level.setColor(info.canPurchase ? '#fff0c0' : '#9a9a9a');
            card.icon.setAlpha(info.canPurchase ? 1 : 0.45);
            // Run the perimeter comet only when the player can
            // actually buy this upgrade — same cue the HUD uses to
            // tell them "the escape button matters right now".
            card.glow.update(info.canPurchase, true);
        });
    };

    if (!escaped) {
        return { cards, cardsBottomY, refreshShop };
    }

    meta.getUpgradeCards(loc.language).forEach((card, index) => {
        const position = cardPositions[index];
        if (!position) {
            return;
        }

        const panel = drawPanel(scene, position.x, position.y, CARD_W, CARD_H, {
            depth: Depths.EndScreenContent,
            interactive: true,
        });
        const background = panel.background;

        const iconX = position.x - CARD_W / 2 + ICON_OFFSET_X;
        const cardIcon = createHudIcon(scene, iconX, position.y, UPGRADE_ICON[card.id], {
            pixelSize: ICON_SIZE,
        }) as DimmableIcon;
        cardIcon.setDepth(Depths.EndScreenForeground);

        const textLeftX = position.x - CARD_W / 2 + TEXT_OFFSET_X;
        // Title / body / level / cost all bumped roughly +40 %
        // (22 → 30, 16 → 22) per feedback that the previous sizes
        // looked grey-on-grey-black and were hard to read. All
        // colours are fully opaque parchment / gold tones so the
        // text doesn't bleed into the (now golden) card fill.
        const cardTitle = scene.add
            .text(textLeftX, position.y - CARD_H / 2 + 16, card.title, {
                fontFamily: BODY_FONT,
                fontSize: '30px',
                color: '#ffffff',
            })
            .setDepth(Depths.EndScreenForeground);

        const cardLevel = scene.add
            .text(position.x + CARD_W / 2 - 16, position.y - CARD_H / 2 + 20, '', {
                fontFamily: BODY_FONT,
                fontSize: '22px',
                color: '#fff0c0',
            })
            .setOrigin(1, 0)
            .setDepth(Depths.EndScreenForeground);

        const cardBody = scene.add
            .text(textLeftX, position.y - CARD_H / 2 + 56, '', {
                fontFamily: BODY_FONT,
                fontSize: '22px',
                color: '#fff4cc',
                wordWrap: { width: CARD_W - TEXT_OFFSET_X - 28 },
            })
            .setDepth(Depths.EndScreenForeground);

        const cardCost = scene.add
            .text(position.x + CARD_W / 2 - 16, position.y + CARD_H / 2 - 32, '', {
                fontFamily: BODY_FONT,
                fontSize: '22px',
                color: '#ffd86a',
            })
            .setOrigin(1, 0)
            .setDepth(Depths.EndScreenForeground);

        // Perimeter comet glow — same widget as the HUD escape
        // button, parented to no container (the end-screen draws
        // straight onto the scene) and pinned just above the card
        // foreground so it never reads under the title/cost text.
        const glow = new EscapeHintGlow(
            scene,
            { x: position.x, y: position.y, width: CARD_W, height: CARD_H },
            { depth: Depths.EndScreenForeground + 1 }
        );

        const visual: UpgradeCardVisual = {
            id: card.id,
            background,
            textured: panel.textured,
            icon: cardIcon,
            title: cardTitle,
            level: cardLevel,
            body: cardBody,
            cost: cardCost,
            glow,
            canPurchase: false,
        };

        background.on('pointerover', () => {
            if (visual.canPurchase) {
                applyCardState(background, 'hover', visual.textured);
            }
        });
        background.on('pointerout', () => {
            applyCardState(background, visual.canPurchase ? 'idle' : 'disabled', visual.textured);
        });
        background.on('pointerdown', () => {
            const info = meta
                .getUpgradeCards(loc.language)
                .find((upgrade) => upgrade.id === visual.id);
            if (!info?.canPurchase) {
                return;
            }

            if (meta.purchaseUpgrade(visual.id)) {
                // No purchase particle burst: the previous gold
                // shower over the card read as visual noise and is
                // intentionally suppressed pending a redesigned
                // confirmation. The card-state repaint + SFX still
                // signal the buy without the particle spray.
                refreshShop();
            }
        });

        cards.push(visual);
    });

    return { cards, cardsBottomY, refreshShop };
}

/**
 * Per-milestone discovery progress block (escape only). One row per
 * content-unlock milestone, each with a label, a gold/blue progress
 * bar, and a `current/target` status readout. The bars scale in from
 * 0 on mount via a staggered tween. The block is suppressed entirely
 * on the death branch (`escaped === false`) — the divider above and
 * the header are still constructed but hidden so the layout stays
 * uniform.
 */
function buildDiscoveryProgress(
    ctx: EndScreenContext,
    escaped: boolean,
    cardsBottomY: number,
    layout: PanelLayout
): ProgressBlockWidgets {
    const { scene, loc, meta } = ctx;
    const { panelLeft, panelW } = layout;

    // ── Divider between cards and discovery progress (escape only) ─
    // The previous version of this screen rendered a "RUN PROGRESS"
    // / "ACQUAINTANCES" two-column block here, between the cards and
    // the discovery rows. That info now lives behind the bottom-row
    // "Log" button (a popup modal — see further below), which freed
    // up ~140 px of vertical real estate and let the discovery bars
    // both (a) move up and (b) grow significantly larger without
    // colliding with the action buttons at the bottom of the panel.
    // On death the cards aren't rendered so we hide this divider
    // too; the discovery progress block is suppressed entirely on
    // that branch.
    const divider2 = scene.add
        .rectangle(CENTER_X, cardsBottomY + 16, panelW - 96, 1, 0x6a4f38, 0.6)
        .setDepth(Depths.EndScreenContent)
        .setVisible(escaped);

    // ── Discovery progress block (escape only) ──────────────
    // One row per content-unlock milestone; each row has a label, a
    // gold/blue progress bar showing how close `highestDepthEver` /
    // `bossesKilledEver` is to the target, and a textual `current/
    // target` readout (with a `✓` for already-unlocked rows). The
    // fill scales from 0 to its real fraction on mount so the player
    // sees their progress animate in. `resetProgress` zeroes the
    // source counters, so a post-wipe escape screen will start every
    // bar at 0 again.
    //
    // Sized considerably larger than the previous iteration (bar
    // 260×6 → 340×12 → 240×12, label/status font 12 → 17, min row
    // 16 → 26) so this section reads at the same scale as the
    // upgrade cards above it. Bar width was dialled back from 340
    // to 240 after feedback that the right-anchored `current/target`
    // status text was overlapping the bar's filled end — the new
    // width leaves ~70 px of breathing room between the bar's right
    // edge and the status text even with `✓` suffixes. Anchored
    // directly to `cardsBottomY` since the two-column run-summary
    // block that used to sit between cards and bars now lives
    // behind the "Log" popup.
    const PROGRESS_HEADER_GAP = 30;
    const PROGRESS_MIN_ROW_HEIGHT = 26;
    const PROGRESS_ROW_PADDING = 8;
    const PROGRESS_LABEL_FONT = '17px';
    const PROGRESS_BAR_W = 240;
    const PROGRESS_BAR_H = 12;
    const PROGRESS_LABEL_X = panelLeft + 60;
    const PROGRESS_BAR_X = CENTER_X + 50;
    const PROGRESS_STATUS_X = panelLeft + panelW - 60;
    const progressHeaderY = cardsBottomY + PROGRESS_HEADER_GAP;
    const progressFirstRowY = progressHeaderY + 28;

    const progressHeader = scene.add
        .text(CENTER_X, progressHeaderY, loc.t('shopDiscoveryProgressHeader').toUpperCase(), {
            fontFamily: BODY_FONT,
            fontSize: '17px',
            color: '#e8d8a8',
        })
        .setOrigin(0.5, 0)
        .setDepth(Depths.EndScreenContent)
        .setVisible(escaped);

    const progressRows: MilestoneRowVisual[] = [];
    const progressEntries = escaped ? meta.getMilestoneProgressList(loc.language) : [];
    let progressCursorY = progressFirstRowY;
    progressEntries.forEach((entry, index) => {
        const label = scene.add
            .text(PROGRESS_LABEL_X, progressCursorY, entry.label, {
                fontFamily: BODY_FONT,
                fontSize: PROGRESS_LABEL_FONT,
                color: entry.unlocked ? '#fff4cc' : '#f0e0b0',
                wordWrap: { width: PROGRESS_BAR_X - PROGRESS_LABEL_X - 24 },
            })
            .setOrigin(0, 0)
            .setDepth(Depths.EndScreenContent);

        const rowH = Math.max(PROGRESS_MIN_ROW_HEIGHT, label.height);
        const centerY = progressCursorY + rowH / 2;

        const barBg = scene.add
            .rectangle(PROGRESS_BAR_X, centerY, PROGRESS_BAR_W, PROGRESS_BAR_H, 0x2a201a)
            .setStrokeStyle(1, 0x6a4f38)
            .setOrigin(0, 0.5)
            .setDepth(Depths.EndScreenContent);

        const fraction = entry.target > 0 ? Math.min(1, entry.current / entry.target) : 0;
        const barFill = scene.add
            .rectangle(
                PROGRESS_BAR_X,
                centerY,
                PROGRESS_BAR_W,
                PROGRESS_BAR_H,
                entry.unlocked ? 0xffd86a : 0x8aaedc
            )
            .setOrigin(0, 0.5)
            .setDepth(Depths.EndScreenForeground);
        barFill.scaleX = 0;
        scene.tweens.add({
            targets: barFill,
            scaleX: { from: 0, to: fraction },
            duration: 900,
            delay: 240 + index * 160,
            ease: 'Quad.out',
        });

        const statusText = entry.unlocked
            ? `${entry.current}/${entry.target}  \u2713`
            : `${entry.current}/${entry.target}`;
        const status = scene.add
            .text(PROGRESS_STATUS_X, centerY, statusText, {
                fontFamily: BODY_FONT,
                fontSize: '17px',
                color: entry.unlocked ? '#ffe092' : '#f0e0b0',
            })
            .setOrigin(1, 0.5)
            .setDepth(Depths.EndScreenContent);

        progressRows.push({ label, barBg, barFill, status });
        progressCursorY += rowH + PROGRESS_ROW_PADDING;
    });

    return { progressHeader, progressRows, divider2 };
}

/**
 * Bottom-row action buttons: restart (always), log popup toggle
 * (always), and reset profile (escape only). Listeners other than
 * the immediate restart hook are attached by the caller — that
 * keeps the button row decoupled from the log/confirm modal helpers
 * which haven't been built yet at this point in the orchestration.
 */
function buildActionButtons(
    ctx: EndScreenContext,
    escaped: boolean,
    panelBottom: number
): ActionButtonsWidgets {
    const { scene, loc, sfx } = ctx;

    // ── Action buttons (panel bottom) ───────────────────────
    // On death the reset button is suppressed: `meta.resetProgress()`
    // is fired by GameScene before this screen mounts, so the entire
    // profile (skill-points bank + every upgrade) is already wiped.
    // A second "Wipe memory" button would be a no-op confuser.
    //
    // The bottom row now hosts a third "Log" button that opens a
    // popup with the run-progress summary + acquaintances that used
    // to sit inline above the discovery bars. On escape the row is
    // [Wipe memory] [Log] [Begin new run]; on death it collapses to
    // [Log] [Begin new run].
    const buttonsY = panelBottom - 40;
    const BTN_W = 220;
    const BTN_H = 42;
    const BTN_STRIDE = BTN_W + 24; // centre-to-centre distance
    const restartUi = drawUiButton(
        scene,
        escaped ? CENTER_X + BTN_STRIDE : CENTER_X + BTN_STRIDE / 2,
        buttonsY,
        BTN_W,
        BTN_H,
        loc.t('shopBeginRun'),
        {
            variant: 'positive',
            fontSize: '17px',
            color: '#f0f0f0',
            depth: Depths.EndScreenContent,
            sfx,
        }
    );
    const restartButton = restartUi.background;
    const restartText = restartUi.label;

    const logUi = drawUiButton(
        scene,
        escaped ? CENTER_X : CENTER_X - BTN_STRIDE / 2,
        buttonsY,
        BTN_W,
        BTN_H,
        loc.t('endScreenLogButton'),
        {
            variant: 'default',
            fontSize: '17px',
            color: '#f0f0f0',
            depth: Depths.EndScreenContent,
            sfx,
        }
    );
    const logButton = logUi.background;
    const logButtonText = logUi.label;

    const resetUi = escaped
        ? drawUiButton(
              scene,
              CENTER_X - BTN_STRIDE,
              buttonsY,
              BTN_W,
              BTN_H,
              loc.t('shopResetSouls'),
              {
                  variant: 'danger',
                  fontSize: '15px',
                  color: '#ffd0d0',
                  depth: Depths.EndScreenContent,
                  sfx,
              }
          )
        : null;
    const resetButton = resetUi?.background ?? null;
    const resetText = resetUi?.label ?? null;

    return {
        restartButton,
        restartText,
        logButton,
        logButtonText,
        resetButton,
        resetText,
    };
}

/**
 * Run-progress / acquaintances popup. Built once at mount, hidden,
 * and toggled by the caller-attached `pointerdown` on the log button.
 * Both the overlay and the close button dismiss the popup. Visibility
 * is centralised in `setVisible` so the toggle handler doesn't need
 * to know about the underlying widget list.
 */
function buildLogModal(ctx: EndScreenContext, isRu: boolean): { setVisible(v: boolean): void } {
    const { scene, loc, tracker, npcs, sfx } = ctx;

    // ── Run-log popup ────────────────────────────────────────
    // Built once at mount and toggled by the Log button. Mirrors
    // the confirm-reset modal further below (overlay + carved
    // panel + close button), but renders the same two-column
    // "RUN PROGRESS" / "ACQUAINTANCES" block that used to live
    // inline on the main panel. Colours/sizes follow the bumped
    // scale the rest of this screen now uses (17 px body, opaque
    // parchment tones).
    const LOG_PANEL_W = 720;
    const LOG_PANEL_H = 520;
    const logOverlay = scene.add
        .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.76)
        .setDepth(Depths.ConfirmOverlay)
        .setInteractive();
    const logPanelHandle = drawPanel(scene, CENTER_X, CENTER_Y, LOG_PANEL_W, LOG_PANEL_H, {
        depth: Depths.ConfirmPanel,
    });
    const logPanel = logPanelHandle.background;
    const logTitle = scene.add
        .text(CENTER_X, CENTER_Y - LOG_PANEL_H / 2 + 32, loc.t('endScreenLogTitle'), {
            fontFamily: BODY_FONT,
            fontSize: '26px',
            color: '#ffd86a',
        })
        .setOrigin(0.5)
        .setDepth(Depths.ConfirmContent);

    const LOG_COL_HEADER_Y = CENTER_Y - LOG_PANEL_H / 2 + 78;
    const LOG_COL_BODY_Y = LOG_COL_HEADER_Y + 32;
    const LOG_COL_LEFT_X = CENTER_X - LOG_PANEL_W / 2 + 36;
    const LOG_COL_RIGHT_X = CENTER_X + 20;
    const LOG_COL_W = LOG_PANEL_W / 2 - 56;

    const logLeftHeader = scene.add
        .text(LOG_COL_LEFT_X, LOG_COL_HEADER_Y, isRu ? 'ПРОГРЕСС ЗАБЕГА' : 'RUN PROGRESS', {
            fontFamily: BODY_FONT,
            fontSize: '17px',
            color: '#e8d8a8',
        })
        .setDepth(Depths.ConfirmContent);

    const logRightHeader = scene.add
        .text(LOG_COL_RIGHT_X, LOG_COL_HEADER_Y, loc.t('shopAcquaintances').toUpperCase(), {
            fontFamily: BODY_FONT,
            fontSize: '17px',
            color: '#e8d8a8',
        })
        .setDepth(Depths.ConfirmContent);

    const statLines = tracker.getSummaryLines(loc.language);
    const npcLines = npcs.getMemorySummary(loc.language);

    const logLeftBody = scene.add
        .text(LOG_COL_LEFT_X, LOG_COL_BODY_Y, statLines.join('\n'), {
            fontFamily: BODY_FONT,
            fontSize: '17px',
            color: '#f0e0b0',
            align: 'left',
            lineSpacing: 6,
            wordWrap: { width: LOG_COL_W },
        })
        .setDepth(Depths.ConfirmContent);

    const logRightBodyText =
        npcLines.length > 0
            ? npcLines.join('\n')
            : isRu
              ? '— забег закончился до встреч —'
              : '— no one was met —';
    const logRightBody = scene.add
        .text(LOG_COL_RIGHT_X, LOG_COL_BODY_Y, logRightBodyText, {
            fontFamily: BODY_FONT,
            fontSize: '17px',
            color: '#f0e0b0',
            align: 'left',
            lineSpacing: 6,
            wordWrap: { width: LOG_COL_W },
        })
        .setDepth(Depths.ConfirmContent);

    const logCloseUi = drawUiButton(
        scene,
        CENTER_X,
        CENTER_Y + LOG_PANEL_H / 2 - 36,
        200,
        40,
        loc.t('endScreenLogClose'),
        {
            variant: 'dark',
            fontSize: '17px',
            color: '#f0f0f0',
            depth: Depths.ConfirmContent,
            sfx,
        }
    );
    const logCloseButton = logCloseUi.background;
    const logCloseText = logCloseUi.label;
    logCloseText.setDepth(Depths.ConfirmForeground);

    // Every widget in this list implements `setVisible`; the union
    // type matches what `confirmWidgets` uses below for the reset
    // confirmation modal so the toggle helper stays a single line.
    const logWidgets: Toggleable[] = [
        logOverlay,
        logPanel,
        logTitle,
        logLeftHeader,
        logRightHeader,
        logLeftBody,
        logRightBody,
        logCloseButton,
        logCloseText,
    ];
    logWidgets.forEach((widget) => widget.setVisible(false));
    const setVisible = (visible: boolean) => {
        logWidgets.forEach((widget) => widget.setVisible(visible));
    };
    logCloseButton.on('pointerdown', () => setVisible(false));
    logOverlay.on('pointerdown', () => setVisible(false));

    return { setVisible };
}

/**
 * "Are you sure?" reset-profile modal. Mounted only on the escape
 * branch (death already wiped the profile in `GameScene` before this
 * screen rendered). The caller passes the bottom-row reset button so
 * the modal can attach its own `pointerdown` to it; confirming fires
 * `meta.resetProgress()` then `safeRestart()`.
 */
function buildResetConfirmModal(ctx: EndScreenContext, resetButton: PanelBackground): void {
    const { scene, loc, meta, sfx } = ctx;

    // The reset confirmation modal is only mounted when the reset
    // button is on screen. On death the button is suppressed (see
    // above), so the entire confirm overlay is skipped too.
    const confirmOverlay = scene.add
        .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.76)
        .setDepth(Depths.ConfirmOverlay)
        .setInteractive();
    const confirmPanel = scene.add
        .rectangle(CENTER_X, CENTER_Y, 460, 200, 0x181818)
        .setDepth(Depths.ConfirmPanel);
    confirmPanel.setStrokeStyle(2, 0x8a4d4d);
    const confirmTitle = scene.add
        .text(CENTER_X, CENTER_Y - 50, loc.t('confirmResetTitle'), {
            fontFamily: BODY_FONT,
            fontSize: '22px',
            color: '#ffd2d2',
        })
        .setOrigin(0.5)
        .setDepth(Depths.ConfirmContent);
    const confirmBody = scene.add
        .text(CENTER_X, CENTER_Y, loc.t('confirmResetBody'), {
            fontFamily: BODY_FONT,
            fontSize: '14px',
            color: '#d6d6d6',
            align: 'center',
            lineSpacing: 8,
            wordWrap: { width: 360 },
        })
        .setOrigin(0.5)
        .setDepth(Depths.ConfirmContent);
    const confirmResetUi = drawUiButton(
        scene,
        CENTER_X - 90,
        CENTER_Y + 66,
        170,
        38,
        loc.t('shopResetConfirm'),
        {
            variant: 'danger',
            fontSize: '14px',
            color: '#ffe8e8',
            depth: Depths.ConfirmContent,
            sfx,
        }
    );
    const confirmResetButton = confirmResetUi.background;
    const confirmResetText = confirmResetUi.label;
    confirmResetText.setDepth(Depths.ConfirmForeground);
    const cancelResetUi = drawUiButton(
        scene,
        CENTER_X + 90,
        CENTER_Y + 66,
        170,
        38,
        loc.t('shopResetCancel'),
        {
            variant: 'dark',
            fontSize: '14px',
            color: '#f0f0f0',
            depth: Depths.ConfirmContent,
            sfx,
        }
    );
    const cancelResetButton = cancelResetUi.background;
    const cancelResetText = cancelResetUi.label;
    cancelResetText.setDepth(Depths.ConfirmForeground);

    const confirmWidgets: Toggleable[] = [
        confirmOverlay,
        confirmPanel,
        confirmTitle,
        confirmBody,
        confirmResetButton,
        confirmResetText,
        cancelResetButton,
        cancelResetText,
    ];
    confirmWidgets.forEach((widget) => widget.setVisible(false));

    const setConfirmVisible = (visible: boolean) => {
        confirmWidgets.forEach((widget) => widget.setVisible(visible));
    };

    resetButton.on('pointerdown', () => setConfirmVisible(true));
    cancelResetButton.on('pointerdown', () => setConfirmVisible(false));
    confirmOverlay.on('pointerdown', () => setConfirmVisible(false));
    confirmResetButton.on('pointerdown', () => {
        meta.resetProgress();
        ctx.safeRestart();
    });
}

/**
 * Soft fade-in for every widget that's visible from frame one. The
 * Log popup widgets aren't part of this list — they're toggled on
 * demand by `buildLogModal`'s `setVisible` instead, so they live
 * outside this list. `logButton`/`logButtonText` always fade in
 * alongside `restartButton`.
 */
function runEntryFadeIn(
    scene: Phaser.Scene,
    layout: PanelLayout,
    header: HeaderWidgets,
    banner: BannerWidgets,
    progress: ProgressBlockWidgets,
    actions: ActionButtonsWidgets,
    escaped: boolean
): void {
    const fadeTargets: Phaser.GameObjects.GameObject[] = [
        layout.stoneBackdrop,
        layout.overlay,
        layout.panel,
        header.title,
        header.subtitle,
        header.divider1,
        actions.restartButton,
        actions.restartText,
        actions.logButton,
        actions.logButtonText,
    ];
    if (actions.resetButton && actions.resetText) {
        fadeTargets.push(actions.resetButton, actions.resetText);
    }
    if (escaped) {
        fadeTargets.push(
            progress.divider2,
            banner.background,
            banner.pointsLabel,
            banner.pointsValue,
            progress.progressHeader
        );
        progress.progressRows.forEach((row) => {
            fadeTargets.push(row.label, row.barBg, row.barFill, row.status);
        });
    }
    scene.tweens.add({
        targets: fadeTargets,
        alpha: { from: 0, to: 1 },
        duration: 280,
        ease: 'Quad.out',
    });
}
