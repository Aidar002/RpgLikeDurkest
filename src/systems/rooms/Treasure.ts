import { ROOM_CONFIG } from '../../data/GameConfig';
import { defaultRng, randomInt, chance } from '../Rng';
import type { GameScene } from '../../scenes/GameScene';

export function handleTreasureRoom(scene: GameScene): void {
    const goldUnlocked = scene.meta.isUnlocked('currency_gold');
    const xpGained = scene.player.gainXp(ROOM_CONFIG.treasure.xpReward);

    let goldGained = 0;
    let potionGained = 0;
    if (goldUnlocked) {
        goldGained = scene.player.gainGold(randomInt(defaultRng, ROOM_CONFIG.treasure.goldMin, ROOM_CONFIG.treasure.goldMax));
        if (goldGained > 0) scene.tracker.record('goldEarned', goldGained);
        if (scene.player.isPotionUnlocked && chance(defaultRng, ROOM_CONFIG.treasure.potionChance)) {
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
        scene.loc.t('roomTreasureHint'),
        'TREASURE'
    );
    scene.log.addMessage(scene.loc.t('treasureSecured', { parts: rewardParts.join(', ') }), '#f7d46b');
    scene.sfx.play('treasure');
    scene.maybeDropRelic('treasure');
    scene.showReturnButton();
}
