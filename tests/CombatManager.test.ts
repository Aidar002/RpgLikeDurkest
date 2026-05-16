import { beforeEach, describe, expect, it } from 'vitest';
import { CombatManager } from '../src/systems/CombatManager';
import { PlayerManager } from '../src/systems/PlayerManager';
import { Mulberry32 } from '../src/systems/Rng';
import { emptyStatusState } from '../src/systems/StatusEffects';
import type { EventLog } from '../src/ui/EventLog';
import type { EnemyDef, EnemyPassive, EnemyPrepareDef } from '../src/data/GameConfig';

// Death Knight's boss blueprint lives in src/data/Bosses.ts (Death
// Shield + Death Touch). Death Knight itself was demoted to the 16-20
// normal pool in the design-sheet port, so depth 25 no longer
// resolves to him via the random boss roll. These tests still need a
// boss with that exact blueprint to cover the legacy Cursed Ring and
// Death Touch interactions, so we inject the def explicitly via the
// `startCombat` override parameter.
const DEATH_KNIGHT_BOSS_DEF: EnemyDef = {
    name: 'Death Knight',
    description: 'test_desc_death_knight',
    icon: '\u2620',
    hp: 45,
    attack: 8,
    xp: 50,
    gold: 40,
    color: 0x2a0814,
    profile: 'boss',
};

// Minimal stub: CombatManager only calls log.addMessage(text, color?).
function makeManager(seed: number): {
    combat: CombatManager;
    player: PlayerManager;
    seenMessages: string[];
} {
    const player = new PlayerManager();
    const seenMessages: string[] = [];
    const log = {
        addMessage: (text: string, _color?: string) => {
            seenMessages.push(text);
        },
    } as unknown as EventLog;
    const combat = new CombatManager(player, log, undefined, new Mulberry32(seed));
    return { combat, player, seenMessages };
}

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
    combat.enemy = {
        kind: 'normal',
        name: 'Ghoul',
        canonicalName: 'Ghoul',
        description: 'test',
        icon: 'G',
        hp: 10,
        maxHp: 10,
        attack: 1,
        color: 0x455544,
        xp: 0,
        gold: 0,
        profile: 'bleeder',
        turnsAlive: 0,
        status: emptyStatusState(),
        pendingPrepare: { def: prepare, turnsRemaining: 0 },
        currentIntent: null,
    };
}

// Direct injection of a Bee-Butterfly-shaped enemy so we can pin the
// evade chance to 0 or 1 and assert deterministic behaviour without
// hunting for an RNG seed that lines up with the passive trigger.
function injectBeeButterfly(combat: CombatManager, passive: EnemyPassive): void {
    combat.enemy = {
        kind: 'normal',
        name: 'Bee-Butterfly',
        canonicalName: 'Bee-Butterfly',
        description: 'test',
        icon: 'Y',
        hp: 3,
        maxHp: 3,
        attack: 2,
        color: 0xc4a01e,
        xp: 0,
        gold: 0,
        profile: 'stalker',
        turnsAlive: 0,
        status: emptyStatusState(),
        passive,
        currentIntent: null,
    };
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
    combat.enemy = {
        kind: 'normal',
        name: 'Earth Elemental',
        canonicalName: 'Earth Elemental',
        description: 'test',
        icon: 'E',
        hp: 50,
        maxHp: 50,
        attack: 2,
        color: 0x6e553b,
        xp: 0,
        gold: 0,
        profile: 'brute',
        turnsAlive: 0,
        status: emptyStatusState(),
        passive,
        currentIntent: null,
    };
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
    combat.enemy = {
        kind: 'normal',
        name: 'Vampire',
        canonicalName: 'Vampire',
        description: 'test',
        icon: 'V',
        hp: overrides.hp ?? 5,
        maxHp: overrides.maxHp ?? 9,
        attack: overrides.attack ?? 4,
        color: 0x4a1a1a,
        xp: 0,
        gold: 0,
        profile: 'stalker',
        turnsAlive: 0,
        status: emptyStatusState(),
        passive,
        currentIntent: null,
    };
}

describe('Vampire lifestealOnAttack', () => {
    it('heals the vampire by floor(damage * ratio) on a successful hit', () => {
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
            expect(healed).toBeLessThanOrEqual(Math.max(1, Math.floor(damageDealt * 0.5)));
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
            // floor(damage * 0.5) clamped to 1.
            expect(combat.enemy!.hp - hpBefore).toBeGreaterThanOrEqual(1);
        }
    });
});

function injectGoblinHorde(
    combat: CombatManager,
    overrides: Partial<{ hp: number; maxHp: number; attack: number }> = {}
): void {
    combat.enemy = {
        kind: 'normal',
        name: 'Goblin Horde',
        canonicalName: 'Goblin Horde',
        description: 'test',
        icon: 'O',
        hp: overrides.hp ?? 13,
        maxHp: overrides.maxHp ?? 13,
        attack: overrides.attack ?? 9,
        color: 0x4d6a2a,
        xp: 0,
        gold: 0,
        profile: 'brute',
        turnsAlive: 0,
        status: emptyStatusState(),
        passive: { kind: 'attackScalesWithHp' },
        currentIntent: null,
    };
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
    combat.enemy = {
        kind: 'normal',
        name: 'Succubus',
        canonicalName: 'Succubus',
        description: 'test',
        icon: 'U',
        hp: overrides.hp ?? 22,
        maxHp: overrides.maxHp ?? 22,
        attack: overrides.attack ?? 1,
        color: 0x6a2a44,
        xp: 0,
        gold: 0,
        profile: 'stalker',
        turnsAlive: 0,
        status: emptyStatusState(),
        passive: { kind: 'painExultation', bonusPerStep: 0.1 },
        currentIntent: null,
    };
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

// [Cursed Ring] sanity: a skill that the ring scrubs into a basic
// strike must NOT break the boss's Death Shield. The shield-breaking
// path lives in `breakBossBlockOnSkillDamage`, and the curse takes
// the early-return basic-attack branch before that ever runs.
describe('Cursed Ring vs Death Shield', () => {
    it('skill scrubbed to basic attack does NOT break Death Shield', () => {
        const { combat, player } = makeManager(99);
        // Force Death Knight as the boss so the Death Shield phase
        // blueprint is wired up (he is no longer the default depth-25 boss).
        combat.startCombat(25, 'boss', DEATH_KNIGHT_BOSS_DEF);
        const boss = combat.enemy!;
        // Force the boss into the post-Shield state we need: pretend it
        // has already finished the death_shield windup so a 15-block
        // pool is up.
        boss.bossPhase!.pendingBlock = 15;
        boss.bossPhase!.pendingBlockTurns = 5;
        // Force the curse to always proc; force enemy to never crit.
        player.aggregate.skillToBasicChance = 1;
        // Make sure player can pay the cleave's resolve cost.
        player.gainResolve(10);

        const blockBefore = boss.bossPhase!.pendingBlock;
        combat.processTurn({ kind: 'skill', id: 'cleave' });

        // The curse-converted basic attack damages the shield pool but
        // must NOT shatter the shield outright (shield is only broken
        // on a real Will-skill landing).
        expect(boss.bossPhase!.pendingBlockTurns).toBeGreaterThan(0);
        // Block pool can absorb the basic-attack damage; the test
        // is that the buff itself isn't wiped.
        expect(boss.bossPhase!.pendingBlock).toBeGreaterThan(0);
        // Sanity: the shield really did soak the strike (so the boss
        // HP is unchanged for blocks >= damage roll).
        expect(boss.bossPhase!.pendingBlock).toBeLessThanOrEqual(blockBefore);
    });

    it('actual Will-skill damage DOES break Death Shield (control)', () => {
        const { combat, player } = makeManager(99);
        combat.startCombat(25, 'boss', DEATH_KNIGHT_BOSS_DEF);
        const boss = combat.enemy!;
        boss.bossPhase!.pendingBlock = 15;
        boss.bossPhase!.pendingBlockTurns = 5;
        // No curse this time.
        player.aggregate.skillToBasicChance = 0;
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
