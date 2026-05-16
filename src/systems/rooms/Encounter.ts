import type { NpcEvalContext, PickedDialog } from '../NpcManager';
import type { NpcId, NpcOfferTemplate } from '../Npcs';
import type { GameScene, RoomButtonAction } from '../../scenes/GameScene';

function buildNpcEvalContext(scene: GameScene): NpcEvalContext {
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

function npcOfferCost(offerId: string, _npcId: NpcId): number {
    switch (offerId) {
        case 'gogi_what':
        case 'gogi_who':
            return 10;
        default:
            return 0;
    }
}

function isNpcOfferEnabled(scene: GameScene, offer: NpcOfferTemplate, npcId: NpcId): boolean {
    const cost = npcOfferCost(offer.id, npcId);
    switch (offer.id) {
        case 'gogi_what':
        case 'gogi_who':
            return scene.player.resources.gold >= cost;
        default:
            return true;
    }
}

/**
 * Per-run visibility gate, layered on top of NpcManager's static
 * `onlyAfterMet` / `requiresAffinity` filtering. NpcManager doesn't
 * know about transient PlayerManager state (per-run flags), so any
 * "you already did this in this run" gating lives here.
 *
 * Currently used to hide Gogi's two paid-training offers once the
 * player has already bought the buff this run — both offers lead to
 * the same `presentGogiPayChoice` flow, and the +5 HP / +1 def bonus
 * stacks naively if applied twice.
 */
function isNpcOfferAvailableThisRun(
    scene: GameScene,
    offer: NpcOfferTemplate,
    npcId: NpcId
): boolean {
    if (npcId === 'gogi' && (offer.id === 'gogi_what' || offer.id === 'gogi_who')) {
        return !scene.player.gogiTrainingTaken;
    }
    return true;
}

export function presentNpcRoom(scene: GameScene, npcId: NpcId, headerLabel: string): void {
    const ctx = buildNpcEvalContext(scene);
    const picked = scene.npcs.pickDialog(npcId, ctx);
    scene.npcs.markEncounter(npcId, scene.dungeon.currentDepth);

    const npcSpeech = scene.loc.pick(picked.beat.text);
    const npcName = scene.loc.pick(picked.npc.name);
    scene.showRoomNpcCard(
        headerLabel,
        `${npcName}, ${scene.loc.pick(picked.npc.title)}`,
        picked.npc.color,
        picked.npc.glyph,
        npcSpeech
    );

    // Event log no longer mirrors every line of the dialog — it only
    // records that a conversation has started so the player can see
    // it in the timeline without the log getting flooded by speech.
    scene.log.addMessage(scene.loc.t('dialogStarted', { name: npcName }), '#cdb8ff');

    const availableOffers = picked.offers.filter((offer) =>
        isNpcOfferAvailableThisRun(scene, offer, npcId)
    );
    const actions = availableOffers.map<RoomButtonAction>((offer, idx) => {
        const cost = npcOfferCost(offer.id, npcId);
        const label = scene.npcOfferLabel(offer, cost, idx + 1);
        return {
            label,
            callback: () => handleNpcOffer(scene, npcId, offer, label),
            enabled: isNpcOfferEnabled(scene, offer, npcId),
            fill: picked.npc.color,
        };
    });

    actions.push({
        label: scene.loc.t('actionDynamicLeave', { num: actions.length + 1 }),
        callback: () =>
            leaveNpcRoom(
                scene,
                picked,
                scene.loc.t('actionDynamicLeave', { num: actions.length + 1 })
            ),
        fill: 0x202020,
    });

    scene.setRoomButtons(actions);
}

function leaveNpcRoom(scene: GameScene, picked: PickedDialog, leaveLabel: string): void {
    if (picked.farewell) {
        const farewell = scene.loc.pick(picked.farewell.text);
        scene.updateRoomDialog({ player: leaveLabel, npc: farewell });
    } else {
        scene.updateRoomDialog({ player: leaveLabel });
    }
    scene.log.addMessage(scene.loc.t('dialogEnded'), '#a89dc4');
    scene.showReturnButton();
}

// Dialogue beats render only inside the dialog window — the event
// log stays clean (just the start / end markers from
// presentNpcRoom / leaveNpcRoom). `color` is unused now but kept on
// the call sites for clarity about who is speaking.
function speakNpc(scene: GameScene, line: string, _color: string, playerLine: string): void {
    scene.updateRoomDialog({ player: playerLine, npc: line });
}

function handleNpcOffer(
    scene: GameScene,
    npcId: NpcId,
    offer: NpcOfferTemplate,
    offerLabel: string
): void {
    // Each handled case below owns its full flow (append dialog,
    // adjust affinity if any, present follow-up choice / return
    // button) so that the chat-log gets exactly one player + one NPC
    // entry per click. Falling through to a shared trailer used to
    // work when updateRoomDialog replaced the visible line, but in
    // append-mode it would double-append.
    switch (offer.id) {
        // -- Sara ---------------------------------------------------------------
        case 'sara_where':
            speakNpc(
                scene,
                scene.loc.language === 'ru'
                    ? 'Сара: "Мне бы кто сказал."'
                    : 'Sara: "I wish someone would tell me."',
                '#cdb8ff',
                offerLabel
            );
            scene.npcs.adjustAffinity(npcId, 1);
            // Dialog tree branch: "Где я?" → follow-up "Кто ты?" →
            // "Я? Да никто." Sub-choice owns its own return button.
            presentSaraWhoFollowup(scene);
            return;
        case 'sara_right':
            speakNpc(
                scene,
                scene.loc.language === 'ru'
                    ? 'Сара: "И хладнокровный. Надеюсь ты выживешь. Хочешь совет?"'
                    : 'Sara: "And cold-blooded. I hope you survive. Want some advice?"',
                '#cdb8ff',
                offerLabel
            );
            presentSaraAdviceChoice(scene);
            return;

        // -- Gogi ---------------------------------------------------------------
        case 'gogi_what':
            speakNpc(
                scene,
                scene.loc.language === 'ru'
                    ? 'Гоги: "Неважно. Совет хочешь? Он стоит 10 монет."'
                    : 'Gogi: "Doesn\'t matter. Want advice? It costs 10 gold."',
                '#d4c87a',
                offerLabel
            );
            presentGogiPayChoice(scene);
            return;
        case 'gogi_who':
            speakNpc(
                scene,
                scene.loc.language === 'ru'
                    ? 'Гоги: "Твой шанс прожить чуть подольше. 10 монет есть?"'
                    : 'Gogi: "Your chance to live a little longer. Got 10 gold?"',
                '#d4c87a',
                offerLabel
            );
            presentGogiPayChoice(scene);
            return;

        default: {
            // Offer without a dedicated speech case: use the offer's
            // own flavour text as the NPC's response, if any.
            const flavor = scene.loc.pick(offer.flavor);
            if (flavor) {
                scene.updateRoomDialog({ player: offerLabel, npc: flavor });
            } else {
                scene.updateRoomDialog({ player: offerLabel });
            }
            scene.npcs.adjustAffinity(npcId, 1);
            scene.showReturnButton();
            return;
        }
    }
}

function presentSaraWhoFollowup(scene: GameScene): void {
    const whoLabel = scene.loc.language === 'ru' ? '[1] Кто ты?' : '[1] Who are you?';
    scene.setRoomButtons([
        {
            label: whoLabel,
            callback: () => {
                const reply =
                    scene.loc.language === 'ru' ? 'Сара: "Я? Да никто."' : 'Sara: "Me? Nobody."';
                scene.updateRoomDialog({ player: whoLabel, npc: reply });
                scene.showReturnButton();
            },
            fill: 0x8a6cb6,
        },
    ]);
}

function presentSaraAdviceChoice(scene: GameScene): void {
    const yesLabel = scene.loc.language === 'ru' ? '[1] Да' : '[1] Yes';
    const noLabel = scene.loc.language === 'ru' ? '[2] Нет' : '[2] No';
    scene.setRoomButtons([
        {
            label: yesLabel,
            callback: () => {
                scene.npcs.adjustAffinity('sara', 2);
                scene.npcs.addFlag('sara', 'vampire-blessing');
                scene.player.setVampireBlessing(true);
                const grantLine =
                    scene.loc.language === 'ru'
                        ? 'Сара дала благословение вампиров: шанс 25% восстановить 2 ОЗ при ударе.'
                        : 'Sara granted Vampire Blessing: 25% chance to restore 2 HP on attack.';
                scene.log.addMessage(grantLine, '#d7b6ff');
                scene.updateRoomDialog({ player: yesLabel, npc: grantLine });
                scene.showReturnButton();
            },
            fill: 0x8a6cb6,
        },
        {
            label: noLabel,
            callback: () => {
                const refuseLine = scene.loc.language === 'ru' ? 'Сара: "Зря."' : 'Sara: "Shame."';
                scene.updateRoomDialog({ player: noLabel, npc: refuseLine });
                scene.showReturnButton();
            },
            fill: 0x202020,
        },
    ]);
}

function presentGogiPayChoice(scene: GameScene): void {
    const canPay = scene.player.resources.gold >= 10;
    const payLabel = scene.loc.language === 'ru' ? '[1] Держи (10 монет)' : '[1] Here (10 gold)';
    const refuseLabel = scene.loc.language === 'ru' ? '[2] Нет' : '[2] No';
    scene.setRoomButtons([
        {
            label: payLabel,
            callback: () => {
                if (!scene.player.spendGold(10)) return;
                scene.tracker.record('goldSpent', 10);
                scene.npcs.adjustAffinity('gogi', 2);
                scene.npcs.addFlag('gogi', 'initial-training');
                scene.player.gogiTrainingTaken = true;
                scene.player.addMaxHpBonus(5, 5);
                scene.player.addDefenseBonus(1);
                const grantLine =
                    scene.loc.language === 'ru'
                        ? 'Гоги дал начальную подготовку: +5 жизни, +1 защита.'
                        : 'Gogi granted Initial Training: +5 HP, +1 defense.';
                scene.log.addMessage(grantLine, '#d4c87a');
                scene.updateRoomDialog({ player: payLabel, npc: grantLine });
                scene.showReturnButton();
            },
            enabled: canPay,
            fill: 0xb6a44a,
        },
        {
            label: refuseLabel,
            callback: () => {
                const dismissLine =
                    scene.loc.language === 'ru'
                        ? 'Гоги: "Ну и вали нахрен."'
                        : 'Gogi: "Then get lost."';
                scene.updateRoomDialog({ player: refuseLabel, npc: dismissLine });
                scene.showReturnButton();
            },
            fill: 0x202020,
        },
    ]);
}
