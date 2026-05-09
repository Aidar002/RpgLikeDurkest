import { ROOM_CONFIG } from '../../data/GameConfig';
import { defaultRng, randomInt, chance, pick } from '../Rng';
import type { GameScene } from '../../scenes/GameScene';

export function handleTrapRoom(scene: GameScene): void {
    const trapVariants = [
        {
            title: scene.loc.t('trapMechanicalName'),
            desc: scene.loc.t('trapMechanicalDesc'),
            icon: '^',
        },
        {
            title: scene.loc.t('trapDartName'),
            desc: scene.loc.t('trapDartDesc'),
            icon: '!',
        },
        {
            title: scene.loc.t('trapCollapseName'),
            desc: scene.loc.t('trapCollapseDesc'),
            icon: 'v',
        },
    ];
    const trap = pick(defaultRng, trapVariants);

    scene.showRoomCard(
        scene.loc.t('trap'),
        trap.title,
        trap.desc,
        0x75458a,
        trap.icon,
        scene.loc.t('trapHint'),
        'TRAP'
    );

    scene.setRoomButtons([
        {
            label: scene.loc.t('actionRush'),
            callback: () => {
                scene.tracker.record('trapsTriggered');
                const damage = scene.applyTrapDamage(
                    randomInt(
                        defaultRng,
                        ROOM_CONFIG.trap.rushDamageMin,
                        ROOM_CONFIG.trap.rushDamageMax
                    )
                );
                scene.sfx.play('trapTrigger');
                scene.log.addMessage(scene.loc.t('trapRush', { damage }), '#ff7777');
                if (scene.player.stats.hp > 0) {
                    scene.showReturnButton();
                    scene.enemyIntelText.setText(scene.loc.t('trapAfterRush'));
                }
            },
            fill: 0x5a1d1d,
        },
        {
            label: scene.loc.t('actionDisarm'),
            callback: () => {
                if (chance(defaultRng, ROOM_CONFIG.trap.disarmChance)) {
                    const gold = scene.player.gainGold(
                        randomInt(
                            defaultRng,
                            ROOM_CONFIG.trap.disarmGoldMin,
                            ROOM_CONFIG.trap.disarmGoldMax
                        )
                    );
                    scene.sfx.play('trapDisarm');
                    scene.log.addMessage(scene.loc.t('trapDisarm', { gold }), '#f7d46b');
                    scene.enemyIntelText.setText(scene.loc.t('trapAfterDisarm'));
                } else {
                    const damage = scene.applyTrapDamage(
                        randomInt(
                            defaultRng,
                            ROOM_CONFIG.trap.disarmFailDamageMin,
                            ROOM_CONFIG.trap.disarmFailDamageMax
                        )
                    );
                    scene.sfx.play('trapTrigger');
                    scene.log.addMessage(scene.loc.t('trapSnap', { damage }), '#ff7777');
                    scene.enemyIntelText.setText(scene.loc.t('trapSnapIntel'));
                }
                if (scene.player.stats.hp > 0) {
                    scene.showReturnButton();
                }
            },
            fill: 0x2a3d5a,
        },
    ]);
}
