import { getBossForDepth, getEnemyByName, getEnemyForDepth } from './EnemyPicker';
import { COMBAT_CONFIG, ROOM_CONFIG } from '../data/GameConfig';
import type { EnemyDef, EnemyPassive, EnemyPrepareDef, EnemyProfile } from '../data/GameConfig';
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
    applyArmorBreak,
    applyBleed,
    applyMark,
    applyPoison,
    applyStun,
    applyWeaken,
    consumeGuardBlock,
    consumeMark,
    consumeStunForTurn,
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
 * Per-combat boss phase tracking. Built from a BossBlueprint
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
    /**
     * Mime's anti-repeat tracker for the random-status rider on
     * `mime_chaos` actions. Records the last status picked so the
     * next roll is forced to choose a different one. Reset by
     * encounter setup.
     */
    lastRandomStatus?: 'bleed' | 'poison' | 'stun' | 'weaken' | 'armorBreak' | 'mark';
    /**
     * Mammon's "Greed Lord" snapshot of the relic he stole from the
     * player. Set when `onEnterStealRelic` resolves on phase entry;
     * read in `finishCombat` so the relic is restored to the player
     * on Mammon's death.
     */
    stolenRelicId?: import('./Relics').RelicId;
    /**
     * Prophet's resurrection guard. Set to `true` once
     * `resurrectOnDeath` has fired so subsequent kills go through
     * the normal finishCombat pipeline.
     */
    resurrected?: boolean;
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
    /**
     * Lich's "Curse of Darkness" tracks whether its single per-fight
     * curse has already landed. Set to `true` once the weaken applies
     * so the lich never tries to re-curse later turns. Reset by
     * encounter setup since `setupEnemy` builds an `ActiveEnemy` from
     * scratch.
     */
    curseDarknessFired?: boolean;
    /**
     * Lost Adventurer's "Healing Potions" counter. Increments each
     * time the `selfHealOnLowHp` passive fires; the passive stops
     * triggering once it reaches the configured `maxUses`.
     */
    selfHealsUsed?: number;
    /** Per-spec passive trigger copied from EnemyDef at combat start. */
    passive?: EnemyPassive;
    /**
     * Mid-combat windup state for non-boss enemies that have a `prepare`
     * block. `turnsRemaining` counts down on every enemy turn; when it
     * hits 0 the prepare resolves on the *next* enemy turn (so the
     * player has one turn to react with Defend).
     */
    pendingPrepare?: { def: EnemyPrepareDef; turnsRemaining: number };
    /** Phase blueprint runtime state, only set on bosses. */
    bossPhase?: BossPhaseState;
    /**
     * Localised one-line intent shown BEFORE the boss's next
     * turn so the player can respond. `null` for non-boss enemies.
     */
    currentIntent?: string | null;
    /** Hard cap on stack count for bleed (final boss). */
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
    /** Set when the slain enemy was the final boss. */
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

    /** Per-combat skill cooldowns keyed by SkillId. */
    public skillCooldowns: Partial<Record<SkillId, number>> = {};
    /** Preparation buff: next attack +1 damage, next defend +1 defense. */
    public preparationActive = false;
    /**
     * Per-turn relic guards. Reset at the top of every player
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

    /**
     * Begin a new combat at the given depth. When `kind === 'boss'`
     * and the depth maps to multiple boss candidates, the seeded RNG
     * picks one deterministically. Tests can short-circuit the pool /
     * boss lookup entirely by passing an explicit `override` def.
     */
    startCombat(depth: number, kind: EncounterKind, override?: EnemyDef) {
        // Reset per-combat state.
        this.skillCooldowns = {};
        this.preparationActive = false;
        const definition =
            override ??
            (kind === 'boss'
                ? getBossForDepth(depth, this.rng)
                : getEnemyForDepth(depth, this.rng));
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

        // Look up a boss blueprint by canonical English name so
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
     * Look up the remaining cooldown for a skill (0 = ready).
     * Used by both UI and the headless simulator.
     */
    getSkillCooldown(id: SkillId): number {
        return this.skillCooldowns[id] ?? 0;
    }

    /** True when the skill is on cooldown and unusable. */
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
        // Reset per-turn boss-phase state before the player acts.
        if (this.enemy.bossPhase) {
            this.enemy.bossPhase.damagedThisTurn = false;
        }
        // Reset per-turn relic guards.
        this.vampiricHealedThisTurn = false;
        this.gamblersResolveThisTurn = 0;

        // Tick down cooldowns at the start of each player turn.
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

        // Giant-Toad-style player stun: if the player is bound, their
        // chosen action is forfeit. The enemy's turn still resolves.
        // Stun ticks here (consumeStunForTurn decrements turns) so the
        // very next player turn after a stun=1 application is the one
        // skipped, and the one after that is free again.
        const playerStunned = consumeStunForTurn(this.player.status);
        if (playerStunned) {
            this.log.addMessage(this.loc.t('combatPlayerStunned'), '#7aaaff');
        } else if (actionName === 'attack') {
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
            // Prophet "Furious Resurrection": once per encounter,
            // restore HP and buff attack instead of dying. Resolves
            // BEFORE all other death-trigger paths (hellfire, spawn,
            // finishCombat) so the boss simply continues the fight
            // with the new stats. The blueprint flag prevents repeat
            // resurrections.
            if (
                this.enemy.bossPhase &&
                this.enemy.bossPhase.blueprint.resurrectOnDeath &&
                !this.enemy.bossPhase.resurrected
            ) {
                const cfg = this.enemy.bossPhase.blueprint.resurrectOnDeath;
                this.enemy.bossPhase.resurrected = true;
                this.enemy.hp = Math.max(1, Math.floor(this.enemy.maxHp * cfg.hpFraction));
                const newAttack = Math.max(1, Math.round(this.enemy.attack * cfg.attackMultiplier));
                this.enemy.attack = newAttack;
                this.log.addMessage(
                    this.loc.t('combatBossResurrect', {
                        name: this.enemy.name,
                        hp: this.enemy.hp,
                        attack: newAttack,
                    }),
                    '#ffe08a'
                );
                this.enemyUpdate.emit({
                    hp: this.enemy.hp,
                    maxHp: this.enemy.maxHp,
                    color: this.enemy.color,
                    name: this.enemy.name,
                    icon: this.enemy.icon,
                });
                // Fall through past the death-trigger block; the rest
                // of processTurn (resolveEnemyTurn etc.) runs as if
                // the boss never died.
            } else {
                // Death-trigger passive: Demon-style 'hellfireOnDeath'
                // detonates the dying enemy for true damage scaled by
                // the player's relic count. Resolves BEFORE finishCombat
                // so the explosion can still kill the player and route
                // them through the death screen — finishCombat itself
                // then plays out as normal (rewards still pay if the
                // player survived). The spawnOnDeath check below short-
                // circuits combat continuation, so put hellfire first
                // and let the spawn case handle the matron / replacement
                // flow it already owns.
                if (this.enemy.passive?.kind === 'hellfireOnDeath') {
                    const relicCount = this.player.relics.length;
                    const damage = relicCount * this.enemy.passive.damagePerRelic;
                    if (damage > 0) {
                        const taken = this.player.takeDamage(damage, 0, 'true');
                        this.log.addMessage(
                            this.loc.t('combatEnemyHellfireOnDeath', {
                                name: this.enemy.name,
                                damage: taken,
                            }),
                            '#ff8a3a'
                        );
                        if (taken > 0) this.playerHit.emit({ damage: taken });
                        if (this.player.stats.hp <= 0) {
                            this.logDeath();
                            this.finishCombat(killedByBleed);
                            return;
                        }
                    }
                }
                // Death-trigger passive: Rat Matron-style 'spawnOnDeath'
                // respawns the encounter as a different enemy instead
                // of ending combat.
                if (this.enemy.passive?.kind === 'spawnOnDeath') {
                    this.spawnReplacement(this.enemy.passive.spawnName, killedByBleed);
                    return;
                }
                this.finishCombat(killedByBleed);
                return;
            }
        }

        this.resolveEnemyTurn(actionName as Exclude<CombatAction, { kind: 'skill'; id: SkillId }>);

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
        const result = this.rollPlayerAttack();
        let damage = result.damage;
        if (this.preparationActive) {
            damage += 1;
            this.preparationActive = false;
            this.log.addMessage(this.loc.t('combatPreparationAttack'), '#9bc8ff');
        }
        // Knight's Sword: +5 damage on a regular attack at the relic's
        // chance. Resolved on the basic-attack path ONLY (skills, bleed
        // ticks, Cursed-Ring scrubbed strikes do NOT receive it). Logged
        // before the strike line so the order reads "extra → strike".
        const agg = this.player.aggregate;
        if (agg.damageBonusOnAttackChance > 0 && this.rng.next() < agg.damageBonusOnAttackChance) {
            const bonus = agg.damageBonusOnAttackAmount;
            damage += bonus;
            this.log.addMessage(this.loc.t('combatRelicKnightSwordBonus', { bonus }), '#e6d27a');
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
        this.applyResolveOnAttack();
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

        // Skeleton Swordsman "Skilled Fencer": parry the skill before
        // its effect resolves. The resolve cost is already spent above
        // (and is NOT refunded — the parry just wastes the player's
        // turn) and the player's turn still passes so the enemy still
        // acts on top.
        if (
            this.enemy.passive?.kind === 'blocksSkillsAndPotions' &&
            this.rng.next() < this.enemy.passive.chance
        ) {
            this.log.addMessage(
                this.loc.t('combatEnemyParrySkill', {
                    name: this.enemy.name,
                    value: this.skillName(skillId),
                }),
                '#a89070'
            );
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
                this.applyResolveOnAttack();
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
                this.applyResolveOnAttack();
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
        // Skeleton Swordsman "Skilled Fencer": parry the potion as it
        // is being drunk. The potion is already consumed (cost is the
        // gating mechanic) but the heal is silenced. Player's turn
        // still passes.
        if (
            this.enemy?.passive?.kind === 'blocksSkillsAndPotions' &&
            this.rng.next() < this.enemy.passive.chance
        ) {
            this.log.addMessage(
                this.loc.t('combatEnemyParryPotion', {
                    name: this.enemy.name,
                }),
                '#a89070'
            );
            return true;
        }
        const healed = this.player.heal(COMBAT_CONFIG.potionHeal);
        this.log.addMessage(this.loc.t('drinkPotion', { healed }), '#78e496');
        return true;
    }

    private applyPlayerDamage(baseDamage: number, criticalIn: boolean) {
        if (!this.enemy) return;

        // Bee-Butterfly "Flutter and sting": chance to dodge the
        // player's incoming swing entirely and counter for a fixed
        // amount of true damage. Resolved before any player-side
        // procs (Minor Cursed, mark consumption, expose bonuses,
        // Bone-Shield, damage reduction) so those are not wasted on
        // a missed swing.
        if (
            this.enemy.passive?.kind === 'evadeAndStingOnHit' &&
            this.rng.next() < this.enemy.passive.chance
        ) {
            this.lastActionResult.enemyEvaded = true;
            const sting = this.enemy.passive.damage;
            const taken = sting > 0 ? this.player.takeDamage(sting, 0, 'true') : 0;
            this.log.addMessage(
                this.loc.t('combatEnemyEvadeAndSting', {
                    name: this.enemy.name,
                    damage: taken,
                }),
                '#d9bf3a'
            );
            if (taken > 0) this.playerHit.emit({ damage: taken });
            return;
        }

        let critical = criticalIn;
        let damage = baseDamage;

        // Consume mark for guaranteed crit.
        if (!critical && consumeMark(this.enemy.status)) {
            critical = true;
            damage = Math.max(1, Math.round(damage * COMBAT_CONFIG.criticalMultiplier));
        }

        // Boss "Exposed" actions queue +N damage on the next
        // player hit. Consume the queue here so subsequent hits (e.g.
        // bleed tick) do NOT eat the bonus.
        if (this.enemy.bossPhase && this.enemy.bossPhase.pendingExposeBonus > 0) {
            damage += this.enemy.bossPhase.pendingExposeBonus;
            this.enemy.bossPhase.pendingExposeBonus = 0;
        }

        // Bone-Shield style block on the boss soaks the next
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

        // Longinus Shard: ×N damage when the enemy is the Prophet
        // boss. Applied AFTER all other damage modifiers but BEFORE
        // the HP write so the multiplied damage feeds the death
        // check and the boss-block / spawn paths.
        if (damage > 0 && this.enemy.canonicalName === 'Prophet') {
            const mult = this.player.aggregate.prophetDamageMult;
            if (mult > 1) {
                const before = damage;
                damage = Math.max(1, Math.round(damage * mult));
                this.log.addMessage(
                    this.loc.t('combatRelicLonginusShard', {
                        before,
                        damage,
                    }),
                    '#ffd9d9'
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
     * Vampire Amulet (and similar): a chance to recover HP after any
     * attack action. Uses the player's `aggregate.healOnAttackChance`
     * so multiple sources stack via max() in {@link aggregateRelics}.
     * The flesh-set proc-bump (10% → 30%) is folded into the chance
     * by `applyUnconditionalSetBonuses`.
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

    /**
     * Lost Staff: +N current resolve every time the player takes an
     * attack action (basic strike OR Will-skill). Capped at maxResolve
     * by `gainResolve`. Logged only when something was actually
     * gained, so a full bar stays quiet.
     */
    private applyResolveOnAttack() {
        const agg = this.player.aggregate;
        if (agg.resolveOnAttackAmount <= 0) return;
        const gained = this.player.gainResolve(agg.resolveOnAttackAmount);
        if (gained > 0) {
            this.log.addMessage(this.loc.t('combatRelicLostStaff', { resolve: gained }), '#9bc8ff');
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

        // Dark Chestplate (and similar): a chance to halve the
        // incoming damage (50% block, rounded with Math.floor on the
        // BLOCKED side so 5 → blocks 2 → player takes 3, and a 1-dmg
        // hit blocks 0 so the player still takes the full 1). Stacks
        // before defense / flatBlock so the surviving amount still
        // gets reduced by guard + defense afterwards.
        const agg = this.player.aggregate;
        let extraBlock = 0;
        if (
            agg.damageReductionChance > 0 &&
            agg.damageReductionPercent > 0 &&
            this.rng.next() < agg.damageReductionChance
        ) {
            extraBlock = Math.floor(amount * agg.damageReductionPercent);
            if (extraBlock > 0) {
                this.log.addMessage(
                    this.loc.t('combatRelicDarkChestplate', { amount: extraBlock }),
                    '#9fc4f0'
                );
            }
        }

        const taken = this.player.takeDamage(amount, flatBlock + extraBlock, 'combat');
        if (taken > 0) {
            if (crit) this.log.addMessage(narrate('crit_received', this.loc.language), '#c4a35a');
            this.playerHit.emit({ damage: taken });

            // Knight's Helmet: chance to restore N resolve when the
            // player takes a hit. Resolved AFTER damage is applied so
            // the chance fires once per landed enemy hit; misses /
            // fully-blocked hits do NOT trigger.
            if (
                agg.resolveOnHitChance > 0 &&
                agg.resolveOnHitAmount > 0 &&
                this.rng.next() < agg.resolveOnHitChance
            ) {
                const gained = this.player.gainResolve(agg.resolveOnHitAmount);
                if (gained > 0) {
                    this.log.addMessage(
                        this.loc.t('combatRelicKnightHelmet', { resolve: gained }),
                        '#9fc4f0'
                    );
                }
            }
        }
        return taken;
    }

    /**
     * Replace the current dying enemy with a fresh blueprint pulled
     * from the roster by canonical name (Rat Matron's "litter" spawns
     * a Rat). The matron's xp/gold are paid out inline via the player
     * manager — we do NOT emit combatEnd here, because that signal
     * advances the room and closes the fight. Player status carries
     * through (bleeds, armor break, etc. don't reset mid-encounter).
     */
    private spawnReplacement(spawnName: string, _killedByBleed: boolean) {
        if (!this.enemy) return;
        const fallenName = this.enemy.name;
        const fallenXp = this.enemy.xp;
        const fallenGold = this.enemy.gold;
        const spawnDef = getEnemyByName(spawnName);
        if (!spawnDef) {
            // Roster typo — fail open by ending combat normally so a
            // bad data entry doesn't soft-lock a run.
            this.finishCombat(_killedByBleed);
            return;
        }
        // Pay out the matron's xp/gold FIRST, then keep combat going
        // with the spawned creature. No relic roll on the matron —
        // the spawned rat carries the encounter's drop instead, so
        // 'one fight = one relic chance' invariant holds.
        this.log.addMessage(this.loc.t('enemyFalls', { name: fallenName }), '#66ff88');
        if (fallenXp > 0) {
            const gained = this.player.gainXp(fallenXp);
            if (gained > 0) this.log.addMessage(this.loc.t('plusXp', { value: gained }), '#a8e0a8');
        }
        if (fallenGold > 0) {
            const gained = this.player.gainGold(fallenGold);
            if (gained > 0)
                this.log.addMessage(this.loc.t('plusGold', { value: gained }), '#e0c468');
        }

        // Build the replacement in-place. No depth scaling — we just
        // copy the def numbers since the spawned creature is meant to
        // be a "child" not a power-scaled enemy.
        this.enemy = {
            kind: 'normal',
            name: this.loc.enemyName(spawnDef.name),
            canonicalName: spawnDef.name,
            description: this.loc.enemyDescription(spawnDef.name, spawnDef.description),
            icon: spawnDef.icon,
            hp: spawnDef.hp,
            maxHp: spawnDef.hp,
            attack: spawnDef.attack,
            color: spawnDef.color,
            xp: spawnDef.xp,
            gold: spawnDef.gold,
            profile: spawnDef.profile,
            turnsAlive: 0,
            status: emptyStatusState(),
            passive: spawnDef.passive,
            pendingPrepare: spawnDef.prepare
                ? { def: spawnDef.prepare, turnsRemaining: spawnDef.prepare.turns }
                : undefined,
            currentIntent: null,
        };
        if (this.enemy.pendingPrepare) {
            this.enemy.currentIntent = intentLabelForPrepare(this.enemy.pendingPrepare, this.loc);
        }
        this.log.addMessage(
            this.loc.t('combatEnemySpawnsReplacement', {
                name: fallenName,
                spawn: this.enemy.name,
            }),
            '#c4a35a'
        );
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

    private finishCombat(killedByBleed: boolean) {
        if (!this.enemy) return;
        // Mammon "Greed Lord": return the stolen relic to the player
        // when Mammon dies. addRelic returns 'duplicate' / 'full' /
        // 'added' — we only narrate the success path; if the player
        // somehow re-acquired the same relic in the meantime ('duplicate')
        // or filled the inventory ('full') we drop the return silently
        // rather than spawn a swap-modal mid-finish.
        if (this.enemy.bossPhase?.stolenRelicId) {
            const id = this.enemy.bossPhase.stolenRelicId;
            const result = this.player.addRelic(id);
            if (result === 'added') {
                this.log.addMessage(
                    this.loc.t('combatBossRelicReturned', { name: this.enemy.name }),
                    '#a8e0a8'
                );
            }
        }
        const payload = this.buildRewards(this.enemy, killedByBleed);
        this.log.addMessage(this.loc.t('enemyFalls', { name: this.enemy.name }), '#66ff88');
        if (killedByBleed)
            this.log.addMessage(narrate('bleed_finisher', this.loc.language), '#c4a35a');

        this.enemy = null;
        this.combatEnd.emit(payload);
    }

    /**
     * Mammon's "Greed Lord" relic theft. Picks one of the player's
     * relics deterministically through `this.rng.next()` and stashes
     * the id on `BossPhaseState.stolenRelicId` so finishCombat can
     * return it on the boss's death. No-op when the player has no
     * relics.
     */
    private stealRandomRelic(state: BossPhaseState): void {
        if (!this.enemy) return;
        const relics = this.player.relics;
        if (relics.length === 0) {
            // Player carries nothing — narrate the fizzle so the cue
            // is still visible.
            this.log.addMessage(
                this.loc.t('combatBossRelicTheftEmpty', { name: this.enemy.name }),
                '#a89070'
            );
            return;
        }
        const idx = Math.floor(this.rng.next() * relics.length) % relics.length;
        const stolen = relics[idx];
        this.player.removeRelic(stolen);
        state.stolenRelicId = stolen;
        this.log.addMessage(
            this.loc.t('combatBossRelicStolen', { name: this.enemy.name }),
            '#d09a4f'
        );
    }

    private logDeath() {
        this.log.addMessage(narrate('death', this.loc.language), '#ff3333');
    }

    /**
     * Mime "Chaos Lord's Laughter" — pick one status from the action's
     * pool that is NOT the same as the last status applied. The
     * anti-repeat tracker lives on `BossPhaseState.lastRandomStatus`
     * so it survives turn boundaries but resets per-encounter (a
     * fresh `setupEnemy` builds a new BossPhaseState).
     */
    private applyRandomMimeStatus(
        state: BossPhaseState,
        cfg: {
            pool: Array<'bleed' | 'poison' | 'stun' | 'weaken' | 'armorBreak' | 'mark'>;
            amount: number;
            turns: number;
        }
    ): void {
        if (!this.enemy) return;
        const candidates = cfg.pool.filter((s) => s !== state.lastRandomStatus);
        // If anti-repeat would empty the pool (single-element pool),
        // fall back to the full pool so we still apply something.
        const choices = candidates.length > 0 ? candidates : cfg.pool;
        if (choices.length === 0) return;
        const idx = Math.floor(this.rng.next() * choices.length) % choices.length;
        const pick = choices[idx];
        state.lastRandomStatus = pick;
        // Map status id → its localised display label. The keys are
        // referenced as string literals here so the orphan-key test
        // (`tests/Locale.consistency.test.ts`) can statically detect
        // each call site.
        let statusLabel: string;
        switch (pick) {
            case 'bleed':
                applyBleed(this.player.status, cfg.amount, cfg.turns);
                statusLabel = this.loc.t('combatBossMimeStatus_bleed');
                break;
            case 'poison':
                applyPoison(this.player.status, cfg.amount, cfg.turns);
                statusLabel = this.loc.t('combatBossMimeStatus_poison');
                break;
            case 'stun':
                applyStun(this.player.status, cfg.turns);
                statusLabel = this.loc.t('combatBossMimeStatus_stun');
                break;
            case 'weaken':
                applyWeaken(this.player.status, cfg.amount, cfg.turns);
                statusLabel = this.loc.t('combatBossMimeStatus_weaken');
                break;
            case 'armorBreak':
                applyArmorBreak(this.player.status, cfg.amount, cfg.turns);
                statusLabel = this.loc.t('combatBossMimeStatus_armorBreak');
                break;
            case 'mark':
                applyMark(this.player.status, cfg.turns);
                statusLabel = this.loc.t('combatBossMimeStatus_mark');
                break;
        }
        this.log.addMessage(
            this.loc.t('combatBossMimeChaos', {
                name: this.enemy.name,
                status: statusLabel,
            }),
            '#c0a0d0'
        );
        this.playerStatusChange.emit();
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
        // Every BOSSES entry lives on the final depth, so a boss kill
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
    // Boss phase / intent runner. Pure helpers
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
        const advanced = maybeAdvancePhase(this.enemy, this.log, this.loc);

        // Mammon "Greed Lord" — phase 2 onEnter steals one random
        // relic from the player. The id is preserved on `stolenRelicId`
        // so finishCombat can return it on the boss's death. Skipped
        // when the player has no relics; never re-fires across phase
        // re-entries because phase indices are monotonic.
        if (advanced) {
            const enteredPhase = state.blueprint.phases[state.phaseIndex];
            if (enteredPhase.onEnterStealRelic && !state.stolenRelicId) {
                this.stealRandomRelic(state);
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

        // Gilgamesh "Hero's Cry": rider on the regular attack — on a
        // 10% roll, drain weaken / armorBreak / resolve from the
        // player on top of the swing. Resolved BEFORE the attack so
        // the resolve drain registers immediately and the player can
        // see the cumulative effect on the next turn's intent.
        if (
            action.id === 'hero_call' &&
            action.heroCryChance &&
            action.heroCryDrain &&
            this.rng.next() < action.heroCryChance
        ) {
            const drain = action.heroCryDrain;
            applyWeaken(this.player.status, drain.attackWeaken, drain.turns);
            applyArmorBreak(this.player.status, drain.defenseArmorBreak, drain.turns);
            const drained = Math.min(this.player.resources.resolve, drain.resolveDrain);
            if (drained > 0) this.player.spendResolve(drained);
            this.log.addMessage(
                this.loc.t('combatBossHeroCry', {
                    name: this.enemy.name,
                    weaken: drain.attackWeaken,
                    armor: drain.defenseArmorBreak,
                    resolve: drained,
                }),
                '#d09a4f'
            );
            this.playerStatusChange.emit();
        }

        // Mime "Chaos Lord's Laughter": every turn pick one random
        // status from the action's pool and apply it to the player.
        // The same status cannot fire twice in a row — anti-repeat
        // tracked on `BossPhaseState.lastRandomStatus`.
        if (action.id === 'mime_chaos' && action.randomStatus) {
            this.applyRandomMimeStatus(state, action.randomStatus);
        }

        // Damage-dealing actions hit the player.
        if (!action.noAttack) {
            // Mime's swings ignore armor (true damage). All other
            // boss attacks go through `applyEnemyHitToPlayer` which
            // applies guard/defense/crit normally. The lifesteal
            // rider only applies when the hit landed for >0 damage.
            let taken: number;
            if (action.ignoreArmor) {
                taken = this.player.takeDamage(Math.max(1, attackPower), 0, 'true');
                if (taken > 0) this.playerHit.emit({ damage: taken });
            } else {
                taken = this.applyEnemyHitToPlayer(attackPower, flatBlock);
            }
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
            // Mime lifesteal: heal a flat amount on a successful hit.
            if (
                taken > 0 &&
                action.lifestealFlat &&
                action.lifestealFlat > 0 &&
                this.enemy.hp < this.enemy.maxHp
            ) {
                const before = this.enemy.hp;
                this.enemy.hp = Math.min(this.enemy.maxHp, this.enemy.hp + action.lifestealFlat);
                const healed = this.enemy.hp - before;
                if (healed > 0) {
                    this.log.addMessage(
                        this.loc.t('combatEnemyLifesteal', {
                            name: this.enemy.name,
                            healed,
                        }),
                        '#c45a5a'
                    );
                    this.enemyUpdate.emit({
                        hp: this.enemy.hp,
                        maxHp: this.enemy.maxHp,
                        color: this.enemy.color,
                        name: this.enemy.name,
                        icon: this.enemy.icon,
                    });
                }
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

        // Nimrod's "God-Killer": unconditional OHKO when the 5-turn
        // windup resolves. No Defend smoothing — the only counterplay
        // is burning Nimrod down before resolution. Reuses the same
        // `oneShot: true` flag as Death Touch but skips the
        // oneShotDefendDamage branch.
        if (action.id === 'nimrod_godkiller' && action.oneShot) {
            const lethal = Math.max(this.player.stats.hp, 1);
            this.player.takeDamage(lethal, 0, 'true');
            this.log.addMessage(
                this.loc.t('combatBossNimrodGodkiller', {
                    name: this.enemy.name,
                    action: actionLabel,
                }),
                '#ff6666'
            );
            this.playerHit.emit({ damage: lethal });
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
