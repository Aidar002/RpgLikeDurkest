import * as Phaser from 'phaser';
import { MAP_CONFIG } from '../data/GameConfig';
import { type CombatAction, type CombatEndPayload } from '../systems/CombatManager';
import { SKILLS } from '../systems/Skills';
import { compactText } from '../ui/TextHelpers';
import { CENTER_X, CENTER_Y, Depths, GAME_HEIGHT, GAME_WIDTH, RoomLayout } from '../ui/Layout';
import { fitEnemySprite, resolveEnemyTextureKey } from '../ui/RoomVisuals';
import { VFX } from '../ui/VFX';
import { playEffect } from '../ui/EffectsLibrary';
import type { GameScene, RoomButtonAction } from './GameScene';
import { variantFromFill } from '../ui/RoomButtonVariant';

export class CombatHudController {
    private readonly scene: GameScene;

    constructor(scene: GameScene) {
        this.scene = scene;
    }

    start(kind: 'normal' | 'elite' | 'boss'): void {
        const scene = this.scene;
        const isFinalBoss = kind === 'boss' && scene.dungeon.currentDepth >= MAP_CONFIG.finalDepth;
        const card =
            kind === 'boss'
                ? {
                      header: isFinalBoss
                          ? scene.loc.language === 'ru'
                              ? 'СТРАЖ АРТЕФАКТА'
                              : 'ARTIFACT GUARDIAN'
                          : scene.loc.t('boss'),
                      title: isFinalBoss
                          ? scene.loc.language === 'ru'
                              ? 'Хранитель Артефакта Желаний.'
                              : 'The Guardian of the Wish Artifact.'
                          : scene.loc.t('hudBossPrologueA'),
                      description: isFinalBoss
                          ? scene.loc.language === 'ru'
                              ? 'Последний страж. За ним лежит Артефакт Желаний.'
                              : 'The final keeper. Beyond it lies the wish-granting artifact.'
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
            kind === 'boss' ? 'BOSS' : kind === 'elite' ? 'ELITE' : 'ENEMY'
        );
        scene.combat.startCombat(scene.dungeon.currentDepth, kind);
        this.refreshButtons();

        if (kind === 'boss') {
            scene.sfx.play('bossAppear');
        } else if (kind === 'elite') {
            scene.sfx.play('eliteAppear');
        }
    }

    refreshButtons(): void {
        const scene = this.scene;
        if (!scene.combat.enemy) {
            scene.roomButtons.setActions([]);
            return;
        }

        const actions: RoomButtonAction[] = [
            {
                label: scene.loc.t('actionAttack'),
                callback: () => this.performAction('attack'),
                variant: 'default',
            },
            {
                label: scene.loc.t('actionDefend'),
                callback: () => this.performAction('defend'),
                variant: 'silver',
                vfx: 'shieldBubble',
            },
        ];

        scene.skillLoadout.forEach((id) => {
            const def = SKILLS[id];
            const cost = Math.max(1, def.resolveCost);
            actions.push({
                label: `[${actions.length + 1}] ${scene.skillShort(id)} ${cost} ${scene.loc.t('resolveShort').toLowerCase()}`,
                callback: () => this.performAction({ kind: 'skill', id }),
                enabled: scene.player.resources.resolve >= cost,
                variant: variantFromFill(def.color),
            });
        });

        actions.push({
            label: scene.loc.t('actionPotion', { num: actions.length + 1 }),
            callback: () => this.performAction('potion'),
            enabled: scene.player.resources.potions > 0,
            variant: 'positive',
            vfx: 'healPulse',
        });

        scene.roomButtons.setActions(actions);
        scene.enemyIntelText.setText(this.buildIntel());
        scene.enemyIntelText.setVisible(true);
    }

    performAction(action: CombatAction): void {
        const scene = this.scene;
        if (!scene.combat.enemy) {
            return;
        }

        scene.roomButtons.disableAll();

        const hpBefore = scene.combat.enemy.hp;
        scene.tracker.record('turnsInCombat');
        const actionKind = typeof action === 'string' ? action : action.kind;
        if (actionKind === 'skill') {
            scene.tracker.record('skillsUsed');
            scene.sfx.play('skillUse');
            // Bleed-strike paints a thick blood splash across the
            // enemy portrait while the skill is being cast — the
            // generic `hit` SFX/VFX below isn't enough on its own
            // for the bleed-themed skill to feel meaty. The spread
            // covers the full 250×250 portrait box (see
            // ENEMY_SPRITE_MAX_DIM in RoomVisuals) so droplets land
            // edge-to-edge.
            const skillId = typeof action === 'string' ? undefined : action.id;
            if (skillId === 'bleed_strike') {
                playEffect(scene, 'bloodSplatter', RoomLayout.panelCenterX, scene.enemyPortrait.y, {
                    spreadX: 120,
                    spreadY: 120,
                    countScale: 4,
                });
            }
        }
        if (actionKind === 'defend') {
            scene.tracker.record('defendsUsed');
            VFX.shieldFlash(scene, 160, 82);
            scene.sfx.play('defend');
        }
        if (actionKind === 'potion') {
            scene.tracker.record('potionsUsed');
            VFX.healGlow(scene, 160, 82);
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
        const hints: string[] = [];
        // Show the boss intent + phase first so the player
        // can read what the boss is about to do before deciding their turn.
        if (enemy.currentIntent) {
            hints.push(scene.loc.t('hudIntentLabel', { intent: enemy.currentIntent }));
        }
        if (enemy.bossPhase) {
            const total = enemy.bossPhase.blueprint.phases.length;
            hints.push(
                scene.loc.t('hudPhaseLabel', {
                    current: enemy.bossPhase.phaseIndex + 1,
                    total,
                })
            );
        }

        return hints.filter(Boolean).join(' ');
    }

    updateEnemyUI(hp: number, maxHp: number, color: number, name: string, icon: string): void {
        const scene = this.scene;
        const unlocks = scene.meta.getUiUnlockState();
        const description = scene.combat.enemy?.description ?? scene.loc.t('enemyFallback');

        const isFinalBoss =
            scene.combat.enemy?.kind === 'boss' &&
            scene.dungeon.currentDepth >= MAP_CONFIG.finalDepth;
        scene.roomHeaderText.setText(
            isFinalBoss
                ? scene.loc.language === 'ru'
                    ? 'СТРАЖ АРТЕФАКТА'
                    : 'ARTIFACT GUARDIAN'
                : scene.combat.enemy?.kind === 'boss'
                  ? scene.loc.t('boss')
                  : scene.combat.enemy?.kind === 'elite'
                    ? scene.loc.t('elite')
                    : scene.loc.t('hostile')
        );
        // Keep the gray frame stripped during combat too — the
        // hand-authored 250×250 portrait IS the panel art, any backdrop
        // tint just shows as a stray border around the sprite.
        scene.enemyPortrait.setFillStyle(color, 0);
        scene.enemyIconText.setText(icon);
        scene.enemyNameText.setText(compactText(name, 36));
        // The description is rendered once in the pre-combat room
        // card; during combat the same Y-slot is owned by the HP bar
        // + intent line, so we hide the flavour text to avoid having
        // it bleed through the action-button row.
        scene.roomFlavorText.setText(compactText(description, 96));
        scene.roomFlavorText.setVisible(false);
        scene.roomPanelGroup.setVisible(true);

        // Prefer the hand-authored per-mob portrait
        // (`enemy_<canonical_name>`). Falls back to the procedural
        // profile bucket (`enemy_<profile>`) when the per-mob art
        // isn't shipped — `resolveEnemyTextureKey` returns `null` only
        // when both are missing, in which case we render the letter
        // glyph instead.
        const activeEnemy = scene.combat.enemy;
        const sprKey = activeEnemy
            ? resolveEnemyTextureKey(scene, activeEnemy.canonicalName, activeEnemy.profile)
            : null;
        if (sprKey) {
            scene.enemySpriteImage.setTexture(sprKey).setVisible(true);
            fitEnemySprite(scene.enemySpriteImage);
            scene.enemyIconText.setVisible(false);
        } else {
            scene.enemySpriteImage.setVisible(false);
            scene.enemyIconText.setVisible(true);
        }

        const ratio = Phaser.Math.Clamp(hp / maxHp, 0, 1);
        // HP bar grew to 360×18 in the redesigned right panel — keep
        // setDisplaySize in sync with GameRoomController.build().
        scene.enemyHpBar.setDisplaySize(ratio * 360, 18);
        scene.enemyHpBar.setFillStyle(ratio > 0.5 ? 0xc65a2e : ratio > 0.25 ? 0xcf9e16 : 0xc63d2d);
        scene.enemyHpText.setText(`${scene.loc.t('hp')} ${Math.max(0, hp)}/${maxHp}`);
        scene.enemyHpBarBg.setVisible(unlocks.showEnemyHp);
        scene.enemyHpBar.setVisible(unlocks.showEnemyHp);
        scene.enemyHpText.setVisible(unlocks.showEnemyHp);
        scene.enemyIntelText.setVisible(true);
        scene.enemyIntelText.setText(
            unlocks.showEnemyHp
                ? compactText(this.buildIntel(), 64)
                : scene.loc.t('enemyInfoLocked')
        );

        if (scene.lastEnemyHp > 0 && hp < scene.lastEnemyHp) {
            const damage = scene.lastEnemyHp - hp;
            VFX.floatText(scene, RoomLayout.panelCenterX, 130, `-${damage}`, '#ff7373');
            VFX.shake(scene, scene.enemyPortrait);
            VFX.flash(scene, scene.enemyPortrait, 0xff3232, 120);
        }

        scene.lastEnemyHp = hp;
    }

    handleVictory(payload: CombatEndPayload): void {
        const scene = this.scene;
        const rewardLines: string[] = [];

        scene.tracker.record('enemiesKilled');
        if (payload.kind === 'elite') {
            scene.tracker.record('elitesKilled');
            scene.eliteKillsThisRun += 1;
        }
        if (payload.kind === 'boss') {
            scene.runState.runBossKills += 1;
            scene.tracker.record('bossesKilled');
            const bossMilestones = scene.meta.registerBossKill();
            scene.handleMilestoneUnlocks(bossMilestones);
        }
        // Final-boss specific log line. The actual win is gated
        // below by depth and finalBossDefeated to avoid surprising the
        // player on non-final boss kills.
        if (payload.finalBossDefeated) {
            scene.log.addMessage(scene.loc.t('victoryWishArtifact'), '#ffd36e');
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

        scene.player.registerKill();
        scene.log.addMessage(
            scene.loc.t('victoryRewards', { parts: rewardLines.join(', ') }),
            '#9be0a7'
        );

        if (payload.kind === 'boss') {
            scene.maybeDropRelic('boss', payload.enemyCanonicalName);

            if (scene.dungeon.currentDepth >= MAP_CONFIG.finalDepth) {
                scene.time.delayedCall(800, () => scene.showVictoryScreen());
                return;
            }
        } else if (payload.kind === 'elite') {
            scene.maybeDropRelic('elite', payload.enemyCanonicalName);
        } else {
            // Normal kills route through the per-enemy drop table
            // directly: each item rolls its own chance, so no extra
            // top-level gate is needed.
            scene.maybeDropRelic('normal', payload.enemyCanonicalName);
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
        const flash = scene.add
            .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0xff0000, 0.18)
            .setDepth(Depths.ScreenFlash);
        scene.tweens.add({
            targets: flash,
            alpha: 0,
            duration: 300,
            onComplete: () => flash.destroy(),
        });
        VFX.floatText(scene, 160, 82, `-${damage}`, '#ff5555');
    }
}
