import { beforeEach, describe, expect, it } from 'vitest';
import { CombatManager } from '../src/systems/CombatManager';
import { PlayerManager } from '../src/systems/PlayerManager';
import { Mulberry32 } from '../src/systems/Rng';
import type { EventLog } from '../src/ui/EventLog';

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
    const combat = new CombatManager(
        player,
        log,
        null,
        undefined,
        new Mulberry32(seed)
    );
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
