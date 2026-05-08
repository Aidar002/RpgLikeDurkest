import { FEATURES, MAP_CONFIG, ROOM_CONFIG, RUN_CONFIG } from '../data/GameConfig';
import { RoomType } from '../systems/MapGenerator';
import { isLightWarning, shouldDecayLight } from '../systems/Light';
import type { MapNode } from '../systems/MapGenerator';
import type { NpcEvalContext, PickedDialog } from '../systems/NpcManager';
import type { NpcId, NpcOfferTemplate } from '../systems/Npcs';
import { narrate } from '../systems/Narrator';
import { defaultRng, randomInt } from '../systems/Rng';
import { compactText } from '../ui/TextHelpers';
import type { GameScene, RoomButtonAction } from './GameScene';

/**
 * Owns the "what happens when the avatar enters a room" flow:
 * the depth-entry bookkeeping, the dispatcher, and every room-type
 * sub-handler (treasure / trap / rest / shrine / merchant / empty / NPC).
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

        // [FIX-2] Light now decays once every
        // {@link getLightDecayInterval} rooms (runLength-derived; was a
        // flat 2 per room before the runLength refactor). Empty rooms
        // spared by relic and the START room never tick the counter so
        // the relic effect stays meaningful.
        if (FEATURES.light) {
            if (scene.skipLightSpendThisRoom) {
                scene.skipLightSpendThisRoom = false;
            } else if (node.type !== RoomType.START) {
                scene.roomsVisitedForLight += 1;
                if (shouldDecayLight(scene.roomsVisitedForLight, RUN_CONFIG.runLength)) {
                    const spent = scene.player.spendLight(1);
                    if (spent > 0) {
                        scene.log.addMessage(scene.loc.t('lightLower', { count: spent }), '#e0c873');
                    }
                }
                if (isLightWarning(scene.player.resources.light)) {
                    scene.log.addMessage(scene.loc.t('lightWarning'), '#c4a35a');
                }
            }

            if (scene.player.hasLowLight && node.type !== RoomType.START) {
                if (Math.random() < 0.3) {
                    scene.log.addMessage(narrate('low_light', scene.loc.language), '#c4a35a');
                }
            }
        }

        scene.log.addDivider(`${scene.loc.t('depth')} ${scene.dungeon.currentDepth}`);

        const d = scene.dungeon.currentDepth;
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
            // TODO(seals): require player.seals >= getRequiredSeals(RUN_CONFIG.runLength)
            //   before allowing entry into / victory over the final boss.
            //   Map-gen (PR-3) guarantees `requiredSeals` seal opportunities
            //   on every full path; combat-side gating + player.seals
            //   inventory + UI progress are intentionally deferred to a
            //   later balance pass.
        }

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
                // Branch-guardian / mid-run threat (PR-2). Semantically
                // sits between ELITE and BOSS — we route it through the
                // elite combat path so the player gets the elite intro
                // card + elite-tier hp / attack / reward multipliers.
                // Without this case the switch fell through silently
                // and entering a MINI_BOSS room produced no UI at all.
                scene.startCombatEncounter('elite');
                return;
            case RoomType.TREASURE:
                this.resolveTreasureRoom();
                return;
            case RoomType.TRAP:
                this.showTrapOptions();
                return;
            case RoomType.REST:
                this.showRestOptions();
                return;
            case RoomType.SHRINE:
                this.showShrineOptions();
                return;
            case RoomType.MERCHANT:
                this.showMerchantOptions();
                return;
            case RoomType.EMPTY:
                this.showEmptyOptions();
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
                    scene.loc.language === 'ru' ? 'Иди, когда выдохнешь.' : 'Continue when you are ready.'
                );
                scene.showReturnButton();
                return;
            default: {
                // Compile-time exhaustiveness: if a new RoomType is
                // added to MapGenerator and not wired here, the
                // assignment below stops type-checking. Catches the
                // class of bug where a fresh room kind silently
                // produces no UI on entry (PR-2 MINI_BOSS regression).
                const _unhandled: never = node.type;
                void _unhandled;
                return;
            }
        }
    }

    private resolveTreasureRoom(): void {
        const scene = this.scene;
        const goldUnlocked = scene.meta.isUnlocked('currency_gold');
        const xpGained = scene.player.gainXp(ROOM_CONFIG.treasure.xpReward);

        let goldGained = 0;
        let potionGained = 0;
        if (goldUnlocked) {
            goldGained = scene.player.gainGold(randomInt(defaultRng, ROOM_CONFIG.treasure.goldMin, ROOM_CONFIG.treasure.goldMax));
            if (goldGained > 0) scene.tracker.record('goldEarned', goldGained);
            if (scene.player.isPotionUnlocked && Math.random() < ROOM_CONFIG.treasure.potionChance) {
                potionGained = scene.player.gainPotions(1);
            }
        }

        const rewardParts = [scene.loc.t('plusXp', { value: xpGained })];
        if (goldGained > 0) {
            rewardParts.push(scene.loc.t('plusGold', { value: goldGained }));
        }
        if (potionGained > 0) {
            rewardParts.push(scene.loc.t('plusPotion'));
        }

        scene.showRoomCard(
            scene.loc.t('treasure'),
            scene.loc.t('roomTreasureName'),
            scene.loc.t('roomTreasureDesc', { value: rewardParts.join(', ') }),
            0x8d6a21,
            '$',
            scene.loc.t('roomTreasureHint'),
            'TREASURE'
        );
        scene.log.addMessage(scene.loc.t('treasureSecured', { parts: rewardParts.join(', ') }), '#f7d46b');
        scene.sfx.play('treasure');
        scene.maybeDropRelic('treasure');
        scene.showReturnButton();
    }

    private showTrapOptions(): void {
        const scene = this.scene;
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
        const trap = trapVariants[Math.floor(Math.random() * trapVariants.length)];

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
                        randomInt(defaultRng, ROOM_CONFIG.trap.rushDamageMin, ROOM_CONFIG.trap.rushDamageMax)
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
                    if (Math.random() < ROOM_CONFIG.trap.disarmChance) {
                        const gold = scene.player.gainGold(
                            randomInt(defaultRng, ROOM_CONFIG.trap.disarmGoldMin, ROOM_CONFIG.trap.disarmGoldMax)
                        );
                        scene.sfx.play('trapDisarm');
                        scene.log.addMessage(scene.loc.t('trapDisarm', { gold }), '#f7d46b');
                        scene.enemyIntelText.setText(scene.loc.t('trapAfterDisarm'));
                    } else {
                        const damage = scene.applyTrapDamage(
                            randomInt(defaultRng,
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

    private showRestOptions(): void {
        const scene = this.scene;
        scene.sfx.play('rest');
        scene.showRoomCard(
            scene.loc.t('rest'),
            scene.loc.t('restCampfireName'),
            scene.loc.t('restCampfireDesc'),
            0x2f8b4b,
            '+',
            scene.loc.t('restHint'),
            'REST'
        );

        scene.setRoomButtons([
            {
                label: scene.loc.t('actionRecover'),
                callback: () => {
                    const healed = scene.player.heal(
                        ROOM_CONFIG.rest.recoverHeal +
                            scene.meta.getBonuses().rooms.restHealBonus
                    );
                    if (healed > 0) scene.tracker.record('healingDone', healed);
                    const lightGained = FEATURES.light
                        ? scene.player.gainLight(ROOM_CONFIG.rest.recoverLight)
                        : 0;
                    const summary = [`${healed} ${scene.loc.t('hp')}`];
                    if (lightGained > 0) {
                        summary.push(`${lightGained} ${scene.loc.t('unitLight')}`);
                    }
                    scene.log.addMessage(scene.loc.t('restRecover', { parts: summary.join(', ') }), '#79e28f');
                    scene.enemyIntelText.setText(scene.loc.t('restAfterHint'));
                    scene.showReturnButton();
                },
                fill: 0x1f5b2f,
            },
            {
                label: scene.loc.t('actionFocus'),
                callback: () => {
                    const gained = scene.player.gainResolve(ROOM_CONFIG.rest.focusResolve);
                    scene.log.addMessage(scene.loc.t('focusResolve', { value: gained }), '#9bc8ff');
                    scene.enemyIntelText.setText(scene.loc.t('restAfterSteady'));
                    scene.showReturnButton();
                },
                fill: 0x1b335b,
            },
        ]);
    }

    private buildNpcEvalContext(): NpcEvalContext {
        const scene = this.scene;
        const hpFrac = scene.player.stats.maxHp > 0
            ? scene.player.stats.hp / scene.player.stats.maxHp
            : 1;
        return {
            depth: scene.dungeon.currentDepth,
            hpFrac,
            bleedDamageDealt: scene.tracker.current.bleedDamageDealt,
            relicsFound: scene.tracker.current.relicsFound,
            bossesKilledEver: scene.meta.bossesKilledEver,
        };
    }

    private npcOfferCost(offerId: string, _npcId: NpcId): number {
        switch (offerId) {
            case 'gogi_what':
            case 'gogi_who':
                return 10;
            default:
                return 0;
        }
    }

    private isNpcOfferEnabled(offer: NpcOfferTemplate, npcId: NpcId): boolean {
        const scene = this.scene;
        const cost = this.npcOfferCost(offer.id, npcId);
        switch (offer.id) {
            case 'gogi_what':
            case 'gogi_who':
                return scene.player.resources.gold >= cost;
            default:
                return true;
        }
    }

    private presentNpcRoom(npcId: NpcId, headerLabel: string): void {
        const scene = this.scene;
        const ctx = this.buildNpcEvalContext();
        const picked = scene.npcs.pickDialog(npcId, ctx);
        scene.npcs.markEncounter(npcId, scene.dungeon.currentDepth);

        scene.roomHeaderText.setText(headerLabel);
        scene.enemyPortrait.setFillStyle(picked.npc.color);
        scene.enemyIconText.setText(picked.npc.glyph);
        scene.enemyNameText.setText(
            compactText(
                `${scene.loc.pick(picked.npc.name)}, ${scene.loc.pick(picked.npc.title)}`,
                28
            )
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
            const cost = this.npcOfferCost(offer.id, npcId);
            return {
                label: scene.npcOfferLabel(offer, cost, idx + 1),
                callback: () => this.handleNpcOffer(npcId, offer),
                enabled: this.isNpcOfferEnabled(offer, npcId),
                fill: picked.npc.color,
            };
        });

        actions.push({
            label: scene.loc.t('actionDynamicLeave', { num: actions.length + 1 }),
            callback: () => this.leaveNpcRoom(picked),
            fill: 0x202020,
        });

        scene.setRoomButtons(actions);
    }

    private leaveNpcRoom(picked: PickedDialog): void {
        const scene = this.scene;
        if (picked.farewell) {
            const farewell = scene.loc.pick(picked.farewell.text);
            scene.log.addMessage(farewell, '#a89dc4');
            scene.enemyIntelText.setText(compactText(farewell, 60));
        }
        scene.showReturnButton();
    }

    private handleNpcOffer(npcId: NpcId, offer: NpcOfferTemplate): void {
        const scene = this.scene;
        let consumed = true;
        let affinityDelta = 1;

        switch (offer.id) {
            // -- Sara ---------------------------------------------------------------
            case 'sara_where':
                scene.log.addMessage(
                    scene.loc.language === 'ru'
                        ? '\u0421\u0430\u0440\u0430: "\u041c\u043d\u0435 \u0431\u044b \u043a\u0442\u043e \u0441\u043a\u0430\u0437\u0430\u043b."'
                        : 'Sara: "I wish someone would tell me."',
                    '#cdb8ff'
                );
                break;
            case 'sara_who':
                scene.log.addMessage(
                    scene.loc.language === 'ru'
                        ? '\u0421\u0430\u0440\u0430: "\u042f? \u0414\u0430 \u043d\u0438\u043a\u0442\u043e."'
                        : 'Sara: "Me? Nobody."',
                    '#cdb8ff'
                );
                break;
            case 'sara_right':
                scene.log.addMessage(
                    scene.loc.language === 'ru'
                        ? '\u0421\u0430\u0440\u0430: "\u0418 \u0445\u043b\u0430\u0434\u043d\u043e\u043a\u0440\u043e\u0432\u043d\u044b\u0439. \u041d\u0430\u0434\u0435\u044e\u0441\u044c \u0442\u044b \u0432\u044b\u0436\u0438\u0432\u0435\u0448\u044c. \u0425\u043e\u0447\u0435\u0448\u044c \u0441\u043e\u0432\u0435\u0442?"'
                        : 'Sara: "And cold-blooded. I hope you survive. Want some advice?"',
                    '#cdb8ff'
                );
                this.presentSaraAdviceChoice();
                affinityDelta = 2;
                return;

            // -- Gogi ---------------------------------------------------------------
            case 'gogi_what':
                scene.log.addMessage(
                    scene.loc.language === 'ru'
                        ? '\u0413\u043e\u0433\u0438: "\u041d\u0435\u0432\u0430\u0436\u043d\u043e. \u0421\u043e\u0432\u0435\u0442 \u0445\u043e\u0447\u0435\u0448\u044c? \u041e\u043d \u0441\u0442\u043e\u0438\u0442 10 \u043c\u043e\u043d\u0435\u0442."'
                        : 'Gogi: "Doesn\'t matter. Want advice? It costs 10 gold."',
                    '#d4c87a'
                );
                this.presentGogiPayChoice();
                affinityDelta = 1;
                return;
            case 'gogi_who':
                scene.log.addMessage(
                    scene.loc.language === 'ru'
                        ? '\u0413\u043e\u0433\u0438: "\u0422\u0432\u043e\u0439 \u0448\u0430\u043d\u0441 \u043f\u0440\u043e\u0436\u0438\u0442\u044c \u0447\u0443\u0442\u044c \u043f\u043e\u0434\u043e\u043b\u044c\u0448\u0435. 10 \u043c\u043e\u043d\u0435\u0442 \u0435\u0441\u0442\u044c?"'
                        : 'Gogi: "Your chance to live a little longer. Got 10 gold?"',
                    '#d4c87a'
                );
                this.presentGogiPayChoice();
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

    private presentSaraAdviceChoice(): void {
        const scene = this.scene;
        scene.setRoomButtons([
            {
                label: scene.loc.language === 'ru' ? '[1] \u0414\u0430' : '[1] Yes',
                callback: () => {
                    scene.npcs.adjustAffinity('sara', 2);
                    scene.npcs.addFlag('sara', 'vampire-blessing');
                    scene.player.setVampireBlessing(true);
                    scene.log.addMessage(
                        scene.loc.language === 'ru'
                            ? '\u0421\u0430\u0440\u0430 \u0434\u0430\u043b\u0430 \u0431\u043b\u0430\u0433\u043e\u0441\u043b\u043e\u0432\u0435\u043d\u0438\u0435 \u0432\u0430\u043c\u043f\u0438\u0440\u043e\u0432: \u0448\u0430\u043d\u0441 25% \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c 2 \u041e\u0417 \u043f\u0440\u0438 \u0443\u0434\u0430\u0440\u0435.'
                            : 'Sara granted Vampire Blessing: 25% chance to restore 2 HP on attack.',
                        '#d7b6ff'
                    );
                    scene.enemyIntelText.setText(
                        scene.loc.language === 'ru'
                            ? '\u0411\u043b\u0430\u0433\u043e\u0441\u043b\u043e\u0432\u0435\u043d\u0438\u0435 \u0432\u0430\u043c\u043f\u0438\u0440\u043e\u0432 \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u043e.'
                            : 'Vampire Blessing received.'
                    );
                    scene.showReturnButton();
                },
                fill: 0x8a6cb6,
            },
            {
                label: scene.loc.language === 'ru' ? '[2] \u041d\u0435\u0442' : '[2] No',
                callback: () => {
                    scene.log.addMessage(
                        scene.loc.language === 'ru'
                            ? '\u0421\u0430\u0440\u0430: "\u0417\u0440\u044f."'
                            : 'Sara: "Shame."',
                        '#cdb8ff'
                    );
                    scene.showReturnButton();
                },
                fill: 0x202020,
            },
        ]);
    }

    private presentGogiPayChoice(): void {
        const scene = this.scene;
        const canPay = scene.player.resources.gold >= 10;
        scene.setRoomButtons([
            {
                label: scene.loc.language === 'ru' ? '[1] \u0414\u0435\u0440\u0436\u0438 (10 \u043c\u043e\u043d\u0435\u0442)' : '[1] Here (10 gold)',
                callback: () => {
                    if (!scene.player.spendGold(10)) return;
                    scene.tracker.record('goldSpent', 10);
                    scene.npcs.adjustAffinity('gogi', 2);
                    scene.npcs.addFlag('gogi', 'initial-training');
                    scene.player.addMaxHpBonus(5, 5);
                    scene.player.addDefenseBonus(1);
                    scene.log.addMessage(
                        scene.loc.language === 'ru'
                            ? '\u0413\u043e\u0433\u0438 \u0434\u0430\u043b \u043d\u0430\u0447\u0430\u043b\u044c\u043d\u0443\u044e \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0443: +5 \u0436\u0438\u0437\u043d\u0438, +1 \u0437\u0430\u0449\u0438\u0442\u0430.'
                            : 'Gogi granted Initial Training: +5 HP, +1 defense.',
                        '#d4c87a'
                    );
                    scene.enemyIntelText.setText(
                        scene.loc.language === 'ru'
                            ? '\u041d\u0430\u0447\u0430\u043b\u044c\u043d\u0430\u044f \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u0430.'
                            : 'Initial Training received.'
                    );
                    scene.showReturnButton();
                },
                enabled: canPay,
                fill: 0xb6a44a,
            },
            {
                label: scene.loc.language === 'ru' ? '[2] \u041d\u0435\u0442' : '[2] No',
                callback: () => {
                    scene.log.addMessage(
                        scene.loc.language === 'ru'
                            ? '\u0413\u043e\u0433\u0438: "\u041d\u0443 \u0438 \u0432\u0430\u043b\u0438 \u043d\u0430\u0445\u0440\u0435\u043d."'
                            : 'Gogi: "Then get lost."',
                        '#d4c87a'
                    );
                    scene.showReturnButton();
                },
                fill: 0x202020,
            },
        ]);
    }

    private showShrineOptions(): void {
        const scene = this.scene;
        scene.sfx.play('shrine');
        scene.tracker.record('shrinesVisited');
        const npcId = scene.npcs.pickForRole('shrine', scene.dungeon.currentDepth);
        if (npcId) {
            this.presentNpcRoom(npcId, scene.loc.t('shrine'));
        } else {
            this.showGenericShrineOptions();
        }
    }

    private showGenericShrineOptions(): void {
        const scene = this.scene;
        const actions: RoomButtonAction[] = [
            {
                label: scene.loc.language === 'ru' ? '[1] \u0411\u043b\u0430\u0433\u043e\u0441\u043b\u043e\u0432\u0435\u043d\u0438\u0435 (+1 \u0443\u0440\u043e\u043d)' : '[1] Blessing (+1 attack)',
                callback: () => {
                    scene.player.addAttackBonus(1);
                    scene.log.addMessage(
                        scene.loc.language === 'ru'
                            ? '\u0410\u043b\u0442\u0430\u0440\u044c \u0431\u043b\u0430\u0433\u043e\u0441\u043b\u043e\u0432\u043b\u044f\u0435\u0442 \u043e\u0440\u0443\u0436\u0438\u0435: +1 \u0443\u0440\u043e\u043d.'
                            : 'The altar blesses your weapon: +1 attack.',
                        '#d7b6ff'
                    );
                    scene.enemyIntelText.setText(scene.loc.t('shrineRemembersName'));
                    scene.showReturnButton();
                },
                fill: 0x5f4e8a,
            },
            {
                label: scene.loc.language === 'ru' ? '[2] \u041c\u043e\u043b\u0438\u0442\u0432\u0430 (+5 \u041e\u0417)' : '[2] Prayer (+5 HP)',
                callback: () => {
                    scene.player.addMaxHpBonus(5, 5);
                    scene.log.addMessage(
                        scene.loc.language === 'ru'
                            ? '\u0410\u043b\u0442\u0430\u0440\u044c \u0443\u043a\u0440\u0435\u043f\u043b\u044f\u0435\u0442 \u0442\u0435\u043b\u043e: +5 \u0436\u0438\u0437\u043d\u0438.'
                            : 'The altar strengthens your body: +5 HP.',
                        '#79e28f'
                    );
                    scene.enemyIntelText.setText(scene.loc.t('shrineRemembersName'));
                    scene.showReturnButton();
                },
                fill: 0x2f8b4b,
            },
            {
                label: scene.loc.language === 'ru' ? '[3] \u0420\u0435\u0447\u044c (+3 \u0432\u043e\u043b\u0438)' : '[3] Speech (+3 resolve)',
                callback: () => {
                    scene.player.gainResolve(3);
                    scene.log.addMessage(
                        scene.loc.language === 'ru'
                            ? '\u0410\u043b\u0442\u0430\u0440\u044c \u043d\u0430\u043f\u043e\u043b\u043d\u044f\u0435\u0442 \u0440\u0435\u0448\u0438\u043c\u043e\u0441\u0442\u044c\u044e: +3 \u0432\u043e\u043b\u0438.'
                            : 'The altar fills you with resolve: +3 resolve.',
                        '#9bc8ff'
                    );
                    scene.enemyIntelText.setText(scene.loc.t('shrineRemembersName'));
                    scene.showReturnButton();
                },
                fill: 0x1b335b,
            },
            {
                label: scene.loc.language === 'ru' ? '[4] \u0421\u043e\u0432\u0435\u0442 (+1 \u0437\u0430\u0449\u0438\u0442\u0430)' : '[4] Counsel (+1 defense)',
                callback: () => {
                    scene.player.addDefenseBonus(1);
                    scene.log.addMessage(
                        scene.loc.language === 'ru'
                            ? '\u0410\u043b\u0442\u0430\u0440\u044c \u0443\u043a\u0440\u0435\u043f\u043b\u044f\u0435\u0442 \u0437\u0430\u0449\u0438\u0442\u0443: +1 \u0437\u0430\u0449\u0438\u0442\u0430.'
                            : 'The altar fortifies your guard: +1 defense.',
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

    private showMerchantOptions(): void {
        const scene = this.scene;
        scene.sfx.play('merchant');
        scene.tracker.record('merchantsVisited');
        const npcId = scene.npcs.pickForRole('merchant', scene.dungeon.currentDepth);
        if (npcId) {
            this.presentNpcRoom(npcId, scene.loc.t('merchant'));
            return;
        }
        this.showGenericMerchantOptions();
    }

    private showGenericMerchantOptions(): void {
        const scene = this.scene;
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

        if (FEATURES.light && scene.player.isLightUnlocked) {
            actions.push({
                label: scene.loc.t('actionLantern', { num: actions.length + 1, cost: ROOM_CONFIG.merchant.lanternCost }),
                callback: () => {
                    if (!scene.player.spendGold(ROOM_CONFIG.merchant.lanternCost)) {
                        return;
                    }
                    scene.tracker.record('goldSpent', ROOM_CONFIG.merchant.lanternCost);
                    const gainedLight = scene.player.gainLight(ROOM_CONFIG.merchant.lanternLightGain);
                    scene.log.addMessage(scene.loc.t('buyLantern', { value: gainedLight }), '#ffe08a');
                    scene.enemyIntelText.setText(scene.loc.t('npcMerchantOil'));
                    scene.showReturnButton();
                },
                enabled: scene.player.resources.gold >= ROOM_CONFIG.merchant.lanternCost,
                fill: 0x8a5d2d,
            });
        }

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

    private showEmptyOptions(): void {
        const scene = this.scene;
        if (Math.random() < 0.35) {
            const npcId = scene.npcs.pickForRole('wanderer', scene.dungeon.currentDepth);
            if (npcId) {
                this.presentNpcRoom(npcId, scene.loc.t('roomEnemyEncounterTitle'));
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
                icon: '\'',
            },
        ];
        const event = subEvents[Math.floor(Math.random() * subEvents.length)];

        scene.showRoomCard(
            scene.loc.t('empty'),
            event.title,
            event.desc,
            0x444444,
            event.icon,
            scene.loc.t('roomEmptyHint'),
            'EMPTY'
        );

        scene.setRoomButtons([
            {
                label: scene.loc.t('actionScout'),
                callback: () => {
                    const gains: string[] = [];
                    const lightGain = scene.player.gainLight(ROOM_CONFIG.empty.scoutLightGain);
                    if (lightGain > 0) {
                        gains.push(`${lightGain} ${scene.loc.t('unitLight')}`);
                    }

                    if (
                        scene.player.isGoldUnlocked &&
                        Math.random() < ROOM_CONFIG.empty.scoutGoldChance
                    ) {
                        const gold = scene.player.gainGold(
                            randomInt(defaultRng, ROOM_CONFIG.empty.scoutGoldMin, ROOM_CONFIG.empty.scoutGoldMax)
                        );
                        if (gold > 0) scene.tracker.record('goldEarned', gold);
                        gains.push(`${gold} ${scene.loc.t('unitGold')}`);
                    }

                    if (gains.length === 0) {
                        const xp = scene.player.gainXp(1);
                        gains.push(scene.loc.t('plusXp', { value: xp }).replace(/^\+/, ''));
                    }

                    scene.log.addMessage(scene.loc.t('emptyScout', { parts: gains.join(', ') }), '#bbbbbb');
                    scene.enemyIntelText.setText(scene.loc.t('roomEmptyAfterSearch'));
                    scene.showReturnButton();
                },
                fill: 0x3d3d3d,
            },
            {
                label: scene.loc.t('actionSteady'),
                callback: () => {
                    if (scene.player.isResolveUnlocked) {
                        const gained = scene.player.gainResolve(ROOM_CONFIG.empty.steadyResolveGain);
                        scene.log.addMessage(scene.loc.t('emptySteady', { value: gained }), '#9bc8ff');
                    } else {
                        const gainedXp = scene.player.gainXp(1);
                        scene.log.addMessage(scene.loc.t('emptyStudy', { value: gainedXp }), '#bbbbbb');
                    }
                    scene.enemyIntelText.setText(scene.loc.t('roomEmptyAfterSkip'));
                    scene.showReturnButton();
                },
                fill: 0x2b2b2b,
            },
        ]);
    }
}
