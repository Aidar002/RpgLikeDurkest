import { ROOM_CONFIG } from '../../data/GameConfig';
import { presentNpcRoom } from './Encounter';
import type { GameScene, RoomButtonAction } from '../../scenes/GameScene';

export function handleMerchantRoom(scene: GameScene): void {
    scene.sfx.play('merchant');
    scene.tracker.record('merchantsVisited');
    const npcId = scene.npcs.pickForRole('merchant', scene.dungeon.currentDepth);
    if (npcId) {
        presentNpcRoom(scene, npcId, scene.loc.t('merchant'));
        return;
    }
    showGenericMerchantOptions(scene);
}

function showGenericMerchantOptions(scene: GameScene): void {
    const actions: RoomButtonAction[] = [
        {
            label: scene.loc.t('actionBuyPotion', { cost: ROOM_CONFIG.merchant.potionCost }),
            callback: () => {
                if (!scene.player.spendGold(ROOM_CONFIG.merchant.potionCost)) {
                    return;
                }
                scene.tracker.record('goldSpent', ROOM_CONFIG.merchant.potionCost);
                scene.player.gainPotions(1);
                scene.log.addMessage(scene.loc.t('buyPotion'), '#9be0a7');
                scene.enemyIntelText.setText(scene.loc.t('npcMerchantPay'));
                scene.showReturnButton();
            },
            enabled: scene.player.resources.gold >= ROOM_CONFIG.merchant.potionCost,
            fill: 0x1f5b2f,
        },
    ];

    actions.push({
        label: scene.loc.t('actionArmor', { num: actions.length + 1, cost: ROOM_CONFIG.merchant.armorCost }),
        callback: () => {
            if (!scene.player.spendGold(ROOM_CONFIG.merchant.armorCost)) {
                return;
            }
            scene.tracker.record('goldSpent', ROOM_CONFIG.merchant.armorCost);
            scene.player.addDefenseBonus(ROOM_CONFIG.merchant.armorDefenseGain);
            scene.log.addMessage(scene.loc.t('buyArmor', { value: ROOM_CONFIG.merchant.armorDefenseGain }), '#b8d3ff');
            scene.enemyIntelText.setText(scene.loc.t('npcMerchantFair'));
            scene.showReturnButton();
        },
        enabled: scene.player.resources.gold >= ROOM_CONFIG.merchant.armorCost,
        fill: 0x355070,
    });

    if (scene.meta.isUnlocked('merchant_premium')) {
        actions.push({
            label: scene.loc.t('actionRelic', { num: actions.length + 1, cost: ROOM_CONFIG.merchant.premiumShardCost }),
            callback: () => {
                if (!scene.player.spendRelicShard(ROOM_CONFIG.merchant.premiumShardCost)) {
                    return;
                }
                scene.player.addAttackBonus(ROOM_CONFIG.merchant.premiumAttackBonus);
                scene.player.gainPotions(ROOM_CONFIG.merchant.premiumPotionBonus);
                scene.log.addMessage(scene.loc.t('buyRelic', {
                    attack: ROOM_CONFIG.merchant.premiumAttackBonus,
                    potions: ROOM_CONFIG.merchant.premiumPotionBonus,
                }), '#ffd9f7');
                scene.enemyIntelText.setText(scene.loc.t('npcMerchantSmile'));
                scene.showReturnButton();
            },
            enabled: scene.player.resources.relicShards >= ROOM_CONFIG.merchant.premiumShardCost,
            fill: 0x6b4c96,
        });
    }

    actions.push({
        label: scene.loc.t('actionDynamicLeave', { num: actions.length + 1 }),
        callback: () => scene.showReturnButton(),
        fill: 0x202020,
    });

    scene.showRoomCard(
        scene.loc.t('merchant'),
        scene.loc.t('roomShadowTraderName'),
        scene.loc.t('roomShadowTraderDesc'),
        0x2e6c87,
        'M',
        scene.loc.t('roomShadowTraderHint'),
        'MERCHANT'
    );
    scene.setRoomButtons(actions);
}
