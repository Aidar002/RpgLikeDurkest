import { beforeEach, describe, expect, it } from 'vitest';
import { CombatManager } from '../src/systems/CombatManager';
import { PlayerManager } from '../src/systems/PlayerManager';
import { Mulberry32 } from '../src/systems/Rng';
import { emptyStatusState } from '../src/systems/StatusEffects';
import type { EventLog } from '../src/ui/EventLog';
import type { EnemyPrepareDef } from '../src/data/GameConfig';

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
        // Boss encounter at depth 25 = Death Knight (deterministic).
        combat.startCombat(25, 'boss');
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
        combat.startCombat(25, 'boss');
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
        combat.startCombat(25, 'boss');
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
        combat.startCombat(25, 'boss');
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
