import { COMBAT_CONFIG } from '../data/GameConfig';
import type { EnemyPrepareDef } from '../data/GameConfig';
import type { EventLog } from '../ui/EventLog';
import { intentLabelForPhase, intentLabelForPrepare, prepareName } from './BossRuntime';
import { narrate } from './Narrator';
import type { Localization } from './Localization';
import type { PlayerManager } from './PlayerManager';
import { applyBleed, applyPoison, consumeStunForTurn } from './StatusEffects';
import type { ActiveEnemy, EnemyUpdatePayload } from './CombatManager';
import type { Rng } from './Rng';

export type PlayerAction = 'attack' | 'defend' | 'skill' | 'potion';

/**
 * Dependencies injected by {@link CombatManager} so EnemyTurn logic
 * stays a pure function module with no back-reference to the manager.
 */
export interface EnemyTurnDeps {
    player: PlayerManager;
    log: EventLog;
    loc: Localization;
    rng: Rng;
    lastActionResult: { enemyEvaded?: boolean };
    emitPlayerHit(damage: number): void;
    emitEnemyUpdate(payload: EnemyUpdatePayload): void;
    emitPlayerStatus(): void;
    emitEnemyStatus(): void;
    logDeath(): void;
    applyEnemyHitToPlayer(rawAttack: number, flatBlock: number): number;
    runBossTurn(playerAction: PlayerAction): void;
}

/**
 * Resolve a full enemy turn (stun check, evasion, boss delegation,
 * prepare windup/resolution, or basic attack).
 */
export function resolveEnemyTurn(
    enemy: ActiveEnemy,
    deps: EnemyTurnDeps,
    playerAction: PlayerAction
): void {
    const { player, log, loc, rng } = deps;

    // Stun check.
    if (consumeStunForTurn(enemy.status)) {
        log.addMessage(loc.t('combatEnemyStunned', { name: enemy.name }), '#7aaaff');
        if (enemy.bossPhase) {
            enemy.currentIntent = intentLabelForPhase(enemy.bossPhase, loc);
        }
        deps.emitEnemyStatus();
        return;
    }

    // First-hit evasion from Shade Mask.
    if (enemy.firstHitEvaded) {
        enemy.firstHitEvaded = false;
        deps.lastActionResult.enemyEvaded = true;
        log.addMessage(loc.t('combatEnemyEvadeFirst', { name: enemy.name }), '#9fb4c4');
        return;
    }

    // Boss enemies use the phase runner.
    if (enemy.bossPhase) {
        deps.runBossTurn(playerAction);
        return;
    }

    // Mid-combat windups (bat / ghoul / lynx).
    if (enemy.pendingPrepare) {
        const pp = enemy.pendingPrepare;
        if (pp.turnsRemaining > 0) {
            pp.turnsRemaining -= 1;
            log.addMessage(
                loc.t('combatEnemyPrepareWindup', {
                    name: enemy.name,
                    action: prepareName(pp.def, loc),
                }),
                '#c4a35a'
            );
            enemy.currentIntent = intentLabelForPrepare(pp, loc);
            deps.emitPlayerStatus();
            deps.emitEnemyStatus();
            return;
        }
        resolvePrepare(enemy, deps, playerAction, pp.def);
        pp.turnsRemaining = pp.def.turns;
        enemy.currentIntent = intentLabelForPrepare(pp, loc);
        deps.emitPlayerStatus();
        deps.emitEnemyStatus();
        return;
    }

    // Regular attack.
    const flatBlock = playerAction === 'defend' ? COMBAT_CONFIG.defendBlock : 0;
    const weakenReduction = enemy.status.weaken.turns > 0 ? enemy.status.weaken.amount : 0;
    let attackPower = enemy.attack - weakenReduction;
    if (attackPower < 1) attackPower = 1;

    if (enemy.passive?.kind === 'extraDamageOnHit' && rng.next() < enemy.passive.chance) {
        attackPower += enemy.passive.bonus;
        log.addMessage(
            loc.t('combatEnemyExtraDamage', {
                name: enemy.name,
                bonus: enemy.passive.bonus,
            }),
            '#d09a4f'
        );
    }

    const extraMessage = '';
    const takenDamage = deps.applyEnemyHitToPlayer(attackPower, flatBlock);
    if (takenDamage > 0) {
        log.addMessage(
            loc.t('combatEnemyHit', { name: enemy.name, takenDamage, extraMessage }),
            '#ff6666'
        );
    } else {
        log.addMessage(loc.t('absorb'), '#8fc6ff');
    }

    // Vampire-style lifesteal: heal a ratio of the damage that actually
    // landed on the player. Floor + min 1 on a successful hit keeps
    // attack=1 vampires from ever leaving the field at half HP with
    // nothing healed.
    if (takenDamage > 0 && enemy.passive?.kind === 'lifestealOnAttack' && enemy.hp < enemy.maxHp) {
        const want = Math.max(1, Math.floor(takenDamage * enemy.passive.ratio));
        const before = enemy.hp;
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + want);
        const healed = enemy.hp - before;
        if (healed > 0) {
            log.addMessage(loc.t('combatEnemyLifesteal', { name: enemy.name, healed }), '#c45a5a');
            deps.emitEnemyUpdate({
                hp: enemy.hp,
                maxHp: enemy.maxHp,
                color: enemy.color,
                name: enemy.name,
                icon: enemy.icon,
            });
        }
    }

    if (player.stats.hp <= 0) {
        deps.logDeath();
        return;
    }

    if (player.stats.hp > 0 && player.stats.hp <= Math.ceil(player.stats.maxHp * 0.25)) {
        if (rng.next() < 0.25) log.addMessage(narrate('low_hp', loc.language), '#c4a35a');
    }

    deps.emitPlayerStatus();
}

/**
 * Resolve a prepared enemy attack (bat Bite, ghoul Decay, lynx Claws).
 */
function resolvePrepare(
    enemy: ActiveEnemy,
    deps: EnemyTurnDeps,
    playerAction: PlayerAction,
    def: EnemyPrepareDef
): void {
    const { player, log, loc } = deps;
    const defended = playerAction === 'defend';
    const action = prepareName(def, loc);

    if (defended && def.defenseRule === 'damageBack') {
        const back = def.defenseBackDamage ?? 0;
        log.addMessage(loc.t('combatEnemyPrepareDefend', { name: enemy.name, action }), '#9bc8ff');
        if (back > 0) {
            enemy.hp = Math.max(0, enemy.hp - back);
            log.addMessage(
                loc.t('combatEnemyPrepareDamageBack', { name: enemy.name, back }),
                '#9bc8ff'
            );
            deps.emitEnemyUpdate({
                hp: enemy.hp,
                maxHp: enemy.maxHp,
                color: enemy.color,
                name: enemy.name,
                icon: enemy.icon,
            });
        }
        return;
    }

    if (defended && def.defenseRule === 'leakOnDefend') {
        const leak = def.defenseLeakDamage ?? 0;
        const taken = leak > 0 ? player.takeDamage(leak, 0, 'true') : 0;
        if (taken > 0) {
            deps.emitPlayerHit(taken);
            log.addMessage(
                loc.t('combatEnemyPrepareLeakOnDefend', {
                    name: enemy.name,
                    action,
                    takenDamage: taken,
                }),
                '#d0a060'
            );
        } else {
            log.addMessage(
                loc.t('combatEnemyPrepareDefend', { name: enemy.name, action }),
                '#9bc8ff'
            );
        }
        if (def.bleed || def.poison) {
            log.addMessage(
                loc.t('combatEnemyPrepareRidersCancelled', { name: enemy.name, action }),
                '#9bc8ff'
            );
        }
        return;
    }

    // Either no Defend, or 'cancelRiders' rule.
    const flatBlock = defended ? COMBAT_CONFIG.defendBlock : 0;
    const taken = deps.applyEnemyHitToPlayer(def.damage, flatBlock);
    if (taken > 0) {
        log.addMessage(
            loc.t('combatEnemyPrepareResolve', {
                name: enemy.name,
                action,
                takenDamage: taken,
            }),
            '#ff6666'
        );
    } else {
        log.addMessage(loc.t('absorb'), '#8fc6ff');
    }

    if (defended) {
        if (def.bleed || def.poison) {
            log.addMessage(
                loc.t('combatEnemyPrepareRidersCancelled', { name: enemy.name, action }),
                '#9bc8ff'
            );
        }
        return;
    }

    // No Defend: apply rider effects.
    if (def.bleed) {
        applyBleed(player.status, def.bleed.stacks, def.bleed.turns, enemy.bleedCap);
        log.addMessage(
            loc.t('combatEnemyPrepareBleed', {
                name: enemy.name,
                action,
                stacks: def.bleed.stacks,
                turns: def.bleed.turns,
            }),
            '#d06060'
        );
    }
    if (def.poison) {
        applyPoison(player.status, def.poison.damage, def.poison.turns);
        log.addMessage(
            loc.t('combatEnemyPreparePoison', {
                name: enemy.name,
                action,
                damage: def.poison.damage,
                turns: def.poison.turns,
            }),
            '#7fbf6a'
        );
    }
}
