import { describe, expect, it } from 'vitest';
import {
    applyBleed,
    applyGuard,
    applyMark,
    applyRegen,
    applyStun,
    applyWeaken,
    consumeGuardBlock,
    consumeMark,
    consumeStunForTurn,
    emptyStatusState,
    statusSummary,
    tickTurn,
} from '../src/systems/StatusEffects';

describe('StatusEffects', () => {
    it('applyBleed stacks up to 8 and extends turns to the longer of the two', () => {
        const s = emptyStatusState();
        applyBleed(s, 3, 2);
        expect(s.bleed.stacks).toBe(3);
        expect(s.bleed.turns).toBe(2);

        applyBleed(s, 10, 1);
        expect(s.bleed.stacks).toBe(8);
        expect(s.bleed.turns).toBe(2);
    });

    it('applyWeaken keeps the stronger amount and the longer duration', () => {
        const s = emptyStatusState();
        applyWeaken(s, 1, 2);
        applyWeaken(s, 3, 1);
        expect(s.weaken.amount).toBe(3);
        expect(s.weaken.turns).toBe(2);
    });

    it('applyGuard accumulates hits and takes the stronger amount', () => {
        const s = emptyStatusState();
        applyGuard(s, 2, 3);
        applyGuard(s, 1, 1);
        expect(s.guard.hits).toBe(3);
        expect(s.guard.amount).toBe(3);
    });

    it('consumeStunForTurn decrements and signals skip', () => {
        const s = emptyStatusState();
        applyStun(s, 2);
        expect(consumeStunForTurn(s)).toBe(true);
        expect(s.stun.turns).toBe(1);
        expect(consumeStunForTurn(s)).toBe(true);
        expect(consumeStunForTurn(s)).toBe(false);
    });

    it('consumeMark pops the mark', () => {
        const s = emptyStatusState();
        applyMark(s, 2);
        expect(consumeMark(s)).toBe(true);
        expect(consumeMark(s)).toBe(false);
    });

    it('consumeGuardBlock reduces incoming damage and consumes one hit', () => {
        const s = emptyStatusState();
        applyGuard(s, 2, 4);
        expect(consumeGuardBlock(s, 5)).toBe(1);
        expect(s.guard.hits).toBe(1);
        expect(consumeGuardBlock(s, 10)).toBe(6);
        expect(s.guard.hits).toBe(0);
        // With no guard left the block is a no-op.
        expect(consumeGuardBlock(s, 7)).toBe(7);
    });

    it('tickTurn applies bleed damage and expires bleed at 0 turns', () => {
        const s = emptyStatusState();
        applyBleed(s, 2, 1);
        const result = tickTurn(s);
        expect(result.bleedDamage).toBe(2);
        expect(result.expired).toContain('bleed');
        expect(s.bleed.stacks).toBe(0);
    });

    it('tickTurn heals via regen and expires it', () => {
        const s = emptyStatusState();
        applyRegen(s, 3, 1);
        const result = tickTurn(s);
        expect(result.regenHeal).toBe(3);
        expect(result.expired).toContain('regen');
    });

    it('statusSummary formats ru/en labels', () => {
        const s = emptyStatusState();
        applyBleed(s, 2, 3);
        applyGuard(s, 1, 2);

        const en = statusSummary(s, 'en');
        expect(en).toContain('Bleed x2/3t');
        expect(en).toContain('Guard 2x1');

        const ru = statusSummary(s, 'ru');
        expect(ru).toContain('Кровотечение x2/3х');
        expect(ru).toContain('Защита 2x1');
    });

    it('statusSummary returns empty string when nothing is active', () => {
        expect(statusSummary(emptyStatusState(), 'en')).toBe('');
    });
});
