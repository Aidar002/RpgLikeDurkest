import * as Phaser from 'phaser';
import { COMBAT_CONFIG, MAP_CONFIG } from '../data/GameConfig';
import { type CombatAction, type CombatEndPayload } from '../systems/CombatManager';
import { SKILLS } from '../systems/Skills';
import { compactText } from '../ui/TextHelpers';
import { CENTER_X, CENTER_Y, Depths, GAME_HEIGHT, GAME_WIDTH } from '../ui/Layout';
import { PixelSprite } from '../ui/PixelSprite';
import { fitEnemySprite } from '../ui/RoomVisuals';
import { VFX } from '../ui/VFX';
import type { GameScene, RoomButtonAction } from './GameScene';

export class CombatHudController {
    private readonly scene: GameScene;

    constructor(scene: GameScene) {
        this.scene = scene;
    }

    start(kind: 'normal' | 'elite' | 'boss'): void {
        const scene = this.scene;
        const isFinalBoss = kind === 'boss' && scene.dungeon.currentDepth >= MAP_CONFIG.finalDepth;
        const card = kind === 'boss'
            ? {
                  header: isFinalBoss ? (scene.loc.language === 'ru' ? 'СТРАЖ АРТЕФАКТА' : 'ARTIFACT GUARDIAN') : scene.loc.t('boss'),
                  title: isFinalBoss
                      ? (scene.loc.language === 'ru' ? 'Хранитель Артефакта Желаний.' : 'The Guardian of the Wish Artifact.')
                      : scene.loc.t('hudBossPrologueA'),
                  description: isFinalBoss
                      ? (scene.loc.language === 'ru' ? 'Последний страж. За ним лежит Артефакт Желаний.' : 'The final keeper. Beyond it lies the wish-granting artifact.')
                      : scene.loc.t('hudBossPrologueB'),
                  color: isFinalBoss ? 0xc8a030 : 0xa52f2f,
                  icon: isFinalBoss ? '\u2726' : 'B',
              }
            : kind === 'elite'
              ? {
                    header: scene.loc.t('elite'),
                    title: scene.loc.t('hudEliteIntroTitle'),
                    description: scene.loc.t('hudEliteIntroBody'),
                    color: 0xa14a4a,
                    icon: 'E',
                }
              : {
                    header: scene.loc.t('hostile'),
                    title: scene.loc.t('hudCombatContactTitle'),
                    description: scene.loc.t('hudCombatContactBody'),
                    color: 0x6b3030,
                    icon: 'X',
                };

        scene.showRoomCard(
            card.header,
            card.title,
            card.description,
            card.color,
            card.icon,
            scene.loc.t('chooseMove'),
            kind === 'boss' ? 'BOSS' : kind === 'elite' ? 'ELITE' : 'ENEMY'
        );
        scene.combat.startCombat(scene.dungeon.currentDepth, kind);
        this.refreshButtons();

        if (kind === 'boss') {
            scene.sfx.play('bossAppear');
        } else if (kind === 'elite') {
            scene.sfx.play('eliteAppear');
        }

        if (kind === 'boss') {
            const intro = scene.npcs.pickBossIntro(scene.loc.language);
            if (intro) {
                scene.log.addMessage(intro.line, '#cdb8ff');
            }
        }
    }

    refreshButtons(): void {
        const scene = this.scene;
        if (!scene.combat.enemy) {
            scene.setRoomButtons([]);
            return;
        }

        const actions: RoomButtonAction[] = [
            {
                label: scene.loc.t('actionAttack'),
                callback: () => this.performAction('attack'),
                fill: 0x5a1d1d,
            },
            {
                label: scene.loc.t('actionDefend'),
                callback: () => this.performAction('defend'),
                fill: 0x1b335b,
            },
        ];

        scene.skillLoadout.forEach((id) => {
            const def = SKILLS[id];
            const cost = Math.max(1, def.resolveCost + (scene.stress?.resolveCostMod() ?? 0));
            actions.push({
                label: `[${actions.length + 1}] ${scene.skillShort(id)} ${cost}${scene.loc.t('resolveShort').toLowerCase()}`,
                callback: () => this.performAction({ kind: 'skill', id }),
                enabled: scene.player.resources.resolve >= cost,
                fill: def.color,
            });
        });

        actions.push({
            label: scene.loc.t('actionPotion', { num: actions.length + 1 }),
            callback: () => this.performAction('potion'),
            enabled: scene.player.resources.potions > 0,
            fill: 0x1f5b2f,
        });

        scene.setRoomButtons(actions);
        scene.enemyIntelText.setText(this.buildIntel());
        scene.enemyIntelText.setVisible(true);
    }

    performAction(action: CombatAction): void {
        const scene = this.scene;
        if (!scene.combat.enemy) {
            return;
        }

        scene.actionButtons.forEach((b) => { b.enabled = false; });

        const hpBefore = scene.combat.enemy.hp;
        scene.tracker.record('turnsInCombat');
        const actionKind = typeof action === 'string' ? action : action.kind;
        if (actionKind === 'skill') {
            scene.tracker.record('skillsUsed');
            scene.sfx.play('skillUse');
        }
        if (actionKind === 'defend') {
            scene.tracker.record('defendsUsed');
            VFX.shieldFlash(scene, 126, 82);
            scene.sfx.play('defend');
        }
        if (actionKind === 'potion') {
            scene.tracker.record('potionsUsed');
            VFX.healGlow(scene, 126, 82);
            scene.sfx.play('potion');
        }

        scene.combat.processTurn(action);

        if (scene.combat.lastActionResult.critical) {
            scene.tracker.record('criticalHits');
            VFX.critFlash(scene);
            scene.sfx.play('crit');
        } else if (actionKind === 'attack' || actionKind === 'skill') {
            scene.sfx.play('hit');
        }

        const dmgDealt = hpBefore - (scene.combat.enemy?.hp ?? 0);
        if (dmgDealt > 0) scene.tracker.record('damageDealt', dmgDealt);

        scene.time.delayedCall(350, () => {
            if (scene.combat.enemy) {
                this.refreshButtons();
            }
        });
    }

    buildIntel(): string {
        const scene = this.scene;
        if (!scene.combat.enemy) {
            return scene.loc.t('hudReturnHint');
        }

        const enemy = scene.combat.enemy;
        const profileHints: Record<string, string> = {
            brute: scene.loc.t('hudProfileBrute'),
            stalker: scene.loc.t('hudProfileStalker'),
            mage: scene.loc.t('hudProfileMage'),
            boss: scene.loc.t('hudProfileBoss'),
        };

        const hints: string[] = [];
        hints.push(profileHints[enemy.profile] ?? '');

        if (enemy.enraged) {
            hints.push(scene.loc.t('hudHintEnraged'));
        }
        if (enemy.charging) {
            hints.push(scene.loc.t('hudHintCharging'));
        }

        if (scene.meta.isUnlocked('action_skill')) {
            hints.push(
                scene.loc.t('hudHintSkillCost', { skillCost: COMBAT_CONFIG.skillCost })
            );
        }

        return hints.filter(Boolean).join(' ');
    }

    updateEnemyUI(
        hp: number,
        maxHp: number,
        color: number,
        name: string,
        icon: string
    ): void {
        const scene = this.scene;
        const unlocks = scene.meta.getUiUnlockState();
        const description = scene.combat.enemy?.description ?? scene.loc.t('enemyFallback');

        const isFinalBoss = scene.combat.enemy?.kind === 'boss' && scene.dungeon.currentDepth >= MAP_CONFIG.finalDepth;
        scene.roomHeaderText.setText(
            isFinalBoss
                ? (scene.loc.language === 'ru' ? 'СТРАЖ АРТЕФАКТА' : 'ARTIFACT GUARDIAN')
                : scene.combat.enemy?.kind === 'boss'
                  ? scene.loc.t('boss')
                  : scene.combat.enemy?.kind === 'elite'
                    ? scene.loc.t('elite')
                    : scene.loc.t('hostile')
        );
        scene.enemyPortrait.setFillStyle(color);
        scene.enemyIconText.setText(icon);
        scene.enemyNameText.setText(compactText(name, 28));
        scene.roomFlavorText.setText(compactText(description, 72));
        scene.roomPanelGroup.setVisible(true);

        const profile = scene.combat.enemy?.profile;
        if (profile) {
            const sprKey = PixelSprite.enemyKey(profile);
            if (scene.textures.exists(sprKey)) {
                scene.enemySpriteImage.setTexture(sprKey).setVisible(true);
                fitEnemySprite(scene.enemySpriteImage);
                scene.enemyIconText.setVisible(false);
            } else {
                scene.enemySpriteImage.setVisible(false);
                scene.enemyIconText.setVisible(true);
            }
        } else {
            scene.enemySpriteImage.setVisible(false);
            scene.enemyIconText.setVisible(true);
        }

        const ratio = Phaser.Math.Clamp(hp / maxHp, 0, 1);
        scene.enemyHpBar.setDisplaySize(ratio * 220, 12);
        scene.enemyHpBar.setFillStyle(ratio > 0.5 ? 0xc65a2e : ratio > 0.25 ? 0xcf9e16 : 0xc63d2d);
        scene.enemyHpText.setText(`${scene.loc.t('hp')} ${Math.max(0, hp)}/${maxHp}`);
        scene.enemyHpBarBg.setVisible(unlocks.showEnemyHp);
        scene.enemyHpBar.setVisible(unlocks.showEnemyHp);
        scene.enemyHpText.setVisible(unlocks.showEnemyHp);
        scene.enemyIntelText.setVisible(true);
        scene.enemyIntelText.setText(
            unlocks.showEnemyHp
                ? compactText(this.buildIntel(), 54)
                : scene.loc.t('enemyInfoLocked')
        );

        if (scene.lastEnemyHp > 0 && hp < scene.lastEnemyHp) {
            const damage = scene.lastEnemyHp - hp;
            VFX.floatText(scene, 616, 138, `-${damage}`, '#ff7373');
            VFX.shake(scene, scene.enemyPortrait);
            VFX.flash(scene, scene.enemyPortrait, 0xff3232, 120);
        }

        scene.lastEnemyHp = hp;
    }

    handleVictory(payload: CombatEndPayload): void {
        const scene = this.scene;
        const rewardLines: string[] = [];

        scene.tracker.record('enemiesKilled');
        if (payload.kind === 'elite') scene.tracker.record('elitesKilled');
        if (payload.kind === 'boss') {
            scene.runBossKills += 1;
            scene.tracker.record('bossesKilled');
            const bossMilestones = scene.meta.registerBossKill();
            scene.handleMilestoneUnlocks(bossMilestones);
        }

        const gainedXp = scene.player.gainXp(payload.rewards.xp);
        rewardLines.push(scene.loc.t('plusXp', { value: gainedXp }));

        const gainedGold = scene.player.gainGold(payload.rewards.gold);
        if (gainedGold > 0) {
            rewardLines.push(scene.loc.t('plusGold', { value: gainedGold }));
            scene.tracker.record('goldEarned', gainedGold);
        }

        const gainedPotions = scene.player.gainPotions(payload.rewards.potions);
        if (gainedPotions > 0) {
            rewardLines.push(scene.loc.t('plusPotion'));
        }

        if (payload.rewards.attackBonus > 0) {
            scene.player.addAttackBonus(payload.rewards.attackBonus);
            rewardLines.push(scene.loc.t('plusAttack', { value: payload.rewards.attackBonus }));
        }

        const gainedShards = scene.player.gainRelicShards(payload.rewards.relicShards);
        if (gainedShards > 0) {
            rewardLines.push(scene.loc.t('plusShard', { value: gainedShards }));
        }

        scene.player.registerKill();
        scene.log.addMessage(scene.loc.t('victoryRewards', { parts: rewardLines.join(', ') }), '#9be0a7');

        if (payload.kind === 'boss') {
            scene.maybeDropRelic('boss');
            const intro = scene.npcs.pickBossIntro(scene.loc.language);
            if (intro) {
                const farewells = intro.npc.voice.farewell;
                const line = scene.loc.pick(farewells[Math.floor(Math.random() * farewells.length)]);
                scene.log.addMessage(line, '#cdb8ff');
            }

            if (scene.dungeon.currentDepth >= MAP_CONFIG.finalDepth) {
                scene.time.delayedCall(800, () => scene.showVictoryScreen());
                return;
            }
        } else if (payload.kind === 'elite') {
            scene.maybeDropRelic('elite');
        } else if (Math.random() < 0.07) {
            scene.maybeDropRelic('normal');
        }

        scene.enemyIntelText.setText(scene.loc.t('pathOpen'));
        scene.showReturnButton();
        scene.refreshUI();
    }

    onPlayerHit(damage: number): void {
        const scene = this.scene;
        scene.tracker.record('damageTaken', damage);
        scene.sfx.play('enemyHit');
        const intensity = Math.min(0.015, 0.004 * damage);
        scene.cameras.main.shake(220, intensity);
        const flash = scene.add.rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0xff0000, 0.18).setDepth(Depths.ScreenFlash);
        scene.tweens.add({
            targets: flash,
            alpha: 0,
            duration: 300,
            onComplete: () => flash.destroy(),
        });
        VFX.floatText(scene, 126, 82, `-${damage}`, '#ff5555');

        if (
            scene.player.stats.maxHp > 0 &&
            scene.player.stats.hp / scene.player.stats.maxHp <= 0.25 &&
            Math.random() < 0.4
        ) {
            const recall = scene.npcs.pickLowHpRecall(scene.loc.language);
            if (recall) scene.log.addMessage(recall, '#a89dc4');
        }
    }
}
