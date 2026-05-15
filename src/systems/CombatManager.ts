import { getBossForDepth } from '../data/Enemies';
import { getEnemyForDepth } from './EnemyPicker';
import { COMBAT_CONFIG, DEFAULT_ACTION_BARS, ROOM_CONFIG } from '../data/GameConfig';
import type {
    EnemyActionBars,
    EnemyDef,
    EnemyPassive,
    EnemyPrepareDef,
    EnemyProfile,
} from '../data/GameConfig';
import {
    BOSS_BLUEPRINT_BY_NAME,
    pickLine,
    type BossActionDef,
    type BossBlueprint,
} from '../data/Bosses';
import type { EventLog } from '../ui/EventLog';
import {
    breakBossBlockOnSkillDamage,
    intentLabelForPhase,
    intentLabelForPrepare,
    maybeAdvancePhase,
    tickBossBlockAtTurnEnd,
} from './BossRuntime';
import { Emitter } from './Emitter';
import { narrate } from './Narrator';
import { Localization } from './Localization';
import { PlayerManager } from './PlayerManager';
import { SKILLS } from './Skills';
import type { SkillId } from './Skills';
import {
    applyBleed,
    consumeGuardBlock,
    consumeMark,
    emptyStatusState,
    statusSummary,
    tickTurn,
} from './StatusEffects';
import {
    resolveEnemyTurn as resolveEnemyTurnFn,
    type EnemyTurnDeps,
    type PlayerAction,
} from './EnemyTurn';
import type { StatusState } from './StatusEffects';
import { defaultRng, randomInt, type Rng } from './Rng';

export type CombatAction =
    | 'attack'
    | 'defend'
    | 'skill'
    | 'potion'
    | { kind: 'skill'; id: SkillId };

type EncounterKind = 'normal' | 'elite' | 'boss';

/**
 * [FIX-10] Per-combat boss phase tracking. Built from a BossBlueprint
 * when the enemy's name matches an entry in BOSS_BLUEPRINT_BY_NAME.
 * Lives on the ActiveEnemy so it is GC'd when combat ends.
 */
export interface BossPhaseState {
    blueprint: BossBlueprint;
    phaseIndex: number;
    actionIndex: number;
    /** Boss takes +N extra damage on the player's next hit. */
    pendingExposeBonus: number;
    /** Block remaining on the boss (e.g. Bone Shield, Death Shield). */
    pendingBlock: number;
    /** Boss turns the active block buff still has before it expires. */
    pendingBlockTurns: number;
    /** Pending False Mercy heal if the player did no damage this turn. */
    pendingHealOnSafe: number;
    /** Whether the player damaged the boss during the just-finished player turn. */
    damagedThisTurn: boolean;
    /**
     * Active windup for an action with `windupTurns`. While set, the
     * boss takes no other action; the player sees a "{action} (Nt)"
     * intent badge and can react. When `turnsRemaining` reaches 0 the
     * action's resolution effect fires on the boss's next turn.
     */
    pendingWindup?: {
        actionDef: BossActionDef;
        turnsRemaining: number;
    };
}

export interface ActiveEnemy {
    kind: EncounterKind;
    /** Localised display name (used for log lines and UI). */
    name: string;
    /** Canonical English name from EnemyDef — stable key for drop tables. */
    canonicalName: string;
    description: string;
    icon: string;
    hp: number;
    maxHp: number;
    attack: number;
    color: number;
    xp: number;
    gold: number;
    profile: EnemyProfile;
    turnsAlive: number;
    status: StatusState;
    firstHitEvaded?: boolean;
    firstStunResisted?: boolean;
    /** Per-spec passive trigger copied from EnemyDef at combat start. */
    passive?: EnemyPassive;
    /**
     * Mid-combat windup state for non-boss enemies that have a `prepare`
     * block. `turnsRemaining` counts down on every enemy turn; when it
     * hits 0 the prepare resolves on the *next* enemy turn (so the
     * player has one turn to react with Defend).
     */
    pendingPrepare?: { def: EnemyPrepareDef; turnsRemaining: number };
    /** [FIX-10] Phase blueprint runtime state, only set on bosses. */
    bossPhase?: BossPhaseState;
    /**
     * EXPERIMENTAL — action-combat prototype tuning copied from the
     * EnemyDef at combat start. Drives the per-frame bar mechanics in
     * the CombatHud; ignored entirely in turn-based (non-realtime)
     * mode. Always present so the HUD can read it unconditionally.
     */
    actionBars: EnemyActionBars;
    /**
     * [FIX-10] Localised one-line intent shown BEFORE the boss's next
     * turn so the player can respond. `null` for non-boss enemies.
     */
    currentIntent?: string | null;
    /** [FIX-1] Hard cap on stack count for bleed (final boss). */
    bleedCap?: number;
}

interface CombatRewards {
    xp: number;
    gold: number;
    potions: number;
    attackBonus: number;
}

export interface CombatEndPayload {
    enemyName: string;
    /** Canonical English name — used by drop tables (rollRelicForEnemy). */
    enemyCanonicalName: string;
    kind: EncounterKind;
    rewards: CombatRewards;
    killedByBleed: boolean;
    /** [FIX-1] Set when the slain enemy was the final boss. */
    finalBossDefeated: boolean;
}

export interface EnemyUpdatePayload {
    hp: number;
    maxHp: number;
    color: number;
    name: string;
    icon: string;
}

// =============================================================================
// CombatManager routing map (see .agents/skills/rpg-like-durkest/SKILL.md)
// -----------------------------------------------------------------------------
// Type/payload exports (CombatAction, BossPhaseState, ActiveEnemy,
//   CombatRewards, CombatEndPayload, EnemyUpdatePayload) . . . . . .   40 - 149
// Field declarations + Emitter channels . . . . . . . . . . . . . . 152 - 188
// constructor / skillName . . . . . . . . . . . . . . . . . . . . . 190 - 204
// startCombat / setupEnemy (encounter init, scaling, intent rolls). 206 - 311
// getSkillCooldown / isSkillOnCooldown . . . . . . . . . . . . . .  313 - 320
// processTurn (top-level player-action dispatcher) . . . . . . . .  322 - 428
// handlePlayerAttack / Defend / Skill / Potion . . . . . . . . . .  430 - 564
// applyPlayerDamage (crit, mark, weaken, status, kill check) . . .  566 - 670
// applyOnAttackRelics / tryVampireBlessingOnAttack /
//   tryHealOnAttack . . . . . . . . . . . . . . . . . . . . . . .  672 - 716
// resolveEnemyTurn (non-boss intent execution) . . . . . . . . . .  723 - 900
// applyEnemyHitToPlayer / finishCombat / logDeath /
//   rollPlayerAttack / buildRewards . . . . . . . . . . . . . . . . 902 - 1001
// Boss machinery: intentLabel*, prepareName, resolvePrepare,
//   maybeAdvancePhase, runBossTurn, resolveBossWindupAction,
//   tickBossBlockAtTurnEnd, breakBossBlockOnSkillDamage . . . . .  1003 - 1478
// enemyStatusText / playerStatusText / randomBetween . . . . . . . 1481 - end
// =============================================================================
export class CombatManager {
    private player: PlayerManager;
    private log: EventLog;
    private loc: Localization;
    private rng: Rng;

    public enemy: ActiveEnemy | null = null;
    public lastActionResult: {
        critical: boolean;
        enemyStunned: boolean;
        enemyEvaded: boolean;
    } = {
        critical: false,
        enemyStunned: false,
        enemyEvaded: false,
    };
    public readonly enemyUpdate = new Emitter<EnemyUpdatePayload>();
    public readonly playerStatusChange = new Emitter<void>();
    public readonly enemyStatusChange = new Emitter<void>();
    public readonly playerHit = new Emitter<{ damage: number }>();
    public readonly combatEnd = new Emitter<CombatEndPayload>();

    /** [FIX-5] Per-combat skill cooldowns keyed by SkillId. */
    public skillCooldowns: Partial<Record<SkillId, number>> = {};
    /** Preparation buff: next attack +1 damage, next defend +1 defense. */
    public preparationActive = false;
    /**
     * EXPERIMENTAL — action-combat prototype. When true, `processTurn`
     * runs the player's action but *skips* the reactive enemy turn so
     * enemy hits are driven by the CombatHud's defend-bar timer
     * instead of being tied 1:1 to player actions. Set by the HUD on
     * `startCombat` for the prototype branch and never flipped back
     * during a fight.
     */
    public realtimeMode = false;
    /**
     * [FIX-13] Per-turn relic guards. Reset at the top of every player
     * turn so Vampiric Sigil / Gambler's Knuckle resolve gain can fire
     * at most once per turn regardless of how many crits / kills line
     * up in that turn.
     */
    private vampiricHealedThisTurn = false;
    private gamblersResolveThisTurn = 0;

    constructor(
        player: PlayerManager,
        log: EventLog,
        loc: Localization = new Localization(),
        rng: Rng = defaultRng
    ) {
        this.player = player;
        this.log = log;
        this.loc = loc;
        this.rng = rng;
    }

    private skillName(id: SkillId): string {
        return this.loc.pick(SKILLS[id].name);
    }

    startCombat(depth: number, kind: EncounterKind) {
        // Reset per-combat state.
        this.skillCooldowns = {};
        this.preparationActive = false;
        const definition =
            kind === 'boss' ? getBossForDepth(depth) : getEnemyForDepth(depth, this.rng);
        this.setupEnemy(depth, kind, definition);
    }

    private setupEnemy(depth: number, kind: EncounterKind, definition: EnemyDef) {
        const rewardMultiplier =
            kind === 'elite'
                ? COMBAT_CONFIG.eliteRewardMultiplier
                : kind === 'boss'
                  ? COMBAT_CONFIG.bossRewardMultiplier
                  : 1;

        // Boss "piñata" XP bump — bosses dump 10–20 levels worth of XP in
        // one kill so the player visibly powers up after every depth-tier
        // fight. Stacks on top of bossRewardMultiplier and is XP-only
        // (gold still uses the legacy reward multiplier).
        const xpBossBonus = kind === 'boss' ? COMBAT_CONFIG.bossXpMultiplier : 1;

        const baseHp =
            kind === 'elite'
                ? Math.round(definition.hp * COMBAT_CONFIG.eliteHpMultiplier)
                : definition.hp;
        const baseAtk =
            kind === 'elite'
                ? Math.round(definition.attack * COMBAT_CONFIG.eliteAttackMultiplier)
                : definition.attack;

        // [FIX-10] Look up a boss blueprint by canonical English name so
        // localisation never breaks the lookup. Non-boss kinds skip this.
        const blueprint = kind === 'boss' ? BOSS_BLUEPRINT_BY_NAME[definition.name] : undefined;

        this.enemy = {
            kind,
            name: this.loc.enemyName(definition.name),
            canonicalName: definition.name,
            description: this.loc.enemyDescription(definition.name, definition.description),
            icon: definition.icon,
            hp: baseHp,
            maxHp: baseHp,
            attack: baseAtk,
            color: definition.color,
            xp: Math.max(1, Math.round(definition.xp * rewardMultiplier * xpBossBonus)),
            gold: Math.max(1, Math.round(definition.gold * rewardMultiplier)),
            profile: definition.profile,
            turnsAlive: 0,
            status: emptyStatusState(),
            passive: definition.passive,
            pendingPrepare: definition.prepare
                ? { def: definition.prepare, turnsRemaining: definition.prepare.turns }
                : undefined,
            bossPhase: blueprint
                ? {
                      blueprint,
                      phaseIndex: 0,
                      actionIndex: 0,
                      pendingExposeBonus: 0,
                      pendingBlock: 0,
                      pendingBlockTurns: 0,
                      pendingHealOnSafe: 0,
                      damagedThisTurn: false,
                  }
                : undefined,
            currentIntent: null,
            actionBars: definition.actionBars ?? DEFAULT_ACTION_BARS,
        };
        // Compute the initial intent so the UI can show what the enemy
        // is about to do BEFORE the first player turn.
        if (this.enemy.bossPhase) {
            this.enemy.currentIntent = intentLabelForPhase(this.enemy.bossPhase, this.loc);
        } else if (this.enemy.pendingPrepare) {
            this.enemy.currentIntent = intentLabelForPrepare(this.enemy.pendingPrepare, this.loc);
        }

        const encounterKey =
            kind === 'boss'
                ? 'combatBossEncounter'
                : kind === 'elite'
                  ? 'combatEliteEncounter'
                  : 'combatHostileContact';
        this.log.addMessage(this.loc.t(encounterKey, { name: this.enemy.name }), '#ff6666');

        if (kind === 'boss') {
            this.log.addMessage(narrate('enter_boss', this.loc.language), '#c4a35a');
        } else if (kind === 'elite') {
            this.log.addMessage(narrate('enter_elite', this.loc.language), '#c4a35a');
        } else if (depth > 0 && this.rng.next() < 0.25) {
            this.log.addMessage(narrate('enter_combat', this.loc.language), '#7a7a7a');
        }

        this.enemyUpdate.emit({
            hp: this.enemy.hp,
            maxHp: this.enemy.maxHp,
            color: this.enemy.color,
            name: this.enemy.name,
            icon: this.enemy.icon,
        });
        this.playerStatusChange.emit();
        this.enemyStatusChange.emit();
    }

    /**
     * [FIX-5] Look up the remaining cooldown for a skill (0 = ready).
     * Used by both UI and the headless simulator.
     */
    getSkillCooldown(id: SkillId): number {
        return this.skillCooldowns[id] ?? 0;
    }

    /** [FIX-5] True when the skill is on cooldown and unusable. */
    isSkillOnCooldown(id: SkillId): boolean {
        return this.getSkillCooldown(id) > 0;
    }

    processTurn(action: CombatAction) {
        if (!this.enemy) {
            return;
        }

        this.lastActionResult = {
            critical: false,
            enemyStunned: false,
            enemyEvaded: false,
        };
        this.enemy.turnsAlive += 1;
        // [FIX-10] Reset per-turn boss-phase state before the player acts.
        if (this.enemy.bossPhase) {
            this.enemy.bossPhase.damagedThisTurn = false;
        }
        // [FIX-13] Reset per-turn relic guards.
        this.vampiricHealedThisTurn = false;
        this.gamblersResolveThisTurn = 0;

        // [FIX-5] Tick down cooldowns at the start of each player turn.
        for (const id of Object.keys(this.skillCooldowns) as SkillId[]) {
            const remaining = this.skillCooldowns[id] ?? 0;
            if (remaining > 0) {
                this.skillCooldowns[id] = remaining - 1;
            }
            if ((this.skillCooldowns[id] ?? 0) <= 0) {
                delete this.skillCooldowns[id];
            }
        }

        const actionName = typeof action === 'string' ? action : action.kind;

        if (actionName === 'attack') {
            this.handlePlayerAttack();
        } else if (actionName === 'defend') {
            this.handlePlayerDefend();
        } else if (actionName === 'skill') {
            const skillId = typeof action === 'object' && 'id' in action ? action.id : 'cleave';
            if (!this.handlePlayerSkill(skillId)) {
                return;
            }
        } else {
            if (!this.handlePlayerPotion()) {
                return;
            }
        }

        // End-of-player-turn: tick enemy statuses (bleed damage etc.).
        if (this.enemy) {
            const enemyTick = tickTurn(this.enemy.status);
            if (enemyTick.bleedDamage > 0) {
                this.enemy.hp = Math.max(0, this.enemy.hp - enemyTick.bleedDamage);
                this.log.addMessage(
                    this.loc.t('combatBleedTick', {
                        name: this.enemy.name,
                        bleedDamage: enemyTick.bleedDamage,
                    }),
                    '#c15a5a'
                );
                this.enemyUpdate.emit({
                    hp: this.enemy.hp,
                    maxHp: this.enemy.maxHp,
                    color: this.enemy.color,
                    name: this.enemy.name,
                    icon: this.enemy.icon,
                });
            }
            this.enemyStatusChange.emit();
        }

        if (this.enemy && this.enemy.hp <= 0) {
            const killedByBleed = actionName === 'defend' || actionName === 'potion';
            this.finishCombat(killedByBleed);
            return;
        }

        if (!this.realtimeMode) {
            this.resolveEnemyTurn(
                actionName as Exclude<CombatAction, { kind: 'skill'; id: SkillId }>
            );
        }

        // Tick player statuses (bleed/poison damage, regen/mark/weaken decay).
        const playerTick = tickTurn(this.player.status);
        if (playerTick.regenHeal > 0) {
            const healed = this.player.heal(playerTick.regenHeal);
            if (healed > 0) {
                this.log.addMessage(this.loc.t('combatRegenTick', { healed }), '#8be0a7');
            }
        }
        if (playerTick.bleedDamage > 0) {
            const taken = this.player.takeDamage(playerTick.bleedDamage, 0, 'true');
            if (taken > 0) {
                this.log.addMessage(
                    this.loc.t('combatPlayerBleedTick', { damage: taken }),
                    '#d06060'
                );
                this.playerHit.emit({ damage: taken });
            }
        }
        if (playerTick.poisonDamage > 0 && this.player.stats.hp > 0) {
            const taken = this.player.takeDamage(playerTick.poisonDamage, 0, 'true');
            if (taken > 0) {
                this.log.addMessage(
                    this.loc.t('combatPlayerPoisonTick', { damage: taken }),
                    '#7fbf6a'
                );
                this.playerHit.emit({ damage: taken });
            }
        }
        if (this.player.stats.hp <= 0) {
            this.logDeath();
        }
        this.playerStatusChange.emit();
    }

    private handlePlayerAttack() {
        if (!this.enemy) return;
        this.player.gainResolve(COMBAT_CONFIG.resolveFromAttack);
        // Cursed Amulet (and similar): the curse may make the strike
        // miss outright. The Resolve gain above is preserved so the
        // economy is not punished, but no damage / on-hit procs run.
        const agg = this.player.aggregate;
        if (agg.missChance > 0 && this.rng.next() < agg.missChance) {
            this.log.addMessage(this.loc.t('combatRelicCursedMiss'), '#a08070');
            return;
        }
        const result = this.rollPlayerAttack();
        let damage = result.damage;
        if (this.preparationActive) {
            damage += 1;
            this.preparationActive = false;
            this.log.addMessage(this.loc.t('combatPreparationAttack'), '#9bc8ff');
        }
        this.applyPlayerDamage(damage, result.critical);
        this.log.addMessage(
            result.critical
                ? this.loc.t('strikeCrit', { damage })
                : this.loc.t('strike', { damage }),
            result.critical ? '#ffe08a' : '#dddddd'
        );
        if (result.critical && this.rng.next() < 0.35) {
            this.log.addMessage(narrate('crit_landed', this.loc.language), '#c4a35a');
        }
        this.applyOnAttackRelics();
    }

    private handlePlayerDefend() {
        if (!this.enemy) return;
        this.player.gainResolve(COMBAT_CONFIG.resolveFromGuard);
        if (this.preparationActive) {
            this.player.addDefenseBonus(1);
            this.preparationActive = false;
            this.log.addMessage(this.loc.t('combatPreparationDefend'), '#9bc8ff');
        }
        this.log.addMessage(this.loc.t('brace'), '#66aaff');
    }

    private handlePlayerSkill(skillId: SkillId): boolean {
        if (!this.enemy) return false;
        const skill = SKILLS[skillId];
        if (this.isSkillOnCooldown(skillId)) {
            this.log.addMessage(
                this.loc.t('combatSkillOnCooldown', {
                    value: this.skillName(skillId),
                    turns: this.getSkillCooldown(skillId),
                }),
                '#8899aa'
            );
            return false;
        }
        const cost = Math.max(1, skill.resolveCost);
        if (!this.player.spendResolve(cost)) {
            this.log.addMessage(
                this.loc.t('combatNeedResolveForSkill', { cost, value: this.skillName(skillId) }),
                '#8899aa'
            );
            return false;
        }

        // Cursed Ring (and similar): the curse may scrub the skill and
        // resolve it as a basic strike instead. Resolve already paid is
        // NOT refunded — the curse keeps the cost as a tax.
        const agg = this.player.aggregate;
        if (agg.skillToBasicChance > 0 && this.rng.next() < agg.skillToBasicChance) {
            this.log.addMessage(this.loc.t('combatRelicCursedSkillBasic'), '#a08070');
            const result = this.rollPlayerAttack();
            this.applyPlayerDamage(result.damage, result.critical);
            this.log.addMessage(
                result.critical
                    ? this.loc.t('strikeCrit', { damage: result.damage })
                    : this.loc.t('strike', { damage: result.damage }),
                result.critical ? '#ffe08a' : '#dddddd'
            );
            this.applyOnAttackRelics();
            return true;
        }

        switch (skillId) {
            case 'cleave': {
                const base = this.player.getAttackPower();
                const bonus = Math.max(1, Math.floor(base * 0.5));
                const dmg = Math.max(1, base + bonus);
                this.applyPlayerDamage(dmg, false);
                this.log.addMessage(this.loc.t('combatSkillCleave', { dmg }), '#b893ff');
                this.applyOnAttackRelics();
                breakBossBlockOnSkillDamage(this.enemy, this.log, this.loc);
                break;
            }
            case 'bleed_strike': {
                const dmg = Math.max(1, this.player.getAttackPower());
                this.applyPlayerDamage(dmg, false);
                const bleedPerTick = Math.max(1, Math.floor(this.player.getAttackPower() * 0.2));
                applyBleed(this.enemy.status, bleedPerTick, 3, this.enemy.bleedCap);
                this.log.addMessage(this.loc.t('combatSkillBleedStrike', { dmg }), '#d06060');
                this.applyOnAttackRelics();
                breakBossBlockOnSkillDamage(this.enemy, this.log, this.loc);
                break;
            }
            case 'preparation': {
                this.preparationActive = true;
                this.log.addMessage(this.loc.t('combatSkillPreparation'), '#7fa9ff');
                break;
            }
        }
        return true;
    }

    private handlePlayerPotion(): boolean {
        if (!this.player.spendPotion()) {
            this.log.addMessage(this.loc.t('noPotions'), '#8899aa');
            return false;
        }
        const healed = this.player.heal(COMBAT_CONFIG.potionHeal);
        this.log.addMessage(this.loc.t('drinkPotion', { healed }), '#78e496');
        return true;
    }

    private applyPlayerDamage(baseDamage: number, criticalIn: boolean) {
        if (!this.enemy) return;
        let critical = criticalIn;
        let damage = baseDamage;

        // Minor Cursed set: each player damaging action coin-flips
        // between doubling the strike OR backfiring 2 untyped damage
        // onto the player. Resolved BEFORE crit/expose/passives so the
        // doubled damage can ride the rest of the pipeline.
        if (this.player.aggregate.sets.minor_cursed) {
            if (this.rng.next() < 0.5) {
                damage *= 2;
                this.log.addMessage(this.loc.t('combatRelicCursedDouble', { damage }), '#c98aff');
            } else {
                const taken = this.player.takeDamage(2, 0, 'true');
                if (taken > 0) {
                    this.log.addMessage(
                        this.loc.t('combatRelicCursedSelfHit', { damage: taken }),
                        '#c98aff'
                    );
                    this.playerHit.emit({ damage: taken });
                }
            }
        }

        // Consume mark for guaranteed crit.
        if (!critical && consumeMark(this.enemy.status)) {
            critical = true;
            damage = Math.max(1, Math.round(damage * COMBAT_CONFIG.criticalMultiplier));
        }

        // [FIX-10] Boss "Exposed" actions queue +N damage on the next
        // player hit. Consume the queue here so subsequent hits (e.g.
        // bleed tick) do NOT eat the bonus.
        if (this.enemy.bossPhase && this.enemy.bossPhase.pendingExposeBonus > 0) {
            damage += this.enemy.bossPhase.pendingExposeBonus;
            this.enemy.bossPhase.pendingExposeBonus = 0;
        }

        // [FIX-10] Bone-Shield style block on the boss soaks the next
        // player hit before HP loss.
        if (this.enemy.bossPhase && this.enemy.bossPhase.pendingBlock > 0) {
            const blocked = Math.min(this.enemy.bossPhase.pendingBlock, damage);
            damage -= blocked;
            this.enemy.bossPhase.pendingBlock -= blocked;
        }

        // Skeleton-style passive: on a successful hit, the enemy may
        // shrug off N points of damage. Mirrored as a chance-gated
        // flat reduction so it interacts cleanly with crits/expose.
        if (
            damage > 0 &&
            this.enemy.passive?.kind === 'damageReduction' &&
            this.rng.next() < this.enemy.passive.chance
        ) {
            const before = damage;
            damage = Math.max(0, damage - this.enemy.passive.reduction);
            if (damage < before) {
                this.log.addMessage(
                    this.loc.t('combatEnemyDamageReduction', {
                        name: this.enemy.name,
                        amount: before - damage,
                    }),
                    '#9aa6b3'
                );
            }
        }

        if (damage > 0) {
            this.enemy.hp = Math.max(0, this.enemy.hp - damage);
            if (this.enemy.bossPhase) this.enemy.bossPhase.damagedThisTurn = true;
        }
        this.lastActionResult.critical = this.lastActionResult.critical || critical;
        this.enemyUpdate.emit({
            hp: this.enemy.hp,
            maxHp: this.enemy.maxHp,
            color: this.enemy.color,
            name: this.enemy.name,
            icon: this.enemy.icon,
        });

        // Slime-style thorns: when struck, the enemy may reflect a
        // small fixed amount back to the player as untyped damage.
        if (
            damage > 0 &&
            this.enemy.passive?.kind === 'thornsOnTakeHit' &&
            this.rng.next() < this.enemy.passive.chance
        ) {
            const reflect = this.enemy.passive.damage;
            const taken = this.player.takeDamage(reflect, 0, 'true');
            if (taken > 0) {
                this.log.addMessage(
                    this.loc.t('combatEnemyThorns', {
                        name: this.enemy.name,
                        thorns: taken,
                    }),
                    '#7fbf6a'
                );
                this.playerHit.emit({ damage: taken });
            }
        }

        if (critical) {
            // Crit-based relic effects are deferred to a follow-up PR.
            void this.vampiricHealedThisTurn;
            void this.gamblersResolveThisTurn;
        }
    }

    private applyOnAttackRelics() {
        if (!this.enemy) return;
        this.tryHealOnAttack();
        this.tryVampireBlessingOnAttack();
    }

    /**
     * Sara's Vampire Blessing: while active, every damaging player
     * action has an aggregate-defined chance (25%) to restore a fixed
     * amount (2) of HP. Stored on the relic aggregate so the combat
     * pipeline reads it through the same hook as relic on-attack
     * effects; granted via {@link PlayerManager.setVampireBlessing}.
     */
    private tryVampireBlessingOnAttack() {
        const agg = this.player.aggregate;
        if (agg.vampireBlessingChance <= 0 || agg.vampireBlessingAmount <= 0) return;
        if (this.rng.next() >= agg.vampireBlessingChance) return;
        const healed = this.player.heal(agg.vampireBlessingAmount);
        if (healed > 0) {
            this.log.addMessage(this.loc.t('combatVampireBlessingHeal', { healed }), '#d7b6ff');
        }
    }

    /**
     * Cracked Amulet (and similar): a small chance to recover HP after
     * any attack action. Uses the player's `aggregate.healOnAttackChance`
     * so multiple sources stack via max() in {@link aggregateRelics}.
     */
    private tryHealOnAttack() {
        if (!this.enemy) return;
        const agg = this.player.aggregate;
        if (agg.healOnAttackChance <= 0) return;
        if (this.rng.next() >= agg.healOnAttackChance) return;
        const healed = this.player.heal(agg.healOnAttackAmount);
        if (healed > 0) {
            this.log.addMessage(this.loc.t('combatRelicHealOnAttack', { healed }), '#8be0a7');
        }
    }

    private resolveEnemyTurn(playerAction: PlayerAction) {
        if (!this.enemy) return;
        resolveEnemyTurnFn(this.enemy, this.buildEnemyTurnDeps(), playerAction);
    }

    private buildEnemyTurnDeps(): EnemyTurnDeps {
        return {
            player: this.player,
            log: this.log,
            loc: this.loc,
            rng: this.rng,
            lastActionResult: this.lastActionResult,
            emitPlayerHit: (damage) => this.playerHit.emit({ damage }),
            emitEnemyUpdate: (payload) => this.enemyUpdate.emit(payload),
            emitPlayerStatus: () => this.playerStatusChange.emit(),
            emitEnemyStatus: () => this.enemyStatusChange.emit(),
            logDeath: () => this.logDeath(),
            applyEnemyHitToPlayer: (rawAttack, flatBlock) =>
                this.applyEnemyHitToPlayer(rawAttack, flatBlock),
            runBossTurn: (action) => this.runBossTurn(action),
        };
    }

    private applyEnemyHitToPlayer(rawAttack: number, flatBlock: number): number {
        if (!this.enemy) return 0;
        let amount = Math.max(1, rawAttack);

        // Guard (from Parry Stance etc.) also blocks damage.
        amount = consumeGuardBlock(this.player.status, amount);

        // Enemy crits: 8% flat.
        let crit = false;
        if (this.rng.next() < 0.08) {
            crit = true;
            amount = Math.max(1, Math.round(amount * 1.5));
        }

        // Holey Chestplate (and similar): a chance to soak a fixed
        // amount of damage before defense / HP loss is computed.
        const agg = this.player.aggregate;
        let extraBlock = 0;
        if (agg.blockOnHitChance > 0 && this.rng.next() < agg.blockOnHitChance) {
            extraBlock = agg.blockOnHitAmount;
            this.log.addMessage(
                this.loc.t('combatRelicBlockOnHit', { amount: extraBlock }),
                '#9fc4f0'
            );
        }

        const taken = this.player.takeDamage(amount, flatBlock + extraBlock, 'combat');
        if (taken > 0) {
            if (crit) this.log.addMessage(narrate('crit_received', this.loc.language), '#c4a35a');
            this.playerHit.emit({ damage: taken });
        }
        return taken;
    }

    private finishCombat(killedByBleed: boolean) {
        if (!this.enemy) return;
        const payload = this.buildRewards(this.enemy, killedByBleed);
        this.log.addMessage(this.loc.t('enemyFalls', { name: this.enemy.name }), '#66ff88');
        if (killedByBleed)
            this.log.addMessage(narrate('bleed_finisher', this.loc.language), '#c4a35a');

        this.enemy = null;
        this.combatEnd.emit(payload);
    }

    /**
     * EXPERIMENTAL — action-combat prototype. Called by the CombatHud
     * every time the enemy's defend bar hits 1.0. Routes through
     * `applyEnemyHitToPlayer` so crits / relics / Guard / status hooks
     * still fire, then runs the player-status tick that `processTurn`
     * would normally run. Logs "blocked" and skips the damage when the
     * player's defend buff is active. Returns the damage dealt (0 if
     * blocked or fully absorbed) so the HUD can flash the bar
     * accordingly.
     */
    public executeRealtimeEnemyHit(blocked: boolean): number {
        if (!this.enemy) return 0;
        if (blocked) {
            this.log.addMessage(
                this.loc.t('combatRealtimeBlocked', { name: this.enemy.name }),
                '#9aaef0'
            );
            return 0;
        }
        const taken = this.applyEnemyHitToPlayer(this.enemy.attack, 0);
        if (taken > 0) {
            this.log.addMessage(
                this.loc.t('combatRealtimeHit', { name: this.enemy.name, damage: taken }),
                '#cb7878'
            );
        }
        const playerTick = tickTurn(this.player.status);
        if (playerTick.bleedDamage > 0) {
            const damage = this.player.takeDamage(playerTick.bleedDamage, 0, 'true');
            if (damage > 0) {
                this.log.addMessage(this.loc.t('combatPlayerBleedTick', { damage }), '#d06060');
                this.playerHit.emit({ damage });
            }
        }
        if (playerTick.poisonDamage > 0 && this.player.stats.hp > 0) {
            const damage = this.player.takeDamage(playerTick.poisonDamage, 0, 'true');
            if (damage > 0) {
                this.log.addMessage(this.loc.t('combatPlayerPoisonTick', { damage }), '#7fbf6a');
                this.playerHit.emit({ damage });
            }
        }
        this.playerStatusChange.emit();
        return taken;
    }

    private logDeath() {
        this.log.addMessage(narrate('death', this.loc.language), '#ff3333');
    }

    private rollPlayerAttack() {
        const variance =
            COMBAT_CONFIG.randomVariance > 0
                ? this.randomBetween(-COMBAT_CONFIG.randomVariance, COMBAT_CONFIG.randomVariance)
                : 0;
        const baseDamage = Math.max(1, this.player.getAttackPower() + variance);
        const critical = this.rng.next() < this.player.getCritChance();

        return {
            damage: critical
                ? Math.max(1, Math.round(baseDamage * COMBAT_CONFIG.criticalMultiplier))
                : baseDamage,
            critical,
        };
    }

    private buildRewards(enemy: ActiveEnemy, killedByBleed: boolean): CombatEndPayload {
        // Death Knight is the only boss in the spec, so a boss kill
        // here is always the final-boss kill. The victoryWishArtifact
        // log line fires on that single event.
        const finalBoss = enemy.kind === 'boss';
        return {
            enemyName: enemy.name,
            enemyCanonicalName: enemy.canonicalName,
            kind: enemy.kind,
            killedByBleed,
            finalBossDefeated: finalBoss,
            rewards: {
                xp: enemy.xp,
                gold: enemy.gold + (enemy.kind === 'elite' ? ROOM_CONFIG.elite.bonusGold : 0),
                potions: enemy.kind === 'elite' ? ROOM_CONFIG.elite.bonusPotions : 0,
                attackBonus: enemy.kind === 'elite' ? ROOM_CONFIG.elite.bonusAttack : 0,
            },
        };
    }

    // -----------------------------------------------------------------
    // [FIX-10] Boss phase / intent runner. Pure helpers
    // (intentLabelForPhase / intentLabelForPrepare / prepareName /
    // maybeAdvancePhase / tickBossBlockAtTurnEnd /
    // breakBossBlockOnSkillDamage) live in ./BossRuntime.ts.
    // -----------------------------------------------------------------

    private runBossTurn(playerAction: 'attack' | 'defend' | 'skill' | 'potion') {
        if (!this.enemy || !this.enemy.bossPhase) return;
        const state = this.enemy.bossPhase;

        // Phase advancement is HP-driven and happens BEFORE picking an
        // action so the very next attack reflects the new phase's
        // pattern.
        maybeAdvancePhase(this.enemy, this.log, this.loc);

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
                this.log.addMessage(
                    this.loc.t('combatBossWindupTick', {
                        name: this.enemy.name,
                        action: pickLine(wind.actionDef.intent, this.loc.language),
                        turns: wind.turnsRemaining,
                    }),
                    '#c4a35a'
                );
                tickBossBlockAtTurnEnd(this.enemy, this.log, this.loc);
                if (this.player.stats.hp <= 0) {
                    this.logDeath();
                    return;
                }
                this.enemy.currentIntent = intentLabelForPhase(state, this.loc);
                this.playerStatusChange.emit();
                this.enemyStatusChange.emit();
                return;
            }
            // Windup expired — resolve the action effect now.
            const resolveDef = wind.actionDef;
            state.pendingWindup = undefined;
            this.resolveBossWindupAction(resolveDef, playerAction);
            tickBossBlockAtTurnEnd(this.enemy, this.log, this.loc);
            if (this.player.stats.hp <= 0) {
                this.logDeath();
                return;
            }
            // Advance to the next action in the rotation.
            state.actionIndex = (state.actionIndex + 1) % phaseDef.actions.length;
            this.enemy.currentIntent = intentLabelForPhase(state, this.loc);
            this.playerStatusChange.emit();
            this.enemyStatusChange.emit();
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
            this.log.addMessage(
                this.loc.t('combatBossWindupStart', {
                    name: this.enemy.name,
                    action: pickLine(action.intent, this.loc.language),
                    turns: action.windupTurns,
                }),
                '#c4a35a'
            );
            tickBossBlockAtTurnEnd(this.enemy, this.log, this.loc);
            if (this.player.stats.hp <= 0) {
                this.logDeath();
                return;
            }
            this.enemy.currentIntent = intentLabelForPhase(state, this.loc);
            this.playerStatusChange.emit();
            this.enemyStatusChange.emit();
            return;
        }

        const flatBlockBase = playerAction === 'defend' ? COMBAT_CONFIG.defendBlock : 0;
        const flatBlock = flatBlockBase;

        const weakenReduction =
            this.enemy.status.weaken.turns > 0 ? this.enemy.status.weaken.amount : 0;
        let attackPower = this.enemy.attack - weakenReduction;
        if (action.damageBonus) attackPower += action.damageBonus;
        if (attackPower < 1) attackPower = 1;

        // Damage-dealing actions hit the player.
        if (!action.noAttack) {
            const taken = this.applyEnemyHitToPlayer(attackPower, flatBlock);
            if (taken > 0) {
                this.log.addMessage(
                    this.loc.t('combatEnemyHit', {
                        name: this.enemy.name,
                        takenDamage: taken,
                        extraMessage: '',
                    }),
                    '#ff6666'
                );
            } else {
                this.log.addMessage(this.loc.t('absorb'), '#8fc6ff');
            }
        }

        // Resolve False Mercy: heal only if player did no damage.
        if (state.pendingHealOnSafe > 0 && !state.damagedThisTurn) {
            const heal = state.pendingHealOnSafe;
            this.enemy.hp = Math.min(this.enemy.maxHp, this.enemy.hp + heal);
            this.log.addMessage(
                this.loc.t('combatEnemyHeal', { name: this.enemy.name, heal }),
                '#88dd88'
            );
            this.enemyUpdate.emit({
                hp: this.enemy.hp,
                maxHp: this.enemy.maxHp,
                color: this.enemy.color,
                name: this.enemy.name,
                icon: this.enemy.icon,
            });
        }
        state.pendingHealOnSafe = 0;

        tickBossBlockAtTurnEnd(this.enemy, this.log, this.loc);

        if (this.player.stats.hp <= 0) {
            this.logDeath();
            return;
        }

        // Advance to next action and update the intent shown to the player.
        state.actionIndex = (state.actionIndex + 1) % phaseDef.actions.length;
        this.enemy.currentIntent = intentLabelForPhase(state, this.loc);
        this.playerStatusChange.emit();
        this.enemyStatusChange.emit();
    }

    /**
     * Apply the resolution effect of a boss windup action whose
     * `turnsRemaining` just hit zero. Currently covers Death Knight's
     * `death_shield` (raise a 15-block buff for 3 turns) and
     * `death_touch` (instant-kill, softened to a flat 8-damage hit if
     * the player Defends on the resolution turn).
     */
    private resolveBossWindupAction(
        action: BossActionDef,
        playerAction: 'attack' | 'defend' | 'skill' | 'potion'
    ) {
        if (!this.enemy || !this.enemy.bossPhase) return;
        const state = this.enemy.bossPhase;
        const actionLabel = pickLine(action.intent, this.loc.language);

        if (action.id === 'death_shield' && action.pendingBlock && action.pendingBlockTurns) {
            state.pendingBlock = action.pendingBlock;
            // +1 so the shield survives the tick at the END of this
            // same boss turn and lasts the full N subsequent turns.
            state.pendingBlockTurns = action.pendingBlockTurns + 1;
            this.log.addMessage(
                this.loc.t('combatBossDeathShieldRaised', {
                    name: this.enemy.name,
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
                const taken = this.applyEnemyHitToPlayer(dmg, COMBAT_CONFIG.defendBlock);
                this.log.addMessage(
                    this.loc.t('combatBossDeathTouchDefended', {
                        name: this.enemy.name,
                        action: actionLabel,
                        damage: taken,
                    }),
                    '#9bc8ff'
                );
            } else {
                // OHKO: drop the player's HP to zero directly so any
                // flat block / temporary defence buff can't soak it.
                const lethal = Math.max(this.player.stats.hp, 1);
                this.player.takeDamage(lethal, 0, 'true');
                this.log.addMessage(
                    this.loc.t('combatBossDeathTouchOhko', {
                        name: this.enemy.name,
                        action: actionLabel,
                    }),
                    '#ff6666'
                );
                this.playerHit.emit({ damage: lethal });
            }
            return;
        }

        // Fallback: a generic windup with no special effect just runs
        // its `attack`/`damageBonus` like a normal boss action so we
        // never silently swallow new windup definitions.
        const flatBlock = playerAction === 'defend' ? COMBAT_CONFIG.defendBlock : 0;
        const weakenReduction =
            this.enemy.status.weaken.turns > 0 ? this.enemy.status.weaken.amount : 0;
        let attackPower = this.enemy.attack - weakenReduction;
        if (action.damageBonus) attackPower += action.damageBonus;
        if (attackPower < 1) attackPower = 1;
        if (!action.noAttack) {
            const taken = this.applyEnemyHitToPlayer(attackPower, flatBlock);
            if (taken > 0) {
                this.log.addMessage(
                    this.loc.t('combatEnemyHit', {
                        name: this.enemy.name,
                        takenDamage: taken,
                        extraMessage: '',
                    }),
                    '#ff6666'
                );
            } else {
                this.log.addMessage(this.loc.t('absorb'), '#8fc6ff');
            }
        }
    }

    /** Returns a human-readable line of enemy statuses. */
    enemyStatusText(): string {
        return this.enemy ? statusSummary(this.enemy.status, this.loc.language) : '';
    }

    playerStatusText(): string {
        return statusSummary(this.player.status, this.loc.language);
    }

    private randomBetween(min: number, max: number): number {
        return randomInt(this.rng, min, max);
    }
}
