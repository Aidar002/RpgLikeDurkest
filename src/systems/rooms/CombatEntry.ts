import { chance, defaultRng } from '../Rng';
import type { GameScene, RoomButtonAction } from '../../scenes/GameScene';

/**
 * Probability that the Flee button skips the encounter. The other 90 %
 * of attempts fall through to combat immediately — the player wasted
 * the action and the enemy still acts first when the bar mechanic
 * kicks in. Boss / final-boss rooms ignore this prompt and start the
 * fight without an escape option.
 */
const ESCAPE_CHANCE = 0.1;

export type CombatEntryKind = 'normal' | 'elite' | 'boss';

/**
 * Pre-combat decision card. Shown when the avatar enters an enemy /
 * elite / mini-boss room. Renders the same "threat detected" panel
 * that `CombatHudController.start` would have shown, but with two
 * action buttons — Flee and Fight — instead of the combat row.
 *
 * - Fight: hands off to `scene.startCombatEncounter(kind)` which
 *   keeps the existing CombatHud bootstrap path.
 * - Flee: `chance(rng, 0.1)` succeeds → the room ends, the player
 *   returns to the map. On failure the fight starts anyway.
 *
 * Bosses (`kind === 'boss'`) cannot be escaped — the card is skipped
 * entirely so the existing boss appearance flow runs unchanged.
 */
export function handleCombatEntry(scene: GameScene, kind: CombatEntryKind): void {
    if (kind === 'boss') {
        scene.startCombatEncounter(kind);
        return;
    }

    const card =
        kind === 'elite'
            ? {
                  header: scene.loc.t('elite'),
                  title: scene.loc.t('hudEliteIntroTitle'),
                  body: scene.loc.t('hudEliteIntroBody'),
                  color: 0xa14a4a,
                  icon: 'E',
                  spriteKey: 'ELITE',
              }
            : {
                  header: scene.loc.t('hostile'),
                  title: scene.loc.t('hudCombatContactTitle'),
                  body: scene.loc.t('hudCombatContactBody'),
                  color: 0x6b3030,
                  icon: 'X',
                  spriteKey: 'ENEMY',
              };

    scene.showRoomCard(card.header, card.title, card.body, card.color, card.icon, card.spriteKey);

    const actions: RoomButtonAction[] = [
        {
            label: scene.loc.t('actionFlee'),
            callback: () => attemptFlee(scene, kind),
            fill: 0x3a5b3a,
        },
        {
            label: scene.loc.t('actionFight'),
            callback: () => scene.startCombatEncounter(kind),
            fill: 0x5a1d1d,
        },
    ];
    scene.setRoomButtons(actions);
}

function attemptFlee(scene: GameScene, kind: CombatEntryKind): void {
    if (chance(defaultRng, ESCAPE_CHANCE)) {
        scene.log.addMessage(scene.loc.t('fleeSuccess'), '#9be0a7');
        scene.showRoomCard(
            scene.loc.t('hostile'),
            scene.loc.t('fleeEscapedTitle'),
            scene.loc.t('fleeEscapedBody'),
            0x3a5b3a,
            '~'
        );
        scene.showReturnButton();
        return;
    }
    scene.log.addMessage(scene.loc.t('fleeFailed'), '#cb7878');
    scene.startCombatEncounter(kind);
}
