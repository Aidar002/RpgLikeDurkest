import { EXPEDITION_CONFIG, MAP_CONFIG, ROOM_CONFIG, STRESS_CONFIG } from '../data/GameConfig';
import { RoomType } from '../systems/MapGenerator';
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

        const sparesLight =
            scene.player.aggregate.emptyRoomsSpareLight && node.type === RoomType.EMPTY;
        if (scene.skipLightSpendThisRoom) {
            scene.skipLightSpendThisRoom = false;
        } else if (!sparesLight) {
            const spent = scene.player.spendLight(EXPEDITION_CONFIG.lightLossPerRoom);
            if (spent > 0) {
                scene.log.addMessage(scene.loc.t('lightLower', { count: spent }), '#e0c873');
            }
        }

        if (scene.player.hasLowLight && node.type !== RoomType.START) {
            scene.stress.add(STRESS_CONFIG.onLowLightRoom, scene.player.aggregate.stressReductionPct);
            if (Math.random() < 0.3) {
                scene.log.addMessage(narrate('low_light', scene.loc.language), '#c4a35a');
            }
        }
        if (scene.player.hasHighLight && node.type === RoomType.EMPTY) {
            scene.stress.add(STRESS_CONFIG.onEmptyRoomHighLight, scene.player.aggregate.stressReductionPct);
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
        scene.stress.relieve(STRESS_CONFIG.onTreasure);
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
                            scene.meta.getBonuses().rooms.restHealBonus +
                            scene.player.aggregate.restHealBonus
                    );
                    if (healed > 0) scene.tracker.record('healingDone', healed);
                    const lightGained = scene.player.gainLight(ROOM_CONFIG.rest.recoverLight);
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
            {
                label: scene.loc.t('restMeditateLabel'),
                callback: () => {
                    scene.stress.relieve(ROOM_CONFIG.rest.meditateStressRelief);
                    scene.log.addMessage(
                        scene.loc.t('restMeditateApplied', { meditateStressRelief: ROOM_CONFIG.rest.meditateStressRelief }),
                        '#d6b8ff'
                    );
                    scene.enemyIntelText.setText(scene.loc.t('restMeditateAfter'));
                    scene.showReturnButton();
                },
                fill: 0x3e2260,
            },
        ]);
    }

    private buildNpcEvalContext(): NpcEvalContext {
        const scene = this.scene;
        const hpFrac = scene.player.stats.maxHp > 0
            ? scene.player.stats.hp / scene.player.stats.maxHp
            : 1;
        const r = scene.stress.resolution;
        return {
            depth: scene.dungeon.currentDepth,
            hpFrac,
            stress: scene.stress.value,
            resolution: r ? r.kind : 'none',
            bleedDamageDealt: scene.tracker.current.bleedDamageDealt,
            relicsFound: scene.tracker.current.relicsFound,
            bossesKilledEver: scene.meta.bossesKilledEver,
        };
    }

    private npcOfferCost(offerId: string, _npcId: NpcId): number {
        const scene = this.scene;
        switch (offerId) {
            case 'mira_potion':
                return ROOM_CONFIG.merchant.potionCost;
            case 'mira_lantern':
                return ROOM_CONFIG.merchant.lanternCost;
            case 'mira_armor':
                return ROOM_CONFIG.merchant.armorCost;
            case 'mira_relic_oil':
                return ROOM_CONFIG.merchant.premiumShardCost;
            case 'casimir_offer':
                return ROOM_CONFIG.shrine.offerGoldCost;
            case 'casimir_rite':
                return ROOM_CONFIG.shrine.premiumShardCost;
            case 'hollow_relic_for_hp':
                return Math.max(4, Math.floor(scene.player.stats.maxHp * 0.25));
            case 'hollow_shards_for_relic':
                return 2;
            case 'hollow_potion_for_gold':
                return ROOM_CONFIG.merchant.potionCost - 2;
            case 'veth_challenge':
                return Math.max(3, Math.floor(scene.player.stats.maxHp * 0.15));
            case 'veth_lesson':
                return 25;
            case 'chorister_relieve':
                return ROOM_CONFIG.shrine.offerGoldCost - 6;
            case 'chorister_resolve':
                return ROOM_CONFIG.shrine.offerGoldCost - 8;
            case 'chorister_unbind':
                return ROOM_CONFIG.shrine.premiumShardCost;
            default:
                return 0;
        }
    }

    private isNpcOfferEnabled(offer: NpcOfferTemplate, npcId: NpcId): boolean {
        const scene = this.scene;
        const cost = this.npcOfferCost(offer.id, npcId);
        switch (offer.id) {
            case 'mira_potion':
            case 'mira_lantern':
            case 'mira_armor':
            case 'casimir_offer':
            case 'chorister_relieve':
            case 'chorister_resolve':
                return scene.player.resources.gold >= cost;
            case 'mira_relic_oil':
            case 'casimir_rite':
            case 'hollow_shards_for_relic':
            case 'chorister_unbind':
                return scene.player.resources.relicShards >= cost;
            case 'hollow_relic_for_hp':
            case 'veth_challenge':
                return scene.player.stats.hp > cost + 1;
            case 'veth_lesson':
                return scene.stress.value < 100;
            case 'hollow_potion_for_gold':
                return scene.player.resources.potions > 0;
            case 'veth_strop':
                return !scene.vethSharpenedThisRoom;
            case 'kessa_tea':
            case 'kessa_warning':
                return true;
            case 'kessa_token':
                return !scene.npcs.hasFlag('kessa', 'gave-token');
            default:
                return true;
        }
    }

    private presentNpcRoom(npcId: NpcId, headerLabel: string): void {
        const scene = this.scene;
        scene.vethSharpenedThisRoom = false;

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
        const cost = this.npcOfferCost(offer.id, npcId);
        let consumed = true;
        let affinityDelta = 1;

        switch (offer.id) {
            // -- Mira ------------------------------------------------------------
            case 'mira_potion':
                if (!scene.player.spendGold(cost)) { consumed = false; break; }
                scene.tracker.record('goldSpent', cost);
                scene.player.gainPotions(1);
                scene.log.addMessage(scene.loc.t('npcMiraPotion'), '#9be0a7');
                break;
            case 'mira_lantern': {
                if (!scene.player.spendGold(cost)) { consumed = false; break; }
                scene.tracker.record('goldSpent', cost);
                const gainedLight = scene.player.gainLight(ROOM_CONFIG.merchant.lanternLightGain);
                scene.log.addMessage(scene.loc.t('npcMiraLight', { gainedLight }), '#ffe08a');
                affinityDelta = 2;
                break;
            }
            case 'mira_armor':
                if (!scene.player.spendGold(cost)) { consumed = false; break; }
                scene.tracker.record('goldSpent', cost);
                scene.player.addDefenseBonus(ROOM_CONFIG.merchant.armorDefenseGain);
                scene.log.addMessage(scene.loc.t('npcMiraArmor', { armorDefenseGain: ROOM_CONFIG.merchant.armorDefenseGain }), '#b8d3ff');
                break;
            case 'mira_relic_oil':
                if (!scene.player.spendRelicShard(cost)) { consumed = false; break; }
                scene.player.addAttackBonus(ROOM_CONFIG.merchant.premiumAttackBonus);
                scene.player.gainPotions(ROOM_CONFIG.merchant.premiumPotionBonus);
                scene.log.addMessage(
                    scene.loc.t('npcMiraPremium', { premiumAttackBonus: ROOM_CONFIG.merchant.premiumAttackBonus, premiumPotionBonus: ROOM_CONFIG.merchant.premiumPotionBonus }),
                    '#ffd9f7'
                );
                affinityDelta = 2;
                break;

            // -- Casimir ---------------------------------------------------------
            case 'casimir_pray':
                if (Math.random() < ROOM_CONFIG.shrine.prayBlessChance) {
                    scene.player.addAttackBonus(ROOM_CONFIG.shrine.prayAttackBonus);
                    scene.log.addMessage(
                        scene.loc.t('npcCasimirPray', { prayAttackBonus: ROOM_CONFIG.shrine.prayAttackBonus }),
                        '#d7b6ff'
                    );
                    affinityDelta = 2;
                } else {
                    const damage = scene.player.takeDamage(ROOM_CONFIG.shrine.prayDamage);
                    const resolve = scene.player.gainResolve(ROOM_CONFIG.shrine.prayResolveGain);
                    scene.log.addMessage(
                        scene.loc.t('npcCasimirOffer', { damage, resolve }),
                        '#c99cff'
                    );
                    affinityDelta = 1;
                }
                break;
            case 'casimir_offer':
                if (!scene.player.spendGold(cost)) { consumed = false; break; }
                scene.tracker.record('goldSpent', cost);
                scene.player.addMaxHpBonus(ROOM_CONFIG.shrine.offerMaxHpBonus);
                scene.log.addMessage(
                    scene.loc.t('npcCasimirFeed', { offerMaxHpBonus: ROOM_CONFIG.shrine.offerMaxHpBonus }),
                    '#ffd36e'
                );
                affinityDelta = 2;
                break;
            case 'casimir_rite':
                if (!scene.player.spendRelicShard(cost)) { consumed = false; break; }
                scene.player.addMaxHpBonus(
                    ROOM_CONFIG.shrine.premiumMaxHpBonus,
                    ROOM_CONFIG.shrine.premiumMaxHpBonus
                );
                scene.player.gainResolve(ROOM_CONFIG.shrine.premiumResolveBonus);
                scene.log.addMessage(
                    scene.loc.t('npcCasimirRite', { premiumMaxHpBonus: ROOM_CONFIG.shrine.premiumMaxHpBonus, premiumResolveBonus: ROOM_CONFIG.shrine.premiumResolveBonus }),
                    '#ffd9f7'
                );
                affinityDelta = 2;
                break;

            // -- Hollow Trader ---------------------------------------------------
            case 'hollow_relic_for_hp': {
                scene.player.takeDamage(cost, 0, 'true');
                const got = scene.maybeDropRelic('elite');
                if (!got) {
                    scene.player.gainGold(8);
                    scene.log.addMessage(scene.loc.t('npcHollowPay'), '#a8a0c0');
                } else {
                    scene.log.addMessage(scene.loc.t('npcHollowMark'), '#a8a0c0');
                }
                affinityDelta = 2;
                scene.npcs.addFlag('hollow', 'paid-in-blood');
                break;
            }
            case 'hollow_shards_for_relic':
                if (!scene.player.spendRelicShard(cost)) { consumed = false; break; }
                scene.maybeDropRelic('boss');
                scene.log.addMessage(scene.loc.t('npcHollowRelic'), '#f0a8ff');
                affinityDelta = 2;
                break;
            case 'hollow_potion_for_gold':
                if (scene.player.resources.potions <= 0) { consumed = false; break; }
                scene.player.resources.potions -= 1;
                scene.player.gainGold(cost);
                scene.log.addMessage(scene.loc.t('npcHollowPotion', { cost }), '#ffd36e');
                break;

            // -- Veth ------------------------------------------------------------
            case 'veth_challenge': {
                scene.player.takeDamage(cost, 0, 'true');
                const got = scene.maybeDropRelic('elite');
                if (!got) {
                    scene.player.gainGold(20);
                    scene.log.addMessage(scene.loc.t('npcVethCoin'), '#ffb084');
                } else {
                    scene.log.addMessage(scene.loc.t('npcVethCarry'), '#ffb084');
                }
                affinityDelta = 2;
                scene.npcs.addFlag('veth', 'pacted');
                break;
            }
            case 'veth_lesson':
                scene.stress.add(cost);
                scene.player.addAttackBonus(2);
                scene.log.addMessage(scene.loc.t('npcVethThirdCut'), '#ffb084');
                affinityDelta = 2;
                scene.npcs.addFlag('veth', 'taught');
                break;
            case 'veth_strop':
                if (scene.vethSharpenedThisRoom) { consumed = false; break; }
                scene.vethSharpenedThisRoom = true;
                scene.player.addAttackBonus(1);
                scene.log.addMessage(scene.loc.t('npcVethStrop'), '#ffb084');
                affinityDelta = 1;
                break;

            // -- Chorister -------------------------------------------------------
            case 'chorister_relieve':
                if (!scene.player.spendGold(cost)) { consumed = false; break; }
                scene.tracker.record('goldSpent', cost);
                scene.stress.relieve(20);
                scene.log.addMessage(scene.loc.t('npcChoristerSong'), '#d6b8ff');
                affinityDelta = 2;
                break;
            case 'chorister_resolve':
                if (!scene.player.spendGold(cost)) { consumed = false; break; }
                scene.tracker.record('goldSpent', cost);
                scene.player.gainResolve(2);
                scene.log.addMessage(scene.loc.t('npcChoristerSteady'), '#9bc8ff');
                break;
            case 'chorister_unbind':
                if (!scene.player.spendRelicShard(cost)) { consumed = false; break; }
                if (scene.stress.resolution && scene.stress.resolution.kind === 'affliction') {
                    scene.stress.resolution = null;
                    scene.updateStressUI();
                    scene.log.addMessage(scene.loc.t('npcChoristerUnbind'), '#ffd9f7');
                    affinityDelta = 3;
                } else {
                    scene.player.gainResolve(3);
                    scene.log.addMessage(scene.loc.t('npcChoristerCarry'), '#ffd9f7');
                    affinityDelta = 1;
                }
                break;

            // -- Kessa -----------------------------------------------------------
            case 'kessa_tea':
                scene.player.heal(4);
                scene.stress.relieve(10);
                scene.log.addMessage(scene.loc.t('npcKessaCup'), '#9be0a7');
                affinityDelta = 2;
                break;
            case 'kessa_warning':
                scene.player.gainResolve(1);
                scene.log.addMessage(
                    scene.loc.t('npcKessaTip'),
                    '#9bc8ff'
                );
                affinityDelta = 1;
                break;
            case 'kessa_token':
                scene.player.addAttackBonus(1);
                scene.player.addDefenseBonus(1);
                scene.log.addMessage(
                    scene.loc.t('npcKessaEarring'),
                    '#ffd36e'
                );
                scene.npcs.addFlag('kessa', 'gave-token');
                affinityDelta = 3;
                break;

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
                label: scene.loc.t('actionPray'),
                callback: () => {
                    if (Math.random() < ROOM_CONFIG.shrine.prayBlessChance) {
                        scene.player.addAttackBonus(ROOM_CONFIG.shrine.prayAttackBonus);
                        scene.log.addMessage(scene.loc.t('shrineAttack'), '#d7b6ff');
                    } else {
                        const damage = scene.player.takeDamage(ROOM_CONFIG.shrine.prayDamage);
                        const resolve = scene.player.gainResolve(ROOM_CONFIG.shrine.prayResolveGain);
                        scene.log.addMessage(scene.loc.t('shrineWound', { damage, resolve }), '#c99cff');
                    }
                    if (scene.player.stats.hp > 0) {
                        scene.enemyIntelText.setText(scene.loc.t('shrineRemembersName'));
                        scene.showReturnButton();
                    }
                },
                fill: 0x5f4e8a,
            },
            {
                label: scene.loc.t('actionDynamicLeave', { num: 2 }),
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

        if (scene.player.isLightUnlocked) {
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
