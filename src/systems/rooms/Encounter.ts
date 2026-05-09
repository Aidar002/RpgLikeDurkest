import { compactText } from '../../ui/TextHelpers';
import type { NpcEvalContext, PickedDialog } from '../NpcManager';
import type { NpcId, NpcOfferTemplate } from '../Npcs';
import type { GameScene, RoomButtonAction } from '../../scenes/GameScene';

export function buildNpcEvalContext(scene: GameScene): NpcEvalContext {
    const hpFrac =
        scene.player.stats.maxHp > 0 ? scene.player.stats.hp / scene.player.stats.maxHp : 1;
    return {
        depth: scene.dungeon.currentDepth,
        hpFrac,
        bleedDamageDealt: scene.tracker.current.bleedDamageDealt,
        relicsFound: scene.tracker.current.relicsFound,
        bossesKilledEver: scene.meta.bossesKilledEver,
    };
}

export function npcOfferCost(offerId: string, _npcId: NpcId): number {
    switch (offerId) {
        case 'gogi_what':
        case 'gogi_who':
            return 10;
        default:
            return 0;
    }
}

export function isNpcOfferEnabled(
    scene: GameScene,
    offer: NpcOfferTemplate,
    npcId: NpcId
): boolean {
    const cost = npcOfferCost(offer.id, npcId);
    switch (offer.id) {
        case 'gogi_what':
        case 'gogi_who':
            return scene.player.resources.gold >= cost;
        default:
            return true;
    }
}

export function presentNpcRoom(scene: GameScene, npcId: NpcId, headerLabel: string): void {
    const ctx = buildNpcEvalContext(scene);
    const picked = scene.npcs.pickDialog(npcId, ctx);
    scene.npcs.markEncounter(npcId, scene.dungeon.currentDepth);

    scene.roomHeaderText.setText(headerLabel);
    scene.enemyPortrait.setFillStyle(picked.npc.color);
    scene.enemyIconText.setText(picked.npc.glyph);
    scene.enemyNameText.setText(
        compactText(`${scene.loc.pick(picked.npc.name)}, ${scene.loc.pick(picked.npc.title)}`, 28)
    );
    scene.enemyIntelText.setText(scene.loc.pick(picked.npc.flavor));
    scene.enemyIntelText.setVisible(true);
    scene.roomFlavorText.setText(compactText(scene.loc.pick(picked.beat.text), 90));
    scene.enemySpriteImage.setVisible(false);
    scene.enemyIconText.setVisible(true);
    scene.enemyHpBarBg.setVisible(false);
    scene.enemyHpBar.setVisible(false);
    scene.enemyHpText.setVisible(false);
    scene.roomPanelGroup.setVisible(true);

    scene.log.addMessage(scene.loc.pick(picked.beat.text), '#cdb8ff');

    const actions = picked.offers.map<RoomButtonAction>((offer, idx) => {
        const cost = npcOfferCost(offer.id, npcId);
        return {
            label: scene.npcOfferLabel(offer, cost, idx + 1),
            callback: () => handleNpcOffer(scene, npcId, offer),
            enabled: isNpcOfferEnabled(scene, offer, npcId),
            fill: picked.npc.color,
        };
    });

    actions.push({
        label: scene.loc.t('actionDynamicLeave', { num: actions.length + 1 }),
        callback: () => leaveNpcRoom(scene, picked),
        fill: 0x202020,
    });

    scene.setRoomButtons(actions);
}

function leaveNpcRoom(scene: GameScene, picked: PickedDialog): void {
    if (picked.farewell) {
        const farewell = scene.loc.pick(picked.farewell.text);
        scene.log.addMessage(farewell, '#a89dc4');
        scene.enemyIntelText.setText(compactText(farewell, 60));
    }
    scene.showReturnButton();
}

function handleNpcOffer(scene: GameScene, npcId: NpcId, offer: NpcOfferTemplate): void {
    let consumed = true;
    let affinityDelta = 1;

    switch (offer.id) {
        // -- Sara ---------------------------------------------------------------
        case 'sara_where':
            scene.log.addMessage(
                scene.loc.language === 'ru'
                    ? 'Сара: "Мне бы кто сказал."'
                    : 'Sara: "I wish someone would tell me."',
                '#cdb8ff'
            );
            break;
        case 'sara_who':
            scene.log.addMessage(
                scene.loc.language === 'ru' ? 'Сара: "Я? Да никто."' : 'Sara: "Me? Nobody."',
                '#cdb8ff'
            );
            break;
        case 'sara_right':
            scene.log.addMessage(
                scene.loc.language === 'ru'
                    ? 'Сара: "И хладнокровный. Надеюсь ты выживешь. Хочешь совет?"'
                    : 'Sara: "And cold-blooded. I hope you survive. Want some advice?"',
                '#cdb8ff'
            );
            presentSaraAdviceChoice(scene);
            affinityDelta = 2;
            return;

        // -- Gogi ---------------------------------------------------------------
        case 'gogi_what':
            scene.log.addMessage(
                scene.loc.language === 'ru'
                    ? 'Гоги: "Неважно. Совет хочешь? Он стоит 10 монет."'
                    : 'Gogi: "Doesn\'t matter. Want advice? It costs 10 gold."',
                '#d4c87a'
            );
            presentGogiPayChoice(scene);
            affinityDelta = 1;
            return;
        case 'gogi_who':
            scene.log.addMessage(
                scene.loc.language === 'ru'
                    ? 'Гоги: "Твой шанс прожить чуть подольше. 10 монет есть?"'
                    : 'Gogi: "Your chance to live a little longer. Got 10 gold?"',
                '#d4c87a'
            );
            presentGogiPayChoice(scene);
            affinityDelta = 1;
            return;

        default:
            consumed = false;
    }

    if (consumed && affinityDelta !== 0) {
        scene.npcs.adjustAffinity(npcId, affinityDelta);
    }

    const flavor = scene.loc.pick(offer.flavor);
    if (flavor) {
        scene.enemyIntelText.setText(compactText(flavor, 60));
    }
    scene.showReturnButton();
}

function presentSaraAdviceChoice(scene: GameScene): void {
    scene.setRoomButtons([
        {
            label: scene.loc.language === 'ru' ? '[1] Да' : '[1] Yes',
            callback: () => {
                scene.npcs.adjustAffinity('sara', 2);
                scene.npcs.addFlag('sara', 'vampire-blessing');
                scene.player.setVampireBlessing(true);
                scene.log.addMessage(
                    scene.loc.language === 'ru'
                        ? 'Сара дала благословение вампиров: шанс 25% восстановить 2 ОЗ при ударе.'
                        : 'Sara granted Vampire Blessing: 25% chance to restore 2 HP on attack.',
                    '#d7b6ff'
                );
                scene.enemyIntelText.setText(
                    scene.loc.language === 'ru'
                        ? 'Благословение вампиров получено.'
                        : 'Vampire Blessing received.'
                );
                scene.showReturnButton();
            },
            fill: 0x8a6cb6,
        },
        {
            label: scene.loc.language === 'ru' ? '[2] Нет' : '[2] No',
            callback: () => {
                scene.log.addMessage(
                    scene.loc.language === 'ru' ? 'Сара: "Зря."' : 'Sara: "Shame."',
                    '#cdb8ff'
                );
                scene.showReturnButton();
            },
            fill: 0x202020,
        },
    ]);
}

function presentGogiPayChoice(scene: GameScene): void {
    const canPay = scene.player.resources.gold >= 10;
    scene.setRoomButtons([
        {
            label: scene.loc.language === 'ru' ? '[1] Держи (10 монет)' : '[1] Here (10 gold)',
            callback: () => {
                if (!scene.player.spendGold(10)) return;
                scene.tracker.record('goldSpent', 10);
                scene.npcs.adjustAffinity('gogi', 2);
                scene.npcs.addFlag('gogi', 'initial-training');
                scene.player.addMaxHpBonus(5, 5);
                scene.player.addDefenseBonus(1);
                scene.log.addMessage(
                    scene.loc.language === 'ru'
                        ? 'Гоги дал начальную подготовку: +5 жизни, +1 защита.'
                        : 'Gogi granted Initial Training: +5 HP, +1 defense.',
                    '#d4c87a'
                );
                scene.enemyIntelText.setText(
                    scene.loc.language === 'ru'
                        ? 'Начальная подготовка получена.'
                        : 'Initial Training received.'
                );
                scene.showReturnButton();
            },
            enabled: canPay,
            fill: 0xb6a44a,
        },
        {
            label: scene.loc.language === 'ru' ? '[2] Нет' : '[2] No',
            callback: () => {
                scene.log.addMessage(
                    scene.loc.language === 'ru'
                        ? 'Гоги: "Ну и вали нахрен."'
                        : 'Gogi: "Then get lost."',
                    '#d4c87a'
                );
                scene.showReturnButton();
            },
            fill: 0x202020,
        },
    ]);
}
