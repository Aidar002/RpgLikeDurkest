import * as Phaser from 'phaser';
import type { Localization } from '../systems/Localization';
import type {
    MetaProgressionManager,
    UpgradeId,
} from '../systems/MetaProgressionManager';
import type { NpcManager } from '../systems/NpcManager';
import type { PlayerManager } from '../systems/PlayerManager';
import type { RunTracker } from '../systems/RunTracker';
import type { SoundManager } from '../systems/SoundManager';
import { drawCarvedPanel } from './HudFrame';
import { CENTER_X, CENTER_Y, Depths, GAME_HEIGHT, GAME_WIDTH } from './Layout';

// End-of-run overlays: the boss-defeated victory screen and the post-death
// meta-progression shop. Both are terminal modals that hide the live scene
// containers and expose only a restart button, so they only need read access
// to scene subsystems plus two run-scoped mutable flags (prestige awarded
// tracking), passed via `runState`.

export interface RunEndState {
    runBestDepth: number;
    runBossKills: number;
    prestigeAwarded: boolean;
    prestigeReward: number;
}

export interface EndScreenContext {
    scene: Phaser.Scene;
    loc: Localization;
    sfx: SoundManager;
    meta: MetaProgressionManager;
    tracker: RunTracker;
    player: PlayerManager;
    npcs: NpcManager;
    mapContainer: Phaser.GameObjects.Container;
    roomContainer: Phaser.GameObjects.Container;
    uiContainer: Phaser.GameObjects.Container;
    runState: RunEndState;
    /** Scene restart that also tears down timers/tweens/input. */
    safeRestart: () => void;
}

interface UpgradeCardVisual {
    id: UpgradeId;
    background: Phaser.GameObjects.Rectangle;
    title: Phaser.GameObjects.Text;
    level: Phaser.GameObjects.Text;
    body: Phaser.GameObjects.Text;
    cost: Phaser.GameObjects.Text;
    canPurchase: boolean;
}

function awardPrestigeOnce(ctx: EndScreenContext) {
    if (!ctx.runState.prestigeAwarded) {
        ctx.runState.prestigeReward = ctx.meta.awardPrestigeForRun(
            ctx.runState.runBestDepth,
            ctx.runState.runBossKills
        );
        ctx.runState.prestigeAwarded = true;
    }
}

function hideLiveContainers(ctx: EndScreenContext) {
    ctx.mapContainer.setVisible(false);
    ctx.roomContainer.setVisible(false);
    ctx.uiContainer.setVisible(false);
}

export function showVictoryScreen(ctx: EndScreenContext) {
    const { scene, loc, sfx, tracker, player, runState } = ctx;

    sfx.play('victory');
    sfx.stopAmbient();
    hideLiveContainers(ctx);
    awardPrestigeOnce(ctx);

    tracker.trackMax('bestDepth', runState.runBestDepth);
    tracker.trackMax('levelReached', player.stats.level);

    const overlay = scene.add.rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.92).setDepth(Depths.EndScreenOverlay);
    const panel = scene.add.rectangle(CENTER_X, CENTER_Y, 700, 500, 0x0a0a18).setDepth(Depths.EndScreenPanel);
    panel.setStrokeStyle(2, 0x6a8fcc);

    const title = scene.add
        .text(CENTER_X, 150, loc.t('victoryScreenTitle'), {
            fontFamily: 'Courier New',
            fontSize: '32px',
            color: '#ffd36e',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenContent);

    const artifactGlow = scene.add.rectangle(CENTER_X, 280, 64, 64, 0xffd36e, 0.25).setDepth(Depths.EndScreenContent);
    const artifactIcon = scene.add
        .text(CENTER_X, 280, '\u2726', {
            fontFamily: 'Courier New',
            fontSize: '40px',
            color: '#ffd36e',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenForeground);

    scene.tweens.add({
        targets: [artifactGlow],
        alpha: { from: 0.15, to: 0.5 },
        scaleX: { from: 1, to: 1.3 },
        scaleY: { from: 1, to: 1.3 },
        duration: 1200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
    });

    const summaryBody = loc.t('victoryScreenSummary', {
        depth: runState.runBestDepth,
        bosses: runState.runBossKills,
    });
    const summaryText = scene.add
        .text(CENTER_X, 370, summaryBody, {
            fontFamily: 'Courier New',
            fontSize: '13px',
            color: '#c8cdd2',
            align: 'center',
            lineSpacing: 6,
            wordWrap: { width: 500 },
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenContent);

    const statLines = tracker.getSummaryLines(loc.language);
    const statsText = scene.add
        .text(CENTER_X, 460, statLines.join('\n'), {
            fontFamily: 'Courier New',
            fontSize: '11px',
            color: '#9a9a9a',
            align: 'center',
            lineSpacing: 3,
        })
        .setOrigin(0.5, 0)
        .setDepth(Depths.EndScreenContent);

    const restartButton = scene.add.rectangle(CENTER_X, 590, 280, 44, 0x1c2a3a).setDepth(Depths.EndScreenContent);
    restartButton.setStrokeStyle(1, 0x6a8fcc);
    restartButton.setInteractive({ useHandCursor: true });
    const restartLabel = scene.add
        .text(CENTER_X, 590, loc.t('victoryNewRun'), {
            fontFamily: 'Courier New',
            fontSize: '17px',
            color: '#f0f0f0',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenForeground);

    restartButton.on('pointerover', () => restartButton.setStrokeStyle(2, 0xffffff));
    restartButton.on('pointerout', () => restartButton.setStrokeStyle(1, 0x6a8fcc));
    restartButton.on('pointerdown', () => ctx.safeRestart());

    scene.tweens.add({
        targets: [overlay, panel, title, artifactIcon, summaryText, statsText, restartButton, restartLabel],
        alpha: { from: 0, to: 1 },
        duration: 600,
        ease: 'Quad.out',
    });
}

export function showDeathScreen(ctx: EndScreenContext) {
    const { scene, loc, meta, tracker, player, npcs, runState } = ctx;

    hideLiveContainers(ctx);
    awardPrestigeOnce(ctx);

    tracker.trackMax('bestDepth', runState.runBestDepth);
    tracker.trackMax('levelReached', player.stats.level);

    // ── Backdrop + carved panel ─────────────────────────────
    // The new layout uses the same carved-stone nine-slice as the
    // bottom HUD bar so the screen reads as part of the same world,
    // not a flat dialog box. Sections (title, two-column body,
    // prestige banner, upgrade grid, action buttons) are anchored
    // to fixed offsets from the panel rim, with the body section
    // measured dynamically so a long stat run never overlaps the
    // prestige banner below.
    const PANEL_W = 940;
    const PANEL_H = 700;
    const panelLeft = CENTER_X - PANEL_W / 2;
    const panelTop = CENTER_Y - PANEL_H / 2;
    const panelBottom = panelTop + PANEL_H;

    const overlay = scene.add
        .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.94)
        .setDepth(Depths.EndScreenOverlay);
    const panel = drawCarvedPanel(scene, panelLeft, panelTop, PANEL_W, PANEL_H);
    panel.setDepth(Depths.EndScreenPanel);

    // ── Title ────────────────────────────────────────────────
    const title = scene.add
        .text(CENTER_X, panelTop + 40, tracker.getRunTitle(loc.language), {
            fontFamily: 'Courier New',
            fontSize: '28px',
            color: '#d65a5a',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenContent);

    // Subtitle one-liner: depth | bosses | prestige.
    const subtitle = scene.add
        .text(
            CENTER_X,
            panelTop + 78,
            loc.t('deathRunLine', {
                depth: runState.runBestDepth,
                bosses: runState.runBossKills,
                prestige: runState.prestigeReward,
            }),
            {
                fontFamily: 'Courier New',
                fontSize: '14px',
                color: '#c9a880',
            },
        )
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
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#9a8a6a',
        })
        .setDepth(Depths.EndScreenContent);

    const rightHeader = scene.add
        .text(COL_RIGHT_X, COL_HEADER_Y, loc.t('shopAcquaintances').toUpperCase(), {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#9a8a6a',
        })
        .setDepth(Depths.EndScreenContent);

    const statLines = tracker.getSummaryLines(loc.language);
    const npcLines = npcs.getMemorySummary(loc.language);

    const leftBody = scene.add
        .text(COL_LEFT_X, COL_BODY_Y, statLines.join('\n'), {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#a8a09a',
            align: 'left',
            lineSpacing: 4,
            wordWrap: { width: COL_W },
        })
        .setDepth(Depths.EndScreenContent);

    const rightBodyText = npcLines.length > 0
        ? npcLines.join('\n')
        : isRu ? '— забег закончился до встреч —' : '— no one was met —';
    const rightBody = scene.add
        .text(COL_RIGHT_X, COL_BODY_Y, rightBodyText, {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#a8a09a',
            align: 'left',
            lineSpacing: 4,
            wordWrap: { width: COL_W },
        })
        .setDepth(Depths.EndScreenContent);

    // The two columns can be different heights (lots of stats, no
    // NPCs / no NPCs, lots of stats) — use the taller one as the
    // anchor for everything below.
    const bodyEndY = Math.max(
        leftBody.y + leftBody.height,
        rightBody.y + rightBody.height,
    );

    // ── Prestige banner ──────────────────────────────────────
    const divider2Y = bodyEndY + 20;
    const divider2 = scene.add
        .rectangle(CENTER_X, divider2Y, PANEL_W - 96, 1, 0x6a4f38, 0.6)
        .setDepth(Depths.EndScreenContent);
    const bannerY = divider2Y + 24;
    const prestigeBanner = scene.add
        .rectangle(CENTER_X, bannerY, 380, 34, 0x261c10, 0.95)
        .setStrokeStyle(1, 0xc9a050)
        .setDepth(Depths.EndScreenContent);
    const pointsText = scene.add
        .text(CENTER_X, bannerY, '', {
            fontFamily: 'Courier New',
            fontSize: '15px',
            color: '#ffd36e',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenForeground);

    const unlockText = scene.add
        .text(CENTER_X, bannerY + 28, '', {
            fontFamily: 'Courier New',
            fontSize: '11px',
            color: '#8fb8ff',
            align: 'center',
            wordWrap: { width: PANEL_W - 96 },
        })
        .setOrigin(0.5, 0)
        .setDepth(Depths.EndScreenContent);

    // ── Upgrade card grid (3 rows × 2 cols) ─────────────────
    const cardsStartY = bannerY + 64;
    const CARD_W = 380;
    const CARD_H = 70;
    const CARD_GAP_Y = 12;
    const cards: UpgradeCardVisual[] = [];
    const cardPositions = [
        { x: CENTER_X - CARD_W / 2 - 12, y: cardsStartY },
        { x: CENTER_X + CARD_W / 2 + 12, y: cardsStartY },
        { x: CENTER_X - CARD_W / 2 - 12, y: cardsStartY + (CARD_H + CARD_GAP_Y) },
        { x: CENTER_X + CARD_W / 2 + 12, y: cardsStartY + (CARD_H + CARD_GAP_Y) },
        { x: CENTER_X - CARD_W / 2 - 12, y: cardsStartY + 2 * (CARD_H + CARD_GAP_Y) },
        { x: CENTER_X + CARD_W / 2 + 12, y: cardsStartY + 2 * (CARD_H + CARD_GAP_Y) },
    ];

    meta.getUpgradeCards(loc.language).forEach((card, index) => {
        const position = cardPositions[index];

        const background = scene.add
            .rectangle(position.x, position.y, CARD_W, CARD_H, 0x1c1c1c)
            .setStrokeStyle(1, 0x4a4a4a)
            .setDepth(Depths.EndScreenContent)
            .setInteractive({ useHandCursor: true });

        const cardTitle = scene.add
            .text(position.x - CARD_W / 2 + 14, position.y - CARD_H / 2 + 10, card.title, {
                fontFamily: 'Courier New',
                fontSize: '15px',
                color: '#f0f0f0',
            })
            .setDepth(Depths.EndScreenForeground);

        const cardLevel = scene.add
            .text(position.x + CARD_W / 2 - 14, position.y - CARD_H / 2 + 10, '', {
                fontFamily: 'Courier New',
                fontSize: '14px',
                color: '#a8a8a8',
            })
            .setOrigin(1, 0)
            .setDepth(Depths.EndScreenForeground);

        const cardBody = scene.add
            .text(position.x - CARD_W / 2 + 14, position.y - CARD_H / 2 + 30, '', {
                fontFamily: 'Courier New',
                fontSize: '12px',
                color: '#9a9a9a',
                wordWrap: { width: CARD_W - 110 },
            })
            .setDepth(Depths.EndScreenForeground);

        const cardCost = scene.add
            .text(position.x + CARD_W / 2 - 14, position.y + CARD_H / 2 - 22, '', {
                fontFamily: 'Courier New',
                fontSize: '13px',
                color: '#ffd36e',
            })
            .setOrigin(1, 0)
            .setDepth(Depths.EndScreenForeground);

        const visual: UpgradeCardVisual = {
            id: card.id,
            background,
            title: cardTitle,
            level: cardLevel,
            body: cardBody,
            cost: cardCost,
            canPurchase: false,
        };

        background.on('pointerover', () => {
            if (visual.canPurchase) {
                background.setStrokeStyle(2, 0xffffff);
            }
        });
        background.on('pointerout', () => {
            background.setStrokeStyle(1, visual.canPurchase ? 0x8a8a8a : 0x4a4a4a);
        });
        background.on('pointerdown', () => {
            const info = meta.getUpgradeCards(loc.language).find((upgrade) => upgrade.id === visual.id);
            if (!info?.canPurchase) {
                return;
            }

            if (meta.purchaseUpgrade(visual.id)) {
                refreshShop();
            }
        });

        cards.push(visual);
    });

    // ── Action buttons (side-by-side at panel bottom) ───────
    const buttonsY = panelBottom - 40;
    const restartButton = scene.add
        .rectangle(CENTER_X + 130, buttonsY, 240, 42, 0x1f3a25)
        .setDepth(Depths.EndScreenContent);
    restartButton.setStrokeStyle(1, 0x6acb7f);
    restartButton.setInteractive({ useHandCursor: true });
    const restartText = scene.add
        .text(CENTER_X + 130, buttonsY, loc.t('shopBeginRun'), {
            fontFamily: 'Courier New',
            fontSize: '17px',
            color: '#f0f0f0',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenForeground);

    const resetButton = scene.add
        .rectangle(CENTER_X - 130, buttonsY, 240, 36, 0x3a1818)
        .setDepth(Depths.EndScreenContent);
    resetButton.setStrokeStyle(1, 0xa35a5a);
    resetButton.setInteractive({ useHandCursor: true });
    const resetText = scene.add
        .text(CENTER_X - 130, buttonsY, loc.t('shopResetSouls'), {
            fontFamily: 'Courier New',
            fontSize: '14px',
            color: '#ffd0d0',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenForeground);

    restartButton.on('pointerover', () => restartButton.setStrokeStyle(2, 0xa8e0b8));
    restartButton.on('pointerout', () => restartButton.setStrokeStyle(1, 0x6acb7f));
    restartButton.on('pointerdown', () => ctx.safeRestart());

    resetButton.on('pointerover', () => resetButton.setStrokeStyle(2, 0xffd7d7));
    resetButton.on('pointerout', () => resetButton.setStrokeStyle(1, 0xa35a5a));

    const refreshShop = () => {
        pointsText.setText(`${loc.t('shopPrestigeBank')}: ${meta.availablePrestige}`);

        const nextUnlock = meta.getNextContentUnlock();
        unlockText.setText(
            nextUnlock
                ? `${loc.t('shopNextDiscovery')}: ${loc.pick(nextUnlock.requirement)} -> ${loc.pick(nextUnlock.label)}.`
                : loc.t('shopAllUnlocked')
        );

        const upgradeCards = meta.getUpgradeCards(loc.language);
        cards.forEach((card) => {
            const info = upgradeCards.find((upgrade) => upgrade.id === card.id);
            if (!info) {
                return;
            }

            card.level.setText(`Lv ${info.level}/${info.maxLevel}`);
            card.body.setText(info.description);
            card.cost.setText(
                info.cost === null ? loc.t('shopMaxLabel') : `${loc.t('shopCostLabel')} ${info.cost}`
            );
            card.background.setFillStyle(info.canPurchase ? 0x242424 : 0x1c1c1c);
            card.background.setStrokeStyle(1, info.canPurchase ? 0x8a8a8a : 0x4a4a4a);
            card.canPurchase = info.canPurchase;
            card.cost.setColor(info.cost === null ? '#6acb7f' : info.canPurchase ? '#ffd36e' : '#6f6f6f');
            card.title.setColor(info.canPurchase ? '#f0f0f0' : '#a7a7a7');
            card.body.setColor(info.canPurchase ? '#9a9a9a' : '#727272');
        });
    };

    const confirmOverlay = scene.add
        .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.76)
        .setDepth(Depths.ConfirmOverlay)
        .setInteractive();
    const confirmPanel = scene.add.rectangle(CENTER_X, CENTER_Y, 460, 200, 0x181818).setDepth(Depths.ConfirmPanel);
    confirmPanel.setStrokeStyle(2, 0x8a4d4d);
    const confirmTitle = scene.add
        .text(CENTER_X, CENTER_Y - 50, loc.t('confirmResetTitle'), {
            fontFamily: 'Courier New',
            fontSize: '22px',
            color: '#ffd2d2',
        })
        .setOrigin(0.5)
        .setDepth(Depths.ConfirmContent);
    const confirmBody = scene.add
        .text(
            CENTER_X,
            CENTER_Y,
            loc.t('confirmResetBody'),
            {
                fontFamily: 'Courier New',
                fontSize: '14px',
                color: '#d6d6d6',
                align: 'center',
                lineSpacing: 8,
                wordWrap: { width: 360 },
            }
        )
        .setOrigin(0.5)
        .setDepth(Depths.ConfirmContent);
    const confirmResetButton = scene.add.rectangle(CENTER_X - 90, CENTER_Y + 66, 170, 38, 0x5a1d1d).setDepth(Depths.ConfirmContent);
    confirmResetButton.setStrokeStyle(1, 0xc57d7d);
    confirmResetButton.setInteractive({ useHandCursor: true });
    const confirmResetText = scene.add
        .text(CENTER_X - 90, CENTER_Y + 66, loc.t('shopResetConfirm'), {
            fontFamily: 'Courier New',
            fontSize: '14px',
            color: '#ffe8e8',
        })
        .setOrigin(0.5)
        .setDepth(Depths.ConfirmForeground);
    const cancelResetButton = scene.add.rectangle(CENTER_X + 90, CENTER_Y + 66, 170, 38, 0x252525).setDepth(Depths.ConfirmContent);
    cancelResetButton.setStrokeStyle(1, 0x8a8a8a);
    cancelResetButton.setInteractive({ useHandCursor: true });
    const cancelResetText = scene.add
        .text(CENTER_X + 90, CENTER_Y + 66, loc.t('shopResetCancel'), {
            fontFamily: 'Courier New',
            fontSize: '14px',
            color: '#f0f0f0',
        })
        .setOrigin(0.5)
        .setDepth(Depths.ConfirmForeground);

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

    refreshShop();

    scene.tweens.add({
        targets: [
            overlay,
            panel,
            title,
            subtitle,
            divider1,
            leftHeader,
            rightHeader,
            leftBody,
            rightBody,
            divider2,
            prestigeBanner,
            pointsText,
            unlockText,
            restartButton,
            restartText,
            resetButton,
            resetText,
        ],
        alpha: { from: 0, to: 1 },
        duration: 280,
        ease: 'Quad.out',
    });
}
