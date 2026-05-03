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

    const overlay = scene.add.rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.92).setDepth(Depths.EndScreenOverlay);
    const panel = scene.add.rectangle(CENTER_X, CENTER_Y, 820, 640, 0x121212).setDepth(Depths.EndScreenPanel);
    panel.setStrokeStyle(2, 0x5a2f2f);

    const title = scene.add
        .text(CENTER_X, 66, tracker.getRunTitle(loc.language), {
            fontFamily: 'Courier New',
            fontSize: '28px',
            color: '#d65a5a',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenContent);

    const summaryLines = [
        loc.t('deathRunLine', {
            depth: runState.runBestDepth,
            bosses: runState.runBossKills,
            prestige: runState.prestigeReward,
        }),
    ];
    const statLines = tracker.getSummaryLines(loc.language);
    const npcLines = npcs.getMemorySummary(loc.language);
    const allLines = [
        ...summaryLines,
        ...statLines,
        ...(npcLines.length > 0 ? ['', loc.t('shopAcquaintances'), ...npcLines] : []),
    ];
    const summary = scene.add
        .text(CENTER_X, 100, allLines.join('\n'), {
            fontFamily: 'Courier New',
            fontSize: '11px',
            color: '#9a9a9a',
            align: 'center',
            lineSpacing: 3,
        })
        .setOrigin(0.5, 0)
        .setDepth(Depths.EndScreenContent);

    const pointsText = scene.add
        .text(CENTER_X, 260, '', {
            fontFamily: 'Courier New',
            fontSize: '16px',
            color: '#ffd36e',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenContent);

    const unlockText = scene.add
        .text(CENTER_X, 286, '', {
            fontFamily: 'Courier New',
            fontSize: '11px',
            color: '#8fb8ff',
            align: 'center',
            wordWrap: { width: 580 },
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenContent);

    const cards: UpgradeCardVisual[] = [];
    const cardPositions = [
        { x: CENTER_X - 180, y: 340 },
        { x: CENTER_X + 180, y: 340 },
        { x: CENTER_X - 180, y: 420 },
        { x: CENTER_X + 180, y: 420 },
        { x: CENTER_X - 180, y: 500 },
        { x: CENTER_X + 180, y: 500 },
    ];

    meta.getUpgradeCards(loc.language).forEach((card, index) => {
        const position = cardPositions[index];

        const background = scene.add
            .rectangle(position.x, position.y, 300, 68, 0x1c1c1c)
            .setStrokeStyle(1, 0x4a4a4a)
            .setDepth(Depths.EndScreenContent)
            .setInteractive({ useHandCursor: true });

        const cardTitle = scene.add
            .text(position.x - 136, position.y - 22, card.title, {
                fontFamily: 'Courier New',
                fontSize: '15px',
                color: '#f0f0f0',
            })
            .setDepth(Depths.EndScreenForeground);

        const cardLevel = scene.add
            .text(position.x + 136, position.y - 22, '', {
                fontFamily: 'Courier New',
                fontSize: '14px',
                color: '#a8a8a8',
            })
            .setOrigin(1, 0)
            .setDepth(Depths.EndScreenForeground);

        const cardBody = scene.add
            .text(position.x - 136, position.y - 2, '', {
                fontFamily: 'Courier New',
                fontSize: '12px',
                color: '#9a9a9a',
                wordWrap: { width: 220 },
            })
            .setDepth(Depths.EndScreenForeground);

        const cardCost = scene.add
            .text(position.x + 136, position.y + 14, '', {
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

    const restartButton = scene.add.rectangle(CENTER_X, 590, 280, 44, 0x2b2b2b).setDepth(Depths.EndScreenContent);
    restartButton.setStrokeStyle(1, 0x8a8a8a);
    restartButton.setInteractive({ useHandCursor: true });
    const restartText = scene.add
        .text(CENTER_X, 590, loc.t('shopBeginRun'), {
            fontFamily: 'Courier New',
            fontSize: '17px',
            color: '#f0f0f0',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenForeground);

    const resetButton = scene.add.rectangle(CENTER_X, 640, 280, 36, 0x3a1818).setDepth(Depths.EndScreenContent);
    resetButton.setStrokeStyle(1, 0xa35a5a);
    resetButton.setInteractive({ useHandCursor: true });
    const resetText = scene.add
        .text(CENTER_X, 640, loc.t('shopResetSouls'), {
            fontFamily: 'Courier New',
            fontSize: '14px',
            color: '#ffd0d0',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenForeground);

    restartButton.on('pointerover', () => restartButton.setStrokeStyle(2, 0xffffff));
    restartButton.on('pointerout', () => restartButton.setStrokeStyle(1, 0x8a8a8a));
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
            summary,
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
