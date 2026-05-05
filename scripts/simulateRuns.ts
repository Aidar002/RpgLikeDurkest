/**
 * [FIX-14] Headless Monte-Carlo simulator for RpgLikeDurkest balance.
 *
 * Run with: `npm run sim`
 *
 * The goal of this simulator is NOT to be a 1:1 replica of the live game.
 * It is a statistical model that consumes the same balance constants
 * (GameConfig, RUPTURE_CONFIG, ADRENALINE_CONFIG, STUN_RESIST_CONFIG,
 * STRESS_BAND_CONFIG, RESOLVE_TEST_CONFIG, RELIC_CAP_CONFIG, LIGHT_CONFIG,
 * MAP_CONFIG, EXPEDITION_CONFIG) and the canonical boss roster (Bosses.ts /
 * Enemies.ts). It exists so `npm run sim` can give a quick read on
 * win-rate / death-cause distributions whenever balance numbers change.
 *
 * Architecture notes:
 *   * Combat is a simplified turn-based loop. Player and enemy alternate
 *     turns; the same Rupture / Adrenaline / Stun-resist / Bleed-cap rules
 *     from FIX-5 / FIX-6 / FIX-11 / FIX-1 apply.
 *   * Bosses use the BOSS_BLUEPRINT phase data to choose actions; on phase
 *     change we apply the documented "On phase start" effects.
 *   * The route picks Combat / Elite / Rest / Merchant / Boss rooms in a
 *     simplified pattern: every depth has a single Combat room that may
 *     instead become Rest/Merchant/Elite based on the AI heuristics in
 *     FIX-14. Bosses occur on multiples of MAP_CONFIG.bossEveryNDepths.
 */

import {
    ADRENALINE_CONFIG,
    COMBAT_CONFIG,
    EXPEDITION_CONFIG,
    LIGHT_CONFIG,
    MAP_CONFIG,
    PLAYER_CONFIG,
    RUPTURE_CONFIG,
    STRESS_BAND_CONFIG,
    STUN_RESIST_CONFIG,
} from '../src/data/GameConfig';
import { getBossForDepth, getEnemyForDepth } from '../src/data/Enemies';
import {
    BOSS_BLUEPRINT_BY_NAME,
    type BossBlueprint,
    type BossPhaseDef,
} from '../src/data/Bosses';

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) so runs are reproducible per seed.
// ---------------------------------------------------------------------------
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Simulation types
// ---------------------------------------------------------------------------
type DeathCause =
    | 'attrition'
    | 'boss'
    | 'elite'
    | 'bleed'
    | 'stress'
    | 'low_light';

interface SkillRecord {
    cleave: number;
    bleed_strike: number;
    rupture: number;
    adrenaline: number;
    crushing_blow: number;
    attack: number;
    guard: number;
    potion: number;
}

interface PostBossSnapshot {
    hp: number;
    light: number;
    stress: number;
    level: number;
}

interface RunResult {
    seed: number;
    winnerDepth: number;
    won: boolean;
    finalBossDefeated: boolean;
    deathCause: DeathCause | null;
    turns: number;
    skills: SkillRecord;
    snapshots: Map<number, PostBossSnapshot>;
    relics: string[];
}

// ---------------------------------------------------------------------------
// Lightweight Combat simulation
// ---------------------------------------------------------------------------

interface SimPlayer {
    hp: number;
    maxHp: number;
    attack: number;
    resolve: number;
    maxResolve: number;
    potions: number;
    light: number;
    stress: number;
    level: number;
    xp: number;
    gold: number;
    deathSaveConsumed: boolean;
    eliteKillsThisRun: number;
    afflictionActive: boolean;
}

interface SimEnemy {
    name: string;
    hp: number;
    maxHp: number;
    attack: number;
    profile: string;
    kind: 'normal' | 'elite' | 'boss';
    isBoss: boolean;
    isFinalBoss: boolean;
    bleedCap: number;
    bleedStacks: number;
    bleedTurns: number;
    blueprint: BossBlueprint | null;
    phaseIndex: number;
    actionIndex: number;
    stunned: number;
    block: number;
    extraAtk: number;
    exposeBonus: number;
    /** Null until the boss damages player. False mercy heal trigger. */
    damagedByPlayerThisTurn: boolean;
}

const MIN_DMG = COMBAT_CONFIG.minDamage;

function makePlayer(): SimPlayer {
    return {
        hp: PLAYER_CONFIG.hp,
        maxHp: PLAYER_CONFIG.maxHp,
        attack: PLAYER_CONFIG.attack,
        resolve: EXPEDITION_CONFIG.startingResolve,
        maxResolve: PLAYER_CONFIG.maxResolve,
        potions: EXPEDITION_CONFIG.startingPotions,
        light: EXPEDITION_CONFIG.startingLight,
        stress: 0,
        level: 1,
        xp: 0,
        gold: EXPEDITION_CONFIG.startingGold,
        deathSaveConsumed: false,
        eliteKillsThisRun: 0,
        afflictionActive: false,
    };
}

function makeEnemy(depth: number, kind: 'normal' | 'elite' | 'boss', r: () => number): SimEnemy {
    if (kind === 'boss') {
        const def = getBossForDepth(depth);
        if (!def) throw new Error(`No boss def for depth ${depth}`);
        const blueprint = BOSS_BLUEPRINT_BY_NAME[def.name] ?? null;
        return {
            name: def.name,
            hp: def.hp,
            maxHp: def.hp,
            attack: def.attack,
            profile: def.profile,
            kind: 'boss',
            isBoss: true,
            isFinalBoss: depth === MAP_CONFIG.finalDepth,
            bleedCap: blueprint?.bleedCap ?? 8,
            bleedStacks: 0,
            bleedTurns: 0,
            blueprint,
            phaseIndex: 0,
            actionIndex: 0,
            stunned: 0,
            block: 0,
            extraAtk: 0,
            exposeBonus: 0,
            damagedByPlayerThisTurn: false,
        };
    }
    void r;
    const def = getEnemyForDepth(depth);
    const eliteMult = kind === 'elite' ? 1.5 : 1;
    return {
        name: def.name,
        hp: Math.round(def.hp * eliteMult),
        maxHp: Math.round(def.hp * eliteMult),
        attack: kind === 'elite' ? def.attack + 1 : def.attack,
        profile: def.profile,
        kind,
        isBoss: false,
        isFinalBoss: false,
        bleedCap: 8,
        bleedStacks: 0,
        bleedTurns: 0,
        blueprint: null,
        phaseIndex: 0,
        actionIndex: 0,
        stunned: 0,
        block: 0,
        extraAtk: 0,
        exposeBonus: 0,
        damagedByPlayerThisTurn: false,
    };
}

function ruptureCapPercent(enemy: SimEnemy): number {
    if (enemy.profile === 'final_boss') return RUPTURE_CONFIG.capByKind.final_boss;
    if (enemy.kind === 'boss') return RUPTURE_CONFIG.capByKind.boss;
    if (enemy.kind === 'elite') return RUPTURE_CONFIG.capByKind.elite;
    return RUPTURE_CONFIG.capByKind.normal;
}

/**
 * Public for future stun-aware AI. Currently the simplified player AI
 * doesn't try to stun, so this is exported for visibility only.
 */
export function stunResistChance(enemy: SimEnemy): number {
    if (enemy.isBoss) {
        const override = STUN_RESIST_CONFIG.bossByName[enemy.name];
        if (typeof override === 'number') return override;
        return STUN_RESIST_CONFIG.boss;
    }
    if (enemy.kind === 'elite') return STUN_RESIST_CONFIG.elite;
    return STUN_RESIST_CONFIG.normal;
}

function applyBleed(enemy: SimEnemy, stacks: number, turns: number) {
    const cap = enemy.bleedCap;
    enemy.bleedStacks = Math.min(cap, enemy.bleedStacks + stacks);
    enemy.bleedTurns = Math.max(enemy.bleedTurns, turns);
}

function tickBleed(enemy: SimEnemy): number {
    if (enemy.bleedStacks <= 0 || enemy.bleedTurns <= 0) return 0;
    const dmg = enemy.bleedStacks;
    enemy.hp = Math.max(0, enemy.hp - dmg);
    enemy.bleedTurns--;
    if (enemy.bleedTurns <= 0) {
        enemy.bleedStacks = 0;
    }
    return dmg;
}

function applyStress(p: SimPlayer, amount: number): void {
    let delta = Math.max(0, amount);
    if (p.stress >= STRESS_BAND_CONFIG.strainedMin) {
        delta += STRESS_BAND_CONFIG.bandGainBonus;
    }
    p.stress = Math.min(100, Math.max(0, p.stress + delta));
}

function damageDealtMod(p: SimPlayer): number {
    let mod = 0;
    if (p.stress >= STRESS_BAND_CONFIG.breakingMin) {
        mod += STRESS_BAND_CONFIG.breakingOutgoingDamage;
    }
    if (p.afflictionActive) mod -= 1;
    return mod;
}

function maybeAdvancePhase(enemy: SimEnemy, p: SimPlayer): void {
    if (!enemy.blueprint) return;
    const phases: BossPhaseDef[] = enemy.blueprint.phases;
    const ratio = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 0;
    let target = enemy.phaseIndex;
    // Phases are listed in descending HP order; pick the deepest one whose
    // enterAtHpRatio is >= current ratio.
    for (let i = 0; i < phases.length; i++) {
        if (ratio <= phases[i].enterAtHpRatio) {
            target = i;
        }
    }
    if (target > enemy.phaseIndex) {
        const next = phases[target];
        const onEnter = next.onEnter;
        if (onEnter) {
            if (onEnter.atkBoost) enemy.attack += onEnter.atkBoost;
            if (onEnter.addStress) applyStress(p, onEnter.addStress);
            if (onEnter.drainLight) p.light = Math.max(0, p.light - onEnter.drainLight);
            if (typeof onEnter.capLight === 'number' && p.light > onEnter.capLight) {
                p.light = onEnter.capLight;
            }
        }
        enemy.phaseIndex = target;
        enemy.actionIndex = 0;
    }
}

function chooseSkill(
    p: SimPlayer,
    enemy: SimEnemy,
    cooldowns: Record<string, number>,
    adrenalineUsed: boolean,
    nextEnemyHeavy: boolean,
    record: SkillRecord
): { kind: 'attack' | 'guard' | 'potion' | 'skill'; skill?: keyof SkillRecord } {
    // Baseline AI from FIX-14 spec.
    if (p.hp / p.maxHp <= 0.35 && p.potions > 0) {
        record.potion++;
        return { kind: 'potion' };
    }
    if (nextEnemyHeavy && p.resolve < 3) {
        record.guard++;
        return { kind: 'guard' };
    }
    if (!adrenalineUsed && p.hp / p.maxHp <= 0.6 && p.resolve >= 2) {
        record.adrenaline++;
        return { kind: 'skill', skill: 'adrenaline' };
    }
    const ruptureReady = !cooldowns.rupture || cooldowns.rupture <= 0;
    const isBossOrElite = enemy.kind === 'boss' || enemy.kind === 'elite';
    if (isBossOrElite && p.resolve >= 3 && ruptureReady) {
        record.rupture++;
        return { kind: 'skill', skill: 'rupture' };
    }
    if (p.resolve >= 3) {
        record.crushing_blow++;
        return { kind: 'skill', skill: 'crushing_blow' };
    }
    // Against boss/elite with rupture cooldown still ticking, conserve resolve
    // for the next rupture instead of dumping it into Cleave.
    if (
        !isBossOrElite &&
        p.resolve >= 2 &&
        enemy.bleedStacks === 0 &&
        enemy.bleedTurns === 0 &&
        enemy.maxHp >= 12
    ) {
        record.bleed_strike++;
        return { kind: 'skill', skill: 'bleed_strike' };
    }
    if (p.resolve >= 2 && !isBossOrElite) {
        record.cleave++;
        return { kind: 'skill', skill: 'cleave' };
    }
    record.attack++;
    return { kind: 'attack' };
}

interface CombatOutcome {
    won: boolean;
    deathCause: DeathCause | null;
    turns: number;
    finalBoss: boolean;
}

function runCombat(p: SimPlayer, enemy: SimEnemy, r: () => number, record: SkillRecord): CombatOutcome {
    let turns = 0;
    const cooldowns: Record<string, number> = {};
    let adrenalineUsedThisCombat = false;

    // Special boss start effects (Maw, Lich, etc.) — minimal model
    if (enemy.name === 'Nameless Maw') {
        applyStress(p, 8);
    } else if (enemy.name === 'The Undying Wound') {
        applyStress(p, 8);
    }

    while (p.hp > 0 && enemy.hp > 0 && turns < 50) {
        turns++;
        // Phase advance (boss-only)
        maybeAdvancePhase(enemy, p);
        enemy.damagedByPlayerThisTurn = false;

        // Cooldown tick
        for (const k of Object.keys(cooldowns)) {
            if (cooldowns[k] > 0) cooldowns[k]--;
        }

        // Predict next boss action: heavy?
        let nextHeavy = false;
        if (enemy.blueprint) {
            const phase = enemy.blueprint.phases[enemy.phaseIndex];
            const action = phase.actions[enemy.actionIndex % phase.actions.length];
            nextHeavy = action.id === 'heavy' || (action.damageBonus ?? 0) >= 2;
        }

        // --- Player turn ---
        const decision = chooseSkill(p, enemy, cooldowns, adrenalineUsedThisCombat, nextHeavy, record);
        let blockNext = 0;
        let damage = 0;

        if (decision.kind === 'attack') {
            damage = Math.max(MIN_DMG, p.attack + damageDealtMod(p));
            // Mirror live game: basic attacks/guards refund resolve.
            p.resolve = Math.min(p.maxResolve, p.resolve + COMBAT_CONFIG.resolveFromAttack);
        } else if (decision.kind === 'guard') {
            blockNext = 4;
            p.resolve = Math.min(p.maxResolve, p.resolve + COMBAT_CONFIG.resolveFromGuard);
        } else if (decision.kind === 'potion' && p.potions > 0) {
            p.potions--;
            p.hp = Math.min(p.maxHp, p.hp + 8);
        } else if (decision.kind === 'skill') {
            switch (decision.skill) {
                case 'rupture': {
                    if (p.resolve >= 3) {
                        p.resolve -= 3;
                        const pct = ruptureCapPercent(enemy);
                        const percentDmg = Math.ceil(enemy.maxHp * pct);
                        damage = Math.max(p.attack, percentDmg) + damageDealtMod(p);
                        cooldowns.rupture = RUPTURE_CONFIG.cooldownTurns + 1;
                    }
                    break;
                }
                case 'cleave': {
                    if (p.resolve >= 2) {
                        p.resolve -= 2;
                        damage = Math.round(p.attack * 1.8) + 2 + damageDealtMod(p);
                    }
                    break;
                }
                case 'bleed_strike': {
                    if (p.resolve >= 2) {
                        p.resolve -= 2;
                        damage = Math.round(p.attack * 1.1) + damageDealtMod(p);
                        applyBleed(enemy, 2, 3);
                    }
                    break;
                }
                case 'crushing_blow': {
                    if (p.resolve >= 3) {
                        p.resolve -= 3;
                        damage = Math.round(p.attack * 2.4) + 3 + damageDealtMod(p);
                        p.hp = Math.max(0, p.hp - 3); // recoil
                    }
                    break;
                }
                case 'adrenaline': {
                    if (!adrenalineUsedThisCombat && p.resolve >= ADRENALINE_CONFIG.cost) {
                        adrenalineUsedThisCombat = true;
                        p.resolve -= ADRENALINE_CONFIG.cost;
                        p.hp = Math.min(p.maxHp, p.hp + ADRENALINE_CONFIG.heal);
                        p.resolve = Math.min(p.maxResolve, p.resolve + ADRENALINE_CONFIG.resolveGain);
                    }
                    break;
                }
            }
        }

        // Apply damage to enemy (respect block + expose bonus)
        if (damage > 0) {
            let realDmg = damage;
            if (enemy.exposeBonus > 0) {
                realDmg += enemy.exposeBonus;
                enemy.exposeBonus = 0;
            }
            if (enemy.block > 0) {
                const absorbed = Math.min(realDmg, enemy.block);
                enemy.block -= absorbed;
                realDmg -= absorbed;
            }
            enemy.hp = Math.max(0, enemy.hp - realDmg);
            enemy.damagedByPlayerThisTurn = realDmg > 0;
        }

        // Bleed tick
        const bleed = tickBleed(enemy);
        if (bleed > 0) {
            enemy.damagedByPlayerThisTurn = true;
        }

        if (enemy.hp <= 0) {
            // Player wins this fight
            const xp = enemy.kind === 'boss' ? 25 : enemy.kind === 'elite' ? 15 : 8;
            p.xp += xp;
            return { won: true, deathCause: null, turns, finalBoss: enemy.isFinalBoss };
        }

        // --- Enemy turn ---
        if (enemy.stunned > 0) {
            enemy.stunned--;
            continue;
        }
        if (enemy.blueprint) {
            const phase = enemy.blueprint.phases[enemy.phaseIndex];
            const action = phase.actions[enemy.actionIndex % phase.actions.length];
            enemy.actionIndex++;

            // Stress / light side-effects always apply.
            if (action.addStress) applyStress(p, action.addStress);
            if (action.drainLight) p.light = Math.max(0, p.light - action.drainLight);
            if (action.selfBlock) enemy.block += action.selfBlock;
            if (action.exposedExtraDamage) {
                enemy.exposeBonus = Math.max(enemy.exposeBonus, action.exposedExtraDamage);
            }
            if (action.selfAtkBoost) enemy.attack += action.selfAtkBoost;
            if (action.selfHealIfNoDamageTaken && !enemy.damagedByPlayerThisTurn) {
                enemy.hp = Math.min(enemy.maxHp, enemy.hp + action.selfHealIfNoDamageTaken);
            }
            if (action.selfHeal) {
                enemy.hp = Math.min(enemy.maxHp, enemy.hp + action.selfHeal);
            }

            // Damage actions.
            if (!action.noAttack) {
                let dmg = enemy.attack + (action.damageBonus ?? 0);
                if (blockNext > 0) {
                    dmg = Math.max(0, dmg - blockNext);
                    blockNext = 0;
                }
                p.hp = Math.max(0, p.hp - Math.max(MIN_DMG, dmg));
            }
        } else {
            // Generic enemy: simple attack pattern
            let dmg = enemy.attack;
            if (blockNext > 0) {
                dmg = Math.max(0, dmg - blockNext);
                blockNext = 0;
            }
            p.hp = Math.max(0, p.hp - Math.max(MIN_DMG, dmg));
        }

        // Stress overwhelm
        if (p.stress >= STRESS_BAND_CONFIG.overwhelmedMin) {
            // simplified: 70% affliction, 30% virtue per FIX-7 base
            if (r() < 0.7) {
                p.afflictionActive = true;
            }
            p.stress = 50;
        }
    }

    if (p.hp <= 0) {
        const cause: DeathCause = enemy.kind === 'boss'
            ? 'boss'
            : enemy.kind === 'elite'
                ? 'elite'
                : 'attrition';
        return { won: false, deathCause: cause, turns, finalBoss: enemy.isFinalBoss };
    }
    return { won: false, deathCause: 'attrition', turns, finalBoss: enemy.isFinalBoss };
}

// ---------------------------------------------------------------------------
// Run loop
// ---------------------------------------------------------------------------

function runOne(seed: number): RunResult {
    const r = rng(seed);
    const p = makePlayer();
    const skills: SkillRecord = {
        cleave: 0, bleed_strike: 0, rupture: 0, adrenaline: 0,
        crushing_blow: 0, attack: 0, guard: 0, potion: 0,
    };
    const snapshots = new Map<number, PostBossSnapshot>();
    let totalTurns = 0;
    let roomsVisitedForLight = 0;
    let lastDepthCleared = 0;
    let deathCause: DeathCause | null = null;
    let finalBossDefeated = false;

    for (let depth = 1; depth <= MAP_CONFIG.finalDepth; depth++) {
        // Light decay every 2 rooms
        roomsVisitedForLight++;
        if (roomsVisitedForLight % LIGHT_CONFIG.decayEveryNRooms === 0) {
            p.light = Math.max(0, p.light - 1);
        }
        if (p.light <= 0 && r() < 0.05) {
            deathCause = 'low_light';
            // Light alone doesn't kill; this branch never triggers
        }

        // Decide room kind
        const isBoss = depth % MAP_CONFIG.bossEveryNDepths === 0;
        let kind: 'normal' | 'elite' | 'boss';
        if (isBoss) kind = 'boss';
        else if (p.hp / p.maxHp > 0.5 && p.stress < 70 && r() < 0.2) kind = 'elite';
        else kind = 'normal';

        // Pre-fight Rest decision (simplified): if HP <= 50% or stress >= 70, heal a bit
        if (!isBoss && (p.hp / p.maxHp <= 0.5 || p.stress >= 70) && r() < 0.4) {
            p.hp = Math.min(p.maxHp, p.hp + 6);
            p.light = Math.min(EXPEDITION_CONFIG.maxLight, p.light + LIGHT_CONFIG.restLightGain);
            p.stress = Math.max(0, p.stress - 10);
            continue;
        }

        const enemy = makeEnemy(depth, kind, r);
        const outcome = runCombat(p, enemy, r, skills);
        totalTurns += outcome.turns;

        if (!outcome.won) {
            deathCause = outcome.deathCause;
            return {
                seed,
                winnerDepth: lastDepthCleared,
                won: false,
                finalBossDefeated: false,
                deathCause,
                turns: totalTurns,
                skills,
                snapshots,
                relics: [],
            };
        }
        lastDepthCleared = depth;
        if (outcome.finalBoss) {
            finalBossDefeated = true;
        }
        if (kind === 'elite') p.eliteKillsThisRun++;
        if (isBoss) {
            p.light = Math.min(EXPEDITION_CONFIG.maxLight, p.light + LIGHT_CONFIG.onBossKill);
            snapshots.set(depth, { hp: p.hp, light: p.light, stress: p.stress, level: p.level });
        }
        // Crude leveling
        while (p.xp >= 30 + p.level * 10 && p.level < 10) {
            p.xp -= 30 + p.level * 10;
            p.level++;
            p.maxHp += 4;
            p.hp += 4;
            if (p.level % 4 === 0) p.maxResolve = Math.min(5, p.maxResolve + 1);
        }
    }

    return {
        seed,
        winnerDepth: lastDepthCleared,
        won: finalBossDefeated,
        finalBossDefeated,
        deathCause,
        turns: totalTurns,
        skills,
        snapshots,
        relics: [],
    };
}

// ---------------------------------------------------------------------------
// Aggregate stats
// ---------------------------------------------------------------------------

function median(xs: number[]): number {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function aggregate(results: RunResult[]) {
    const wins = results.filter((r) => r.won).length;
    const winRate = wins / results.length;
    const depths = results.map((r) => r.winnerDepth);
    const avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;
    const medDepth = median(depths);

    const causes: Record<string, number> = {};
    for (const r of results) {
        if (!r.won && r.deathCause) {
            causes[r.deathCause] = (causes[r.deathCause] ?? 0) + 1;
        }
    }

    const skillTotals: SkillRecord = {
        cleave: 0, bleed_strike: 0, rupture: 0, adrenaline: 0,
        crushing_blow: 0, attack: 0, guard: 0, potion: 0,
    };
    for (const r of results) {
        for (const k of Object.keys(skillTotals) as (keyof SkillRecord)[]) {
            skillTotals[k] += r.skills[k];
        }
    }

    const turns = results.map((r) => r.turns);
    const avgTurns = turns.reduce((a, b) => a + b, 0) / turns.length;

    const bossDepths = [5, 10, 15, 20, 25];
    const bossSnapshots: Record<number, { hp: number; light: number; stress: number; level: number; n: number }> = {};
    for (const d of bossDepths) {
        bossSnapshots[d] = { hp: 0, light: 0, stress: 0, level: 0, n: 0 };
    }
    for (const r of results) {
        for (const d of bossDepths) {
            const s = r.snapshots.get(d);
            if (s) {
                const acc = bossSnapshots[d];
                acc.hp += s.hp;
                acc.light += s.light;
                acc.stress += s.stress;
                acc.level += s.level;
                acc.n++;
            }
        }
    }

    return {
        runs: results.length,
        winRate,
        avgDepth,
        medDepth,
        causes,
        skillTotals,
        avgTurns,
        bossSnapshots,
    };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const N = parseInt(process.argv[2] ?? '1000', 10);
const baseSeed = parseInt(process.argv[3] ?? '1', 10);

const results: RunResult[] = [];
for (let i = 0; i < N; i++) {
    results.push(runOne(baseSeed + i));
}

const agg = aggregate(results);

console.log('================================================================');
console.log(`[FIX-14] BALANCE PATCH v0.2 simulator: ${N} runs, base seed=${baseSeed}`);
console.log('================================================================');
console.log(`Win rate (final boss defeated): ${(agg.winRate * 100).toFixed(2)}%`);
console.log(`Avg depth reached: ${agg.avgDepth.toFixed(2)}, median: ${agg.medDepth}`);
console.log(`Avg turns / run: ${agg.avgTurns.toFixed(1)}`);
console.log('Death causes:');
for (const [k, v] of Object.entries(agg.causes)) {
    console.log(`  ${k.padEnd(12)} ${v} (${((v / N) * 100).toFixed(1)}%)`);
}
console.log('Skill usage (totals across runs):');
for (const [k, v] of Object.entries(agg.skillTotals)) {
    console.log(`  ${k.padEnd(14)} ${v}`);
}
console.log('Per-boss snapshot (avg HP/Light/Stress/Level after kill):');
for (const [d, snap] of Object.entries(agg.bossSnapshots)) {
    if (snap.n === 0) {
        console.log(`  depth ${d.padEnd(2)}  (no kills)`);
        continue;
    }
    console.log(
        `  depth ${d.padEnd(2)}  HP=${(snap.hp / snap.n).toFixed(1)}  Light=${(snap.light / snap.n).toFixed(1)}  Stress=${(snap.stress / snap.n).toFixed(1)}  Level=${(snap.level / snap.n).toFixed(2)}  n=${snap.n}`
    );
}
console.log('================================================================');

const json = {
    runs: agg.runs,
    winRate: agg.winRate,
    avgDepth: agg.avgDepth,
    medDepth: agg.medDepth,
    avgTurns: agg.avgTurns,
    deathCauses: agg.causes,
    skillTotals: agg.skillTotals,
    bossSnapshots: Object.fromEntries(
        Object.entries(agg.bossSnapshots).map(([d, s]) => [
            d,
            s.n === 0 ? null : {
                avgHp: s.hp / s.n,
                avgLight: s.light / s.n,
                avgStress: s.stress / s.n,
                avgLevel: s.level / s.n,
                n: s.n,
            },
        ])
    ),
};
console.log('JSON_OUT_BEGIN');
console.log(JSON.stringify(json, null, 2));
console.log('JSON_OUT_END');
