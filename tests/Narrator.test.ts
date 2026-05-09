import { afterEach, describe, expect, it, vi } from 'vitest';
import { narrate } from '../src/systems/Narrator';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('narrate', () => {
    it('returns an English line by default and a Russian line when language="ru"', () => {
        // Force pool index 0 so we can compare against the known first
        // entry of each language pool.
        vi.spyOn(Math, 'random').mockReturnValue(0);

        const enLine = narrate('expedition_start');
        const ruLine = narrate('expedition_start', 'ru');

        expect(enLine).toBe('The door closes behind you. The artifact waits below.');
        expect(ruLine).toBe('Дверь встаёт на засов. Артефакт ждёт ниже.');
    });

    it('always returns a member of the configured pool for the chosen language (smoke / 200 calls)', () => {
        // No mock here \u2014 just confirm the function never returns
        // an empty string or a foreign-language line for a known event.
        // The pools in the source are non-empty so empty-string only
        // happens when the event is missing.
        const enPool = new Set([
            'A clean strike. Remember the feeling.',
            'Precision \u2014 the most underrated weapon.',
        ]);
        for (let i = 0; i < 200; i++) {
            const line = narrate('crit_landed', 'en');
            expect(line).not.toBe('');
            expect(enPool.has(line)).toBe(true);
        }
    });

    it('selects within the pool length: never throws on the boundary RNG values', () => {
        // Math.random() returns values in [0, 1). The narrator
        // multiplies by pool.length and floors. The two boundary
        // cases are 0 (first element) and "just under 1" (last element).
        const spy = vi.spyOn(Math, 'random');

        spy.mockReturnValue(0);
        expect(narrate('first_blood', 'en')).toBe('A promising start. A terrible omen.');

        // 0.999... will floor to pool.length - 1 for any non-empty pool.
        spy.mockReturnValue(0.9999999);
        expect(narrate('first_blood', 'en')).toBe('The first body of many, perhaps.');
    });

    it('returns "" for an unknown event id (defensive contract)', () => {
        // The Russian / English maps are typed against `NarrationEvent`,
        // but at runtime the function still guards against a missing
        // pool. Cast the event to bypass the union for this contract test.
        const result = narrate('not_a_real_event' as unknown as Parameters<typeof narrate>[0]);
        expect(result).toBe('');
    });

    it('the EN and RU pools have matching event coverage (no event missing a translation)', () => {
        // Quasi-snapshot: every event id we care about should produce
        // a non-empty string in both languages. The static type system
        // already enforces this on the Records, but a runtime check
        // catches the case where a future edit accidentally empties a
        // pool array.
        const events = [
            'expedition_start',
            'first_blood',
            'enter_combat',
            'enter_elite',
            'enter_boss',
            'crit_landed',
            'crit_received',
            'low_hp',
            'bleed_finisher',
            'rest',
            'relic_found',
            'stun_landed',
            'death',
        ] as const;

        // Force pool index 0 \u2014 picks the first translation.
        vi.spyOn(Math, 'random').mockReturnValue(0);

        for (const event of events) {
            expect(narrate(event, 'en')).not.toBe('');
            expect(narrate(event, 'ru')).not.toBe('');
        }
    });
});
