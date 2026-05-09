import { MAP_CONFIG } from '../data/GameConfig';
import { RoomType } from '../systems/MapGenerator';
import type { MapNode } from '../systems/MapGenerator';
import { handleTreasureRoom } from '../systems/rooms/Treasure';
import { handleTrapRoom } from '../systems/rooms/Trap';
import { handleRestRoom } from '../systems/rooms/Rest';
import { handleShrineRoom } from '../systems/rooms/Shrine';
import { handleMerchantRoom } from '../systems/rooms/Merchant';
import { handleEmptyRoom } from '../systems/rooms/Empty';
import type { GameScene } from './GameScene';

/**
 * Owns the "what happens when the avatar enters a room" flow:
 * the depth-entry bookkeeping and the dispatcher. Individual room-type
 * handlers live in `../systems/rooms/*`.
 *
 * The controller only reads and calls the scene — it does not hold any
 * Phaser state of its own. Combat entries go back to the scene
 * (`scene.startCombatEncounter`) because combat still lives there.
 */
export class RoomFlowController {
    private readonly scene: GameScene;

    constructor(scene: GameScene) {
        this.scene = scene;
    }

    enter(node: MapNode): void {
        const scene = this.scene;
        scene.lastEnemyHp = 0;
        scene.tracker.record('roomsVisited');
        scene.tracker.trackMax('bestDepth', scene.dungeon.currentDepth);
        scene.applyRoomTint(node.type);
        scene.sfx.play('footstep');
        scene.sfx.updateAmbientDepth(scene.dungeon.currentDepth);

        scene.log.addDivider(`${scene.loc.t('depth')} ${scene.dungeon.currentDepth}`);

        this.depthNarration(scene.dungeon.currentDepth, node);

        switch (node.type) {
            case RoomType.ENEMY:
                scene.startCombatEncounter('normal');
                return;
            case RoomType.ELITE:
                scene.startCombatEncounter('elite');
                return;
            case RoomType.BOSS:
                scene.startCombatEncounter('boss');
                return;
            case RoomType.MINI_BOSS:
                scene.startCombatEncounter('elite');
                return;
            case RoomType.TREASURE:
                handleTreasureRoom(scene);
                return;
            case RoomType.TRAP:
                handleTrapRoom(scene);
                return;
            case RoomType.REST:
                handleRestRoom(scene);
                return;
            case RoomType.SHRINE:
                handleShrineRoom(scene);
                return;
            case RoomType.MERCHANT:
                handleMerchantRoom(scene);
                return;
            case RoomType.EMPTY:
                handleEmptyRoom(scene);
                return;
            case RoomType.START:
                scene.showRoomCard(
                    scene.loc.t('start'),
                    scene.loc.language === 'ru' ? 'Лагерь' : 'Camp',
                    scene.loc.language === 'ru'
                        ? 'Вход остался сверху. Артефакт Желаний лежит внизу.'
                        : 'The entry is behind you. The Wish Artifact waits at the very bottom.',
                    0x555555,
                    '@',
                    scene.loc.language === 'ru'
                        ? 'Иди, когда выдохнешь.'
                        : 'Continue when you are ready.'
                );
                scene.showReturnButton();
                return;
            default: {
                const _unhandled: never = node.type;
                void _unhandled;
                return;
            }
        }
    }

    private depthNarration(d: number, node: MapNode): void {
        const scene = this.scene;
        if (d === 3) {
            scene.sfx.play('whisper');
            scene.log.addMessage(
                scene.loc.language === 'ru'
                    ? 'На стене нацарапано: «Добыча ниже. Назад — выше».'
                    : 'Scratched into the wall: "Treasure below. Turn back above."',
                '#c4a35a'
            );
        } else if (d === 10) {
            scene.sfx.play('whisper');
            scene.log.addMessage(
                scene.loc.language === 'ru'
                    ? 'У стены сидит мёртвый искатель. В пустом рюкзаке осталась карта вниз.'
                    : 'A dead treasure hunter sits against the wall. His map points deeper.',
                '#c4a35a'
            );
        } else if (d === 15) {
            scene.sfx.play('whisper');
            scene.log.addMessage(
                scene.loc.language === 'ru'
                    ? 'Воздух дрожит в зубах. Артефакт ближе.'
                    : 'The air hums. The artifact is closer — you can feel it.',
                '#c4a35a'
            );
        } else if (d === 20) {
            scene.sfx.play('whisper');
            scene.log.addMessage(
                scene.loc.language === 'ru'
                    ? 'Чужие зарубки кончились. Дальше только твои.'
                    : 'You are past the last known expedition. No marks but yours.',
                '#c4a35a'
            );
        } else if (d === MAP_CONFIG.finalDepth - 1) {
            scene.sfx.play('whisper');
            scene.log.addMessage(
                scene.loc.language === 'ru'
                    ? 'Стены слабо светятся. Артефакт за следующей глубиной.'
                    : 'The walls glow faintly. The Wish Artifact is close.',
                '#ffd36e'
            );
        } else if (d >= MAP_CONFIG.finalDepth && node.type === RoomType.BOSS) {
            scene.sfx.play('whisper');
            scene.log.addMessage(
                scene.loc.language === 'ru'
                    ? 'Последняя глубина. Страж ждёт у артефакта.'
                    : 'The final floor. The Artifact Guardian awaits.',
                '#ffd36e'
            );
        }
    }
}
