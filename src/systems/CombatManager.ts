import { getBossForDepth, getEnemyForDepth } from '../data/Enemies';
import {
    ADRENALINE_CONFIG,
    COMBAT_CONFIG,
    FEATURES,
    LIGHT_CONFIG,
    RELIC_CAP_CONFIG,
    ROOM_CONFIG,
    RUPTURE_CONFIG,
    STUN_RESIST_CONFIG,
} from '../data/GameConfig';
import type { EnemyDef, EnemyProfile } from '../data/GameConfig';
import {
    BOSS_BLUEPRINT_BY_NAME,
    pickLine,
    type BossBlueprint,
} from '../data/Bosses';
import type { EventLog } from '../ui/EventLog';
import { Emitter } from './Emitter';
import { narrate } from './Narrator';
import { Localization } from './Localization';
import { PlayerManager } from './PlayerManager';
import { SKILLS } from './Skills';
import type { SkillId } from './Skills';
import {
    applyBleed,
    applyFocus,
    applyGuard,
    applyMark,
    applyStun,
    applyWeaken,
    consumeGuardBlock,
    consumeMark,
    consumeStunForTurn,
    emptyStatusState,
    statusSummary,
    tickTurn,
} from './StatusEffects';
import type { StatusState } from './StatusEffects';
import { defaultRng, randomInt, type Rng } from './Rng';

export type CombatAction =
    | 'attack'
    | 'defend'
    | 'skill'
    | 'potion'
    | { kind: 'skill'; id: SkillId };

export type EncounterKind = 'normal' | 'elite' | 'boss';

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
    /** Block remaining on the boss (e.g. Bone Shield). */
    pendingBlock: number;
    /** Pending False Mercy heal if the player did no damage this turn. */
    pendingHealOnSafe: number;
    /** Whether the player damaged the boss during the just-finished player turn. */
    damagedThisTurn: boolean;
}

export interface ActiveEnemy {
    kind: EncounterKind;
    name: string;
    description: string;
    icon: string;
    hp: number;
    maxHp: number;
    attack: number;
    color: number;
    xp: number;
    gold: number;
    profile: EnemyProfile;
    enraged: boolean;
    charging: boolean;
    turnsAlive: number;
    status: StatusState;
    inflictBleed?: { stacks: number; turns: number; chance: number };
    firstHitEvaded?: boolean;
    firstStunResisted?: boolean;
    /** [FIX-10] Phase blueprint runtime state, only set on bosses. */
    bossPhase?: BossPhaseState;
    /**
     * [FIX-10] Localised one-line intent shown BEFORE the boss's next
     * turn so the player can respond. `null` for non-boss enemies.
     */
    currentIntent?: string | null;
    /** [FIX-1] Hard cap on stack count for bleed (final boss). */
    bleedCap?: number;
}

export interface CombatRewards {
    xp: number;
    gold: number;
    potions: number;
    attackBonus: number;
    relicShards: number;
}

export interface CombatEndPayload {
    enemyName: string;
    kind: EncounterKind;
    rewards: CombatRewards;
    killedByBleed: boolean;
    /** [FIX-1] Set when the slain enemy was the final boss. */
    finalBossDefeated: boolean;
    /** [FIX-2] Light recovered from boss kill, applied by GameScene. */
    lightRecovered: number;
}

export interface EnemyUpdatePayload {
    hp: number;
    maxHp: number;
    color: number;
    name: string;
    icon: string;
}

export class CombatManager {
    private player: PlayerManager;
    private log: EventLog;
    private loc: Localization;
    private rng: Rng;

    public enemy: ActiveEnemy | null = null;
    public lastActionResult: {
        critical: boolean;
        enemyCharged: boolean;
        enemyEnraged: boolean;
        enemyStunned: boolean;
        enemyEvaded: boolean;
    } = {
        critical: false,
        enemyCharged: false,
        enemyEnraged: false,
        enemyStunned: false,
        enemyEvaded: false,
    };
    public readonly enemyUpdate = new Emitter<EnemyUpdatePayload>();
    public readonly playerStatusChange = new Emitter<void>();
    public readonly enemyStatusChange = new Emitter<void>();
    public readonly playerHit = new Emitter<{ damage: number }>();
    public readonly combatEnd = new Emitter<CombatEndPayload>();

    /** [FIX-5] Per-combat skill cooldowns keyed by SkillId; only Rupture uses
     *  this for now, but the table is generic. */
    public skillCooldowns: Partial<Record<SkillId, number>> = {};
    /** [FIX-6] One-shot adrenaline guard. Reset every startCombat. */
    public adrenalineUsedThisCombat = false;
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
        // [FIX-5, FIX-6] Reset per-combat state. Cooldowns & adrenaline
        // tracking start fresh for every fight.
        this.skillCooldowns = {};
        this.adrenalineUsedThisCombat = false;
        const definition = kind === 'boss' ? getBossForDepth(depth) : getEnemyForDepth(depth);
        this.setupEnemy(depth, kind, definition);
    }

    private setupEnemy(depth: number, kind: EncounterKind, definition: EnemyDef) {
        const rewardMultiplier =
            kind === 'elite'
                ? COMBAT_CONFIG.eliteRewardMultiplier
                : kind === 'boss'
                  ? COMBAT_CONFIG.bossRewardMultiplier
                  : 1;

        const lowLightRewardMultiplier =
            kind !== 'normal' ? this.player.getRewardMultiplierFromLowLight() : 1;

        const baseHp = kind === 'elite'
            ? Math.round(definition.hp * COMBAT_CONFIG.eliteHpMultiplier)
            : definition.hp;
        const baseAtk = kind === 'elite'
            ? Math.round(definition.attack * COMBAT_CONFIG.eliteAttackMultiplier)
            : definition.attack;

        // [FIX-10] Look up a boss blueprint by canonical English name so
        // localisation never breaks the lookup. Non-boss kinds skip this.
        const blueprint =
            kind === 'boss' ? BOSS_BLUEPRINT_BY_NAME[definition.name] : undefined;

        this.enemy = {
            kind,
            name: this.loc.enemyName(definition.name),
            description: this.loc.enemyDescription(definition.name, definition.description),
            icon: definition.icon,
            hp: baseHp,
            maxHp: baseHp,
            attack: baseAtk,
            color: definition.color,
            xp: Math.max(1, Math.round(definition.xp * rewardMultiplier * lowLightRewardMultiplier)),
            gold: Math.max(1, Math.round(definition.gold * rewardMultiplier * lowLightRewardMultiplier)),
            profile: definition.profile,
            enraged: false,
            charging: false,
            turnsAlive: 0,
            status: emptyStatusState(),
            inflictBleed: definition.inflictBleed,
            bleedCap: blueprint?.bleedCap,
            bossPhase: blueprint
                ? {
                      blueprint,
                      phaseIndex: 0,
                      actionIndex: 0,
                      pendingExposeBonus: 0,
                      pendingBlock: 0,
                      pendingHealOnSafe: 0,
                      damagedThisTurn: false,
                  }
                : undefined,
            currentIntent: null,
        };
        // Compute the initial intent so the UI can show what the boss
        // is about to do BEFORE the first player turn.
        if (this.enemy.bossPhase) {
            this.enemy.currentIntent = this.intentLabelForPhase(this.enemy.bossPhase);
        }

        const header =
            kind === 'boss'
            ? this.loc.t('combatBossEncounter')
            : kind === 'elite'
              ? this.loc.t('combatEliteEncounter')
                  : this.loc.t('combatHostileContact');
        this.log.addMessage(`${header} ${this.enemy.name} ${definition.icon}`, '#ff6666');

        if (kind === 'boss') {
            this.log.addMessage(narrate('enter_boss', this.loc.language), '#c4a35a');
        } else if (kind === 'elite') {
            this.log.addMessage(narrate('enter_elite', this.loc.language), '#c4a35a');
        } else if (depth > 0 && this.rng.next() < 0.25) {
            this.log.addMessage(narrate('enter_combat', this.loc.language), '#7a7a7a');
        }

        // Relics: start-of-combat setup.
        const agg = this.player.aggregate;
        if (agg.startCombatFocus > 0) {
            applyFocus(this.player.status, 1, agg.startCombatFocus);
            this.playerStatusChange.emit();
        }
        if (agg.evadeFirstHit) {
            this.enemy.firstHitEvaded = true;
        }
        if (agg.resistFirstStun) {
            this.enemy.firstStunResisted = true;
        }

        this.enemyUpdate.emit({ hp: this.enemy.hp, maxHp: this.enemy.maxHp, color: this.enemy.color, name: this.enemy.name, icon: this.enemy.icon });
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
            enemyCharged: false,
            enemyEnraged: false,
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
                    this.loc.t('combatBleedTick', { name: this.enemy.name, bleedDamage: enemyTick.bleedDamage }),
                    '#c15a5a'
                );
                this.enemyUpdate.emit({ hp: this.enemy.hp, maxHp: this.enemy.maxHp, color: this.enemy.color, name: this.enemy.name, icon: this.enemy.icon });
            }
            this.enemyStatusChange.emit();
        }

        if (this.enemy && this.enemy.hp <= 0) {
            const killedByBleed = actionName === 'defend' || actionName === 'potion';
            this.finishCombat(killedByBleed);
            return;
        }

        this.resolveEnemyTurn(actionName as Exclude<CombatAction, { kind: 'skill'; id: SkillId }>);

        // Tick player statuses (focus/regen/mark/weaken decay).
        const playerTick = tickTurn(this.player.status);
        if (playerTick.regenHeal > 0) {
            const healed = this.player.heal(playerTick.regenHeal);
            if (healed > 0) {
                this.log.addMessage(
                    this.loc.t('combatRegenTick', { healed }),
                    '#8be0a7'
                );
            }
        }
        this.playerStatusChange.emit();
    }

    private handlePlayerAttack() {
        if (!this.enemy) return;
        this.player.gainResolve(COMBAT_CONFIG.resolveFromAttack);
        const result = this.rollPlayerAttack();
        this.applyPlayerDamage(result.damage, result.critical);
        this.log.addMessage(
            result.critical
                ? this.loc.t('strikeCrit', { damage: result.damage })
                : this.loc.t('strike', { damage: result.damage }),
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
        this.log.addMessage(this.loc.t('brace'), '#66aaff');
    }

    private handlePlayerSkill(skillId: SkillId): boolean {
        if (!this.enemy) return false;
        const skill = SKILLS[skillId];
        // [FIX-5] Cooldown gate. Currently only Rupture sets a cooldown,
        // but the gate is generic so future skills can adopt it.
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
        // [FIX-6] Adrenaline hard cap: 1 use per combat. Refuse to even
        // pay the resolve cost if it has already been used.
        if (skillId === 'adrenaline' && this.adrenalineUsedThisCombat) {
            this.log.addMessage(
                this.loc.t('combatAdrenalineSpent'),
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

        switch (skillId) {
            case 'cleave': {
                const dmg = Math.max(
                    1,
                    Math.ceil(this.player.getAttackPower() * 1.8) + 2 + this.effectiveDamageMod()
                );
                this.applyPlayerDamage(dmg, false);
                this.log.addMessage(this.loc.t('combatSkillCleave', { dmg }), '#b893ff');
                this.applyOnAttackRelics();
                break;
            }
            case 'bleed_strike': {
                const dmg = Math.max(
                    1,
                    Math.ceil(this.player.getAttackPower() * 1.1) + this.effectiveDamageMod()
                );
                this.applyPlayerDamage(dmg, false);
                const agg = this.player.aggregate;
                applyBleed(
                    this.enemy.status,
                    2 + agg.bleedStackBonus,
                    3 + agg.bleedTurnBonus,
                    this.enemy.bleedCap // [FIX-1] respects final-boss cap
                );
                this.log.addMessage(
                    this.loc.t('combatSkillBleedStrike', { dmg }),
                    '#d06060'
                );
                this.applyOnAttackRelics();
                break;
            }
            case 'parry_stance': {
                applyGuard(this.player.status, 2, 4);
                if (this.tryStun(1)) {
                    this.log.addMessage(this.loc.t('combatSkillParryBreak'), '#7fa9ff');
                    this.log.addMessage(narrate('stun_landed', this.loc.language), '#c4a35a');
                } else {
                    this.log.addMessage(this.loc.t('combatSkillParrySteady'), '#7fa9ff');
                }
                this.player.gainResolve(1);
                break;
            }
            case 'focused_strike': {
                const dmg = Math.max(
                    1,
                    Math.ceil(this.player.getAttackPower() * 0.9) + this.effectiveDamageMod()
                );
                this.applyPlayerDamage(dmg, false);
                applyMark(this.enemy.status, 2);
                this.log.addMessage(
                    this.loc.t('combatSkillFocusedStrike', { dmg }),
                    '#d6c260'
                );
                this.applyOnAttackRelics();
                break;
            }
            case 'rupture': {
                // [FIX-5] Per-target % cap. Bosses & final boss take a
                // tighter slice so Rupture can't 3-shot them.
                const cap = this.ruptureCapForEnemy(this.enemy);
                const pct = Math.ceil(this.enemy.maxHp * cap);
                const dmg = Math.max(this.player.getAttackPower(), pct) + this.effectiveDamageMod();
                this.applyPlayerDamage(dmg, false);
                this.skillCooldowns.rupture = RUPTURE_CONFIG.cooldownTurns + 1;
                this.log.addMessage(this.loc.t('combatSkillRupture', { dmg }), '#c048a0');
                this.applyOnAttackRelics();
                break;
            }
            case 'adrenaline': {
                // [FIX-6] Mark adrenaline as used so the gate at the top
                // of this method blocks any further attempts.
                this.adrenalineUsedThisCombat = true;
                const healed = this.player.heal(ADRENALINE_CONFIG.heal);
                this.player.gainResolve(ADRENALINE_CONFIG.resolveGain);
                applyFocus(
                    this.player.status,
                    ADRENALINE_CONFIG.focusAmount,
                    ADRENALINE_CONFIG.focusTurns
                );
                this.log.addMessage(
                    this.loc.t('combatSkillRally', { healed }),
                    '#66dd88'
                );
                break;
            }
            case 'crushing_blow': {
                const dmg = Math.max(
                    1,
                    Math.ceil(this.player.getAttackPower() * 2.4) + 3 + this.effectiveDamageMod()
                );
                this.applyPlayerDamage(dmg, false);
                this.player.takeDamage(3, 0, 'true');
                this.log.addMessage(
                    this.loc.t('combatSkillCrushingBlow', { dmg }),
                    '#e06040'
                );
                this.applyOnAttackRelics();
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
        const healAmount = COMBAT_CONFIG.potionHeal + this.player.aggregate.potionHealBonus;
        const healed = this.player.heal(healAmount);
        this.log.addMessage(this.loc.t('drinkPotion', { healed }), '#78e496');
        if (this.player.aggregate.potionRegenTurns > 0) {
            const regenAmount = 1;
            const turns = this.player.aggregate.potionRegenTurns;
            // apply via status state
            this.player.status.regen.amount = Math.max(this.player.status.regen.amount, regenAmount);
            this.player.status.regen.turns = Math.max(this.player.status.regen.turns, turns);
            this.playerStatusChange.emit();
        }
        return true;
    }

    private applyPlayerDamage(baseDamage: number, criticalIn: boolean) {
        if (!this.enemy) return;
        let critical = criticalIn;
        let damage = baseDamage;

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

        if (damage > 0) {
            this.enemy.hp = Math.max(0, this.enemy.hp - damage);
            if (this.enemy.bossPhase) this.enemy.bossPhase.damagedThisTurn = true;
        }
        this.lastActionResult.critical = this.lastActionResult.critical || critical;
        this.enemyUpdate.emit({ hp: this.enemy.hp, maxHp: this.enemy.maxHp, color: this.enemy.color, name: this.enemy.name, icon: this.enemy.icon });

        if (critical) {
            const agg = this.player.aggregate;
            // [FIX-13] Vampiric Sigil & Gambler's Knuckle each fire at
            // most once per player turn.
            if (agg.lifestealOnCrit > 0 && !this.vampiricHealedThisTurn) {
                this.player.heal(agg.lifestealOnCrit);
                this.vampiricHealedThisTurn = true;
            }
            if (
                agg.critResolveGain > 0 &&
                this.gamblersResolveThisTurn < RELIC_CAP_CONFIG.gamblersResolvePerTurn
            ) {
                this.player.gainResolve(agg.critResolveGain);
                this.gamblersResolveThisTurn += agg.critResolveGain;
            }
        }
    }

    private applyOnAttackRelics() {
        if (!this.enemy) return;
        const agg = this.player.aggregate;
        if (agg.bleedOnAttackStacks > 0 && agg.bleedOnAttackTurns > 0) {
            applyBleed(
                this.enemy.status,
                agg.bleedOnAttackStacks + agg.bleedStackBonus,
                agg.bleedOnAttackTurns + agg.bleedTurnBonus,
                this.enemy.bleedCap // [FIX-1] respects final-boss cap
            );
        }
    }

    /**
     * [FIX-5] Per-target Rupture cap: 15% for boss/final_boss, 18% for
     * elites, 22% otherwise. Sourced from RUPTURE_CONFIG.
     */
    private ruptureCapForEnemy(enemy: ActiveEnemy): number {
        if (enemy.profile === 'final_boss') return RUPTURE_CONFIG.capByKind.final_boss;
        if (enemy.profile === 'boss' || enemy.kind === 'boss') return RUPTURE_CONFIG.capByKind.boss;
        if (enemy.kind === 'elite') return RUPTURE_CONFIG.capByKind.elite;
        return RUPTURE_CONFIG.capByKind.normal;
    }

    /**
     * [FIX-11] Stun resistance keyed by enemy profile / boss name. The
     * Guard portion of Parry Stance is applied by the caller before
     * tryStun() — when stun is resisted we just skip the Stun status
     * and log it. Returns true when the stun stuck.
     */
    private tryStun(turns: number): boolean {
        if (!this.enemy) return false;
        const resistChance = this.stunResistChance(this.enemy);
        if (resistChance > 0 && this.rng.next() < resistChance) {
            this.log.addMessage(
                this.loc.t('combatEnemyResistStun', { name: this.enemy.name }),
                '#9aa3b3'
            );
            return false;
        }
        // Bosses still get a half-duration soft penalty when the stun
        // does land, preserving the prior "hard to lock" feel.
        const effective = this.enemy.kind === 'boss' ? Math.max(1, Math.floor(turns / 2)) : turns;
        applyStun(this.enemy.status, effective);
        return true;
    }

    private stunResistChance(enemy: ActiveEnemy): number {
        const named = STUN_RESIST_CONFIG.bossByName[enemy.name];
        if (named !== undefined) return named;
        if (enemy.profile === 'final_boss') {
            return STUN_RESIST_CONFIG.bossByName['The Undying Wound'] ?? STUN_RESIST_CONFIG.finalBoss;
        }
        if (enemy.profile === 'boss' || enemy.kind === 'boss') return STUN_RESIST_CONFIG.boss;
        if (enemy.kind === 'elite') return STUN_RESIST_CONFIG.elite;
        return STUN_RESIST_CONFIG.normal;
    }

    private effectiveDamageMod(): number {
        const focus = this.player.status.focus.turns > 0 ? this.player.status.focus.amount : 0;
        // [FIX-13] Ember Vow's low-HP damage bonus is hard-capped at
        // RELIC_CAP_CONFIG.emberVowLowHpBonusCap (default 0.50).
        const lowHpFraction = Math.min(
            this.player.aggregate.lowHpDamageBonus,
            RELIC_CAP_CONFIG.emberVowLowHpBonusCap
        );
        const lowHp =
            lowHpFraction > 0 &&
            this.player.stats.hp <= Math.ceil(this.player.stats.maxHp * this.player.aggregate.lowHpThreshold)
                ? Math.round(this.player.getAttackPower() * lowHpFraction)
                : 0;
        return focus + lowHp;
    }

    private resolveEnemyTurn(playerAction: 'attack' | 'defend' | 'skill' | 'potion') {
        if (!this.enemy) return;

        // Stun check.
        if (consumeStunForTurn(this.enemy.status)) {
            this.log.addMessage(
                this.loc.t('combatEnemyStunned', { name: this.enemy.name }),
                '#7aaaff'
            );
            // [FIX-10] Recompute next intent so the UI reflects what the
            // boss will do AFTER recovering from stun.
            if (this.enemy.bossPhase) {
                this.enemy.currentIntent = this.intentLabelForPhase(this.enemy.bossPhase);
            }
            this.enemyStatusChange.emit();
            return;
        }

        // First-hit evasion from Shade Mask.
        if (this.enemy.firstHitEvaded) {
            this.enemy.firstHitEvaded = false;
            this.lastActionResult.enemyEvaded = true;
            this.log.addMessage(
                    this.loc.t('combatEnemyEvadeFirst', { name: this.enemy.name }),
                '#9fb4c4'
            );
            return;
        }

        // [FIX-10] Boss enemies with a phase blueprint use the phase
        // runner instead of the profile-based fallback. This is also the
        // hook for the final-boss FIX-1 phase logic.
        if (this.enemy.bossPhase) {
            this.runBossTurn(playerAction);
            return;
        }

        const flatBlockBase = playerAction === 'defend' ? COMBAT_CONFIG.defendBlock : 0;
        const wardenBlock =
            playerAction === 'defend' ? this.player.aggregate.defendExtraBlock : 0;
        let flatBlock = flatBlockBase + wardenBlock;

        const weakenReduction = this.enemy.status.weaken.turns > 0 ? this.enemy.status.weaken.amount : 0;
        let attackPower =
            this.enemy.attack +
            this.player.getEnemyAttackBonusFromLight() -
            weakenReduction;
        if (attackPower < 1) attackPower = 1;
        let extraMessage = '';
        let multiStrikeFirstDamage = 0;

        if (this.enemy.profile === 'brute') {
            if (!this.enemy.enraged && this.enemy.hp < this.enemy.maxHp * 0.4) {
                this.enemy.enraged = true;
                this.lastActionResult.enemyEnraged = true;
                this.enemy.attack += 2;
                attackPower += 2;
                this.log.addMessage(
                    this.loc.t('combatEnemyEnrage', { name: this.enemy.name }),
                    '#ff9944'
                );
            }
        } else if (this.enemy.profile === 'stalker') {
            if (this.rng.next() < 0.3) {
                const firstHit = this.applyEnemyHitToPlayer(attackPower, flatBlock);
                multiStrikeFirstDamage = firstHit;
                if (firstHit > 0) {
                    this.log.addMessage(
                this.loc.t('combatEnemyLunge', { name: this.enemy.name, firstHit }),
                        '#ff6666'
                    );
                }
                if (this.player.stats.hp <= 0) {
                    this.logDeath();
                    return;
                }
            extraMessage = this.loc.t('combatEnemyDoubleStrike');
                // After first hit, guard is partially used; refresh flatBlock for consistency.
                flatBlock = flatBlockBase + wardenBlock;
            }
        } else if (this.enemy.profile === 'mage') {
            if (this.enemy.turnsAlive > 0 && this.enemy.turnsAlive % 3 === 0) {
                this.enemy.charging = true;
                this.lastActionResult.enemyCharged = true;
                attackPower = Math.round(attackPower * 1.6);
                this.log.addMessage(
                this.loc.t('combatEnemyChannelDark', { name: this.enemy.name }),
                    '#9966cc'
                );
            } else {
                this.enemy.charging = false;
            }
        } else if (this.enemy.profile === 'bleeder') {
            if (this.enemy.inflictBleed && this.rng.next() < this.enemy.inflictBleed.chance) {
                applyBleed(
                    this.player.status,
                    this.enemy.inflictBleed.stacks,
                    this.enemy.inflictBleed.turns
                );
                this.log.addMessage(
                this.loc.t('combatEnemyOpenWound', { name: this.enemy.name }),
                    '#d06060'
                );
            }
        } else if (this.enemy.profile === 'disruptor') {
            // Disruptors apply weaken instead of raw damage sometimes.
            if (this.enemy.turnsAlive % 2 === 1 && this.enemy.status.weaken.turns <= 0) {
                applyWeaken(this.player.status, 1, 2);
                this.log.addMessage(
                    this.loc.t('combatEnemyWeakenAttack', { name: this.enemy.name }),
                    '#8b5fc7'
                );
            }
        }

        const takenDamage = this.applyEnemyHitToPlayer(attackPower, flatBlock);
        if (takenDamage > 0) {
            this.log.addMessage(
                this.loc.t('combatEnemyHit', { name: this.enemy.name, takenDamage, extraMessage }),
                '#ff6666'
            );
        } else if (multiStrikeFirstDamage === 0) {
            this.log.addMessage(this.loc.t('absorb'), '#8fc6ff');
        }

        if (this.player.stats.hp <= 0) {
            this.logDeath();
            return;
        }

        if (this.player.stats.hp > 0 && this.player.stats.hp <= Math.ceil(this.player.stats.maxHp * 0.25)) {
            if (this.rng.next() < 0.25) this.log.addMessage(narrate('low_hp', this.loc.language), '#c4a35a');
        }

        this.playerStatusChange.emit();
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

        const taken = this.player.takeDamage(amount, flatBlock, 'combat');
        if (taken > 0) {
            if (crit) this.log.addMessage(narrate('crit_received', this.loc.language), '#c4a35a');
            this.playerHit.emit({ damage: taken });

            // Thorns damage back at the attacker.
            // [FIX-13] Thorned Mail is capped at
            // RELIC_CAP_CONFIG.thornedMailReflectionCap per hit.
            const thorns = Math.min(
                this.player.aggregate.thornsDamage,
                RELIC_CAP_CONFIG.thornedMailReflectionCap
            );
            if (thorns > 0) {
                this.enemy.hp = Math.max(0, this.enemy.hp - thorns);
                this.log.addMessage(
                    this.loc.t('combatThornsRetaliate', { thorns }),
                    '#88cc88'
                );
                this.enemyUpdate.emit({ hp: this.enemy.hp, maxHp: this.enemy.maxHp, color: this.enemy.color, name: this.enemy.name, icon: this.enemy.icon });
            }
        }
        return taken;
    }

    private finishCombat(killedByBleed: boolean) {
        if (!this.enemy) return;
        const payload = this.buildRewards(this.enemy, killedByBleed);
        this.log.addMessage(this.loc.t('enemyFalls', { name: this.enemy.name }), '#66ff88');
        if (killedByBleed) this.log.addMessage(narrate('bleed_finisher', this.loc.language), '#c4a35a');

        // Lifesteal on kill.
        const agg = this.player.aggregate;
        if (agg.lifestealOnKill > 0) this.player.heal(agg.lifestealOnKill);

        // [FIX-2] Light recovery on boss kill is reported back to the
        // GameScene through the payload so the run-level resource
        // model is the single owner of light state.
        if (this.enemy.kind === 'boss' && this.enemy.profile !== 'final_boss') {
            this.player.gainLight(LIGHT_CONFIG.onBossKill);
        }

        this.enemy = null;
        this.combatEnd.emit(payload);
    }

    private logDeath() {
        this.log.addMessage(narrate('death', this.loc.language), '#ff3333');
    }

    private rollPlayerAttack() {
        const variance =
            COMBAT_CONFIG.randomVariance > 0
                ? this.randomBetween(-COMBAT_CONFIG.randomVariance, COMBAT_CONFIG.randomVariance)
                : 0;
        const baseDamage = Math.max(1, this.player.getAttackPower() + variance + this.effectiveDamageMod());
        const critical = this.rng.next() < this.player.getCritChance();

        return {
            damage: critical
                ? Math.max(1, Math.round(baseDamage * COMBAT_CONFIG.criticalMultiplier))
                : baseDamage,
            critical,
        };
    }

    private buildRewards(enemy: ActiveEnemy, killedByBleed: boolean): CombatEndPayload {
        const finalBoss = enemy.profile === 'final_boss';
        const lightRecovered =
            enemy.kind === 'boss' && !finalBoss ? LIGHT_CONFIG.onBossKill : 0;
        return {
            enemyName: enemy.name,
            kind: enemy.kind,
            killedByBleed,
            finalBossDefeated: finalBoss,
            lightRecovered,
            rewards: {
                xp: enemy.xp,
                gold: enemy.gold + (enemy.kind === 'elite' ? ROOM_CONFIG.elite.bonusGold : 0),
                potions: enemy.kind === 'elite' ? ROOM_CONFIG.elite.bonusPotions : 0,
                attackBonus: enemy.kind === 'elite' ? ROOM_CONFIG.elite.bonusAttack : 0,
                relicShards: !FEATURES.shards
                    ? 0
                    : enemy.kind === 'elite'
                      ? ROOM_CONFIG.elite.shardReward
                      : enemy.kind === 'boss'
                        ? ROOM_CONFIG.boss.shardReward
                        : 0,
            },
        };
    }

    // -----------------------------------------------------------------
    // [FIX-10] Boss phase / intent runner.
    // -----------------------------------------------------------------

    private intentLabelForPhase(phase: { blueprint: BossBlueprint; phaseIndex: number; actionIndex: number }): string {
        const phaseDef = phase.blueprint.phases[phase.phaseIndex];
        const action = phaseDef.actions[phase.actionIndex % phaseDef.actions.length];
        return pickLine(action.intent, this.loc.language);
    }

    /**
     * Re-evaluates the boss's HP-driven phase. Called at the start of
     * the boss's turn so phase-entry effects fire after the player has
     * just damaged it. Returns `true` when a phase change happened.
     */
    private maybeAdvancePhase(): boolean {
        if (!this.enemy || !this.enemy.bossPhase) return false;
        const state = this.enemy.bossPhase;
        const ratio = this.enemy.hp / Math.max(1, this.enemy.maxHp);
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
            this.log.addMessage(pickLine(phaseDef.label, this.loc.language), '#c4a35a');
        }
        const onEnter = phaseDef.onEnter;
        if (onEnter) {
            if (onEnter.atkBoost) {
                this.enemy.attack += onEnter.atkBoost;
            }
            if (onEnter.drainLight) {
                this.player.spendLight(onEnter.drainLight);
            }
            if (onEnter.capLight !== undefined) {
                const overflow = this.player.resources.light - onEnter.capLight;
                if (overflow > 0) this.player.spendLight(overflow);
            }
            if (onEnter.markPlayer) {
                applyMark(this.player.status, onEnter.markPlayer);
            }
        }
        return true;
    }

    private runBossTurn(playerAction: 'attack' | 'defend' | 'skill' | 'potion') {
        if (!this.enemy || !this.enemy.bossPhase) return;
        const state = this.enemy.bossPhase;

        // Phase advancement is HP-driven and happens BEFORE picking an
        // action so the very next attack reflects the new phase's
        // pattern.
        this.maybeAdvancePhase();

        const phaseDef = state.blueprint.phases[state.phaseIndex];
        const action = phaseDef.actions[state.actionIndex % phaseDef.actions.length];

        const flatBlockBase = playerAction === 'defend' ? COMBAT_CONFIG.defendBlock : 0;
        const wardenBlock =
            playerAction === 'defend' ? this.player.aggregate.defendExtraBlock : 0;
        const flatBlock = flatBlockBase + wardenBlock;

        const weakenReduction = this.enemy.status.weaken.turns > 0 ? this.enemy.status.weaken.amount : 0;
        let attackPower =
            this.enemy.attack +
            this.player.getEnemyAttackBonusFromLight() -
            weakenReduction;
        if (action.damageBonus) attackPower += action.damageBonus;
        if (attackPower < 1) attackPower = 1;

        // Lich Cinderlight passive: low light → +1 atk damage on attacks.
        const passives = state.blueprint.passives ?? [];
        if (passives.includes('cinderlight') && this.player.hasLowLight) {
            attackPower += 1;
        }

        // Resource pressure (always applies).
        if (action.drainLight && action.drainLight > 0) {
            this.player.spendLight(action.drainLight);
        }
        if (action.weaken) {
            applyWeaken(this.player.status, action.weaken.amount, action.weaken.turns);
        }
        if (action.markPlayer) {
            applyMark(this.player.status, action.markPlayer);
        }
        if (action.selfBlock) {
            state.pendingBlock += action.selfBlock;
        }
        if (action.selfHealIfNoDamageTaken) {
            state.pendingHealOnSafe = action.selfHealIfNoDamageTaken;
        }
        if (action.exposedExtraDamage) {
            state.pendingExposeBonus = action.exposedExtraDamage;
        }
        if (action.selfAtkBoost) {
            this.enemy.attack += action.selfAtkBoost;
        }

        // Damage-dealing actions hit the player.
        if (!action.noAttack) {
            const taken = this.applyEnemyHitToPlayer(attackPower, flatBlock);
            if (taken > 0) {
                this.log.addMessage(
                    this.loc.t('combatEnemyHit', { name: this.enemy.name, takenDamage: taken, extraMessage: '' }),
                    '#ff6666'
                );
            } else {
                this.log.addMessage(this.loc.t('absorb'), '#8fc6ff');
            }
            if (action.bleed) {
                const marked = this.player.status.mark.turns > 0;
                const willBleed = action.bleed.alwaysIfHit ? taken > 0 : action.bleed.onlyIfMarked ? marked : true;
                if (willBleed) applyBleed(this.player.status, action.bleed.stacks, action.bleed.turns);
            }
        } else if (action.id === 'expose_self') {
            this.log.addMessage(
                this.loc.t('combatEnemyExposed', { name: this.enemy.name }),
                '#9fb4c4'
            );
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

        if (this.player.stats.hp <= 0) {
            this.logDeath();
            return;
        }

        // Advance to next action and update the intent shown to the player.
        state.actionIndex = (state.actionIndex + 1) % phaseDef.actions.length;
        this.enemy.currentIntent = this.intentLabelForPhase(state);
        this.playerStatusChange.emit();
        this.enemyStatusChange.emit();
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
