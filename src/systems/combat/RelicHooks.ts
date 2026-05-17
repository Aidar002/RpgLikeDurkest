/**
 * Relic on-attack proc resolvers extracted from CombatManager.
 *
 * Each helper takes a {@link RelicHookDeps} bundle and inspects the
 * player's relic aggregate, rolls dice through the supplied RNG,
 * and writes a localised log line on success.  Pure functions: no
 * back-reference to CombatManager.
 *
 * Mirrors the EnemyTurn / BossRuntime extraction pattern already
 * used in this codebase (see {@link EnemyTurn.EnemyTurnDeps} and
 * {@link BossRuntime.intentLabelForPhase}) so each combat-side
 * concern lives in its own module instead of crowding the central
 * orchestrator.
 */
import type { EventLog } from '../../ui/EventLog';
import type { Localization } from '../Localization';
import type { PlayerManager } from '../PlayerManager';
import type { Rng } from '../Rng';
import type { ActiveEnemy } from '../CombatManager';

/** Dependencies injected by CombatManager so relic hooks remain pure. */
export interface RelicHookDeps {
    player: PlayerManager;
    log: EventLog;
    loc: Localization;
    rng: Rng;
}

/**
 * Composite trigger fired AFTER the player completes a damaging
 * action (basic attack or damaging skill). Currently chains the heal
 * proc and the Vampire-Blessing proc; the per-attack resolve gain
 * (Lost Staff) is invoked separately by CombatManager via
 * {@link applyResolveOnAttack}.
 */
export function applyOnAttackRelics(enemy: ActiveEnemy | null, deps: RelicHookDeps): void {
    if (!enemy) return;
    tryHealOnAttack(enemy, deps);
    tryVampireBlessingOnAttack(deps);
}

/**
 * Sara's Vampire Blessing: while active, every damaging player
 * action has an aggregate-defined chance (25%) to restore a fixed
 * amount (2) of HP. Stored on the relic aggregate so the combat
 * pipeline reads it through the same hook as relic on-attack
 * effects; granted via {@link PlayerManager.setVampireBlessing}.
 */
export function tryVampireBlessingOnAttack(deps: RelicHookDeps): void {
    const { player, log, loc, rng } = deps;
    const agg = player.aggregate;
    if (agg.vampireBlessingChance <= 0 || agg.vampireBlessingAmount <= 0) return;
    if (rng.next() >= agg.vampireBlessingChance) return;
    const healed = player.heal(agg.vampireBlessingAmount);
    if (healed > 0) {
        log.addMessage(loc.t('combatVampireBlessingHeal', { healed }), '#d7b6ff');
    }
}

/**
 * Vampire Amulet (and similar): a chance to recover HP after any
 * attack action. Uses the player's `aggregate.healOnAttackChance`
 * so multiple sources stack via max() in `aggregateRelics`. The
 * flesh-set proc-bump (10% → 30%) is folded into the chance by
 * `applyUnconditionalSetBonuses`.
 */
export function tryHealOnAttack(enemy: ActiveEnemy | null, deps: RelicHookDeps): void {
    if (!enemy) return;
    const { player, log, loc, rng } = deps;
    const agg = player.aggregate;
    if (agg.healOnAttackChance <= 0) return;
    if (rng.next() >= agg.healOnAttackChance) return;
    const healed = player.heal(agg.healOnAttackAmount);
    if (healed > 0) {
        log.addMessage(loc.t('combatRelicHealOnAttack', { healed }), '#8be0a7');
    }
}

/**
 * Lost Staff: +N current resolve every time the player takes an
 * attack action (basic strike OR Will-skill). Capped at maxResolve
 * by `gainResolve`. Logged only when something was actually
 * gained, so a full bar stays quiet.
 */
export function applyResolveOnAttack(deps: RelicHookDeps): void {
    const { player, log, loc } = deps;
    const agg = player.aggregate;
    if (agg.resolveOnAttackAmount <= 0) return;
    const gained = player.gainResolve(agg.resolveOnAttackAmount);
    if (gained > 0) {
        log.addMessage(loc.t('combatRelicLostStaff', { resolve: gained }), '#9bc8ff');
    }
}
