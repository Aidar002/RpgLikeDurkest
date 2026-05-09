import { ALTAR_EFFECTS } from '../../data/GameConfig';
import type { GameScene, RoomButtonAction } from '../../scenes/GameScene';

export function handleShrineRoom(scene: GameScene): void {
    scene.sfx.play('shrine');
    scene.tracker.record('shrinesVisited');
    const ru = scene.loc.language === 'ru';
    const actions: RoomButtonAction[] = [
        {
            label: ru
                ? `[1] Благословение (+${ALTAR_EFFECTS.blessingAttack} урон)`
                : `[1] Blessing (+${ALTAR_EFFECTS.blessingAttack} attack)`,
            callback: () => {
                scene.player.addAttackBonus(ALTAR_EFFECTS.blessingAttack);
                scene.log.addMessage(
                    ru
                        ? `Алтарь благословляет оружие: +${ALTAR_EFFECTS.blessingAttack} урон.`
                        : `The altar blesses your weapon: +${ALTAR_EFFECTS.blessingAttack} attack.`,
                    '#d7b6ff'
                );
                scene.enemyIntelText.setText(scene.loc.t('shrineRemembersName'));
                scene.showReturnButton();
            },
            fill: 0x5f4e8a,
        },
        {
            label: ru
                ? `[2] Молитва (+${ALTAR_EFFECTS.prayerMaxHp} ОЗ)`
                : `[2] Prayer (+${ALTAR_EFFECTS.prayerMaxHp} HP)`,
            callback: () => {
                scene.player.addMaxHpBonus(ALTAR_EFFECTS.prayerMaxHp, ALTAR_EFFECTS.prayerHeal);
                scene.log.addMessage(
                    ru
                        ? `Алтарь укрепляет тело: +${ALTAR_EFFECTS.prayerMaxHp} жизни.`
                        : `The altar strengthens your body: +${ALTAR_EFFECTS.prayerMaxHp} HP.`,
                    '#79e28f'
                );
                scene.enemyIntelText.setText(scene.loc.t('shrineRemembersName'));
                scene.showReturnButton();
            },
            fill: 0x2f8b4b,
        },
        {
            label: ru
                ? `[3] Речь (+${ALTAR_EFFECTS.speechResolve} воли)`
                : `[3] Speech (+${ALTAR_EFFECTS.speechResolve} resolve)`,
            callback: () => {
                scene.player.gainResolve(ALTAR_EFFECTS.speechResolve);
                scene.log.addMessage(
                    ru
                        ? `Алтарь наполняет решимостью: +${ALTAR_EFFECTS.speechResolve} воли.`
                        : `The altar fills you with resolve: +${ALTAR_EFFECTS.speechResolve} resolve.`,
                    '#9bc8ff'
                );
                scene.enemyIntelText.setText(scene.loc.t('shrineRemembersName'));
                scene.showReturnButton();
            },
            fill: 0x1b335b,
        },
        {
            label: ru
                ? `[4] Совет (+${ALTAR_EFFECTS.counselDefense} защита)`
                : `[4] Counsel (+${ALTAR_EFFECTS.counselDefense} defense)`,
            callback: () => {
                scene.player.addDefenseBonus(ALTAR_EFFECTS.counselDefense);
                scene.log.addMessage(
                    ru
                        ? `Алтарь укрепляет защиту: +${ALTAR_EFFECTS.counselDefense} защита.`
                        : `The altar fortifies your guard: +${ALTAR_EFFECTS.counselDefense} defense.`,
                    '#b8d3ff'
                );
                scene.enemyIntelText.setText(scene.loc.t('shrineRemembersName'));
                scene.showReturnButton();
            },
            fill: 0x355070,
        },
        {
            label: scene.loc.t('actionDynamicLeave', { num: 5 }),
            callback: () => scene.showReturnButton(),
            fill: 0x202020,
        },
    ];

    scene.showRoomCard(
        scene.loc.t('shrine'),
        scene.loc.t('roomShrineGenericName'),
        scene.loc.t('roomShrineGenericDesc'),
        0x5f4e8a,
        'S',
        scene.loc.t('roomShrineGenericHint'),
        'SHRINE'
    );
    scene.setRoomButtons(actions);
}
