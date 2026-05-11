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
import { drawCarvedPanel } from '../HudFrame';
import { BODY_FONT } from '../HudTheme';
import { CENTER_X, CENTER_Y, Depths, GAME_HEIGHT, GAME_WIDTH } from '../Layout';
import { drawUiButton } from '../UiButton';
import type { PanelBackground } from '../UiPanel';
import { applyPanelState, drawPanel } from '../UiPanel';
import { bankSkillPointsOnce, hideLiveContainers } from './shared';
import type { EndScreenContext } from './types';

interface UpgradeCardVisual {
    id: UpgradeId;
    background: PanelBackground;
    textured: boolean;
    title: Phaser.GameObjects.Text;
    level: Phaser.GameObjects.Text;
    body: Phaser.GameObjects.Text;
    cost: Phaser.GameObjects.Text;
    canPurchase: boolean;
}

interface MilestoneRowVisual {
    label: Phaser.GameObjects.Text;
    barBg: Phaser.GameObjects.Rectangle;
    barFill: Phaser.GameObjects.Rectangle;
    status: Phaser.GameObjects.Text;
}

export function showDeathScreen(ctx: EndScreenContext) {
    const { scene, loc, meta, tracker, player, npcs, runState } = ctx;

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
    const PANEL_H = 700;
    const panelLeft = CENTER_X - PANEL_W / 2;
    const panelTop = CENTER_Y - PANEL_H / 2;
    const panelBottom = panelTop + PANEL_H;

    // Full-screen carved-stone backdrop — reuses the same
    // `hud_bottom_bar` nine-slice as the in-game bottom HUD, so the
    // end / meta-progression screen reads as the same world surface
    // (gold-rimmed carved panel) instead of a flat dungeon wall.
    const stoneBackdrop = drawCarvedPanel(scene, 0, 0, GAME_WIDTH, GAME_HEIGHT).setDepth(
        Depths.EndScreenOverlay - 1
    );
    // Soft dim wash over the backdrop keeps the inner panel readable
    // without competing with the carved rim around the screen edges.
    const overlay = scene.add
        .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.35)
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
    const subtitle = scene.add
        .text(CENTER_X, panelTop + 78, subtitleText, {
            fontFamily: BODY_FONT,
            fontSize: '14px',
            color: '#c9a880',
            align: 'center',
            wordWrap: { width: PANEL_W - 96 },
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenContent);

    const divider1 = scene.add
        .rectangle(CENTER_X, panelTop + 100, PANEL_W - 96, 1, 0x6a4f38, 0.6)
        .setDepth(Depths.EndScreenContent);

    // ── Two-column body (stats | acquaintances) ─────────────
    const isRu = loc.language === 'ru';
    const COL_HEADER_Y = panelTop + 116;
    const COL_BODY_Y = COL_HEADER_Y + 24;
    const COL_LEFT_X = panelLeft + 56;
    const COL_RIGHT_X = panelLeft + PANEL_W / 2 + 16;
    const COL_W = PANEL_W / 2 - 80;

    const leftHeader = scene.add
        .text(COL_LEFT_X, COL_HEADER_Y, isRu ? 'ПРОГРЕСС ЗАБЕГА' : 'RUN PROGRESS', {
            fontFamily: BODY_FONT,
            fontSize: '12px',
            color: '#9a8a6a',
        })
        .setDepth(Depths.EndScreenContent);

    const rightHeader = scene.add
        .text(COL_RIGHT_X, COL_HEADER_Y, loc.t('shopAcquaintances').toUpperCase(), {
            fontFamily: BODY_FONT,
            fontSize: '12px',
            color: '#9a8a6a',
        })
        .setDepth(Depths.EndScreenContent);

    const statLines = tracker.getSummaryLines(loc.language);
    const npcLines = npcs.getMemorySummary(loc.language);

    const leftBody = scene.add
        .text(COL_LEFT_X, COL_BODY_Y, statLines.join('\n'), {
            fontFamily: BODY_FONT,
            fontSize: '12px',
            color: '#a8a09a',
            align: 'left',
            lineSpacing: 4,
            wordWrap: { width: COL_W },
        })
        .setDepth(Depths.EndScreenContent);

    const rightBodyText =
        npcLines.length > 0
            ? npcLines.join('\n')
            : isRu
              ? '— забег закончился до встреч —'
              : '— no one was met —';
    const rightBody = scene.add
        .text(COL_RIGHT_X, COL_BODY_Y, rightBodyText, {
            fontFamily: BODY_FONT,
            fontSize: '12px',
            color: '#a8a09a',
            align: 'left',
            lineSpacing: 4,
            wordWrap: { width: COL_W },
        })
        .setDepth(Depths.EndScreenContent);

    // The two columns can be different heights (lots of stats, no
    // NPCs / no NPCs, lots of stats) — use the taller one as the
    // anchor for everything below. The previous build wrapped the
    // body section in a nested `drawTopBarPanel` sub-frame; we now
    // render the text directly on the outer carved panel so the
    // composition reads as one block instead of a card inside a card.
    const bodyEndY = Math.max(leftBody.y + leftBody.height, rightBody.y + rightBody.height);

    // ── Skill-point banner + upgrade grid (escape only) ─────
    // On a death run the meta profile has already been wiped, so we
    // hide the entire shop section and let the player just hit
    // “start over”. On an escape run we render the bank header, the 4
    // upgrade cards (damage / hp / defense / goldGain) and the
    // discovery-progress block.
    const divider2Y = bodyEndY + 20;
    const divider2 = scene.add
        .rectangle(CENTER_X, divider2Y, PANEL_W - 96, 1, 0x6a4f38, 0.6)
        .setDepth(Depths.EndScreenContent)
        .setVisible(escaped);
    const bannerY = divider2Y + 24;
    const skillPointsBannerHandle = drawPanel(scene, CENTER_X, bannerY, 380, 34, {
        depth: Depths.EndScreenContent,
    });
    const skillPointsBanner = skillPointsBannerHandle.background;
    skillPointsBanner.setVisible(escaped);
    const pointsText = scene.add
        .text(CENTER_X, bannerY, '', {
            fontFamily: BODY_FONT,
            fontSize: '15px',
            color: '#ffd36e',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenForeground)
        .setVisible(escaped);

    // ── Upgrade card grid (2 rows × 2 cols, 4 cards) ───────
    const cardsStartY = bannerY + 64;
    const CARD_W = 380;
    const CARD_H = 70;
    const CARD_GAP_Y = 12;
    const cardsBottomY = cardsStartY + (CARD_H + CARD_GAP_Y) + CARD_H / 2;
    const cards: UpgradeCardVisual[] = [];
    const cardPositions = [
        { x: CENTER_X - CARD_W / 2 - 12, y: cardsStartY },
        { x: CENTER_X + CARD_W / 2 + 12, y: cardsStartY },
        { x: CENTER_X - CARD_W / 2 - 12, y: cardsStartY + (CARD_H + CARD_GAP_Y) },
        { x: CENTER_X + CARD_W / 2 + 12, y: cardsStartY + (CARD_H + CARD_GAP_Y) },
    ];

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

            const cardTitle = scene.add
                .text(position.x - CARD_W / 2 + 14, position.y - CARD_H / 2 + 10, card.title, {
                    fontFamily: BODY_FONT,
                    fontSize: '15px',
                    color: '#f0f0f0',
                })
                .setDepth(Depths.EndScreenForeground);

            const cardLevel = scene.add
                .text(position.x + CARD_W / 2 - 14, position.y - CARD_H / 2 + 10, '', {
                    fontFamily: BODY_FONT,
                    fontSize: '14px',
                    color: '#a8a8a8',
                })
                .setOrigin(1, 0)
                .setDepth(Depths.EndScreenForeground);

            const cardBody = scene.add
                .text(position.x - CARD_W / 2 + 14, position.y - CARD_H / 2 + 30, '', {
                    fontFamily: BODY_FONT,
                    fontSize: '12px',
                    color: '#9a9a9a',
                    wordWrap: { width: CARD_W - 110 },
                })
                .setDepth(Depths.EndScreenForeground);

            const cardCost = scene.add
                .text(position.x + CARD_W / 2 - 14, position.y + CARD_H / 2 - 22, '', {
                    fontFamily: BODY_FONT,
                    fontSize: '13px',
                    color: '#ffd36e',
                })
                .setOrigin(1, 0)
                .setDepth(Depths.EndScreenForeground);

            const visual: UpgradeCardVisual = {
                id: card.id,
                background,
                textured: panel.textured,
                title: cardTitle,
                level: cardLevel,
                body: cardBody,
                cost: cardCost,
                canPurchase: false,
            };

            background.on('pointerover', () => {
                if (visual.canPurchase) {
                    applyPanelState(background, 'hover', visual.textured);
                }
            });
            background.on('pointerout', () => {
                applyPanelState(
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
                    refreshShop();
                }
            });

            cards.push(visual);
        });
    }

    // The skill-point banner + 4 upgrade cards used to live inside a
    // second `drawTopBarPanel` sub-frame. They now sit directly on
    // the outer carved panel so the screen reads as one continuous
    // block; only the dividers + the banner's own gold-rimmed
    // rectangle group the section visually.

    // ── Discovery progress block (escape only) ──────────────
    // One row per content-unlock milestone; each row has a label, a
    // gold/blue progress bar showing how close `highestDepthEver` /
    // `bossesKilledEver` is to the target, and a textual `current/
    // target` readout (with a `✓` for already-unlocked rows). The
    // fill scales from 0 to its real fraction on mount so the player
    // sees their progress animate in. `resetProgress` zeroes the
    // source counters, so a post-wipe escape screen will start every
    // bar at 0 again.
    const PROGRESS_HEADER_GAP = 22;
    // Minimum row height for single-line labels. When the localised
    // milestone label wraps to 2+ lines (e.g. RU "Навык: Подготовка и
    // уникальные реликвии") the row grows to fit the rendered text
    // height so adjacent rows don't visually overlap.
    const PROGRESS_MIN_ROW_HEIGHT = 16;
    const PROGRESS_ROW_PADDING = 4;
    const PROGRESS_LABEL_FONT = '12px';
    const PROGRESS_BAR_W = 260;
    const PROGRESS_BAR_H = 6;
    const PROGRESS_LABEL_X = panelLeft + 60;
    const PROGRESS_BAR_X = CENTER_X + 70;
    const PROGRESS_STATUS_X = panelLeft + PANEL_W - 60;
    const progressHeaderY = cardsBottomY + PROGRESS_HEADER_GAP;
    const progressFirstRowY = progressHeaderY + 18;

    const progressHeader = scene.add
        .text(CENTER_X, progressHeaderY, loc.t('shopDiscoveryProgressHeader').toUpperCase(), {
            fontFamily: BODY_FONT,
            fontSize: '12px',
            color: '#9a8a6a',
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
                color: entry.unlocked ? '#d8c89a' : '#a8a09a',
                wordWrap: { width: PROGRESS_BAR_X - PROGRESS_LABEL_X - 220 },
            })
            .setOrigin(0, 0)
            .setDepth(Depths.EndScreenContent);

        const rowH = Math.max(PROGRESS_MIN_ROW_HEIGHT, label.height);
        const centerY = progressCursorY + rowH / 2;

        const barBg = scene.add
            .rectangle(PROGRESS_BAR_X, centerY, PROGRESS_BAR_W, PROGRESS_BAR_H, 0x2a201a)
            .setStrokeStyle(1, 0x4a3a28)
            .setOrigin(0, 0.5)
            .setDepth(Depths.EndScreenContent);

        const fraction = entry.target > 0 ? Math.min(1, entry.current / entry.target) : 0;
        const barFill = scene.add
            .rectangle(
                PROGRESS_BAR_X,
                centerY,
                PROGRESS_BAR_W,
                PROGRESS_BAR_H,
                entry.unlocked ? 0xc9a050 : 0x6f8fb8
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
                fontSize: '12px',
                color: entry.unlocked ? '#ffd36e' : '#a8a09a',
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
    const buttonsY = panelBottom - 40;
    const restartUi = drawUiButton(
        scene,
        escaped ? CENTER_X + 130 : CENTER_X,
        buttonsY,
        240,
        42,
        loc.t('shopBeginRun'),
        {
            variant: 'positive',
            fontSize: '17px',
            color: '#f0f0f0',
            depth: Depths.EndScreenContent,
        }
    );
    const restartButton = restartUi.background;
    const restartText = restartUi.label;

    const resetUi = escaped
        ? drawUiButton(scene, CENTER_X - 130, buttonsY, 240, 36, loc.t('shopResetSouls'), {
              variant: 'danger',
              fontSize: '14px',
              color: '#ffd0d0',
              depth: Depths.EndScreenContent,
          })
        : null;
    const resetButton = resetUi?.background ?? null;
    const resetText = resetUi?.label ?? null;

    restartButton.on('pointerdown', () => ctx.safeRestart());

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
            applyPanelState(card.background, info.canPurchase ? 'idle' : 'disabled', card.textured);
            card.canPurchase = info.canPurchase;
            card.cost.setColor(
                info.cost === null ? '#6acb7f' : info.canPurchase ? '#ffd36e' : '#6f6f6f'
            );
            card.title.setColor(info.canPurchase ? '#f0f0f0' : '#a7a7a7');
            card.body.setColor(info.canPurchase ? '#9a9a9a' : '#727272');
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

    const fadeTargets: Phaser.GameObjects.GameObject[] = [
        stoneBackdrop,
        overlay,
        panel,
        title,
        subtitle,
        divider1,
        leftHeader,
        rightHeader,
        leftBody,
        rightBody,
        restartButton,
        restartText,
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
