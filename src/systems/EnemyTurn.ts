import { COMBAT_CONFIG } from '../data/GameConfig';
import type { EnemyPrepareDef } from '../data/GameConfig';
import type { EventLog } from '../ui/EventLog';
import { intentLabelForPhase, intentLabelForPrepare, prepareName } from './BossRuntime';
import { narrate } from './Narrator';
import type { Localization } from './Localization';
import type { PlayerManager } from './PlayerManager';
import {
    applyArmorBreak,
    applyBleed,
    applyPoison,
    applyStun,
    applyWeaken,
    consumeStunForTurn,
} from './StatusEffects';
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

    // Underground Ent "Strangling Roots": refresh a small weaken on
    // the player every turn the ent is alive. Applied BEFORE the
    // regular-attack resolution so it is in place for the very next
    // player turn (player ticks run at end-of-full-turn, so a
    // turns=2 application survives the tick exactly long enough).
    if (enemy.passive?.kind === 'weakenPlayerEachTurn') {
        const had = player.status.weaken.turns > 0;
        applyWeaken(player.status, enemy.passive.amount, enemy.passive.turns);
        if (!had) {
            log.addMessage(
                loc.t('combatEnemyStranglingRoots', {
                    name: enemy.name,
                    amount: enemy.passive.amount,
                }),
                '#6a8f5a'
            );
            deps.emitPlayerStatus();
        }
    }

    // Skeleton "Set the Bone": heal a fixed amount at the start of
    // every enemy turn while alive. Applied here (alongside the other
    // start-of-enemy-turn passives) so the heal lands BEFORE the
    // regular-attack resolution and is reflected in the next intent
    // the player sees. No-op once at maxHp.
    if (enemy.passive?.kind === 'regenPerTurn' && enemy.hp < enemy.maxHp) {
        const before = enemy.hp;
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.passive.amount);
        const healed = enemy.hp - before;
        if (healed > 0) {
            log.addMessage(
                loc.t('combatEnemyRegenPerTurn', { name: enemy.name, healed }),
                '#a8d8a0'
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

    // Lich "Curse of Darkness": once per encounter, on a winning roll,
    // apply a long-lasting weaken to the player. The roll runs every
    // enemy turn UNTIL it lands — once `curseDarknessFired` is set the
    // lich never tries again, matching the spec's "60% chance each
    // turn until first application" wording.
    if (enemy.passive?.kind === 'curseDarknessOnce' && !enemy.curseDarknessFired) {
        if (rng.next() < enemy.passive.chance) {
            applyWeaken(player.status, enemy.passive.weakenAmount, enemy.passive.weakenTurns);
            enemy.curseDarknessFired = true;
            log.addMessage(
                loc.t('combatEnemyCurseDarkness', {
                    name: enemy.name,
                    amount: enemy.passive.weakenAmount,
                }),
                '#8a4dc8'
            );
            deps.emitPlayerStatus();
        }
    }

    // Lost Adventurer "Healing Potions": when hp/maxHp drops below
    // the threshold, chug a potion and recover a fraction of maxHp.
    // Limited to `maxUses` heals per encounter — counter lives on the
    // ActiveEnemy and resets with the next setupEnemy call. Resolves
    // BEFORE the regular attack so the tank still gets to swing at
    // higher HP this same turn.
    if (
        enemy.passive?.kind === 'selfHealOnLowHp' &&
        enemy.maxHp > 0 &&
        enemy.hp / enemy.maxHp < enemy.passive.threshold &&
        (enemy.selfHealsUsed ?? 0) < enemy.passive.maxUses &&
        enemy.hp < enemy.maxHp
    ) {
        const want = Math.max(1, Math.floor(enemy.maxHp * enemy.passive.healFraction));
        const before = enemy.hp;
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + want);
        const healed = enemy.hp - before;
        enemy.selfHealsUsed = (enemy.selfHealsUsed ?? 0) + 1;
        if (healed > 0) {
            log.addMessage(loc.t('combatEnemySelfHeal', { name: enemy.name, healed }), '#a8d8a0');
            deps.emitEnemyUpdate({
                hp: enemy.hp,
                maxHp: enemy.maxHp,
                color: enemy.color,
                name: enemy.name,
                icon: enemy.icon,
            });
        }
    }

    // Death Knight "Corrosion Strike": chance to swap the regular
    // attack for a corrosion blow — `damage` true damage (bypasses
    // defense) AND apply armorBreak for the rest of the fight. Picks
    // one or the other per turn, never stacks on top of the regular
    // attack. Resolves before the standard attack pipeline so we can
    // early-return cleanly without firing the rest of the regular
    // attack passives below.
    if (enemy.passive?.kind === 'corrosionStrikeOnAttack' && rng.next() < enemy.passive.chance) {
        const taken = player.takeDamage(enemy.passive.damage, 0, 'true');
        applyArmorBreak(
            player.status,
            enemy.passive.armorBreak.amount,
            enemy.passive.armorBreak.turns
        );
        log.addMessage(
            loc.t('combatEnemyCorrosionStrike', {
                name: enemy.name,
                damage: taken,
                amount: enemy.passive.armorBreak.amount,
            }),
            '#7faf6a'
        );
        if (taken > 0) deps.emitPlayerHit(taken);
        deps.emitPlayerStatus();
        if (player.stats.hp <= 0) {
            deps.logDeath();
            return;
        }
        return;
    }

    // Regular attack.
    const flatBlock = playerAction === 'defend' ? COMBAT_CONFIG.defendBlock : 0;
    const weakenReduction = enemy.status.weaken.turns > 0 ? enemy.status.weaken.amount : 0;
    let attackPower = enemy.attack - weakenReduction;
    if (attackPower < 1) attackPower = 1;

    // Goblin Horde "Thinning Horde": scale attack by current/max HP
    // so the surviving rump only manages a glancing blow. Applies
    // before extraDamageOnHit so the +N bonus still applies on top.
    if (enemy.passive?.kind === 'attackScalesWithHp' && enemy.maxHp > 0) {
        const before = attackPower;
        const scaled = Math.max(1, Math.floor(attackPower * (enemy.hp / enemy.maxHp)));
        attackPower = scaled;
        if (scaled < before) {
            log.addMessage(
                loc.t('combatEnemyHordeThins', {
                    name: enemy.name,
                    attack: scaled,
                }),
                '#7fa05a'
            );
        }
    }

    // Succubus "Exultation in Pain": +1 damage per `bonusPerStep`
    // fraction of *missing* HP. Mirror image of Thinning Horde —
    // gets stronger as she takes damage. Floors fractional steps so
    // a 5% chip doesn't yet earn the bonus.
    if (enemy.passive?.kind === 'painExultation' && enemy.maxHp > 0) {
        const step = enemy.passive.bonusPerStep > 0 ? enemy.passive.bonusPerStep : 0.1;
        const missingRatio = (enemy.maxHp - enemy.hp) / enemy.maxHp;
        const bonus = Math.floor(missingRatio / step);
        if (bonus > 0) {
            attackPower += bonus;
            log.addMessage(
                loc.t('combatEnemyPainExultation', {
                    name: enemy.name,
                    bonus,
                }),
                '#c45a8a'
            );
        }
    }

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

    // Gelatinous Cube "Acid Vomit": on the first regular hit that
    // actually lands, etch the player's armor — defense -amount for
    // the rest of the fight (and a couple of rooms past it, since
    // armorBreak.turns ticks once per combat turn). Gated on the
    // player's existing armorBreak.turns so re-triggers from the same
    // cube don't keep refreshing it; design says ONE acid burst per
    // cube, not a continuous spray.
    if (
        takenDamage > 0 &&
        enemy.passive?.kind === 'acidVomitOnFirstHit' &&
        player.status.armorBreak.turns === 0
    ) {
        applyArmorBreak(player.status, enemy.passive.amount, enemy.passive.turns);
        log.addMessage(
            loc.t('combatEnemyAcidVomit', {
                name: enemy.name,
                amount: enemy.passive.amount,
            }),
            '#5fcf5a'
        );
        deps.emitPlayerStatus();
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

    // Steel Lynx "Predator's Instinct": chance to swing a SECOND time
    // on this same regular-attack turn. The second swing reuses the
    // same scaled `attackPower` (so weaken/horde/exultation modifiers
    // already applied carry over) and goes through the regular hit
    // pipeline so player-side procs (guard, blockOnHit, crit roll)
    // resolve normally on it. The trigger only fires when the first
    // swing actually landed and the player is still alive — a fully
    // absorbed first swing or a death-on-first does not feed a
    // free second hit.
    if (
        takenDamage > 0 &&
        enemy.passive?.kind === 'doubleAttackChance' &&
        rng.next() < enemy.passive.chance &&
        player.stats.hp > 0
    ) {
        log.addMessage(loc.t('combatEnemyDoubleAttack', { name: enemy.name }), '#c4a35a');
        const secondTaken = deps.applyEnemyHitToPlayer(attackPower, flatBlock);
        if (secondTaken > 0) {
            log.addMessage(
                loc.t('combatEnemyHit', {
                    name: enemy.name,
                    takenDamage: secondTaken,
                    extraMessage: '',
                }),
                '#ff6666'
            );
        } else {
            log.addMessage(loc.t('absorb'), '#8fc6ff');
        }
        if (player.stats.hp <= 0) {
            deps.logDeath();
            return;
        }
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
    if (def.stun) {
        applyStun(player.status, def.stun.turns);
        log.addMessage(
            loc.t('combatEnemyPrepareStun', {
                name: enemy.name,
                action,
                turns: def.stun.turns,
            }),
            '#7aaaff'
        );
        deps.emitPlayerStatus();
    }
}
