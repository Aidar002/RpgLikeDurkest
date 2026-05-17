import { ROOM_CONFIG } from '../../data/GameConfig';
import type { GameScene } from '../../scenes/GameScene';

export function handleRestRoom(scene: GameScene): void {
    scene.sfx.play('rest');
    scene.showRoomCard(
        scene.loc.t('rest'),
        scene.loc.t('restCampfireName'),
        scene.loc.t('restCampfireDesc'),
        0x2f8b4b,
        '+',
        'REST'
    );

    scene.roomButtons.setActions([
        {
            label: scene.loc.t('actionRecover'),
            callback: () => {
                const healed = scene.player.heal(ROOM_CONFIG.rest.recoverHeal);
                if (healed > 0) scene.tracker.record('healingDone', healed);
                const summary = [`${healed} ${scene.loc.t('hp')}`];
                scene.log.addMessage(
                    scene.loc.t('restRecover', { parts: summary.join(', ') }),
                    '#79e28f'
                );
                scene.roomFlavorText.setText(scene.loc.t('restAfterHint'));
                scene.showReturnButton();
            },
            variant: 'positive',
        },
        {
            label: scene.loc.t('actionFocus'),
            callback: () => {
                const gained = scene.player.gainResolve(ROOM_CONFIG.rest.focusResolve);
                scene.log.addMessage(scene.loc.t('focusResolve', { value: gained }), '#9bc8ff');
                scene.roomFlavorText.setText(scene.loc.t('restAfterSteady'));
                scene.showReturnButton();
            },
            variant: 'silver',
        },
    ]);
}
