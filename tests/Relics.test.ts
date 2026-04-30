import { describe, expect, it } from 'vitest';
import { RELICS, rollRelic, rollRelicFor, type RelicId } from '../src/systems/Relics';
import { Mulberry32 } from '../src/systems/Rng';

describe('Relics', () => {
    it('rollRelic returns null when the owned list covers every relic', () => {
        const allOwned = Object.keys(RELICS) as RelicId[];
        expect(rollRelic(allOwned, 'common', new Mulberry32(1))).toBeNull();
    });

    it('rollRelic is deterministic for a given seed', () => {
        const owned: RelicId[] = [];
        const a = rollRelic(owned, 'common', new Mulberry32(42));
        const b = rollRelic(owned, 'common', new Mulberry32(42));
        expect(a).toBe(b);
    });

    it('rollRelicFor("boss") returns a rare relic when available', () => {
        const chosen = rollRelicFor([], 'boss', new Mulberry32(1));
        expect(chosen).not.toBeNull();
        if (chosen) {
            expect(RELICS[chosen].rarity).toBe('rare');
        }
    });

    it('rollRelicFor("normal") tends to return a common relic', () => {
        let commonCount = 0;
        const total = 40;
        for (let seed = 0; seed < total; seed++) {
            const chosen = rollRelicFor([], 'normal', new Mulberry32(seed));
            if (chosen && RELICS[chosen].rarity === 'common') commonCount++;
        }
        // Vast majority of normal rolls should land on commons.
        expect(commonCount).toBeGreaterThan(total * 0.75);
    });
});
