/**
 * Combat controller. Owns one combat encounter at a time and routes
 * player / enemy actions through the smaller per-action modules in
 * `src/systems/combat/`. See {@link CombatManager} below; this
 * module-level header is here so the `[FIX-N]` tags scattered
 * throughout the file can all be looked up in one place.
 *
 * ── [FIX-N] dictionary ─────────────────────────────────────────────
 * Inline `[FIX-N]` comments throughout this file (and a handful of
 * sibling files) tag fields, branches, and helpers that exist
 * specifically to satisfy a bug fix or design fix during gameplay
 * development. The number is **stable** — adding a new one means
 * picking the next free integer; old ones are never re-used so the
 * tags remain `grep`-friendly across the codebase.
 *
 *   [FIX-1]   Final-boss bleed cap. Hard ceiling on stack count for
 *             the bleed status when applied to the final boss, plus
 *             the `finalBossDefeated` flag on the end-of-combat
 *             payload so VictoryScreen can fire its special-case
 *             celebration. See `bleedCap` field, `finalBossDefeated`
 *             on `CombatEndPayload`.
 *
 *   [FIX-5]   Per-combat skill cooldowns. `skillCooldowns` map keyed
 *             by `SkillId`, the `getSkillCooldown` / `isSkillOnCooldown`
 *             accessors, and the per-turn tick-down at the top of
 *             `startPlayerTurn`.
 *
 *   [FIX-10]  Boss phases + intent line. `BossPhaseState` runtime
 *             object on `ActiveEnemy`, `currentIntent` localised
 *             one-liner shown before the boss's turn, the
 *             `BOSS_BLUEPRINT_BY_NAME` lookup that builds it, the
 *             per-turn reset in `startPlayerTurn`, and the runner
 *             section near `// Boss phase / intent runner` lower in
 *             this file.
 *
 *   [FIX-13]  Per-turn relic guards. `vampiricHealedThisTurn` /
 *             `gamblersResolveThisTurn` flags reset at the top of
 *             every player turn so the relic effects fire at most
 *             once per turn even when their trigger condition
 *             persists.
 *
 * Numbers without entries above (2, 3, 4, 6, 7, 8, 9, 11, 12) are
 * reserved for fixes that have since been removed or fully absorbed
 * into the regular code path; do **not** reuse them — keep new tags
 * monotonically increasing instead.
 * ───────────────────────────────────────────────────────────────────
 */
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
    intentLabelForPhase,
    intentLabelForPrepare,
    maybeAdvancePhase,
    tickBossBlockAtTurnEnd,
} from './BossRuntime';
import { Emitter } from './Emitter';
import { narrate } from './Narrator';
import { Localization } from './Localization';
import { PlayerManager } from './PlayerManager';
import type { SkillId } from './Skills';
import {
    applyArmorBreak,
    applyWeaken,
    consumeGuardBlock,
    consumeStunForTurn,
    consumeAttackBanForAttack,
    emptyStatusState,
    tickAttackBan,
    statusSummary,
    tickTurn,
} from './StatusEffects';
import {
    resolveEnemyTurn as resolveEnemyTurnFn,
    type EnemyTurnDeps,
    type PlayerAction,
} from './EnemyTurn';
import type { StatusState } from './StatusEffects';
import { defaultRng, type Rng } from './Rng';
import {
    handlePlayerAttack as handlePlayerAttackFn,
    handlePlayerDefend as handlePlayerDefendFn,
    handlePlayerPotion as handlePlayerPotionFn,
    handlePlayerSkill as handlePlayerSkillFn,
    type PlayerActionsDeps,
    type PlayerActionsState,
} from './combat/PlayerActions';
import {
    applyRandomMimeStatus as applyRandomMimeStatusFn,
    stealRandomRelic as stealRandomRelicFn,
    type MimeChaosDeps,
} from './combat/MimeChaos';

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
//   CombatRewards, CombatEndPayload, EnemyUpdatePayload).
// Field declarations + Emitter channels.
// constructor.
// startCombat / setupEnemy (encounter init, scaling, intent rolls).
// getSkillCooldown / isSkillOnCooldown.
// processTurn (top-level player-action dispatcher).
// handlePlayerAttack / Defend / Skill / Potion (delegate wrappers
//   into combat/PlayerActions.ts).
// buildPlayerActionsState / buildPlayerActionsDeps /
//   buildMimeChaosDeps (dependency-injection bundles for the
//   combat/ sub-modules).
// resolveEnemyTurn (delegates to EnemyTurn.ts).
// applyEnemyHitToPlayer.
// spawnReplacement / finishCombat / logDeath / buildRewards.
// stealRandomRelic / applyRandomMimeStatus (wrappers into
//   combat/MimeChaos.ts).
// Boss machinery: runBossTurn, resolveBossWindupAction.
// enemyStatusText / playerStatusText.
//
// Player-side action implementations live in:
//   - combat/PlayerActions.ts  (handlePlayer*, applyPlayerDamage)
//   - combat/RelicHooks.ts     (on-attack relic procs)
//   - combat/MimeChaos.ts      (Mime / Mammon helpers)
// Boss-side helpers live in BossRuntime.ts; non-boss enemy turns
// live in EnemyTurn.ts.
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
     * Per-turn relic guards. Reset at the top of every player
     * turn so Vampiric Sigil / Gambler's Knuckle resolve gain can fire
     * at most once per turn regardless of how many crits / kills line
     * up in that turn.
     *
     * `public` so the player-action handlers in {@link PlayerActions}
     * can read/write them through {@link buildPlayerActionsState}
     * without TypeScript complaining about cross-module access.
     */
    public vampiricHealedThisTurn = false;
    public gamblersResolveThisTurn = 0;

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

        // Giant-Toad-style player stun: if the player is bound, their
        // chosen action is forfeit. The enemy's turn still resolves.
        // Stun ticks here (consumeStunForTurn decrements turns) so the
        // very next player turn after a stun=1 application is the one
        // skipped, and the one after that is free again.
        const playerStunned = consumeStunForTurn(this.player.status);
        // Giant-Toad "Tongue Lash" follow-up: a narrower ban that only
        // forfeits the *attack* action. Defense, skills and potions
        // still resolve normally. The timer ticks once per player turn
        // regardless of choice so a turns=1 ban naturally expires the
        // turn after it lands.
        const attackBanned =
            !playerStunned &&
            actionName === 'attack' &&
            consumeAttackBanForAttack(this.player.status);
        if (playerStunned) {
            this.log.addMessage(this.loc.t('combatPlayerStunned'), '#7aaaff');
        } else if (attackBanned) {
            this.log.addMessage(this.loc.t('combatPlayerAttackBanned'), '#7aaaff');
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
        // Non-attack actions don't consume the ban, but it should still
        // decay naturally so the player isn't permanently locked out of
        // attacking by chaining defenses.
        if (!playerStunned && !attackBanned && actionName !== 'attack') {
            tickAttackBan(this.player.status);
        }

        // End-of-player-turn: tick enemy statuses (bleed damage etc.).
        // Snapshot HP BEFORE the tick so we can detect whether the
        // tick itself is what brought the enemy to 0 (vs. the
        // player's own action already having killed them on this
        // same turn). The old heuristic checked `actionName !==
        // 'attack' / 'skill'` which mis-classified attacks that
        // failed to land the kill but stacked enough bleed to
        // finish over the tick.
        const enemyHpBeforeTick = this.enemy ? this.enemy.hp : 0;
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
            // killedByBleed reflects whether the end-of-turn tick is
            // what finished the enemy off: enemy was alive before the
            // tick (>0) and is dead now (<=0). The flag drives the
            // `bleed_finisher` narration in finishCombat.
            const killedByBleed = enemyHpBeforeTick > 0;
            // Reference the legacy action name so a future refactor
            // looking for it grep-finds this block.
            void actionName;
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

        // If the enemy turn killed the player (resolveEnemyTurn has
        // already called logDeath() on its way out), skip the entire
        // player-status tick block. Otherwise bleed/poison ticks
        // would chip a corpse for extra log lines, regen would
        // appear to "revive" the corpse, and the terminal
        // logDeath() would log a second death narration on top of
        // the one resolveEnemyTurn already emitted.
        if (this.player.stats.hp <= 0) {
            this.playerStatusChange.emit();
            return;
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
        handlePlayerAttackFn(
            this.enemy,
            this.buildPlayerActionsState(),
            this.buildPlayerActionsDeps()
        );
    }

    private handlePlayerDefend() {
        if (!this.enemy) return;
        handlePlayerDefendFn(
            this.enemy,
            this.buildPlayerActionsState(),
            this.buildPlayerActionsDeps()
        );
    }

    private handlePlayerSkill(skillId: SkillId): boolean {
        if (!this.enemy) return false;
        return handlePlayerSkillFn(
            this.enemy,
            skillId,
            this.buildPlayerActionsState(),
            this.buildPlayerActionsDeps()
        );
    }

    private handlePlayerPotion(): boolean {
        return handlePlayerPotionFn(this.enemy, this.buildPlayerActionsDeps());
    }

    /**
     * Build the mutable state object the player-action handlers
     * read & write. Returns a live view backed by the manager's own
     * fields — handlers mutate `state.preparationActive` /
     * `state.skillCooldowns` etc. through the proxy and the changes
     * land directly on `this`.
     */
    private buildPlayerActionsState(): PlayerActionsState {
        // Use property accessors so writes propagate back to `this`.
        // Cooldowns + lastActionResult are object refs so mutations on
        // them are already visible through `this`; primitives need
        // explicit writeback.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const manager: CombatManager = this;
        return {
            get preparationActive(): boolean {
                return manager.preparationActive;
            },
            set preparationActive(v: boolean) {
                manager.preparationActive = v;
            },
            get vampiricHealedThisTurn(): boolean {
                return manager.vampiricHealedThisTurn;
            },
            set vampiricHealedThisTurn(v: boolean) {
                manager.vampiricHealedThisTurn = v;
            },
            get gamblersResolveThisTurn(): number {
                return manager.gamblersResolveThisTurn;
            },
            set gamblersResolveThisTurn(v: number) {
                manager.gamblersResolveThisTurn = v;
            },
            skillCooldowns: this.skillCooldowns,
            lastActionResult: this.lastActionResult,
        };
    }

    private buildPlayerActionsDeps(): PlayerActionsDeps {
        return {
            player: this.player,
            log: this.log,
            loc: this.loc,
            rng: this.rng,
            emitPlayerHit: (damage) => this.playerHit.emit({ damage }),
            emitEnemyUpdate: (payload) => this.enemyUpdate.emit(payload),
        };
    }

    private buildMimeChaosDeps(): MimeChaosDeps {
        return {
            player: this.player,
            log: this.log,
            loc: this.loc,
            rng: this.rng,
            emitPlayerStatus: () => this.playerStatusChange.emit(),
        };
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
     * Mammon's "Greed Lord" relic theft. Delegates to
     * {@link MimeChaos.stealRandomRelic}.
     */
    private stealRandomRelic(state: BossPhaseState): void {
        stealRandomRelicFn(this.enemy, state, this.buildMimeChaosDeps());
    }

    private logDeath() {
        this.log.addMessage(narrate('death', this.loc.language), '#ff3333');
    }

    /**
     * Mime "Chaos Lord's Laughter" — delegates to
     * {@link MimeChaos.applyRandomMimeStatus}.
     */
    private applyRandomMimeStatus(
        state: BossPhaseState,
        cfg: {
            pool: Array<'bleed' | 'poison' | 'stun' | 'weaken' | 'armorBreak' | 'mark'>;
            amount: number;
            turns: number;
        }
    ): void {
        applyRandomMimeStatusFn(this.enemy, state, cfg, this.buildMimeChaosDeps());
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
}
