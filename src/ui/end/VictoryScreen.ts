/**
 * Victory overlay shown after the player defeats the final boss and
 * collects the artifact. Single-screen modal: title, animated artifact
 * glyph, summary stats, restart button. Banks any pending skill points
 * exactly once (escape-only, idempotent via `bankSkillPointsOnce`) and
 * tracks per-run max stats before the scene resets.
 */
import { CENTER_X, CENTER_Y, Depths, GAME_HEIGHT, GAME_WIDTH } from '../Layout';
import { createStoneBackdrop } from '../StoneBackdrop';
import { drawUiButton } from '../UiButton';
import { BODY_FONT } from '../HudTheme';
import { bankSkillPointsOnce, hideLiveContainers } from './shared';
import type { EndScreenContext } from './types';

export function showVictoryScreen(ctx: EndScreenContext) {
    const { scene, loc, sfx, tracker, player, runState } = ctx;

    sfx.play('victory');
    sfx.stopAmbient();
    hideLiveContainers(ctx);
    bankSkillPointsOnce(ctx);

    tracker.trackMax('bestDepth', runState.runBestDepth);
    tracker.trackMax('levelReached', player.stats.level);

    // Stone backdrop sits below the dimming overlay so the dungeon
    // wall reads through the dark wash. Different seed than the death
    // screen so the two don't repeat the same brick layout.
    createStoneBackdrop(scene, 0, 0, GAME_WIDTH, GAME_HEIGHT, {
        keySuffix: 'victory_screen',
        seed: 0x1c8d,
        brightness: 0.7,
    }).setDepth(Depths.EndScreenOverlay - 1);
    const overlay = scene.add
        .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55)
        .setDepth(Depths.EndScreenOverlay);
    const panel = scene.add
        .rectangle(CENTER_X, CENTER_Y, 700, 500, 0x0a0a18)
        .setDepth(Depths.EndScreenPanel);
    panel.setStrokeStyle(2, 0x6a8fcc);

    const titleKey = runState.escaped ? 'escapeScreenTitle' : 'victoryScreenTitle';
    const summaryKey = runState.escaped ? 'escapeScreenSummary' : 'victoryScreenSummary';

    const title = scene.add
        .text(CENTER_X, 150, loc.t(titleKey), {
            fontFamily: BODY_FONT,
            fontSize: '32px',
            color: '#ffd36e',
        })
        .setOrigin(0.5)
        .setDepth(Depths.EndScreenContent);

    const artifactGlow = scene.add
        .rectangle(CENTER_X, 280, 64, 64, 0xffd36e, 0.25)
        .setDepth(Depths.EndScreenContent);
    const artifactIcon = scene.add
        .text(CENTER_X, 280, '\u2726', {
            fontFamily: BODY_FONT,
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

    const summaryBody = loc.t(summaryKey, {
        depth: runState.runBestDepth,
        bosses: runState.runBossKills,
    });
    const summaryText = scene.add
        .text(CENTER_X, 370, summaryBody, {
            fontFamily: BODY_FONT,
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
            fontFamily: BODY_FONT,
            fontSize: '11px',
            color: '#9a9a9a',
            align: 'center',
            lineSpacing: 3,
        })
        .setOrigin(0.5, 0)
        .setDepth(Depths.EndScreenContent);

    const restartUi = drawUiButton(scene, CENTER_X, 590, 280, 44, loc.t('victoryNewRun'), {
        variant: 'gold',
        fontSize: '17px',
        color: '#f0f0f0',
        depth: Depths.EndScreenContent,
    });
    const restartButton = restartUi.background;
    const restartLabel = restartUi.label;
    restartLabel.setDepth(Depths.EndScreenForeground);

    restartButton.on('pointerdown', () => ctx.safeRestart());

    scene.tweens.add({
        targets: [
            overlay,
            panel,
            title,
            artifactIcon,
            summaryText,
            statsText,
            restartButton,
            restartLabel,
        ],
        alpha: { from: 0, to: 1 },
        duration: 600,
        ease: 'Quad.out',
    });
}
