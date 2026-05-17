import { LOCKPICK_CONFIG, ROOM_CONFIG } from '../../data/GameConfig';
import { pickLockpickDifficulty } from '../Lockpick';
import { chance, defaultRng, randomInt } from '../Rng';
import type { GameScene } from '../../scenes/GameScene';

export function handleTreasureRoom(scene: GameScene): void {
    // Roll for a locked chest first. Locked chests show a "Lockpick /
    // Leave" prompt; only the lockpick-success path falls through to
    // the regular reward flow.
    if (chance(defaultRng, LOCKPICK_CONFIG.lockedChance)) {
        presentLockedChest(scene);
        return;
    }
    grantTreasureRewards(scene);
    scene.showReturnButton();
}

/**
 * Locked-chest variant: show the chest card with a different
 * flavour line, give the player the choice to attempt the lockpick
 * mini-game (one shot, costs HP on failure) or walk away empty-handed.
 */
function presentLockedChest(scene: GameScene): void {
    scene.showRoomCard(
        scene.loc.t('treasure'),
        scene.loc.t('roomTreasureLockedName'),
        scene.loc.t('roomTreasureLockedDesc'),
        0x6d4a18,
        '$',
        'TREASURE'
    );

    scene.roomButtons.setActions([
        {
            label: scene.loc.t('actionLockpickAttempt'),
            callback: () => onAttemptLockpick(scene),
            variant: 'gold',
        },
        {
            label: scene.loc.t('actionLockpickLeave'),
            callback: () => onLeaveChest(scene),
            variant: 'dark',
        },
    ]);
}

function onAttemptLockpick(scene: GameScene): void {
    const difficulty = pickLockpickDifficulty(scene.dungeon.currentDepth, defaultRng);
    scene.log.addMessage(scene.loc.t('lockpickStart'), '#d4b070');
    scene.showLockpickModal({
        difficulty,
        onResolve: (result) => {
            if (result === 'success') {
                scene.log.addMessage(scene.loc.t('lockpickSuccess'), '#86d49a');
                grantTreasureRewards(scene);
                if (scene.player.stats.hp > 0) {
                    scene.showReturnButton();
                }
            } else if (result === 'failure') {
                const damage = scene.applyTrapDamage(LOCKPICK_CONFIG.failureDamage);
                scene.sfx.play('lockpickBreak');
                scene.log.addMessage(scene.loc.t('lockpickFailure', { damage }), '#ff7777');
                if (scene.player.stats.hp > 0) {
                    scene.showReturnButton();
                }
            } else {
                // 'leave' from inside the modal — treat the same as
                // backing out via the room button.
                onLeaveChest(scene);
            }
        },
    });
}

function onLeaveChest(scene: GameScene): void {
    scene.log.addMessage(scene.loc.t('lockpickLeft'), '#a09898');
    scene.showReturnButton();
}

/** The original "unlocked chest" reward flow, factored out so the
 *  lockpick-success path can call it after a successful pick. */
function grantTreasureRewards(scene: GameScene): void {
    const goldUnlocked = scene.meta.isUnlocked('currency_gold');
    const xpGained = scene.player.gainXp(ROOM_CONFIG.treasure.xpReward);

    let goldGained = 0;
    let potionGained = 0;
    if (goldUnlocked) {
        goldGained = scene.player.gainGold(
            randomInt(defaultRng, ROOM_CONFIG.treasure.goldMin, ROOM_CONFIG.treasure.goldMax)
        );
        if (goldGained > 0) scene.tracker.record('goldEarned', goldGained);
        if (chance(defaultRng, ROOM_CONFIG.treasure.potionChance)) {
            potionGained = scene.player.gainPotions(1);
        }
    }

    const rewardParts = [scene.loc.t('plusXp', { value: xpGained })];
    if (goldGained > 0) {
        rewardParts.push(scene.loc.t('plusGold', { value: goldGained }));
    }
    if (potionGained > 0) {
        rewardParts.push(scene.loc.t('plusPotion'));
    }

    scene.showRoomCard(
        scene.loc.t('treasure'),
        scene.loc.t('roomTreasureName'),
        scene.loc.t('roomTreasureDesc', { value: rewardParts.join(', ') }),
        0x8d6a21,
        '$',
        'TREASURE'
    );
    scene.log.addMessage(
        scene.loc.t('treasureSecured', { parts: rewardParts.join(', ') }),
        '#f7d46b'
    );
    scene.sfx.play('treasure');
    scene.maybeDropRelic('treasure');
}
