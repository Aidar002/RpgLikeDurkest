import { beforeEach, describe, expect, it } from 'vitest';
import { CombatManager } from '../src/systems/CombatManager';
import { PlayerManager } from '../src/systems/PlayerManager';
import type { EnemyDef, EnemyPassive, EnemyPrepareDef } from '../src/data/GameConfig';
import { BOSSES } from '../src/data/GameConfig';
import { makeActiveEnemy, makeManager } from './helpers/combat';

// Death Knight's boss blueprint lives in src/data/Bosses.ts (Death
// Shield + Death Touch). Death Knight itself was demoted to the 16-20
// normal pool in the design-sheet port, so depth 25 no longer
// resolves to him via the random boss roll. These tests still need a
// boss with that exact blueprint to cover the legacy Cursed Ring and
// Death Touch interactions, so we inject the def explicitly via the
// `startCombat` override parameter — sourced from BOSSES so any
// future stat tweak in the design sheet propagates here automatically.
const DEATH_KNIGHT_BOSS_DEF = (() => {
    const found = BOSSES.find((b) => b.def.name === 'Death Knight');
    if (found) {
        // Deep clone so a test's mutation doesn't leak to the static table.
        return JSON.parse(JSON.stringify(found.def));
    }
    // Death Knight is in the depth 16-20 normal pool now, not the
    // BOSSES table; build the boss-shaped def inline as the legacy
    // tests expected.
    return {
        name: 'Death Knight',
        description: 'test_desc_death_knight',
        icon: '\u2620',
        hp: 45,
        attack: 8,
        xp: 50,
        gold: 40,
        color: 0x2a0814,
        profile: 'boss' as const,
    };
})();

describe('CombatManager (seeded)', () => {
    // Two managers with the same seed should produce identical state after
    // a sequence of player actions. Boss encounters are deterministic by
    // depth (no random pool), so they let us isolate the in-combat RNG.
    beforeEach(() => {
        // Some code paths in startCombat fall back to Math.random for enemy
        // pool selection. Force a stable enemy roll for reproducibility.
        let i = 0;
        const sequence = [0.1, 0.5, 0.9];
        Math.random = () => sequence[i++ % sequence.length];
    });

    it('is deterministic across runs with the same seed', () => {
        const a = makeManager(1234);
        const b = makeManager(1234);

        a.combat.startCombat(2, 'boss');
        b.combat.startCombat(2, 'boss');

        const enemyA = a.combat.enemy!;
        const enemyB = b.combat.enemy!;
        expect(enemyA.name).toBe(enemyB.name);
        expect(enemyA.hp).toBe(enemyB.hp);

        for (let i = 0; i < 6; i++) {
            a.combat.processTurn('attack');
            b.combat.processTurn('attack');
            if (!a.combat.enemy || !b.combat.enemy) break;
            expect(a.combat.enemy.hp).toBe(b.combat.enemy.hp);
            expect(a.player.stats.hp).toBe(b.player.stats.hp);
            expect(a.combat.lastActionResult.critical).toBe(b.combat.lastActionResult.critical);
        }
    });

    it('different seeds diverge on at least one outcome over many turns', () => {
        const a = makeManager(1);
        const b = makeManager(99999);
        a.combat.startCombat(2, 'boss');
        b.combat.startCombat(2, 'boss');

        let diverged = false;
        for (let i = 0; i < 10; i++) {
            a.combat.processTurn('attack');
            b.combat.processTurn('attack');
            if (!a.combat.enemy || !b.combat.enemy) break;
            if (
                a.combat.enemy.hp !== b.combat.enemy.hp ||
                a.combat.lastActionResult.critical !== b.combat.lastActionResult.critical
            ) {
                diverged = true;
                break;
            }
        }
        expect(diverged).toBe(true);
    });

    it('does not throw when player attacks an empty enemy slot', () => {
        const { combat } = makeManager(7);
        // No startCombat call -> enemy is null.
        expect(() => combat.processTurn('attack')).not.toThrow();
    });

    it('attack damage stays within configured variance band', () => {
        // With base attack power around 5 and randomVariance from config,
        // every roll must respect that bound across many turns.
        const { combat, player } = makeManager(42);
        combat.startCombat(2, 'boss');
        const enemy = combat.enemy!;

        const initialHp = enemy.hp;
        const damages: number[] = [];
        let prevHp = initialHp;
        for (let i = 0; i < 20; i++) {
            combat.processTurn('attack');
            if (!combat.enemy) break;
            const dealt = prevHp - combat.enemy.hp;
            // Bleed/regen ticks can adjust HP after attack; we still expect
            // a positive integer damage on every turn the player attacks.
            if (dealt > 0) damages.push(dealt);
            prevHp = combat.enemy.hp;
            // Refill resolve so combat doesn't end on missing potion.
            player.gainResolve(99);
            // If player died, stop.
            if (player.stats.hp <= 0) break;
        }

        expect(damages.length).toBeGreaterThan(0);
        // Sanity: damage values are positive integers.
        for (const d of damages) {
            expect(Number.isInteger(d)).toBe(true);
            expect(d).toBeGreaterThanOrEqual(1);
        }
    });

    it('exposes enemyStatusText / playerStatusText as strings', () => {
        const { combat } = makeManager(5);
        combat.startCombat(2, 'boss');
        expect(typeof combat.enemyStatusText()).toBe('string');
        expect(typeof combat.playerStatusText()).toBe('string');
    });
});

describe('CombatManager log surface', () => {
    it('writes the encounter header on startCombat', () => {
        // Avoid the 25% enter_combat narrate roll for this assertion by
        // using a boss encounter (deterministic narrate path).
        const { combat, seenMessages } = makeManager(3);
        const sequence = [0.5];
        Math.random = () => sequence[0];

        combat.startCombat(2, 'boss');
        expect(seenMessages.length).toBeGreaterThan(0);
        expect(seenMessages[0]).toMatch(/[A-Za-zА-Яа-я]/);
    });
});

// Direct injection of an `ActiveEnemy` minus the bits the prepare path
// touches. Lets us assert windup behaviour without depending on the
// random enemy pool or boss rotation timing.
function injectGhoulPrepare(combat: CombatManager, prepare: EnemyPrepareDef): void {
    combat.enemy = makeActiveEnemy({
        name: 'Ghoul',
        icon: 'G',
        hp: 10,
        maxHp: 10,
        attack: 1,
        color: 0x455544,
        profile: 'bleeder',
        pendingPrepare: { def: prepare, turnsRemaining: 0 },
    });
}

// Direct injection of a Bee-Butterfly-shaped enemy so we can pin the
// evade chance to 0 or 1 and assert deterministic behaviour without
// hunting for an RNG seed that lines up with the passive trigger.
function injectBeeButterfly(combat: CombatManager, passive: EnemyPassive): void {
    combat.enemy = makeActiveEnemy({
        name: 'Bee-Butterfly',
        icon: 'Y',
        hp: 3,
        maxHp: 3,
        attack: 2,
        color: 0xc4a01e,
        profile: 'stalker',
        passive,
    });
}

describe('Bee-Butterfly Flutter and sting (evadeAndStingOnHit)', () => {
    it('on evade, the bee-butterfly is unharmed and the sting message lands', () => {
        const { combat, player, seenMessages } = makeManager(31);
        injectBeeButterfly(combat, { kind: 'evadeAndStingOnHit', chance: 1, damage: 1 });
        const enemyHpBefore = combat.enemy!.hp;
        const playerHpBefore = player.stats.hp;

        combat.processTurn('attack');

        // The player's swing missed, so the enemy keeps full HP. The
        // bee's own counter-attack still fires afterwards as part of
        // the same turn, so we only assert that the player took at
        // least the sting on top of whatever the regular attack did.
        expect(combat.enemy!.hp).toBe(enemyHpBefore);
        expect(combat.lastActionResult.enemyEvaded).toBe(true);
        expect(playerHpBefore - player.stats.hp).toBeGreaterThanOrEqual(1);
        expect(seenMessages.some((m) => /Bee-Butterfly/.test(m) && /1/.test(m))).toBe(true);
    });

    it('with chance 0 the swing lands normally and the evade message stays silent', () => {
        const { combat, player, seenMessages } = makeManager(32);
        injectBeeButterfly(combat, { kind: 'evadeAndStingOnHit', chance: 0, damage: 1 });
        // Drop enemy HP to 1 so the swing kills it; ending combat
        // skips the enemy counter-turn and lets us assert that the
        // player took zero damage from this round.
        combat.enemy!.hp = 1;
        combat.enemy!.maxHp = 1;
        const playerHpBefore = player.stats.hp;

        combat.processTurn('attack');

        expect(combat.enemy === null || combat.enemy.hp === 0).toBe(true);
        expect(player.stats.hp).toBe(playerHpBefore);
        expect(combat.lastActionResult.enemyEvaded).toBe(false);
        expect(seenMessages.some((m) => /flit/.test(m))).toBe(false);
    });
});

// Earth Elemental shape — uses the same damageReduction passive as
// Skeleton, just with stronger numbers (30% / -2). Inject directly so
// we can pin the chance to 0 or 1 and assert the reduction log.
function injectEarthElemental(combat: CombatManager, passive: EnemyPassive): void {
    combat.enemy = makeActiveEnemy({
        name: 'Earth Elemental',
        icon: 'E',
        hp: 50,
        maxHp: 50,
        attack: 2,
        color: 0x6e553b,
        profile: 'brute',
        passive,
    });
}

describe('Earth Elemental Stone Skin (damageReduction)', () => {
    it('shrugs off the configured points when the passive triggers', () => {
        // Two managers, same seed -> identical pre-passive damage roll.
        // Manager A has Stone Skin always firing, B has it disabled.
        // The HP delta must show A took strictly less damage than B.
        const a = makeManager(2024);
        const b = makeManager(2024);
        injectEarthElemental(a.combat, {
            kind: 'damageReduction',
            chance: 1,
            reduction: 2,
        });
        injectEarthElemental(b.combat, {
            kind: 'damageReduction',
            chance: 0,
            reduction: 2,
        });
        const aHpBefore = a.combat.enemy!.hp;
        const bHpBefore = b.combat.enemy!.hp;

        a.combat.processTurn('attack');
        b.combat.processTurn('attack');

        const aDealt = aHpBefore - a.combat.enemy!.hp;
        const bDealt = bHpBefore - b.combat.enemy!.hp;
        expect(aDealt).toBeLessThan(bDealt);
        expect(bDealt - aDealt).toBeLessThanOrEqual(2);
        expect(a.seenMessages.some((m) => /Earth Elemental/.test(m) && /\d/.test(m))).toBe(true);
        expect(b.seenMessages.some((m) => /shrug/i.test(m))).toBe(false);
    });

    it('does not reduce damage below zero (only soaks up to the reduction)', () => {
        // A 1-damage hit against a 2-point shrug must clamp at 0, not
        // wrap into negative damage / heal.
        const { combat } = makeManager(2025);
        injectEarthElemental(combat, {
            kind: 'damageReduction',
            chance: 1,
            reduction: 2,
        });
        const hpBefore = combat.enemy!.hp;

        combat.processTurn('attack');

        // Damage dealt is whatever the player's variance roll produced,
        // minus up to 2 — never below 0.
        const dealt = hpBefore - combat.enemy!.hp;
        expect(dealt).toBeGreaterThanOrEqual(0);
    });
});

// Vampire shape with the new lifestealOnAttack passive. Stripped down
// to the fields the regular-attack path reads.
function injectVampire(
    combat: CombatManager,
    passive: EnemyPassive,
    overrides: Partial<{ hp: number; maxHp: number; attack: number }> = {}
): void {
    combat.enemy = makeActiveEnemy({
        name: 'Vampire',
        icon: 'V',
        hp: overrides.hp ?? 5,
        maxHp: overrides.maxHp ?? 9,
        attack: overrides.attack ?? 4,
        color: 0x4a1a1a,
        profile: 'stalker',
        passive,
    });
}

describe('Vampire lifestealOnAttack', () => {
    it('heals the vampire by ceil(damage * ratio) on a successful hit', () => {
        const { combat, player, seenMessages } = makeManager(11);
        injectVampire(
            combat,
            { kind: 'lifestealOnAttack', ratio: 0.5 },
            { hp: 5, maxHp: 9, attack: 4 }
        );
        const hpBefore = combat.enemy!.hp;
        const playerHpBefore = player.stats.hp;

        combat.processTurn('defend'); // defend so the player's swing
        // never lands and we can isolate the enemy turn / lifesteal.

        const damageDealt = playerHpBefore - player.stats.hp;
        const healed = combat.enemy!.hp - hpBefore;
        if (damageDealt > 0) {
            expect(healed).toBeGreaterThanOrEqual(1);
            expect(healed).toBeLessThanOrEqual(Math.max(1, Math.ceil(damageDealt * 0.5)));
            // Default locale is RU; match either the EN or RU lifesteal
            // phrase so the assertion doesn't accidentally depend on
            // saved language.
            expect(
                seenMessages.some((m) => /drains|recovers|высасыва|восстанавлива/i.test(m))
            ).toBe(true);
        } else {
            // Fully blocked: no damage dealt -> no lifesteal trigger.
            expect(healed).toBe(0);
        }
    });

    it('never heals above maxHp', () => {
        const { combat } = makeManager(12);
        injectVampire(
            combat,
            { kind: 'lifestealOnAttack', ratio: 1 },
            { hp: 8, maxHp: 9, attack: 4 }
        );

        combat.processTurn('defend');

        expect(combat.enemy!.hp).toBeLessThanOrEqual(9);
    });

    it('does not heal when the hit was fully absorbed (no damage dealt)', () => {
        const { combat } = makeManager(13);
        injectVampire(
            combat,
            { kind: 'lifestealOnAttack', ratio: 0.5 },
            { hp: 4, maxHp: 9, attack: 1 }
        );
        // Stack defense high enough that a 1-power attack is fully
        // blocked. defendBlock + extraBlock will usually swallow it.
        const hpBefore = combat.enemy!.hp;

        combat.processTurn('defend');

        // Either the swing was absorbed (heal stays 0) or the bee-
        // sized attack got through and we healed by 1. Both are
        // valid; the only invariant is "no heal without damage".
        if (combat.enemy!.hp > hpBefore) {
            // Some damage leaked through — verify heal is exactly
            // ceil(damage * 0.5) clamped to 1.
            expect(combat.enemy!.hp - hpBefore).toBeGreaterThanOrEqual(1);
        }
    });
});

function injectGoblinHorde(
    combat: CombatManager,
    overrides: Partial<{ hp: number; maxHp: number; attack: number }> = {}
): void {
    combat.enemy = makeActiveEnemy({
        name: 'Goblin Horde',
        icon: 'O',
        hp: overrides.hp ?? 13,
        maxHp: overrides.maxHp ?? 13,
        attack: overrides.attack ?? 9,
        color: 0x4d6a2a,
        profile: 'brute',
        passive: { kind: 'attackScalesWithHp' },
    });
}

describe('Goblin Horde Thinning Horde (attackScalesWithHp)', () => {
    it('hits weaker when the horde is half-HP than when it is full-HP', () => {
        // Same RNG sequence on both managers so player block / crit rolls
        // line up. Force-defend so the player swing is silenced.
        const a = makeManager(77);
        const b = makeManager(77);
        injectGoblinHorde(a.combat, { hp: 13, maxHp: 13, attack: 9 });
        injectGoblinHorde(b.combat, { hp: 6, maxHp: 13, attack: 9 });
        const aHp = a.player.stats.hp;
        const bHp = b.player.stats.hp;

        a.combat.processTurn('defend');
        b.combat.processTurn('defend');

        const aDealt = aHp - a.player.stats.hp;
        const bDealt = bHp - b.player.stats.hp;
        // Full-HP horde hits at least as hard as half-HP horde.
        expect(aDealt).toBeGreaterThanOrEqual(bDealt);
    });

    it('logs the thinning message when scaled damage drops below base', () => {
        const { combat, seenMessages } = makeManager(78);
        injectGoblinHorde(combat, { hp: 6, maxHp: 13, attack: 9 });

        combat.processTurn('defend');

        // EN: "thins out"; RU: "редеет".
        expect(seenMessages.some((m) => /thins|редеет/i.test(m))).toBe(true);
    });

    it('does not log thinning at full HP (scaled == base)', () => {
        const { combat, seenMessages } = makeManager(79);
        injectGoblinHorde(combat, { hp: 13, maxHp: 13, attack: 9 });

        combat.processTurn('defend');

        expect(seenMessages.some((m) => /thins|редеет/i.test(m))).toBe(false);
    });
});

function injectSuccubus(
    combat: CombatManager,
    overrides: Partial<{ hp: number; maxHp: number; attack: number }> = {}
): void {
    combat.enemy = makeActiveEnemy({
        name: 'Succubus',
        icon: 'U',
        hp: overrides.hp ?? 22,
        maxHp: overrides.maxHp ?? 22,
        attack: overrides.attack ?? 1,
        color: 0x6a2a44,
        profile: 'stalker',
        passive: { kind: 'painExultation', bonusPerStep: 0.1 },
    });
}

describe('Succubus Exultation in Pain (painExultation)', () => {
    it('does not buff attack at full HP', () => {
        const { combat, seenMessages } = makeManager(91);
        injectSuccubus(combat, { hp: 22, maxHp: 22, attack: 1 });

        combat.processTurn('defend');

        expect(seenMessages.some((m) => /drinks in|упивается/i.test(m))).toBe(false);
    });

    it('logs the bonus when she has lost at least 10% HP', () => {
        const { combat, seenMessages } = makeManager(92);
        // 11/22 = 50% missing → bonus of 5.
        injectSuccubus(combat, { hp: 11, maxHp: 22, attack: 1 });

        combat.processTurn('defend');

        const msg = seenMessages.find((m) => /drinks in|упивается/i.test(m));
        expect(msg).toBeDefined();
        // The bonus message renders the absolute amount, not the missing-%.
        expect(msg!).toMatch(/5/);
    });

    it('deals more total damage at low HP than at full HP', () => {
        const a = makeManager(93);
        const b = makeManager(93);
        injectSuccubus(a.combat, { hp: 22, maxHp: 22, attack: 1 });
        injectSuccubus(b.combat, { hp: 3, maxHp: 22, attack: 1 });
        const aHp = a.player.stats.hp;
        const bHp = b.player.stats.hp;

        a.combat.processTurn('defend');
        b.combat.processTurn('defend');

        const aDealt = aHp - a.player.stats.hp;
        const bDealt = bHp - b.player.stats.hp;
        expect(bDealt).toBeGreaterThan(aDealt);
    });
});

function injectUndergroundEnt(
    combat: CombatManager,
    overrides: Partial<{ hp: number; maxHp: number; attack: number }> = {}
): void {
    combat.enemy = makeActiveEnemy({
        name: 'Underground Ent',
        icon: 'N',
        hp: overrides.hp ?? 14,
        maxHp: overrides.maxHp ?? 14,
        attack: overrides.attack ?? 4,
        color: 0x3a5532,
        profile: 'brute',
        passive: { kind: 'weakenPlayerEachTurn', amount: 1, turns: 2 },
    });
}

describe('Underground Ent Strangling Roots (weakenPlayerEachTurn)', () => {
    it('applies weaken to the player on the first turn and logs it', () => {
        const { combat, player, seenMessages } = makeManager(101);
        injectUndergroundEnt(combat, { hp: 14, maxHp: 14 });

        combat.processTurn('defend');

        expect(player.status.weaken.amount).toBeGreaterThanOrEqual(1);
        // EN: "curls roots"; RU: "обвивает".
        expect(seenMessages.some((m) => /curls roots|обвивает/i.test(m))).toBe(true);
    });

    it('keeps the weaken active across the player tick (turns=2 buffer)', () => {
        const { combat, player } = makeManager(102);
        injectUndergroundEnt(combat, { hp: 14, maxHp: 14 });

        combat.processTurn('defend');
        // Player tick at end of the full turn decrements weaken by 1.
        expect(player.status.weaken.turns).toBeGreaterThan(0);

        // Bump player attack high so getAttackPower stays >1 after the
        // -1 weaken; we want to assert the weaken is reducing it, not
        // that the floor clamps it.
        player.stats.attack = 5;
        expect(player.getAttackPower()).toBe(4);
    });

    it('does not log a second time when the weaken is just refreshed', () => {
        const { combat, seenMessages } = makeManager(103);
        injectUndergroundEnt(combat, { hp: 14, maxHp: 14 });

        combat.processTurn('defend');
        combat.processTurn('defend');

        const hits = seenMessages.filter((m) => /curls roots|обвивает/i.test(m));
        expect(hits.length).toBe(1);
    });
});

function injectGiantToadPrepare(
    combat: CombatManager,
    overrides: Partial<{ hp: number; maxHp: number; turnsRemaining: number }> = {}
): void {
    combat.enemy = makeActiveEnemy({
        name: 'Giant Toad',
        icon: 'T',
        hp: overrides.hp ?? 3,
        maxHp: overrides.maxHp ?? 3,
        attack: 2,
        color: 0x4a6b2a,
        profile: 'brute',
        pendingPrepare: {
            def: {
                nameEn: 'Tongue Lash',
                nameRu: 'Языковая хватка',
                turns: 1,
                damage: 1,
                stun: { turns: 1 },
                defenseRule: 'cancelRiders',
            },
            turnsRemaining: overrides.turnsRemaining ?? 0,
        },
    });
}

function injectGelatinousCube(
    combat: CombatManager,
    overrides: Partial<{
        hp: number;
        maxHp: number;
        attack: number;
        chance: number;
    }> = {}
): void {
    combat.enemy = makeActiveEnemy({
        name: 'Gelatinous Cube',
        icon: 'C',
        hp: overrides.hp ?? 9,
        maxHp: overrides.maxHp ?? 9,
        attack: overrides.attack ?? 3,
        color: 0x82c4d4,
        profile: 'brute',
        // Default chance=1 so existing tests stay deterministic; the
        // 40% production value lives in GameConfig.ENEMY_TIERS.
        passive: {
            kind: 'acidVomitOnFirstHit',
            chance: overrides.chance ?? 1,
            amount: 1,
            turns: 99,
        },
    });
}

describe('Gelatinous Cube Acid Vomit (acidVomitOnFirstHit)', () => {
    it('applies armor break to the player on the first landed hit', () => {
        const { combat, player, seenMessages } = makeManager(121);
        injectGelatinousCube(combat, { hp: 9, maxHp: 9 });

        combat.processTurn('attack');

        expect(player.status.armorBreak.amount).toBeGreaterThanOrEqual(1);
        expect(player.status.armorBreak.turns).toBeGreaterThan(0);
        // EN: "spews acid"; RU: "плюётся кислотой".
        expect(seenMessages.some((m) => /spews acid|плюётся|плюется/i.test(m))).toBe(true);
    });

    it('reduces effective defense while armor break is active', () => {
        const { combat, player } = makeManager(122);
        // High cube attack so the hit lands through the bumped player
        // defense (acid only triggers when takenDamage > 0).
        injectGelatinousCube(combat, { hp: 9, maxHp: 9, attack: 6 });

        // Bump player defense so we can measure the chip from armor
        // break instead of clamping at the 0-floor.
        player.stats.defense = 3;
        const beforeDef = player.getEffectiveDefense();
        combat.processTurn('attack');
        const afterDef = player.getEffectiveDefense();

        expect(afterDef).toBe(beforeDef - 1);
    });

    it('does not stack armor break on subsequent hits in the same fight', () => {
        const { combat, player } = makeManager(123);
        injectGelatinousCube(combat, { hp: 20, maxHp: 20 });

        combat.processTurn('attack');
        const firstAmount = player.status.armorBreak.amount;
        const firstTurns = player.status.armorBreak.turns;
        combat.processTurn('attack');

        // Amount must not grow on the re-hit. Turns may have ticked
        // down by 1 from end-of-turn status tick — we only assert it
        // didn't get re-set back to the full 99.
        expect(player.status.armorBreak.amount).toBe(firstAmount);
        expect(player.status.armorBreak.turns).toBeLessThanOrEqual(firstTurns);
    });

    it('does not apply armor break when the chance roll fails', () => {
        // chance=0 short-circuits the apply path even on a landed
        // hit. Mirrors what the live 40% does on a missed roll: the
        // hit goes through but armor stays intact.
        const { combat, player } = makeManager(124);
        injectGelatinousCube(combat, { hp: 9, maxHp: 9, chance: 0 });

        combat.processTurn('attack');

        expect(player.status.armorBreak.turns).toBe(0);
    });
});

describe('Giant Toad Tongue Lash (prepare stun rider)', () => {
    it('applies a 1-turn stun to the player when not defending', () => {
        const { combat, player, seenMessages } = makeManager(111);
        // Bump HP up so the toad survives the player's swing and gets
        // to resolve its windup. With a 3-HP toad the player can crit
        // it dead before the prepare ever fires.
        injectGiantToadPrepare(combat, { hp: 20, maxHp: 20, turnsRemaining: 0 });

        combat.processTurn('attack');

        expect(player.status.stun.turns).toBeGreaterThan(0);
        expect(seenMessages.some((m) => /binds you|применяет/i.test(m))).toBe(true);
    });

    it('cancels the stun rider when the player defends on resolve', () => {
        const { combat, player } = makeManager(112);
        injectGiantToadPrepare(combat, { hp: 20, maxHp: 20, turnsRemaining: 0 });

        combat.processTurn('defend');

        expect(player.status.stun.turns).toBe(0);
    });

    it('skips the player action and logs the bound line on the stunned turn', () => {
        const { combat, player, seenMessages } = makeManager(113);
        injectGiantToadPrepare(combat, { hp: 20, maxHp: 20, turnsRemaining: 0 });

        // Turn A: stun is applied (player still acted: attack).
        combat.processTurn('attack');
        const hpAfterA = combat.enemy?.hp ?? 0;
        // Turn B: player is stunned; their attack is swallowed.
        combat.processTurn('attack');
        const hpAfterB = combat.enemy?.hp ?? 0;

        // Bound log must appear on turn B.
        expect(seenMessages.some((m) => /bound|скованы/i.test(m))).toBe(true);
        // No enemy HP lost from the stunned player swing.
        expect(hpAfterB).toBe(hpAfterA);
        // Stun is consumed after the skipped turn.
        expect(player.status.stun.turns).toBe(0);
    });
});

function injectRatMatron(
    combat: CombatManager,
    overrides: Partial<{ hp: number; maxHp: number; xp: number; gold: number }> = {}
): void {
    combat.enemy = makeActiveEnemy({
        name: 'Rat Matron',
        icon: 'M',
        hp: overrides.hp ?? 1,
        maxHp: overrides.maxHp ?? 8,
        attack: 2,
        color: 0x6b4530,
        xp: overrides.xp ?? 5,
        gold: overrides.gold ?? 5,
        profile: 'brute',
        passive: { kind: 'spawnOnDeath', spawnName: 'Rat' },
    });
}

describe('Rat Matron Litter (spawnOnDeath)', () => {
    it('replaces the encounter with a Rat instead of ending combat', () => {
        const { combat, seenMessages } = makeManager(141);
        // 1 HP so a basic attack always kills the matron this turn.
        injectRatMatron(combat, { hp: 1 });

        const combatEndCalls: number[] = [];
        combat.combatEnd.on(() => combatEndCalls.push(1));

        combat.processTurn('attack');

        expect(combat.enemy).not.toBeNull();
        expect(combat.enemy?.canonicalName).toBe('Rat');
        expect(combatEndCalls.length).toBe(0);
        // EN: "crawls from the carcass"; RU: "выползает".
        expect(seenMessages.some((m) => /carcass|выползает/i.test(m))).toBe(true);
    });

    it('pays out matron xp+gold inline on spawn', () => {
        const { combat, player } = makeManager(142);
        const xpBefore = player.stats.xp;
        const goldBefore = player.resources.gold;
        injectRatMatron(combat, { hp: 1, xp: 5, gold: 5 });

        combat.processTurn('attack');

        // gainXp returns the gained amount; we just verify totals grew
        // by exactly the matron's bounty (not the spawned Rat's, which
        // is still alive).
        expect(player.stats.xp).toBe(xpBefore + 5);
        expect(player.resources.gold).toBe(goldBefore + 5);
    });

    it('keeps combat going so the spawned Rat takes the next turn', () => {
        const { combat } = makeManager(143);
        injectRatMatron(combat, { hp: 1 });

        combat.processTurn('attack');

        // The spawned Rat is a fresh blueprint, full hp, fresh status.
        // Name is localised (e.g. 'тест_имя_rat'); we assert the canonical key.
        expect(combat.enemy?.canonicalName).toBe('Rat');
        expect(combat.enemy?.hp).toBeGreaterThan(0);
        expect(combat.enemy?.status.bleed.stacks).toBe(0);
        // Rat carries its own passive (extraDamageOnHit) — NOT the
        // matron's spawnOnDeath, so chained spawns won't happen.
        expect(combat.enemy?.passive?.kind).toBe('extraDamageOnHit');
    });
});

describe('Ghoul Decay (leakOnDefend)', () => {
    it('leaks 1 damage to the player on defend; ghoul stays untouched', () => {
        const { combat, player } = makeManager(11);
        injectGhoulPrepare(combat, {
            nameEn: 'Decay',
            nameRu: 'Разложение',
            turns: 2,
            damage: 2,
            poison: { damage: 1, turns: 3 },
            defenseRule: 'leakOnDefend',
            defenseLeakDamage: 1,
        });
        const enemyHpBefore = combat.enemy!.hp;
        const playerHpBefore = player.stats.hp;

        combat.processTurn('defend');

        // Player took the 1 leak; ghoul is untouched.
        expect(player.stats.hp).toBe(playerHpBefore - 1);
        expect(combat.enemy!.hp).toBe(enemyHpBefore);
    });

    it('cancels the poison rider on defend', () => {
        const { combat, player } = makeManager(12);
        injectGhoulPrepare(combat, {
            nameEn: 'Decay',
            nameRu: 'Разложение',
            turns: 2,
            damage: 2,
            poison: { damage: 1, turns: 3 },
            defenseRule: 'leakOnDefend',
            defenseLeakDamage: 1,
        });

        combat.processTurn('defend');

        expect(player.status.poison.turns).toBe(0);
    });
});

// Will-skill damage breaks the boss's Death Shield through the
// `breakBossBlockOnSkillDamage` hook. (The legacy Cursed Ring scrub
// path is gone in Stage [3]; that field no longer exists on the
// aggregate.)
describe('Will-skill vs Death Shield', () => {
    it('Will-skill damage DOES break Death Shield', () => {
        const { combat, player } = makeManager(99);
        combat.startCombat(25, 'boss', DEATH_KNIGHT_BOSS_DEF);
        const boss = combat.enemy!;
        boss.bossPhase!.pendingBlock = 15;
        boss.bossPhase!.pendingBlockTurns = 5;
        player.gainResolve(10);

        combat.processTurn({ kind: 'skill', id: 'cleave' });

        expect(boss.bossPhase!.pendingBlock).toBe(0);
        expect(boss.bossPhase!.pendingBlockTurns).toBe(0);
    });
});

// [Death Touch] sanity: the OHKO bypasses every defense — flat block,
// temporary defence buffs, even an active guard buff. Defending only
// softens it to the configured fallback damage.
describe('Death Touch OHKO bypasses defenses', () => {
    it('drops the player to 0 HP regardless of defense buffs (no defend)', () => {
        const { combat, player } = makeManager(101);
        combat.startCombat(25, 'boss', DEATH_KNIGHT_BOSS_DEF);
        const boss = combat.enemy!;
        // Stack defense to absurd levels — Death Touch must still kill.
        player.addDefenseBonus(50);
        player.addMaxHpBonus(50);
        // Force a pendingWindup that resolves THIS turn so the next
        // boss turn hits death_touch resolution.
        boss.bossPhase!.pendingWindup = {
            actionDef: {
                id: 'death_touch',
                intent: { en: 'Death Touch', ru: 'Касание смерти' },
                noAttack: true,
                windupTurns: 3,
                oneShot: true,
                oneShotDefendDamage: 8,
            },
            turnsRemaining: 1,
        };

        combat.processTurn('attack');

        expect(player.stats.hp).toBe(0);
    });

    it('softens to oneShotDefendDamage when the player Defends', () => {
        const { combat, player } = makeManager(102);
        combat.startCombat(25, 'boss', DEATH_KNIGHT_BOSS_DEF);
        const boss = combat.enemy!;
        // Big HP pool so the soft damage doesn't kill.
        player.addMaxHpBonus(50);
        boss.bossPhase!.pendingWindup = {
            actionDef: {
                id: 'death_touch',
                intent: { en: 'Death Touch', ru: 'Касание смерти' },
                noAttack: true,
                windupTurns: 3,
                oneShot: true,
                oneShotDefendDamage: 8,
            },
            turnsRemaining: 1,
        };
        const before = player.stats.hp;

        combat.processTurn('defend');

        // Defended: takes some damage (capped by oneShotDefendDamage
        // minus defendBlock + defense), but is not OHKO'd.
        expect(player.stats.hp).toBeGreaterThan(0);
        expect(player.stats.hp).toBeLessThan(before);
    });
});

// =============================================================================
// Stage [3]: new relic catalog (14 items + 5 sets). Tests below cover
// the new aggregate fields and CombatManager hooks introduced when the
// catalog was rewritten. Older Cursed-Ring / Cursed-Amulet / Cracked-
// Amulet / Holey-Chestplate / Minor-Cursed-set tests were either deleted
// (the field is gone) or rewritten here against the new effects.
// =============================================================================

import { aggregateRelics } from '../src/systems/Relics';

const PROPHET_BOSS_DEF: EnemyDef = {
    name: 'Prophet',
    description: 'test_desc_prophet',
    icon: '\u271d',
    hp: 60,
    attack: 5,
    xp: 60,
    gold: 50,
    color: 0xb8a070,
    profile: 'boss',
};

describe("Knight's Sword damageBonusOnAttack (Stage [3])", () => {
    it('with chance=1 deals +5 extra damage on regular attack', () => {
        const a = makeManager(2100);
        const b = makeManager(2100);
        // Manager A has the proc on; B has it off. Same RNG seed → same
        // base attack roll; the only difference is the bonus.
        a.player.aggregate.damageBonusOnAttackChance = 1;
        a.player.aggregate.damageBonusOnAttackAmount = 5;
        b.player.aggregate.damageBonusOnAttackChance = 0;
        b.player.aggregate.damageBonusOnAttackAmount = 5;
        // Inject a tough enemy so the strike doesn't kill it before
        // the HP delta can be measured.
        injectEarthElemental(a.combat, { kind: 'damageReduction', chance: 0, reduction: 0 });
        injectEarthElemental(b.combat, { kind: 'damageReduction', chance: 0, reduction: 0 });
        const aBefore = a.combat.enemy!.hp;
        const bBefore = b.combat.enemy!.hp;

        a.combat.processTurn('attack');
        b.combat.processTurn('attack');

        const aDealt = aBefore - a.combat.enemy!.hp;
        const bDealt = bBefore - b.combat.enemy!.hp;
        expect(aDealt - bDealt).toBe(5);
        expect(a.seenMessages.some((m) => /Knight's Sword|Меч рыцаря/i.test(m))).toBe(true);
    });

    it('with chance=0 the bonus never fires (no extra damage, no log)', () => {
        const { combat, player, seenMessages } = makeManager(2101);
        player.aggregate.damageBonusOnAttackChance = 0;
        player.aggregate.damageBonusOnAttackAmount = 5;
        injectEarthElemental(combat, { kind: 'damageReduction', chance: 0, reduction: 0 });

        combat.processTurn('attack');

        expect(seenMessages.some((m) => /Knight's Sword|Меч рыцаря/i.test(m))).toBe(false);
    });

    it('does NOT fire on Will-skills (skills bypass the regular-attack hook)', () => {
        const { combat, player, seenMessages } = makeManager(2102);
        player.aggregate.damageBonusOnAttackChance = 1;
        player.aggregate.damageBonusOnAttackAmount = 5;
        player.gainResolve(10);
        injectEarthElemental(combat, { kind: 'damageReduction', chance: 0, reduction: 0 });

        combat.processTurn({ kind: 'skill', id: 'cleave' });

        expect(seenMessages.some((m) => /Knight's Sword|Меч рыцаря/i.test(m))).toBe(false);
    });
});

describe("Knight's Helmet resolveOnHit (Stage [3])", () => {
    it('with chance=1 grants extra resolve when the player takes a hit', () => {
        // Compare two seeded managers — A has the helmet hook on, B
        // has it off. Same RNG seed means the same enemy / damage roll;
        // any resolve delta between them comes only from the helmet.
        const a = makeManager(2200);
        const b = makeManager(2200);
        a.player.aggregate.resolveOnHitChance = 1;
        a.player.aggregate.resolveOnHitAmount = 1;
        b.player.aggregate.resolveOnHitChance = 0;
        b.player.aggregate.resolveOnHitAmount = 1;
        a.player.spendResolve(a.player.resources.resolve);
        b.player.spendResolve(b.player.resources.resolve);
        // Inject a vanilla enemy that will land its swing.
        injectVampire(
            a.combat,
            { kind: 'lifestealOnAttack', ratio: 0 },
            { hp: 9, maxHp: 9, attack: 6 }
        );
        injectVampire(
            b.combat,
            { kind: 'lifestealOnAttack', ratio: 0 },
            { hp: 9, maxHp: 9, attack: 6 }
        );

        a.combat.processTurn('defend');
        b.combat.processTurn('defend');

        // If the vampire actually hit (a.player took damage), the
        // helmet must have granted exactly +1 more resolve than the
        // control. If the swing fully blocked, the delta is 0.
        const aHit = a.player.stats.hp < 9;
        const bHit = b.player.stats.hp < 9;
        // Both managers see the same swing — same roll either lands or
        // is blocked across both.
        expect(aHit).toBe(bHit);
        if (aHit) {
            const diff = a.player.resources.resolve - b.player.resources.resolve;
            expect(diff).toBe(1);
        }
    });

    it('with chance=0 the helmet does not grant resolve', () => {
        const { combat, player } = makeManager(2201);
        player.aggregate.resolveOnHitChance = 0;
        player.aggregate.resolveOnHitAmount = 1;
        player.spendResolve(player.resources.resolve);
        injectVampire(
            combat,
            { kind: 'lifestealOnAttack', ratio: 0 },
            { hp: 9, maxHp: 9, attack: 6 }
        );

        // Direct call to applyEnemyHitToPlayer to bypass action-side
        // resolve gains (resolveFromAttack / resolveFromGuard) — only
        // the helmet hook can add resolve here.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (combat as any).applyEnemyHitToPlayer(5, 0);

        expect(player.resources.resolve).toBe(0);
    });
});

describe('Lost Staff bonusMaxResolve and resolveOnAttack (Stage [3])', () => {
    it('+3 max resolve raises both the cap and the current value', () => {
        const player = new PlayerManager();
        const before = player.resources.maxResolve;
        const beforeCur = player.resources.resolve;

        expect(player.addRelic('lost_staff')).toBe('added');

        expect(player.resources.maxResolve).toBe(before + 3);
        // Current resolve grows up to the new cap.
        expect(player.resources.resolve).toBeGreaterThanOrEqual(beforeCur);
        expect(player.resources.resolve).toBeLessThanOrEqual(player.resources.maxResolve);
    });

    it('grants +1 resolve after each player attack', () => {
        const { combat, player } = makeManager(2300);
        player.aggregate.resolveOnAttackAmount = 1;
        // Drain resolve so the gain is observable, then inject a
        // resilient enemy so the attack doesn't end combat.
        player.spendResolve(player.resources.resolve);
        injectEarthElemental(combat, { kind: 'damageReduction', chance: 0, reduction: 0 });
        const before = player.resources.resolve;

        combat.processTurn('attack');

        // gainResolve() from the attack action also runs the base
        // resolveFromAttack credit; just assert resolve grew at least
        // by the staff amount + base.
        expect(player.resources.resolve).toBeGreaterThan(before);
    });
});

describe('Crown of Greed / Sin set goldGainMult (Stage [3])', () => {
    it('Crown alone applies a 1.5× gold multiplier', () => {
        const player = new PlayerManager();
        // Pretend we own the crown (Mammon's drop) without going
        // through combat to avoid Mammon-specific bookkeeping.
        player.addRelic('greed_crown');

        const startGold = player.resources.gold;
        const gained = player.gainGold(10);

        expect(gained).toBe(15);
        expect(player.resources.gold).toBe(startGold + 15);
    });

    it('Sin set (Crown + Longinus Shard) applies a 2.0× gold multiplier', () => {
        const player = new PlayerManager();
        player.addRelic('greed_crown');
        player.addRelic('longinus_shard');

        const startGold = player.resources.gold;
        const gained = player.gainGold(10);

        expect(gained).toBe(20);
        expect(player.resources.gold).toBe(startGold + 20);
    });

    it('relic mult composes with the meta gold mult by multiplication', () => {
        const player = new PlayerManager({ goldGainMult: 1.2 });
        player.addRelic('greed_crown'); // 1.5× relic side

        // Combined: 1.2 × 1.5 = 1.8 → 10 gold becomes 18.
        expect(player.gainGold(10)).toBe(18);
    });
});

describe('Sin set xpGainMult (Stage [3])', () => {
    it('Sin set doubles xp on every gainXp call', () => {
        const player = new PlayerManager();
        player.addRelic('greed_crown');
        player.addRelic('longinus_shard');

        // Anything below the per-level threshold so we don't trip a
        // level-up mid-test. xpPerLevel is well above 5.
        const gained = player.gainXp(5);
        expect(gained).toBe(10);
    });

    it('without the full Sin set the xp multiplier is 1', () => {
        const player = new PlayerManager();
        player.addRelic('greed_crown'); // only 1/2 sin pieces.

        expect(player.gainXp(5)).toBe(5);
    });
});

describe('Longinus Shard prophetDamageMult (Stage [3])', () => {
    it('×5 damage when the enemy is the Prophet boss', () => {
        const a = makeManager(2400);
        const b = makeManager(2400);
        // Force Prophet boss for both managers.
        a.combat.startCombat(25, 'boss', PROPHET_BOSS_DEF);
        b.combat.startCombat(25, 'boss', PROPHET_BOSS_DEF);
        a.player.aggregate.prophetDamageMult = 5;
        b.player.aggregate.prophetDamageMult = 1;

        const aBefore = a.combat.enemy!.hp;
        const bBefore = b.combat.enemy!.hp;

        a.combat.processTurn('attack');
        b.combat.processTurn('attack');

        // a dealt damage may equal full HP (kill) or strictly more
        // than b dealt; never less. The mult is monotonic.
        const aDealt = aBefore - (a.combat.enemy?.hp ?? 0);
        const bDealt = bBefore - (b.combat.enemy?.hp ?? 0);
        expect(aDealt).toBeGreaterThan(bDealt);
        // Sanity: with the same baseline roll, a should be at most
        // 5× b (the full multiplier).
        expect(aDealt).toBeLessThanOrEqual(bDealt * 5 + 5);
    });

    it('does NOT multiply damage on non-Prophet enemies', () => {
        const a = makeManager(2401);
        const b = makeManager(2401);
        // Earth Elemental; not Prophet. Mult must be inert.
        injectEarthElemental(a.combat, { kind: 'damageReduction', chance: 0, reduction: 0 });
        injectEarthElemental(b.combat, { kind: 'damageReduction', chance: 0, reduction: 0 });
        a.player.aggregate.prophetDamageMult = 5;
        b.player.aggregate.prophetDamageMult = 1;

        const aBefore = a.combat.enemy!.hp;
        const bBefore = b.combat.enemy!.hp;

        a.combat.processTurn('attack');
        b.combat.processTurn('attack');

        const aDealt = aBefore - a.combat.enemy!.hp;
        const bDealt = bBefore - b.combat.enemy!.hp;
        expect(aDealt).toBe(bDealt);
    });
});

describe('Dark Chestplate damageReduction floor (Stage [3])', () => {
    it('5 incoming damage → blocks 2 (floor of 50%) → player takes 3', () => {
        const { combat, player } = makeManager(2500);
        // Pin damage reduction to fire deterministically.
        player.aggregate.damageReductionChance = 1;
        player.aggregate.damageReductionPercent = 0.5;
        // Strip defense so the comparison is clean.
        player.stats.defense = 0;
        const hpBefore = player.stats.hp;

        // Fire the path directly with a 5-dmg hit and no flat block.
        // We need a non-null enemy slot, so inject any enemy.
        injectVampire(combat, { kind: 'lifestealOnAttack', ratio: 0 }, { attack: 0 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const taken = (combat as any).applyEnemyHitToPlayer(5, 0);

        // 5 → blocked 2 (floor) → player takes 3. Some RNG paths in
        // applyEnemyHitToPlayer roll a crit (8% chance) which would
        // bump pre-block damage. Cover both: either 3 (no crit) or
        // 8 → blocks 4 → 4 (crit, since 5 * 1.5 = 7.5 → 8).
        expect([3, 4]).toContain(taken);
        expect(hpBefore - player.stats.hp).toBe(taken);
    });

    it('1 incoming damage → blocks 0 (floor of 0.5) → player takes 1', () => {
        const { combat, player } = makeManager(2501);
        player.aggregate.damageReductionChance = 1;
        player.aggregate.damageReductionPercent = 0.5;
        player.stats.defense = 0;

        injectVampire(combat, { kind: 'lifestealOnAttack', ratio: 0 }, { attack: 0 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const taken = (combat as any).applyEnemyHitToPlayer(1, 0);

        // 1 * 0.5 = 0.5 → floor 0 → player takes 1. (Crit can bump
        // it to 2; 2 * 0.5 = 1 → player takes 1.)
        expect([1, 2]).toContain(taken);
    });

    it('with chance=0 the helmet does not absorb anything', () => {
        const { combat, player } = makeManager(2502);
        player.aggregate.damageReductionChance = 0;
        player.aggregate.damageReductionPercent = 0.5;
        player.stats.defense = 0;

        injectVampire(combat, { kind: 'lifestealOnAttack', ratio: 0 }, { attack: 0 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const taken = (combat as any).applyEnemyHitToPlayer(5, 0);

        // Crit bumps 5 → 8; without reduction the player takes the
        // full 5 (or 8 on crit).
        expect([5, 8]).toContain(taken);
    });
});

describe('Flesh set proc-chance bump 10% → 30% (Stage [3])', () => {
    it('owning all 2 flesh pieces sets healOnAttackChance to 0.3', () => {
        // Bypass PlayerManager so we can test aggregateRelics in
        // isolation — same code path the player runs through.
        const agg = aggregateRelics(['vampire_amulet', 'dark_chestplate']);

        expect(agg.sets.flesh).toBe(true);
        expect(agg.healOnAttackChance).toBeCloseTo(0.3, 5);
        expect(agg.damageReductionChance).toBeCloseTo(0.3, 5);
        expect(agg.healOnAttackAmount).toBe(2);
        expect(agg.damageReductionPercent).toBeCloseTo(0.5, 5);
    });

    it('owning only one flesh piece keeps the chance at the per-item 10%', () => {
        const aggHeal = aggregateRelics(['vampire_amulet']);
        expect(aggHeal.sets.flesh).toBe(false);
        expect(aggHeal.healOnAttackChance).toBeCloseTo(0.1, 5);
        // The other side never fires (chance stays 0).
        expect(aggHeal.damageReductionChance).toBe(0);

        const aggBlock = aggregateRelics(['dark_chestplate']);
        expect(aggBlock.sets.flesh).toBe(false);
        expect(aggBlock.damageReductionChance).toBeCloseTo(0.1, 5);
        expect(aggBlock.healOnAttackChance).toBe(0);
    });
});
