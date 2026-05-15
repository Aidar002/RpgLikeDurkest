import * as Phaser from 'phaser';
import { MAP_CONFIG } from '../data/GameConfig';
import type { DefendPatternEasing } from '../data/GameConfig';
import { type CombatAction, type CombatEndPayload } from '../systems/CombatManager';
import { SKILLS } from '../systems/Skills';
import { CombatBars, type DefendBarState } from '../ui/CombatBars';
import { compactText } from '../ui/TextHelpers';
import { CENTER_X, CENTER_Y, Depths, GAME_HEIGHT, GAME_WIDTH, RoomLayout } from '../ui/Layout';
import { PixelSprite } from '../ui/PixelSprite';
import { fitEnemySprite } from '../ui/RoomVisuals';
import { VFX } from '../ui/VFX';
import type { GameScene, RoomButtonAction } from './GameScene';

export class CombatHudController {
    private readonly scene: GameScene;
    // --- EXPERIMENTAL action-combat prototype state ----------------
    // The HUD owns the per-frame bar fills; CombatManager only sees
    // the discrete results (Strike landed, enemy hit landed/blocked).
    private bars: CombatBars | null = null;
    /** Attack bar fill (0..1). Drained by enemy.actionBars.attackDrainPerSec,
     *  bumped on every Strike-button click. At 1 the player auto-attacks. */
    private attackProgress = 0;
    /** Defend bar fill (0..1). Driven by either the linear
     *  `defendFillSeconds` legacy mode or by the active defend pattern. */
    private defendProgress = 0;
    /** Seconds the Guard buff is still active for. Blocks the next enemy hit. */
    private defendActiveLeft = 0;
    /** Seconds of Guard cooldown left. While > 0 the Guard button is unusable. */
    private defendCooldownLeft = 0;
    /** Index of the active pattern within `enemy.actionBars.defendPatterns`.
     *  Wraps after each enemy hit so elites/bosses cycle through their chain. */
    private defendPatternIndex = 0;
    /** Index of the active segment within the current pattern. */
    private defendSegmentIndex = 0;
    /** Seconds elapsed in the current segment. */
    private defendSegmentElapsed = 0;
    /** Bar fill at the start of the current segment (so we can interpolate
     *  cleanly from "wherever we ended up" to `segment.targetFill`). */
    private defendSegmentStartFill = 0;
    /** Pump throttle: scene.update fires every frame; we accumulate dt and
     *  let the tick handler do its work each call. */
    private tickHandler: ((time: number, delta: number) => void) | null = null;

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
        // EXPERIMENTAL action-combat: flip CombatManager into realtime
        // mode so processTurn(...) runs the player's action but skips
        // the reactive enemy turn. Enemy hits come from the defend-bar
        // timer below instead.
        scene.combat.realtimeMode = true;
        scene.combat.startCombat(scene.dungeon.currentDepth, kind);
        this.startBars();
        this.refreshButtons();

        if (kind === 'boss') {
            scene.sfx.play('bossAppear');
        } else if (kind === 'elite') {
            scene.sfx.play('eliteAppear');
        }
    }

    /**
     * Build the progress bars and hook the per-frame tick. Idempotent —
     * safe to call repeatedly (we tear down any prior tick handler
     * first).
     */
    private startBars(): void {
        const scene = this.scene;
        if (!this.bars) {
            this.bars = new CombatBars(scene, scene.roomContainer);
        }
        this.attackProgress = 0;
        this.defendProgress = 0;
        this.defendActiveLeft = 0;
        this.defendCooldownLeft = 0;
        this.defendPatternIndex = 0;
        this.defendSegmentIndex = 0;
        this.defendSegmentElapsed = 0;
        this.defendSegmentStartFill = 0;
        this.bars.setVisible(true);
        this.bars.setLabels(scene.loc.t('attackShort'), scene.loc.t('defenseShort'));
        this.bars.setAttack(0);
        this.bars.setDefend(0, 'idle');
        this.detachTick();
        const handler = (_time: number, delta: number) => this.tick(delta / 1000);
        this.tickHandler = handler;
        scene.events.on(Phaser.Scenes.Events.UPDATE, handler);
    }

    private detachTick(): void {
        if (this.tickHandler) {
            this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.tickHandler);
            this.tickHandler = null;
        }
    }

    private stopBars(): void {
        this.detachTick();
        if (this.bars) {
            this.bars.setVisible(false);
        }
        this.attackProgress = 0;
        this.defendProgress = 0;
        this.defendActiveLeft = 0;
        this.defendCooldownLeft = 0;
        this.defendPatternIndex = 0;
        this.defendSegmentIndex = 0;
        this.defendSegmentElapsed = 0;
        this.defendSegmentStartFill = 0;
    }

    /**
     * Per-frame bar update. `dt` is seconds since the last frame.
     *
     * Three concerns:
     *  - drain the attack bar (player must keep clicking to keep it up),
     *  - fill the defend bar linearly (one enemy hit per
     *    actionBars.defendFillSeconds), and
     *  - tick down the Guard buff active / cooldown timers.
     *
     * When either bar reaches 1 the corresponding effect fires and
     * the bar resets to 0.
     */
    private tick(dt: number): void {
        const scene = this.scene;
        const enemy = scene.combat.enemy;
        if (!enemy || !this.bars) return;
        // Player just died this frame — don't keep ticking the defend
        // bar (it would spam executeRealtimeEnemyHit while the death
        // screen is mounting).
        if (scene.player.stats.hp <= 0) {
            this.stopBars();
            return;
        }
        const bars = enemy.actionBars;

        // Attack bar drain.
        if (this.attackProgress > 0) {
            this.attackProgress = Math.max(0, this.attackProgress - bars.attackDrainPerSec * dt);
        }

        // Guard timers.
        if (this.defendActiveLeft > 0) {
            this.defendActiveLeft = Math.max(0, this.defendActiveLeft - dt);
            if (this.defendActiveLeft === 0) {
                this.defendCooldownLeft = bars.defendCooldownSeconds;
            }
        } else if (this.defendCooldownLeft > 0) {
            this.defendCooldownLeft = Math.max(0, this.defendCooldownLeft - dt);
        }

        // Defend bar fill — pattern-driven if a chain is attached,
        // otherwise the legacy linear path.
        this.advanceDefendBar(dt);
        if (this.defendProgress >= 1) {
            const blocked = this.defendActiveLeft > 0;
            scene.combat.executeRealtimeEnemyHit(blocked);
            this.defendProgress = 0;
            if (blocked) {
                // Block consumes the active Guard window; flip straight
                // to cooldown.
                this.defendActiveLeft = 0;
                this.defendCooldownLeft = bars.defendCooldownSeconds;
                scene.sfx.play('defend');
            }
            // Advance to the next pattern in the chain (wraps). Reset
            // segment cursor + segment-start fill so the new pattern
            // starts from 0.
            const patterns = bars.defendPatterns;
            if (patterns && patterns.length > 0) {
                this.defendPatternIndex = (this.defendPatternIndex + 1) % patterns.length;
            }
            this.defendSegmentIndex = 0;
            this.defendSegmentElapsed = 0;
            this.defendSegmentStartFill = 0;
        }

        // Push render values to the bar visuals.
        const defState: DefendBarState =
            this.defendActiveLeft > 0
                ? 'guarded'
                : this.defendCooldownLeft > 0
                  ? 'cooldown'
                  : 'idle';
        this.bars.setAttack(this.attackProgress);
        this.bars.setDefend(this.defendProgress, defState);
    }

    /**
     * Drive {@link defendProgress} forward by `dt` seconds.
     *
     * Two paths:
     *  1. If the enemy has a `defendPatterns` chain, walk through the
     *     current pattern segment-by-segment. Each segment interpolates
     *     from `defendSegmentStartFill` to `segment.targetFill` over
     *     `segment.duration` seconds using the segment's easing.
     *     When a segment finishes we advance to the next segment; when
     *     the whole pattern finishes the caller bumps `defendPatternIndex`
     *     and resets us.
     *  2. Otherwise, fall back to the legacy linear fill — bar climbs
     *     1/`defendFillSeconds` per second.
     *
     * The {@link defendProgress} field is the single source of truth
     * the rest of `tick()` reads — both paths just write into it.
     */
    private advanceDefendBar(dt: number): void {
        const enemy = this.scene.combat.enemy;
        if (!enemy) return;
        const bars = enemy.actionBars;
        const patterns = bars.defendPatterns;
        if (patterns && patterns.length > 0) {
            const pattern = patterns[this.defendPatternIndex % patterns.length];
            const segIdx = this.defendSegmentIndex;
            if (segIdx >= pattern.length) {
                // Defensive: caller should have advanced us; clamp at 1
                // so the >= 1 branch in tick() takes over.
                this.defendProgress = 1;
                return;
            }
            const segment = pattern[segIdx];
            this.defendSegmentElapsed = Math.min(segment.duration, this.defendSegmentElapsed + dt);
            const rawT = segment.duration > 0 ? this.defendSegmentElapsed / segment.duration : 1;
            const easedT = applyEasing(rawT, segment.easing ?? 'linear');
            this.defendProgress =
                this.defendSegmentStartFill +
                (segment.targetFill - this.defendSegmentStartFill) * easedT;
            if (rawT >= 1) {
                // Segment finished. If there is a next segment, hand off
                // to it from the current fill. Otherwise leave the bar
                // at this segment's end value; the caller will detect
                // >= 1 and trigger the hit / pattern advance.
                this.defendSegmentStartFill = segment.targetFill;
                this.defendSegmentIndex = segIdx + 1;
                this.defendSegmentElapsed = 0;
                if (this.defendSegmentIndex >= pattern.length) {
                    // Pattern done — force the >= 1 branch in tick() to
                    // fire on this frame even if the final targetFill
                    // was slightly under 1 due to author error.
                    this.defendProgress = Math.max(this.defendProgress, 1);
                }
            }
            return;
        }
        // Legacy linear path.
        const fillStep = bars.defendFillSeconds > 0 ? dt / bars.defendFillSeconds : 1;
        this.defendProgress = Math.min(1, this.defendProgress + fillStep);
    }

    /**
     * Player clicked the Strike button. Bump the attack bar and, if it
     * crossed the 1.0 threshold this frame, fire the actual attack via
     * the existing combat path. Bar is reset to 0 after the hit so the
     * player has to fill it again for the next strike.
     */
    private onAttackClick(): void {
        const scene = this.scene;
        const enemy = scene.combat.enemy;
        if (!enemy) return;
        const bars = enemy.actionBars;
        this.attackProgress = Math.min(1, this.attackProgress + bars.attackClickGain);
        scene.sfx.play('buttonHover');
        if (this.attackProgress >= 1) {
            this.attackProgress = 0;
            this.performAction('attack');
        } else if (this.bars) {
            this.bars.setAttack(this.attackProgress);
        }
    }

    /**
     * Player clicked the Guard button. If Guard is available
     * (no active buff + no cooldown), activate it for
     * actionBars.defendActiveSeconds. Otherwise log a polite "still
     * recovering" hint so the press doesn't feel like a dead button.
     */
    private onDefendClick(): void {
        const scene = this.scene;
        const enemy = scene.combat.enemy;
        if (!enemy) return;
        const bars = enemy.actionBars;
        if (this.defendCooldownLeft > 0 || this.defendActiveLeft > 0) {
            scene.log.addMessage(scene.loc.t('combatRealtimeGuardCooldown'), '#7878a0');
            return;
        }
        this.defendActiveLeft = bars.defendActiveSeconds;
        VFX.shieldFlash(scene, 160, 82);
        scene.sfx.play('defend');
        scene.tracker.record('defendsUsed');
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
                callback: () => this.onAttackClick(),
                fill: 0x5a1d1d,
            },
            {
                label: scene.loc.t('actionDefend'),
                callback: () => this.onDefendClick(),
                fill: 0x1b335b,
            },
        ];

        scene.skillLoadout.forEach((id) => {
            const def = SKILLS[id];
            const cost = Math.max(1, def.resolveCost);
            actions.push({
                label: `[${actions.length + 1}] ${scene.skillShort(id)} ${cost} ${scene.loc.t('resolveShort').toLowerCase()}`,
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

        scene.roomButtons.disableAll();

        const hpBefore = scene.combat.enemy.hp;
        scene.tracker.record('turnsInCombat');
        const actionKind = typeof action === 'string' ? action : action.kind;
        if (actionKind === 'skill') {
            scene.tracker.record('skillsUsed');
            scene.sfx.play('skillUse');
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
        // [FIX-10][FIX-15] Show the boss intent + phase first so the player
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
        scene.enemyPortrait.setFillStyle(color);
        scene.enemyIconText.setText(icon);
        scene.enemyNameText.setText(compactText(name, 36));
        scene.roomFlavorText.setText(compactText(description, 96));
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
        this.stopBars();
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
        // [FIX-1] Final-boss specific log line. The actual win is gated
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

/**
 * Maps the normalized segment-progress `t` (0..1) onto a curve.
 * - 'linear': identity.
 * - 'easeIn': starts slow, accelerates (t^2). Used for the slow ominous
 *   wind-up that snaps shut at the end.
 * - 'easeOut': starts fast, decelerates (1 - (1-t)^2). Used for the
 *   fake-out's retreat segment so the bar drops snappily and then
 *   eases into the holding position.
 *
 * Out-of-range inputs are clamped so authoring mistakes can't make the
 * defend bar jump past 1.0 or below 0.
 */
function applyEasing(t: number, easing: DefendPatternEasing): number {
    const clamped = Math.max(0, Math.min(1, t));
    switch (easing) {
        case 'easeIn':
            return clamped * clamped;
        case 'easeOut':
            return 1 - (1 - clamped) * (1 - clamped);
        case 'linear':
        default:
            return clamped;
    }
}
