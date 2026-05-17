import { ROOM_CONFIG } from '../../data/GameConfig';
import { defaultRng, randomInt, chance, pick } from '../Rng';
import { presentNpcRoom } from './Encounter';
import type { GameScene } from '../../scenes/GameScene';

export function handleEmptyRoom(scene: GameScene): void {
    if (chance(defaultRng, 0.35)) {
        const npcId = scene.npcs.pickForRole('wanderer', scene.dungeon.currentDepth);
        if (npcId) {
            presentNpcRoom(scene, npcId, scene.loc.t('roomEnemyEncounterTitle'));
            return;
        }
    }

    const subEvents = [
        {
            title: scene.loc.t('roomEmptyDustyName'),
            desc: scene.loc.t('roomEmptyDustyDesc'),
            icon: '.',
        },
        {
            title: scene.loc.t('roomEmptyCollapsedName'),
            desc: scene.loc.t('roomEmptyCollapsedDesc'),
            icon: '~',
        },
        {
            title: scene.loc.t('roomEmptyEchoingName'),
            desc: scene.loc.t('roomEmptyEchoingDesc'),
            icon: '"',
        },
        {
            title: scene.loc.t('roomEmptyAlcoveName'),
            desc: scene.loc.t('roomEmptyAlcoveDesc'),
            icon: "'",
        },
    ];
    const event = pick(defaultRng, subEvents);

    scene.showRoomCard(
        scene.loc.t('empty'),
        event.title,
        event.desc,
        0x444444,
        event.icon,
        'EMPTY'
    );

    scene.roomButtons.setActions([
        {
            label: scene.loc.t('actionScout'),
            callback: () => {
                const gains: string[] = [];

                if (chance(defaultRng, ROOM_CONFIG.empty.scoutGoldChance)) {
                    const gold = scene.player.gainGold(
                        randomInt(
                            defaultRng,
                            ROOM_CONFIG.empty.scoutGoldMin,
                            ROOM_CONFIG.empty.scoutGoldMax
                        )
                    );
                    if (gold > 0) scene.tracker.record('goldEarned', gold);
                    gains.push(`${gold} ${scene.loc.t('unitGold')}`);
                }

                if (gains.length === 0) {
                    const xp = scene.player.gainXp(1);
                    gains.push(scene.loc.t('plusXp', { value: xp }).replace(/^\+/, ''));
                }

                scene.log.addMessage(
                    scene.loc.t('emptyScout', { parts: gains.join(', ') }),
                    '#bbbbbb'
                );
                scene.roomFlavorText.setText(scene.loc.t('roomEmptyAfterSearch'));
                scene.showReturnButton();
            },
            variant: 'dark',
        },
        {
            label: scene.loc.t('actionSteady'),
            callback: () => {
                const gained = scene.player.gainResolve(ROOM_CONFIG.empty.steadyResolveGain);
                scene.log.addMessage(scene.loc.t('emptySteady', { value: gained }), '#9bc8ff');
                scene.roomFlavorText.setText(scene.loc.t('roomEmptyAfterSkip'));
                scene.showReturnButton();
            },
            variant: 'dark',
        },
    ]);
}
