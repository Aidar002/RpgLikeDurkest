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
                scene.roomFlavorText.setText(scene.loc.t('npcMerchantPay'));
                scene.showReturnButton();
            },
            enabled: scene.player.resources.gold >= ROOM_CONFIG.merchant.potionCost,
            variant: 'positive',
        },
    ];

    actions.push({
        label: scene.loc.t('actionArmor', {
            num: actions.length + 1,
            cost: ROOM_CONFIG.merchant.armorCost,
        }),
        callback: () => {
            if (!scene.player.spendGold(ROOM_CONFIG.merchant.armorCost)) {
                return;
            }
            scene.tracker.record('goldSpent', ROOM_CONFIG.merchant.armorCost);
            scene.player.addDefenseBonus(ROOM_CONFIG.merchant.armorDefenseGain);
            scene.log.addMessage(
                scene.loc.t('buyArmor', { value: ROOM_CONFIG.merchant.armorDefenseGain }),
                '#b8d3ff'
            );
            scene.roomFlavorText.setText(scene.loc.t('npcMerchantFair'));
            scene.showReturnButton();
        },
        enabled: scene.player.resources.gold >= ROOM_CONFIG.merchant.armorCost,
        variant: 'silver',
    });

    actions.push({
        label: scene.loc.t('actionDynamicLeave', { num: actions.length + 1 }),
        callback: () => scene.showReturnButton(),
        variant: 'dark',
    });

    scene.showRoomCard(
        scene.loc.t('merchant'),
        scene.loc.t('roomShadowTraderName'),
        scene.loc.t('roomShadowTraderDesc'),
        0x2e6c87,
        'M',
        'MERCHANT'
    );
    scene.roomButtons.setActions(actions);
}
