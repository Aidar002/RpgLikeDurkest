import { pickLine } from '../data/Bosses';
import type { EnemyPrepareDef } from '../data/GameConfig';
import type { EventLog } from '../ui/EventLog';
import type { Localization } from './Localization';
import type { ActiveEnemy, BossPhaseState } from './CombatManager';

/**
 * BossRuntime — pure helpers extracted from CombatManager so future
 * agents can grep for boss-only behaviour without re-reading the
 * 1500-line manager. Every function is dependency-injected with the
 * pieces of CombatManager state it needs (active enemy, log, loc) so
 * unit tests can drive them in isolation.
 *
 * Heavyweight orchestration (`runBossTurn`, `resolveBossWindupAction`,
 * `resolvePrepare`) stays inside CombatManager because it threads
 * through too many private methods (`applyEnemyHitToPlayer`,
 * `enemyUpdate.emit`, `playerHit.emit`, `logDeath`, …) — broadening the
 * public surface for those would cost more than it saves.
 */

/**
 * Builds the localised intent badge for a boss based on its phase
 * blueprint. If a windup is in flight we surface the remaining
 * countdown so the player can react before resolution; otherwise we
 * preview the next action (with its own windup hint when applicable).
 */
export function intentLabelForPhase(phase: BossPhaseState, loc: Localization): string {
    // Active windup: surface the remaining countdown so the player
    // knows how many turns they have to react before resolution.
    if (phase.pendingWindup) {
        const action = pickLine(phase.pendingWindup.actionDef.intent, loc.language);
        const turns = phase.pendingWindup.turnsRemaining;
        if (turns <= 0) {
            return loc.t('hudPrepareReadyLabel', { action });
        }
        return loc.t('hudPrepareWindupLabel', { action, turns });
    }
    const phaseDef = phase.blueprint.phases[phase.phaseIndex];
    const action = phaseDef.actions[phase.actionIndex % phaseDef.actions.length];
    // For actions that will themselves declare a windup next turn,
    // hint at the windup length up-front so the badge does not jump
    // from a bare label to "(Nt)" the moment the windup begins.
    if (action.windupTurns && action.windupTurns > 0) {
        return loc.t('hudPrepareWindupLabel', {
            action: pickLine(action.intent, loc.language),
            turns: action.windupTurns,
        });
    }
    return pickLine(action.intent, loc.language);
}

/** Localised "{Action} ({turns}t)" badge for non-boss prepare windups. */
export function intentLabelForPrepare(
    pp: { def: EnemyPrepareDef; turnsRemaining: number },
    loc: Localization
): string {
    const action = prepareName(pp.def, loc);
    if (pp.turnsRemaining <= 0) {
        return loc.t('hudPrepareReadyLabel', { action });
    }
    return loc.t('hudPrepareWindupLabel', { action, turns: pp.turnsRemaining });
}

/** Returns the localised name of the prepare action (e.g. "Bite" / "Укус"). */
export function prepareName(def: EnemyPrepareDef, loc: Localization): string {
    return loc.language === 'ru' ? def.nameRu : def.nameEn;
}

/**
 * Re-evaluates the boss's HP-driven phase. Called at the start of the
 * boss's turn so phase-entry effects fire after the player has just
 * damaged it. Returns `true` when a phase change happened.
 */
export function maybeAdvancePhase(enemy: ActiveEnemy, log: EventLog, loc: Localization): boolean {
    if (!enemy.bossPhase) return false;
    const state = enemy.bossPhase;
    const ratio = enemy.hp / Math.max(1, enemy.maxHp);
    let newIndex = state.phaseIndex;
    for (let i = state.phaseIndex + 1; i < state.blueprint.phases.length; i++) {
        if (ratio <= state.blueprint.phases[i].enterAtHpRatio) {
            newIndex = i;
        }
    }
    if (newIndex === state.phaseIndex) return false;
    state.phaseIndex = newIndex;
    state.actionIndex = 0;
    const phaseDef = state.blueprint.phases[newIndex];
    if (phaseDef.label) {
        log.addMessage(pickLine(phaseDef.label, loc.language), '#c4a35a');
    }
    return true;
}

/**
 * Decrement the boss's active block buff timer at the end of every
 * boss turn. When the timer hits zero we drop any leftover block pool
 * and log expiry so the player understands the shield is gone.
 */
export function tickBossBlockAtTurnEnd(
    enemy: ActiveEnemy,
    log: EventLog,
    loc: Localization
): void {
    if (!enemy.bossPhase) return;
    const state = enemy.bossPhase;
    if (state.pendingBlockTurns <= 0) return;
    state.pendingBlockTurns -= 1;
    if (state.pendingBlockTurns <= 0 && state.pendingBlock > 0) {
        state.pendingBlock = 0;
        log.addMessage(
            loc.t('combatBossDeathShieldExpired', { name: enemy.name }),
            '#9aa6b3'
        );
    }
}

/**
 * Knock off the boss's active block buff (Death Shield) when the
 * player lands a damaging Will-spent skill. Called from
 * `handlePlayerSkill` after the damage roll resolves so the shield
 * only breaks when actual damage is delivered.
 */
export function breakBossBlockOnSkillDamage(
    enemy: ActiveEnemy,
    log: EventLog,
    loc: Localization
): void {
    if (!enemy.bossPhase) return;
    const state = enemy.bossPhase;
    if (state.pendingBlock <= 0) return;
    state.pendingBlock = 0;
    state.pendingBlockTurns = 0;
    log.addMessage(
        loc.t('combatBossDeathShieldBroken', { name: enemy.name }),
        '#b893ff'
    );
}
