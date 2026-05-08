import { getBossForDepth, getEnemyForDepth } from '../data/Enemies';
import {
    COMBAT_CONFIG,
    LIGHT_CONFIG,
    ROOM_CONFIG,
} from '../data/GameConfig';
import type {
    EnemyDef,
    EnemyPassive,
    EnemyPrepareDef,
    EnemyProfile,
} from '../data/GameConfig';
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
    applyPoison,
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
    enraged: boolean;
    charging: boolean;
    turnsAlive: number;
    status: StatusState;
    inflictBleed?: { stacks: number; turns: number; chance: number };
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
    /** Canonical English name — used by drop tables (rollRelicForEnemy). */
    enemyCanonicalName: string;
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

    /** [FIX-5] Per-combat skill cooldowns keyed by SkillId. */
    public skillCooldowns: Partial<Record<SkillId, number>> = {};
    /** Preparation buff: next attack +1 damage, next defend +1 defense. */
    public preparationActive = false;
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

        // Boss "piñata" XP bump — bosses dump 10–20 levels worth of XP in
        // one kill so the player visibly powers up after every depth-tier
        // fight. Stacks on top of bossRewardMultiplier and is XP-only
        // (gold still uses the legacy reward multiplier).
        const xpBossBonus =
            kind === 'boss' ? COMBAT_CONFIG.bossXpMultiplier : 1;

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
            canonicalName: definition.name,
            description: this.loc.enemyDescription(definition.name, definition.description),
            icon: definition.icon,
            hp: baseHp,
            maxHp: baseHp,
            attack: baseAtk,
            color: definition.color,
            xp: Math.max(1, Math.round(definition.xp * rewardMultiplier * lowLightRewardMultiplier * xpBossBonus)),
            gold: Math.max(1, Math.round(definition.gold * rewardMultiplier * lowLightRewardMultiplier)),
            profile: definition.profile,
            enraged: false,
            charging: false,
            turnsAlive: 0,
            status: emptyStatusState(),
            inflictBleed: definition.inflictBleed,
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
                      pendingHealOnSafe: 0,
                      damagedThisTurn: false,
                  }
                : undefined,
            currentIntent: null,
        };
        // Compute the initial intent so the UI can show what the enemy
        // is about to do BEFORE the first player turn.
        if (this.enemy.bossPhase) {
            this.enemy.currentIntent = this.intentLabelForPhase(this.enemy.bossPhase);
        } else if (this.enemy.pendingPrepare) {
            this.enemy.currentIntent = this.intentLabelForPrepare(this.enemy.pendingPrepare);
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

        // Tick player statuses (bleed/poison damage, focus/regen/mark/weaken decay).
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
                const base = this.player.getAttackPower() + this.effectiveDamageMod();
                const bonus = Math.max(1, Math.floor(base * 0.5));
                const dmg = Math.max(1, base + bonus);
                this.applyPlayerDamage(dmg, false);
                this.log.addMessage(this.loc.t('combatSkillCleave', { dmg }), '#b893ff');
                this.applyOnAttackRelics();
                break;
            }
            case 'bleed_strike': {
                const dmg = Math.max(
                    1,
                    this.player.getAttackPower() + this.effectiveDamageMod()
                );
                this.applyPlayerDamage(dmg, false);
                const bleedPerTick = Math.max(1, Math.floor(this.player.getAttackPower() * 0.2));
                applyBleed(
                    this.enemy.status,
                    bleedPerTick,
                    3,
                    this.enemy.bleedCap
                );
                this.log.addMessage(
                    this.loc.t('combatSkillBleedStrike', { dmg }),
                    '#d06060'
                );
                this.applyOnAttackRelics();
                break;
            }
            case 'preparation': {
                this.preparationActive = true;
                this.log.addMessage(
                    this.loc.t('combatSkillPreparation'),
                    '#7fa9ff'
                );
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
                this.log.addMessage(
                    this.loc.t('combatRelicCursedDouble', { damage }),
                    '#c98aff'
                );
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
        this.enemyUpdate.emit({ hp: this.enemy.hp, maxHp: this.enemy.maxHp, color: this.enemy.color, name: this.enemy.name, icon: this.enemy.icon });

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
            this.log.addMessage(
                this.loc.t('combatVampireBlessingHeal', { healed }),
                '#d7b6ff'
            );
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
            this.log.addMessage(
                this.loc.t('combatRelicHealOnAttack', { healed }),
                '#8be0a7'
            );
        }
    }


    private effectiveDamageMod(): number {
        const focus = this.player.status.focus.turns > 0 ? this.player.status.focus.amount : 0;
        return focus;
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

        // Mid-combat windups (bat / ghoul / lynx). The enemy spends
        // `def.turns` turns telegraphing, then resolves on the matching
        // turn. The enemy does NOT also throw a basic attack on those
        // turns — the wind-up replaces the regular hit.
        if (this.enemy.pendingPrepare) {
            const pp = this.enemy.pendingPrepare;
            if (pp.turnsRemaining > 0) {
                pp.turnsRemaining -= 1;
                this.log.addMessage(
                    this.loc.t('combatEnemyPrepareWindup', {
                        name: this.enemy.name,
                        action: this.prepareName(pp.def),
                    }),
                    '#c4a35a'
                );
                this.enemy.currentIntent = this.intentLabelForPrepare(pp);
                this.playerStatusChange.emit();
                this.enemyStatusChange.emit();
                return;
            }
            this.resolvePrepare(playerAction, pp.def);
            // Re-arm for the next windup cycle (enemies repeat their
            // prepare every `turns + 1` turns).
            pp.turnsRemaining = pp.def.turns;
            this.enemy.currentIntent = this.intentLabelForPrepare(pp);
            this.playerStatusChange.emit();
            this.enemyStatusChange.emit();
            return;
        }

        const flatBlockBase = playerAction === 'defend' ? COMBAT_CONFIG.defendBlock : 0;
        let flatBlock = flatBlockBase;

        const weakenReduction = this.enemy.status.weaken.turns > 0 ? this.enemy.status.weaken.amount : 0;
        let attackPower =
            this.enemy.attack +
            this.player.getEnemyAttackBonusFromLight() -
            weakenReduction;
        if (attackPower < 1) attackPower = 1;
        // Rat-style passive: chance for the basic attack to land for +N.
        if (
            this.enemy.passive?.kind === 'extraDamageOnHit' &&
            this.rng.next() < this.enemy.passive.chance
        ) {
            attackPower += this.enemy.passive.bonus;
            this.log.addMessage(
                this.loc.t('combatEnemyExtraDamage', {
                    name: this.enemy.name,
                    bonus: this.enemy.passive.bonus,
                }),
                '#d09a4f'
            );
        }
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
                flatBlock = flatBlockBase;
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
        if (killedByBleed) this.log.addMessage(narrate('bleed_finisher', this.loc.language), '#c4a35a');

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
            enemyCanonicalName: enemy.canonicalName,
            kind: enemy.kind,
            killedByBleed,
            finalBossDefeated: finalBoss,
            lightRecovered,
            rewards: {
                xp: enemy.xp,
                gold: enemy.gold + (enemy.kind === 'elite' ? ROOM_CONFIG.elite.bonusGold : 0),
                potions: enemy.kind === 'elite' ? ROOM_CONFIG.elite.bonusPotions : 0,
                attackBonus: enemy.kind === 'elite' ? ROOM_CONFIG.elite.bonusAttack : 0,
                relicShards:
                    enemy.kind === 'elite'
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

    /** Localised "{Action} ({turns}t)" badge for non-boss prepare windups. */
    private intentLabelForPrepare(pp: { def: EnemyPrepareDef; turnsRemaining: number }): string {
        const action = this.prepareName(pp.def);
        if (pp.turnsRemaining <= 0) {
            return this.loc.t('hudPrepareReadyLabel', { action });
        }
        return this.loc.t('hudPrepareWindupLabel', { action, turns: pp.turnsRemaining });
    }

    /** Returns the localised name of the prepare action (e.g. "Bite" / "Укус"). */
    private prepareName(def: EnemyPrepareDef): string {
        return this.loc.language === 'ru' ? def.nameRu : def.nameEn;
    }

    /**
     * Resolve a prepared enemy action. Damage and rider effects depend
     * on whether the player chose Defend on this turn:
     *  - `damageBack`: Defend cancels the hit and the enemy takes
     *    {@link EnemyPrepareDef.defenseBackDamage} damage instead. No
     *    riders are applied.
     *  - `cancelRiders`: Defend lets the raw damage land (with the
     *    normal flat block) but skips the bleed/poison rider.
     * If the player did not Defend, the full damage + rider lands.
     */
    private resolvePrepare(
        playerAction: 'attack' | 'defend' | 'skill' | 'potion',
        def: EnemyPrepareDef
    ) {
        if (!this.enemy) return;
        const defended = playerAction === 'defend';
        const action = this.prepareName(def);

        if (defended && def.defenseRule === 'damageBack') {
            const back = def.defenseBackDamage ?? 0;
            this.log.addMessage(
                this.loc.t('combatEnemyPrepareDefend', {
                    name: this.enemy.name,
                    action,
                }),
                '#9bc8ff'
            );
            if (back > 0) {
                this.enemy.hp = Math.max(0, this.enemy.hp - back);
                this.log.addMessage(
                    this.loc.t('combatEnemyPrepareDamageBack', {
                        name: this.enemy.name,
                        back,
                    }),
                    '#9bc8ff'
                );
                this.enemyUpdate.emit({
                    hp: this.enemy.hp,
                    maxHp: this.enemy.maxHp,
                    color: this.enemy.color,
                    name: this.enemy.name,
                    icon: this.enemy.icon,
                });
            }
            return;
        }

        // Either no Defend, or 'cancelRiders' rule. The hit lands
        // (Defend's flat block applies for cancelRiders).
        const flatBlock = defended ? COMBAT_CONFIG.defendBlock : 0;
        const taken = this.applyEnemyHitToPlayer(def.damage, flatBlock);
        if (taken > 0) {
            this.log.addMessage(
                this.loc.t('combatEnemyPrepareResolve', {
                    name: this.enemy.name,
                    action,
                    takenDamage: taken,
                }),
                '#ff6666'
            );
        } else {
            this.log.addMessage(this.loc.t('absorb'), '#8fc6ff');
        }

        if (defended) {
            // cancelRiders: damage went through, but bleed/poison don't.
            if (def.bleed || def.poison) {
                this.log.addMessage(
                    this.loc.t('combatEnemyPrepareRidersCancelled', {
                        name: this.enemy.name,
                        action,
                    }),
                    '#9bc8ff'
                );
            }
            return;
        }

        // No Defend: apply rider effects.
        if (def.bleed) {
            applyBleed(
                this.player.status,
                def.bleed.stacks,
                def.bleed.turns,
                this.enemy.bleedCap
            );
            this.log.addMessage(
                this.loc.t('combatEnemyPrepareBleed', {
                    name: this.enemy.name,
                    action,
                    stacks: def.bleed.stacks,
                    turns: def.bleed.turns,
                }),
                '#d06060'
            );
        }
        if (def.poison) {
            applyPoison(this.player.status, def.poison.damage, def.poison.turns);
            this.log.addMessage(
                this.loc.t('combatEnemyPreparePoison', {
                    name: this.enemy.name,
                    action,
                    damage: def.poison.damage,
                    turns: def.poison.turns,
                }),
                '#7fbf6a'
            );
        }
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
        const flatBlock = flatBlockBase;

        const weakenReduction = this.enemy.status.weaken.turns > 0 ? this.enemy.status.weaken.amount : 0;
        let attackPower =
            this.enemy.attack +
            this.player.getEnemyAttackBonusFromLight() -
            weakenReduction;
        if (action.damageBonus) attackPower += action.damageBonus;
        if (attackPower < 1) attackPower = 1;

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
