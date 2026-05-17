/**
 * Player-side action handlers extracted from CombatManager.
 *
 * Mirrors the {@link EnemyTurn} extraction pattern: each handler is
 * a standalone function that takes a {@link PlayerActionsDeps}
 * bundle plus an explicit shared-state object so CombatManager
 * doesn't need to be passed in. Keeping these out of the manager
 * class shrinks the orchestration file from ~1600 lines and makes
 * the player/enemy/relic seams more visible.
 *
 * State shared with the manager:
 *  - `preparationActive`: read & cleared by attack / defend.
 *  - `skillCooldowns`: read & written by skill cast.
 * Both live on a {@link PlayerActionsState} object the manager
 * passes by reference; mutations bounce straight back to the
 * manager's own fields.
 *
 * Why a state object instead of getter / setter callbacks: each
 * handler touches multiple fields atomically, so the indirection
 * cost would dwarf the readability win. The state is bundled with
 * deps at every entry point so the manager keeps a single source
 * of truth.
 */
import { COMBAT_CONFIG } from '../../data/GameConfig';
import { narrate } from '../Narrator';
import { SKILLS, type SkillId } from '../Skills';
import { applyBleed, consumeMark } from '../StatusEffects';
import { breakBossBlockOnSkillDamage } from '../BossRuntime';
import { randomInt } from '../Rng';
import type { EventLog } from '../../ui/EventLog';
import type { Localization } from '../Localization';
import type { PlayerManager } from '../PlayerManager';
import type { Rng } from '../Rng';
import type { ActiveEnemy, EnemyUpdatePayload } from '../CombatManager';
import { applyOnAttackRelics, applyResolveOnAttack } from './RelicHooks';

/** Mutable state CombatManager hands the player-action handlers. */
export interface PlayerActionsState {
    /** Preparation buff — set by `preparation` skill, consumed on next attack/defend. */
    preparationActive: boolean;
    /** Per-combat skill cooldowns keyed by SkillId. Mutated on cast. */
    skillCooldowns: Partial<Record<SkillId, number>>;
    /** Per-turn relic guards. Reset by CombatManager at the top of every player turn. */
    vampiricHealedThisTurn: boolean;
    gamblersResolveThisTurn: number;
    lastActionResult: {
        critical: boolean;
        enemyStunned: boolean;
        enemyEvaded: boolean;
    };
}

/** Dependencies for player-action handlers. */
export interface PlayerActionsDeps {
    player: PlayerManager;
    log: EventLog;
    loc: Localization;
    rng: Rng;
    emitPlayerHit(damage: number): void;
    emitEnemyUpdate(payload: EnemyUpdatePayload): void;
}

function skillName(loc: Localization, id: SkillId): string {
    return loc.pick(SKILLS[id].name);
}

export function handlePlayerAttack(
    enemy: ActiveEnemy | null,
    state: PlayerActionsState,
    deps: PlayerActionsDeps
): void {
    if (!enemy) return;
    const { player, log, loc, rng } = deps;
    player.gainResolve(COMBAT_CONFIG.resolveFromAttack);
    const result = rollPlayerAttack(player, rng);
    let damage = result.damage;
    if (state.preparationActive) {
        damage += 1;
        state.preparationActive = false;
        log.addMessage(loc.t('combatPreparationAttack'), '#9bc8ff');
    }
    // Knight's Sword: +5 damage on a regular attack at the relic's
    // chance. Resolved on the basic-attack path ONLY (skills, bleed
    // ticks, Cursed-Ring scrubbed strikes do NOT receive it). Logged
    // before the strike line so the order reads "extra → strike".
    const agg = player.aggregate;
    if (agg.damageBonusOnAttackChance > 0 && rng.next() < agg.damageBonusOnAttackChance) {
        const bonus = agg.damageBonusOnAttackAmount;
        damage += bonus;
        log.addMessage(loc.t('combatRelicKnightSwordBonus', { bonus }), '#e6d27a');
    }
    applyPlayerDamage(enemy, damage, result.critical, state, deps);
    log.addMessage(
        result.critical ? loc.t('strikeCrit', { damage }) : loc.t('strike', { damage }),
        result.critical ? '#ffe08a' : '#dddddd'
    );
    if (result.critical && rng.next() < 0.35) {
        log.addMessage(narrate('crit_landed', loc.language), '#c4a35a');
    }
    applyOnAttackRelics(enemy, deps);
    applyResolveOnAttack(deps);
}

export function handlePlayerDefend(
    enemy: ActiveEnemy | null,
    state: PlayerActionsState,
    deps: PlayerActionsDeps
): void {
    if (!enemy) return;
    const { player, log, loc } = deps;
    player.gainResolve(COMBAT_CONFIG.resolveFromGuard);
    if (state.preparationActive) {
        player.addDefenseBonus(1);
        state.preparationActive = false;
        log.addMessage(loc.t('combatPreparationDefend'), '#9bc8ff');
    }
    log.addMessage(loc.t('brace'), '#66aaff');
}

export function handlePlayerSkill(
    enemy: ActiveEnemy | null,
    skillId: SkillId,
    state: PlayerActionsState,
    deps: PlayerActionsDeps
): boolean {
    if (!enemy) return false;
    const { player, log, loc, rng } = deps;
    const skill = SKILLS[skillId];
    const cooldown = state.skillCooldowns[skillId] ?? 0;
    if (cooldown > 0) {
        log.addMessage(
            loc.t('combatSkillOnCooldown', {
                value: skillName(loc, skillId),
                turns: cooldown,
            }),
            '#8899aa'
        );
        return false;
    }
    const cost = Math.max(1, skill.resolveCost);
    if (!player.spendResolve(cost)) {
        log.addMessage(
            loc.t('combatNeedResolveForSkill', { cost, value: skillName(loc, skillId) }),
            '#8899aa'
        );
        return false;
    }

    // Skeleton Swordsman "Skilled Fencer": parry the skill before
    // its effect resolves. The resolve cost is already spent above
    // (and is NOT refunded — the parry just wastes the player's
    // turn) and the player's turn still passes so the enemy still
    // acts on top.
    if (enemy.passive?.kind === 'blocksSkillsAndPotions' && rng.next() < enemy.passive.chance) {
        log.addMessage(
            loc.t('combatEnemyParrySkill', {
                name: enemy.name,
                value: skillName(loc, skillId),
            }),
            '#a89070'
        );
        return true;
    }

    switch (skillId) {
        case 'cleave': {
            const base = player.getAttackPower();
            const bonus = Math.max(1, Math.floor(base * 0.5));
            const dmg = Math.max(1, base + bonus);
            applyPlayerDamage(enemy, dmg, false, state, deps);
            log.addMessage(loc.t('combatSkillCleave', { dmg }), '#b893ff');
            applyOnAttackRelics(enemy, deps);
            applyResolveOnAttack(deps);
            breakBossBlockOnSkillDamage(enemy, log, loc);
            break;
        }
        case 'bleed_strike': {
            const dmg = Math.max(1, player.getAttackPower());
            applyPlayerDamage(enemy, dmg, false, state, deps);
            const bleedPerTick = Math.max(1, Math.floor(player.getAttackPower() * 0.2));
            applyBleed(enemy.status, bleedPerTick, 3, enemy.bleedCap);
            log.addMessage(loc.t('combatSkillBleedStrike', { dmg }), '#d06060');
            applyOnAttackRelics(enemy, deps);
            applyResolveOnAttack(deps);
            breakBossBlockOnSkillDamage(enemy, log, loc);
            break;
        }
        case 'preparation': {
            state.preparationActive = true;
            log.addMessage(loc.t('combatSkillPreparation'), '#7fa9ff');
            break;
        }
    }
    return true;
}

export function handlePlayerPotion(enemy: ActiveEnemy | null, deps: PlayerActionsDeps): boolean {
    const { player, log, loc, rng } = deps;
    if (!player.spendPotion()) {
        log.addMessage(loc.t('noPotions'), '#8899aa');
        return false;
    }
    // Skeleton Swordsman "Skilled Fencer": parry the potion as it
    // is being drunk. The potion is already consumed (cost is the
    // gating mechanic) but the heal is silenced. Player's turn
    // still passes.
    if (enemy?.passive?.kind === 'blocksSkillsAndPotions' && rng.next() < enemy.passive.chance) {
        log.addMessage(
            loc.t('combatEnemyParryPotion', {
                name: enemy.name,
            }),
            '#a89070'
        );
        return true;
    }
    const healed = player.heal(COMBAT_CONFIG.potionHeal);
    log.addMessage(loc.t('drinkPotion', { healed }), '#78e496');
    return true;
}

/**
 * Apply player-side damage to the enemy with all the per-hit modifiers:
 *   - Bee-Butterfly evade-and-sting (cancels the swing entirely)
 *   - mark consumption -> guaranteed crit
 *   - boss "Exposed" pendingExposeBonus
 *   - boss Bone-Shield style block (pendingBlock soak)
 *   - skeleton-style damageReduction passive
 *   - Longinus Shard Prophet multiplier
 *   - thorns reflect (Slime)
 */
export function applyPlayerDamage(
    enemy: ActiveEnemy | null,
    baseDamage: number,
    criticalIn: boolean,
    state: PlayerActionsState,
    deps: PlayerActionsDeps
): void {
    if (!enemy) return;
    const { player, log, loc, rng } = deps;

    // Bee-Butterfly "Flutter and sting": chance to dodge the
    // player's incoming swing entirely and counter for a fixed
    // amount of true damage. Resolved before any player-side
    // procs (Minor Cursed, mark consumption, expose bonuses,
    // Bone-Shield, damage reduction) so those are not wasted on
    // a missed swing.
    if (enemy.passive?.kind === 'evadeAndStingOnHit' && rng.next() < enemy.passive.chance) {
        state.lastActionResult.enemyEvaded = true;
        const sting = enemy.passive.damage;
        const taken = sting > 0 ? player.takeDamage(sting, 0, 'true') : 0;
        log.addMessage(
            loc.t('combatEnemyEvadeAndSting', {
                name: enemy.name,
                damage: taken,
            }),
            '#d9bf3a'
        );
        if (taken > 0) deps.emitPlayerHit(taken);
        return;
    }

    let critical = criticalIn;
    let damage = baseDamage;

    // Consume mark for guaranteed crit.
    if (!critical && consumeMark(enemy.status)) {
        critical = true;
        damage = Math.max(1, Math.round(damage * COMBAT_CONFIG.criticalMultiplier));
    }

    // Boss "Exposed" actions queue +N damage on the next
    // player hit. Consume the queue here so subsequent hits (e.g.
    // bleed tick) do NOT eat the bonus.
    if (enemy.bossPhase && enemy.bossPhase.pendingExposeBonus > 0) {
        damage += enemy.bossPhase.pendingExposeBonus;
        enemy.bossPhase.pendingExposeBonus = 0;
    }

    // Bone-Shield style block on the boss soaks the next
    // player hit before HP loss.
    if (enemy.bossPhase && enemy.bossPhase.pendingBlock > 0) {
        const blocked = Math.min(enemy.bossPhase.pendingBlock, damage);
        damage -= blocked;
        enemy.bossPhase.pendingBlock -= blocked;
    }

    // Skeleton-style passive: on a successful hit, the enemy may
    // shrug off N points of damage. Mirrored as a chance-gated
    // flat reduction so it interacts cleanly with crits/expose.
    if (
        damage > 0 &&
        enemy.passive?.kind === 'damageReduction' &&
        rng.next() < enemy.passive.chance
    ) {
        const before = damage;
        damage = Math.max(0, damage - enemy.passive.reduction);
        if (damage < before) {
            log.addMessage(
                loc.t('combatEnemyDamageReduction', {
                    name: enemy.name,
                    amount: before - damage,
                }),
                '#9aa6b3'
            );
        }
    }

    // Longinus Shard: ×N damage when the enemy is the Prophet
    // boss. Applied AFTER all other damage modifiers but BEFORE
    // the HP write so the multiplied damage feeds the death
    // check and the boss-block / spawn paths.
    if (damage > 0 && enemy.canonicalName === 'Prophet') {
        const mult = player.aggregate.prophetDamageMult;
        if (mult > 1) {
            const before = damage;
            damage = Math.max(1, Math.round(damage * mult));
            log.addMessage(
                loc.t('combatRelicLonginusShard', {
                    before,
                    damage,
                }),
                '#ffd9d9'
            );
        }
    }

    if (damage > 0) {
        enemy.hp = Math.max(0, enemy.hp - damage);
        if (enemy.bossPhase) enemy.bossPhase.damagedThisTurn = true;
    }
    state.lastActionResult.critical = state.lastActionResult.critical || critical;
    deps.emitEnemyUpdate({
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        color: enemy.color,
        name: enemy.name,
        icon: enemy.icon,
    });

    // Slime-style thorns: when struck, the enemy may reflect a
    // small fixed amount back to the player as untyped damage.
    if (
        damage > 0 &&
        enemy.passive?.kind === 'thornsOnTakeHit' &&
        rng.next() < enemy.passive.chance
    ) {
        const reflect = enemy.passive.damage;
        const taken = player.takeDamage(reflect, 0, 'true');
        if (taken > 0) {
            log.addMessage(
                loc.t('combatEnemyThorns', {
                    name: enemy.name,
                    thorns: taken,
                }),
                '#7fbf6a'
            );
            deps.emitPlayerHit(taken);
        }
    }

    if (critical) {
        // Crit-based relic effects are deferred to a follow-up PR.
        void state.vampiricHealedThisTurn;
        void state.gamblersResolveThisTurn;
    }
}

/**
 * Roll the player's basic attack damage with variance + crit. Public
 * so {@link handlePlayerAttack} can call it without going through
 * CombatManager's private helper.
 */
export function rollPlayerAttack(
    player: PlayerManager,
    rng: Rng
): { damage: number; critical: boolean } {
    const variance =
        COMBAT_CONFIG.randomVariance > 0
            ? randomInt(rng, -COMBAT_CONFIG.randomVariance, COMBAT_CONFIG.randomVariance)
            : 0;
    const baseDamage = Math.max(1, player.getAttackPower() + variance);
    const critical = rng.next() < player.getCritChance();
    return {
        damage: critical
            ? Math.max(1, Math.round(baseDamage * COMBAT_CONFIG.criticalMultiplier))
            : baseDamage,
        critical,
    };
}
