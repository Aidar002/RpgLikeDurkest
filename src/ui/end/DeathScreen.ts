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
 * This module is intentionally kept dense — it's pure layout/wiring
 * with no game-state coupling beyond the {@link EndScreenContext}.
 */
import * as Phaser from 'phaser';

import type { UpgradeId } from '../../systems/MetaProgressionManager';
import { EscapeHintGlow } from '../EscapeHintGlow';
import { playEffect } from '../EffectsLibrary';
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

interface UpgradeCardVisual {
    id: UpgradeId;
    background: PanelBackground;
    textured: boolean;
    icon: Phaser.GameObjects.GameObject;
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

export function showDeathScreen(ctx: EndScreenContext) {
    const { scene, loc, sfx, meta, tracker, player, npcs, runState } = ctx;

    hideLiveContainers(ctx);
    bankSkillPointsOnce(ctx);

    tracker.trackMax('bestDepth', runState.runBestDepth);
    tracker.trackMax('levelReached', player.stats.level);

    const escaped = runState.escaped;

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
            wordWrap: { width: PANEL_W - 96 },
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenContent);

    const divider1 = scene.add
        .rectangle(CENTER_X, panelTop + 108, PANEL_W - 96, 1, 0x6a4f38, 0.6)
        .setDepth(Depths.EndScreenContent);

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
    const pointsText = scene.add
        .text(CENTER_X, bannerY, '', {
            fontFamily: BODY_FONT,
            fontSize: '22px',
            color: '#ffd86a',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenForeground)
        .setVisible(escaped);

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
    const cardsStartY = bannerY + BANNER_H / 2 + 8 + CARD_H / 2;
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
     * unaffordable cards sit at a slightly dimmer (but still gold)
     * tone, and hover lifts the idle gold up to a near-white
     * highlight. Falls back to the rect-stroke states for the
     * procedural path so headless / first-frame renders still look
     * sensible.
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
                ns.setTint(0xc8a050);
                break;
        }
    };

    if (escaped) {
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
            }) as Phaser.GameObjects.GameObject & { setDepth(d: number): unknown };
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
                applyCardState(
                    background,
                    visual.canPurchase ? 'idle' : 'disabled',
                    visual.textured
                );
            });
            background.on('pointerdown', () => {
                const info = meta
                    .getUpgradeCards(loc.language)
                    .find((upgrade) => upgrade.id === visual.id);
                if (!info?.canPurchase) {
                    return;
                }

                if (meta.purchaseUpgrade(visual.id)) {
                    // Meta-upgrade purchase VFX. A short shower of
                    // gold pieces drops over the card the player just
                    // bought; depth is pinned above the end-screen
                    // foreground so the shapes paint on top of the
                    // card chrome but underneath modal overlays
                    // (which use higher Depths.* tiers).
                    playEffect(scene, 'goldShower', position.x, position.y, {
                        depth: Depths.EndScreenForeground + 2,
                    });
                    refreshShop();
                }
            });

            cards.push(visual);
        });
    }

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
    const isRu = loc.language === 'ru';
    const divider2 = scene.add
        .rectangle(CENTER_X, cardsBottomY + 16, PANEL_W - 96, 1, 0x6a4f38, 0.6)
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
    // 260×6 → 340×12, label/status font 12 → 17, min row 16 → 26)
    // so this section reads at the same scale as the upgrade cards
    // above it. Anchored directly to `cardsBottomY` since the
    // two-column run-summary block that used to sit between cards
    // and bars now lives behind the "Log" popup.
    const PROGRESS_HEADER_GAP = 30;
    const PROGRESS_MIN_ROW_HEIGHT = 26;
    const PROGRESS_ROW_PADDING = 8;
    const PROGRESS_LABEL_FONT = '17px';
    const PROGRESS_BAR_W = 340;
    const PROGRESS_BAR_H = 12;
    const PROGRESS_LABEL_X = panelLeft + 60;
    const PROGRESS_BAR_X = CENTER_X + 50;
    const PROGRESS_STATUS_X = panelLeft + PANEL_W - 60;
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

    restartButton.on('pointerdown', () => ctx.safeRestart());

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
    type Toggleable = {
        setVisible(v: boolean): unknown;
    };
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
    const setLogVisible = (visible: boolean) => {
        logWidgets.forEach((widget) => widget.setVisible(visible));
    };
    logButton.on('pointerdown', () => setLogVisible(true));
    logCloseButton.on('pointerdown', () => setLogVisible(false));
    logOverlay.on('pointerdown', () => setLogVisible(false));

    const refreshShop = () => {
        if (!escaped) {
            return;
        }
        pointsText.setText(`${loc.t('shopSkillPointsBank')}: ${meta.availableSkillPoints}`);

        const upgradeCards = meta.getUpgradeCards(loc.language);
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
            card.cost.setColor(
                info.cost === null ? '#9bf0ad' : info.canPurchase ? '#ffd86a' : '#e8c878'
            );
            // Solid, fully-opaque text colours for both states. The
            // previous mid-grey tones (#c8c0a8 disabled title,
            // #a89c80 disabled body/level) read like translucent text
            // on the dark panel fill; both states now use bright
            // parchment shades so a maxed-out / unaffordable card is
            // still easy to read.
            card.title.setColor('#ffffff');
            card.body.setColor(info.canPurchase ? '#fff4cc' : '#f0e0b0');
            card.level.setColor(info.canPurchase ? '#fff0c0' : '#e8d8a8');
            // Run the perimeter comet only when the player can
            // actually buy this upgrade — same cue the HUD uses to
            // tell them "the escape button matters right now".
            card.glow.update(info.canPurchase, true);
        });
    };

    // The reset confirmation modal is only mounted when the reset
    // button is on screen. On death the button is suppressed (see
    // above), so the entire confirm overlay is skipped too.
    if (resetButton && escaped) {
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

        const confirmWidgets = [
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

    refreshShop();

    // The Log popup widgets aren't part of the entry fade — they're
    // toggled on demand by `setLogVisible` instead, so they live
    // outside this list. `logButton`/`logButtonText` always fade in
    // alongside `restartButton`.
    const fadeTargets: Phaser.GameObjects.GameObject[] = [
        stoneBackdrop,
        overlay,
        panel,
        title,
        subtitle,
        divider1,
        restartButton,
        restartText,
        logButton,
        logButtonText,
    ];
    if (resetButton && resetText) {
        fadeTargets.push(resetButton, resetText);
    }
    if (escaped) {
        fadeTargets.push(divider2, skillPointsBanner, pointsText, progressHeader);
        progressRows.forEach((row) => {
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
