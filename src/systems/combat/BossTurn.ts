/**
 * Boss-turn runner extracted from CombatManager.
 *
 * Mirrors the {@link PlayerActions} / {@link EnemyTurn} / {@link MimeChaos}
 * extraction pattern: a standalone function that takes an explicit
 * {@link BossTurnDeps} bundle plus the live {@link ActiveEnemy}.
 * Keeping the boss machinery out of `CombatManager` keeps the
 * orchestration file under ~1100 lines and lines the boss/player/
 * enemy seams up side by side in `src/systems/combat/`.
 *
 * What it does (per boss turn):
 *   1. Advance phase if HP crossed a phase threshold (delegates to
 *      {@link maybeAdvancePhase}). On entering a phase with
 *      `onEnterStealRelic`, calls into {@link stealRandomRelic}.
 *   2. If a multi-turn `windupTurns` action is in flight on
 *      {@link BossPhaseState.pendingWindup}, either decrement it
 *      (telegraph turn) or resolve it via the local
 *      `resolveBossWindupAction` once it expires.
 *   3. Otherwise pick the next action in the current phase rotation
 *      and resolve it (declare a fresh windup, fire `mime_chaos`
 *      random-status rider, deal damage with lifesteal / hero-call /
 *      heal-on-safe modifiers, tick boss block).
 *
 * State shared with the manager:
 *   - `enemy.bossPhase`: read & mutated freely; lives on the
 *     ActiveEnemy and is GC'd when combat ends.
 *
 * Why no shared mutable state object (unlike {@link PlayerActions}):
 * the boss-turn runner only reads/writes state through
 * `enemy.bossPhase`, which is already a reference on the passed-in
 * enemy. The `[FIX-13]` per-turn relic guards do not apply on enemy
 * turns.
 */
import { COMBAT_CONFIG } from '../../data/GameConfig';
import { pickLine, type BossActionDef } from '../../data/Bosses';
import { intentLabelForPhase, maybeAdvancePhase, tickBossBlockAtTurnEnd } from '../BossRuntime';
import { applyArmorBreak, applyWeaken } from '../StatusEffects';
import type { EventLog } from '../../ui/EventLog';
import type { Localization } from '../Localization';
import type { PlayerManager } from '../PlayerManager';
import type { Rng } from '../Rng';
import type { ActiveEnemy, EnemyUpdatePayload } from '../CombatManager';
import { applyRandomMimeStatus, stealRandomRelic, type MimeChaosDeps } from './MimeChaos';

/** Dependencies for the boss-turn runner. */
export interface BossTurnDeps {
    player: PlayerManager;
    log: EventLog;
    loc: Localization;
    rng: Rng;
    emitPlayerHit(damage: number): void;
    emitEnemyUpdate(payload: EnemyUpdatePayload): void;
    emitPlayerStatus(): void;
    emitEnemyStatus(): void;
    /** Routes through the same death-narration path as the player /
     *  enemy turns. */
    logDeath(): void;
    /** Funnels enemy damage through CombatManager's crit / guard /
     *  defense / damage-reduction pipeline. Returns the final amount
     *  the player took (post-mitigation). */
    applyEnemyHitToPlayer(rawAttack: number, flatBlock: number): number;
    /** Built once by CombatManager — forwarded into the MimeChaos
     *  sub-calls so all RNG / log / loc routing stays through the
     *  same dependency bundle. */
    mime: MimeChaosDeps;
}

export function runBossTurn(
    enemy: ActiveEnemy,
    playerAction: 'attack' | 'defend' | 'skill' | 'potion',
    deps: BossTurnDeps
): void {
    if (!enemy.bossPhase) return;
    const state = enemy.bossPhase;
    const { player, log, loc, rng } = deps;

    // Phase advancement is HP-driven and happens BEFORE picking an
    // action so the very next attack reflects the new phase's
    // pattern.
    const advanced = maybeAdvancePhase(enemy, log, loc);

    // Mammon "Greed Lord" — phase 2 onEnter steals one random
    // relic from the player. The id is preserved on `stolenRelicId`
    // so finishCombat can return it on the boss's death. Skipped
    // when the player has no relics; never re-fires across phase
    // re-entries because phase indices are monotonic.
    if (advanced) {
        const enteredPhase = state.blueprint.phases[state.phaseIndex];
        if (enteredPhase.onEnterStealRelic && !state.stolenRelicId) {
            stealRandomRelic(enemy, state, deps.mime);
        }
    }

    const phaseDef = state.blueprint.phases[state.phaseIndex];

    // Resolve a windup that has already counted down, OR continue
    // ticking an in-progress windup. While the boss is winding up
    // it does no other action; the player has already seen the
    // intent badge for this turn.
    if (state.pendingWindup) {
        const wind = state.pendingWindup;
        wind.turnsRemaining -= 1;
        if (wind.turnsRemaining > 0) {
            // Still preparing — log the countdown and update intent.
            log.addMessage(
                loc.t('combatBossWindupTick', {
                    name: enemy.name,
                    action: pickLine(wind.actionDef.intent, loc.language),
                    turns: wind.turnsRemaining,
                }),
                '#c4a35a'
            );
            tickBossBlockAtTurnEnd(enemy, log, loc);
            if (player.stats.hp <= 0) {
                deps.logDeath();
                return;
            }
            enemy.currentIntent = intentLabelForPhase(state, loc);
            deps.emitPlayerStatus();
            deps.emitEnemyStatus();
            return;
        }
        // Windup expired — resolve the action effect now.
        const resolveDef = wind.actionDef;
        state.pendingWindup = undefined;
        resolveBossWindupAction(enemy, resolveDef, playerAction, deps);
        tickBossBlockAtTurnEnd(enemy, log, loc);
        if (player.stats.hp <= 0) {
            deps.logDeath();
            return;
        }
        // Advance to the next action in the rotation.
        state.actionIndex = (state.actionIndex + 1) % phaseDef.actions.length;
        enemy.currentIntent = intentLabelForPhase(state, loc);
        deps.emitPlayerStatus();
        deps.emitEnemyStatus();
        return;
    }

    const action = phaseDef.actions[state.actionIndex % phaseDef.actions.length];

    // Multi-turn windup actions: declare the windup and stop. The
    // resolution happens once turnsRemaining decrements to 0 on a
    // subsequent boss turn.
    if (action.windupTurns && action.windupTurns > 0) {
        state.pendingWindup = {
            actionDef: action,
            turnsRemaining: action.windupTurns,
        };
        log.addMessage(
            loc.t('combatBossWindupStart', {
                name: enemy.name,
                action: pickLine(action.intent, loc.language),
                turns: action.windupTurns,
            }),
            '#c4a35a'
        );
        tickBossBlockAtTurnEnd(enemy, log, loc);
        if (player.stats.hp <= 0) {
            deps.logDeath();
            return;
        }
        enemy.currentIntent = intentLabelForPhase(state, loc);
        deps.emitPlayerStatus();
        deps.emitEnemyStatus();
        return;
    }

    const flatBlockBase = playerAction === 'defend' ? COMBAT_CONFIG.defendBlock : 0;
    const flatBlock = flatBlockBase;

    const weakenReduction = enemy.status.weaken.turns > 0 ? enemy.status.weaken.amount : 0;
    let attackPower = enemy.attack - weakenReduction;
    if (action.damageBonus) attackPower += action.damageBonus;
    if (attackPower < 1) attackPower = 1;

    // Gilgamesh "Hero's Cry": rider on the regular attack — on a
    // 10% roll, drain weaken / armorBreak / resolve from the
    // player on top of the swing. Resolved BEFORE the attack so
    // the resolve drain registers immediately and the player can
    // see the cumulative effect on the next turn's intent.
    if (
        action.id === 'hero_call' &&
        action.heroCryChance &&
        action.heroCryDrain &&
        rng.next() < action.heroCryChance
    ) {
        const drain = action.heroCryDrain;
        applyWeaken(player.status, drain.attackWeaken, drain.turns);
        applyArmorBreak(player.status, drain.defenseArmorBreak, drain.turns);
        const drained = Math.min(player.resources.resolve, drain.resolveDrain);
        if (drained > 0) player.spendResolve(drained);
        log.addMessage(
            loc.t('combatBossHeroCry', {
                name: enemy.name,
                weaken: drain.attackWeaken,
                armor: drain.defenseArmorBreak,
                resolve: drained,
            }),
            '#d09a4f'
        );
        deps.emitPlayerStatus();
    }

    // Mime "Chaos Lord's Laughter": every turn pick one random
    // status from the action's pool and apply it to the player.
    // The same status cannot fire twice in a row — anti-repeat
    // tracked on `BossPhaseState.lastRandomStatus`.
    if (action.id === 'mime_chaos' && action.randomStatus) {
        applyRandomMimeStatus(enemy, state, action.randomStatus, deps.mime);
    }

    // Damage-dealing actions hit the player.
    if (!action.noAttack) {
        // Mime's swings ignore armor (true damage). All other
        // boss attacks go through `applyEnemyHitToPlayer` which
        // applies guard/defense/crit normally. The lifesteal
        // rider only applies when the hit landed for >0 damage.
        let taken: number;
        if (action.ignoreArmor) {
            taken = player.takeDamage(Math.max(1, attackPower), 0, 'true');
            if (taken > 0) deps.emitPlayerHit(taken);
        } else {
            taken = deps.applyEnemyHitToPlayer(attackPower, flatBlock);
        }
        if (taken > 0) {
            log.addMessage(
                loc.t('combatEnemyHit', {
                    name: enemy.name,
                    takenDamage: taken,
                    extraMessage: '',
                }),
                '#ff6666'
            );
        } else {
            log.addMessage(loc.t('absorb'), '#8fc6ff');
        }
        // Mime lifesteal: heal a flat amount on a successful hit.
        if (
            taken > 0 &&
            action.lifestealFlat &&
            action.lifestealFlat > 0 &&
            enemy.hp < enemy.maxHp
        ) {
            const before = enemy.hp;
            enemy.hp = Math.min(enemy.maxHp, enemy.hp + action.lifestealFlat);
            const healed = enemy.hp - before;
            if (healed > 0) {
                log.addMessage(
                    loc.t('combatEnemyLifesteal', {
                        name: enemy.name,
                        healed,
                    }),
                    '#c45a5a'
                );
                deps.emitEnemyUpdate({
                    hp: enemy.hp,
                    maxHp: enemy.maxHp,
                    color: enemy.color,
                    name: enemy.name,
                    icon: enemy.icon,
                });
            }
        }
    }

    // Resolve False Mercy: heal only if player did no damage.
    if (state.pendingHealOnSafe > 0 && !state.damagedThisTurn) {
        const heal = state.pendingHealOnSafe;
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + heal);
        log.addMessage(loc.t('combatEnemyHeal', { name: enemy.name, heal }), '#88dd88');
        deps.emitEnemyUpdate({
            hp: enemy.hp,
            maxHp: enemy.maxHp,
            color: enemy.color,
            name: enemy.name,
            icon: enemy.icon,
        });
    }
    state.pendingHealOnSafe = 0;

    tickBossBlockAtTurnEnd(enemy, log, loc);

    if (player.stats.hp <= 0) {
        deps.logDeath();
        return;
    }

    // Advance to next action and update the intent shown to the player.
    state.actionIndex = (state.actionIndex + 1) % phaseDef.actions.length;
    enemy.currentIntent = intentLabelForPhase(state, loc);
    deps.emitPlayerStatus();
    deps.emitEnemyStatus();
}

/**
 * Apply the resolution effect of a boss windup action whose
 * `turnsRemaining` just hit zero. Currently covers Death Knight's
 * `death_shield` (raise a 15-block buff for 3 turns) and
 * `death_touch` (instant-kill, softened to a flat 8-damage hit if
 * the player Defends on the resolution turn), plus Nimrod's
 * `nimrod_godkiller` unconditional OHKO.
 */
function resolveBossWindupAction(
    enemy: ActiveEnemy,
    action: BossActionDef,
    playerAction: 'attack' | 'defend' | 'skill' | 'potion',
    deps: BossTurnDeps
): void {
    if (!enemy.bossPhase) return;
    const state = enemy.bossPhase;
    const { player, log, loc } = deps;
    const actionLabel = pickLine(action.intent, loc.language);

    if (action.id === 'death_shield' && action.pendingBlock && action.pendingBlockTurns) {
        state.pendingBlock = action.pendingBlock;
        // +1 so the shield survives the tick at the END of this
        // same boss turn and lasts the full N subsequent turns.
        state.pendingBlockTurns = action.pendingBlockTurns + 1;
        log.addMessage(
            loc.t('combatBossDeathShieldRaised', {
                name: enemy.name,
                block: action.pendingBlock,
                turns: action.pendingBlockTurns,
            }),
            '#c4a35a'
        );
        return;
    }

    if (action.id === 'death_touch' && action.oneShot) {
        if (playerAction === 'defend') {
            const dmg = action.oneShotDefendDamage ?? 0;
            const taken = deps.applyEnemyHitToPlayer(dmg, COMBAT_CONFIG.defendBlock);
            log.addMessage(
                loc.t('combatBossDeathTouchDefended', {
                    name: enemy.name,
                    action: actionLabel,
                    damage: taken,
                }),
                '#9bc8ff'
            );
        } else {
            // OHKO: drop the player's HP to zero directly so any
            // flat block / temporary defence buff can't soak it.
            const lethal = Math.max(player.stats.hp, 1);
            player.takeDamage(lethal, 0, 'true');
            log.addMessage(
                loc.t('combatBossDeathTouchOhko', {
                    name: enemy.name,
                    action: actionLabel,
                }),
                '#ff6666'
            );
            deps.emitPlayerHit(lethal);
        }
        return;
    }

    // Nimrod's "God-Killer": unconditional OHKO when the 5-turn
    // windup resolves. No Defend smoothing — the only counterplay
    // is burning Nimrod down before resolution. Reuses the same
    // `oneShot: true` flag as Death Touch but skips the
    // oneShotDefendDamage branch.
    if (action.id === 'nimrod_godkiller' && action.oneShot) {
        const lethal = Math.max(player.stats.hp, 1);
        player.takeDamage(lethal, 0, 'true');
        log.addMessage(
            loc.t('combatBossNimrodGodkiller', {
                name: enemy.name,
                action: actionLabel,
            }),
            '#ff6666'
        );
        deps.emitPlayerHit(lethal);
        return;
    }

    // Fallback: a generic windup with no special effect just runs
    // its `attack` / `damageBonus` like a normal boss action so we
    // never silently swallow new windup definitions.
    const flatBlock = playerAction === 'defend' ? COMBAT_CONFIG.defendBlock : 0;
    const weakenReduction = enemy.status.weaken.turns > 0 ? enemy.status.weaken.amount : 0;
    let attackPower = enemy.attack - weakenReduction;
    if (action.damageBonus) attackPower += action.damageBonus;
    if (attackPower < 1) attackPower = 1;
    if (!action.noAttack) {
        const taken = deps.applyEnemyHitToPlayer(attackPower, flatBlock);
        if (taken > 0) {
            log.addMessage(
                loc.t('combatEnemyHit', {
                    name: enemy.name,
                    takenDamage: taken,
                    extraMessage: '',
                }),
                '#ff6666'
            );
        } else {
            log.addMessage(loc.t('absorb'), '#8fc6ff');
        }
    }
}
