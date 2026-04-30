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
    /** The localized-text picker from GameScene (two-string helper). */
    tr: (ru: string, en: string) => string;
}

interface UpgradeCardVisual {
    id: UpgradeId;
    background: Phaser.GameObjects.Rectangle;
    title: Phaser.GameObjects.Text;
    level: Phaser.GameObjects.Text;
    body: Phaser.GameObjects.Text;
    cost: Phaser.GameObjects.Text;
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

    const overlay = scene.add.rectangle(400, 300, 800, 600, 0x000000, 0.92).setDepth(100);
    const panel = scene.add.rectangle(400, 300, 620, 420, 0x0a0a18).setDepth(101);
    panel.setStrokeStyle(2, 0x6a8fcc);

    const title = scene.add
        .text(400, 100, loc.t('victoryScreenTitle'), {
            fontFamily: 'Courier New',
            fontSize: '32px',
            color: '#ffd36e',
        })
        .setOrigin(0.5)
        .setDepth(102);

    const artifactGlow = scene.add.rectangle(400, 230, 64, 64, 0xffd36e, 0.25).setDepth(102);
    const artifactIcon = scene.add
        .text(400, 230, '\u2726', {
            fontFamily: 'Courier New',
            fontSize: '40px',
            color: '#ffd36e',
        })
        .setOrigin(0.5)
        .setDepth(103);

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
        .text(400, 300, summaryBody, {
            fontFamily: 'Courier New',
            fontSize: '13px',
            color: '#c8cdd2',
            align: 'center',
            lineSpacing: 6,
            wordWrap: { width: 500 },
        })
        .setOrigin(0.5)
        .setDepth(102);

    const statLines = tracker.getSummaryLines(loc.language);
    const statsText = scene.add
        .text(400, 380, statLines.join('\n'), {
            fontFamily: 'Courier New',
            fontSize: '11px',
            color: '#9a9a9a',
            align: 'center',
            lineSpacing: 3,
        })
        .setOrigin(0.5, 0)
        .setDepth(102);

    const restartButton = scene.add.rectangle(400, 510, 260, 42, 0x1c2a3a).setDepth(102);
    restartButton.setStrokeStyle(1, 0x6a8fcc);
    restartButton.setInteractive({ useHandCursor: true });
    const restartLabel = scene.add
        .text(400, 510, loc.t('victoryNewRun'), {
            fontFamily: 'Courier New',
            fontSize: '17px',
            color: '#f0f0f0',
        })
        .setOrigin(0.5)
        .setDepth(103);

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
    const { scene, loc, meta, tracker, player, npcs, runState, tr } = ctx;

    hideLiveContainers(ctx);
    awardPrestigeOnce(ctx);

    tracker.trackMax('bestDepth', runState.runBestDepth);
    tracker.trackMax('levelReached', player.stats.level);

    const overlay = scene.add.rectangle(400, 300, 800, 600, 0x000000, 0.92).setDepth(100);
    const panel = scene.add.rectangle(400, 300, 736, 530, 0x121212).setDepth(101);
    panel.setStrokeStyle(2, 0x5a2f2f);

    const title = scene.add
        .text(400, 56, tracker.getRunTitle(loc.language), {
            fontFamily: 'Courier New',
            fontSize: '28px',
            color: '#d65a5a',
        })
        .setOrigin(0.5)
        .setDepth(102);

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
        ...(npcLines.length > 0 ? ['', tr('— Встреченные —', '— Acquaintances —'), ...npcLines] : []),
    ];
    const summary = scene.add
        .text(400, 88, allLines.join('\n'), {
            fontFamily: 'Courier New',
            fontSize: '11px',
            color: '#9a9a9a',
            align: 'center',
            lineSpacing: 3,
        })
        .setOrigin(0.5, 0)
        .setDepth(102);

    const pointsText = scene.add
        .text(400, 228, '', {
            fontFamily: 'Courier New',
            fontSize: '16px',
            color: '#ffd36e',
        })
        .setOrigin(0.5)
        .setDepth(102);

    const unlockText = scene.add
        .text(400, 250, '', {
            fontFamily: 'Courier New',
            fontSize: '11px',
            color: '#8fb8ff',
            align: 'center',
            wordWrap: { width: 580 },
        })
        .setOrigin(0.5)
        .setDepth(102);

    const cards: UpgradeCardVisual[] = [];
    const cardPositions = [
        { x: 230, y: 304 },
        { x: 570, y: 304 },
        { x: 230, y: 382 },
        { x: 570, y: 382 },
        { x: 230, y: 460 },
        { x: 570, y: 460 },
    ];

    meta.getUpgradeCards(loc.language).forEach((card, index) => {
        const position = cardPositions[index];

        const background = scene.add
            .rectangle(position.x, position.y, 300, 68, 0x1c1c1c)
            .setStrokeStyle(1, 0x4a4a4a)
            .setDepth(102)
            .setInteractive({ useHandCursor: true });

        const cardTitle = scene.add
            .text(position.x - 136, position.y - 22, card.title, {
                fontFamily: 'Courier New',
                fontSize: '15px',
                color: '#f0f0f0',
            })
            .setDepth(103);

        const cardLevel = scene.add
            .text(position.x + 136, position.y - 22, '', {
                fontFamily: 'Courier New',
                fontSize: '14px',
                color: '#a8a8a8',
            })
            .setOrigin(1, 0)
            .setDepth(103);

        const cardBody = scene.add
            .text(position.x - 136, position.y - 2, '', {
                fontFamily: 'Courier New',
                fontSize: '12px',
                color: '#9a9a9a',
                wordWrap: { width: 220 },
            })
            .setDepth(103);

        const cardCost = scene.add
            .text(position.x + 136, position.y + 14, '', {
                fontFamily: 'Courier New',
                fontSize: '13px',
                color: '#ffd36e',
            })
            .setOrigin(1, 0)
            .setDepth(103);

        const visual: UpgradeCardVisual = {
            id: card.id,
            background,
            title: cardTitle,
            level: cardLevel,
            body: cardBody,
            cost: cardCost,
        };

        background.on('pointerover', () => {
            if ((background as unknown as { canPurchase?: boolean }).canPurchase) {
                background.setStrokeStyle(2, 0xffffff);
            }
        });
        background.on('pointerout', () => {
            const canPurchase = (background as unknown as { canPurchase?: boolean }).canPurchase;
            background.setStrokeStyle(1, canPurchase ? 0x8a8a8a : 0x4a4a4a);
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

    const restartButton = scene.add.rectangle(400, 548, 260, 42, 0x2b2b2b).setDepth(102);
    restartButton.setStrokeStyle(1, 0x8a8a8a);
    restartButton.setInteractive({ useHandCursor: true });
    const restartText = scene.add
        .text(400, 548, tr('Новый забег', 'Begin New Expedition'), {
            fontFamily: 'Courier New',
            fontSize: '17px',
            color: '#f0f0f0',
        })
        .setOrigin(0.5)
        .setDepth(103);

    const resetButton = scene.add.rectangle(400, 592, 260, 34, 0x3a1818).setDepth(102);
    resetButton.setStrokeStyle(1, 0xa35a5a);
    resetButton.setInteractive({ useHandCursor: true });
    const resetText = scene.add
        .text(400, 592, tr('Стереть память', 'Reset soul progress'), {
            fontFamily: 'Courier New',
            fontSize: '14px',
            color: '#ffd0d0',
        })
        .setOrigin(0.5)
        .setDepth(103);

    restartButton.on('pointerover', () => restartButton.setStrokeStyle(2, 0xffffff));
    restartButton.on('pointerout', () => restartButton.setStrokeStyle(1, 0x8a8a8a));
    restartButton.on('pointerdown', () => ctx.safeRestart());

    resetButton.on('pointerover', () => resetButton.setStrokeStyle(2, 0xffd7d7));
    resetButton.on('pointerout', () => resetButton.setStrokeStyle(1, 0xa35a5a));

    const refreshShop = () => {
        pointsText.setText(`${tr('Запас престижа', 'Prestige bank')}: ${meta.availablePrestige}`);

        const nextUnlock = meta.getNextContentUnlock();
        unlockText.setText(
            nextUnlock
                ? `${tr('Следующее открытие', 'Next permanent discovery')}: ${loc.pick(nextUnlock.requirement)} -> ${loc.pick(nextUnlock.label)}.`
                : tr(
                      'Все постоянные открытия уже закреплены.',
                      'Every planned layer of permanent content has been unlocked.'
                  )
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
                info.cost === null ? tr('МАКС', 'MAX') : `${tr('Цена', 'Cost')} ${info.cost}`
            );
            card.background.setFillStyle(info.canPurchase ? 0x242424 : 0x1c1c1c);
            card.background.setStrokeStyle(1, info.canPurchase ? 0x8a8a8a : 0x4a4a4a);
            (card.background as unknown as { canPurchase?: boolean }).canPurchase = info.canPurchase;
            card.cost.setColor(info.cost === null ? '#6acb7f' : info.canPurchase ? '#ffd36e' : '#6f6f6f');
            card.title.setColor(info.canPurchase ? '#f0f0f0' : '#a7a7a7');
            card.body.setColor(info.canPurchase ? '#9a9a9a' : '#727272');
        });
    };

    const confirmOverlay = scene.add
        .rectangle(400, 300, 800, 600, 0x000000, 0.76)
        .setDepth(110)
        .setInteractive();
    const confirmPanel = scene.add.rectangle(400, 300, 430, 190, 0x181818).setDepth(111);
    confirmPanel.setStrokeStyle(2, 0x8a4d4d);
    const confirmTitle = scene.add
        .text(400, 244, 'Стереть весь прогресс?', {
            fontFamily: 'Courier New',
            fontSize: '22px',
            color: '#ffd2d2',
        })
        .setOrigin(0.5)
        .setDepth(112);
    const confirmBody = scene.add
        .text(
            400,
            290,
            'Это сотрёт престиж, открытия и улучшения.\nСледующий забег начнётся с пустой памяти.',
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
        .setDepth(112);
    const confirmResetButton = scene.add.rectangle(320, 358, 170, 38, 0x5a1d1d).setDepth(112);
    confirmResetButton.setStrokeStyle(1, 0xc57d7d);
    confirmResetButton.setInteractive({ useHandCursor: true });
    const confirmResetText = scene.add
        .text(320, 358, tr('Да, удалить всё', 'Yes, delete everything'), {
            fontFamily: 'Courier New',
            fontSize: '14px',
            color: '#ffe8e8',
        })
        .setOrigin(0.5)
        .setDepth(113);
    const cancelResetButton = scene.add.rectangle(480, 358, 170, 38, 0x252525).setDepth(112);
    cancelResetButton.setStrokeStyle(1, 0x8a8a8a);
    cancelResetButton.setInteractive({ useHandCursor: true });
    const cancelResetText = scene.add
        .text(480, 358, tr('Отмена', 'Cancel'), {
            fontFamily: 'Courier New',
            fontSize: '14px',
            color: '#f0f0f0',
        })
        .setOrigin(0.5)
        .setDepth(113);

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
