import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_NPC_MEMORY,
    makeDefaultNpcMemoryMap,
    NpcManager,
    sanitizeNpcMemoryMap,
    type NpcEvalContext,
} from '../src/systems/NpcManager';
import { ALL_NPC_IDS, NPCS } from '../src/systems/Npcs';

afterEach(() => {
    vi.restoreAllMocks();
});

function ctx(overrides: Partial<NpcEvalContext> = {}): NpcEvalContext {
    return {
        depth: 1,
        hpFrac: 1,
        bleedDamageDealt: 0,
        relicsFound: 0,
        bossesKilledEver: 0,
        ...overrides,
    };
}

describe('makeDefaultNpcMemoryMap / sanitizeNpcMemoryMap', () => {
    it('seeds every known NPC with the default memory shape', () => {
        const map = makeDefaultNpcMemoryMap();
        for (const id of ALL_NPC_IDS) {
            expect(map[id]).toEqual(DEFAULT_NPC_MEMORY);
            // Defensive: each entry must be its own array, not a shared reference.
            expect(map[id].flags).not.toBe(DEFAULT_NPC_MEMORY.flags);
        }
    });

    it('returns the default map when given undefined', () => {
        expect(sanitizeNpcMemoryMap(undefined)).toEqual(makeDefaultNpcMemoryMap());
    });

    it('clamps affinity to [-5, +5] and floors metCount / lastDepthMet at zero', () => {
        const sanitized = sanitizeNpcMemoryMap({
            sara: { metCount: -3, affinity: 99, lastDepthMet: -7, flags: ['ok'] },
            gogi: { metCount: 2.7, affinity: -99, lastDepthMet: 4.4, flags: [] },
        });
        expect(sanitized.sara).toEqual({
            metCount: 0,
            affinity: 5,
            lastDepthMet: 0,
            flags: ['ok'],
        });
        expect(sanitized.gogi).toEqual({
            metCount: 2,
            affinity: -5,
            lastDepthMet: 4,
            flags: [],
        });
    });

    it('drops non-string entries from the flags list and rejects non-array flags', () => {
        const sanitized = sanitizeNpcMemoryMap({
            sara: {
                metCount: 1,
                affinity: 0,
                lastDepthMet: 0,
                flags: ['kept', 7 as unknown as string, null as unknown as string, 'also-kept'],
            },
            gogi: {
                metCount: 1,
                affinity: 0,
                lastDepthMet: 0,
                flags: 'not-an-array' as unknown as string[],
            },
        });
        expect(sanitized.sara.flags).toEqual(['kept', 'also-kept']);
        expect(sanitized.gogi.flags).toEqual([]);
    });
});

describe('NpcManager mutators', () => {
    it('markEncounter increments metCount, updates lastDepthMet, and persists', () => {
        const memory = makeDefaultNpcMemoryMap();
        const save = vi.fn();
        const manager = new NpcManager(memory, save);

        manager.markEncounter('sara', 4);
        expect(memory.sara.metCount).toBe(1);
        expect(memory.sara.lastDepthMet).toBe(4);
        expect(save).toHaveBeenCalledTimes(1);

        manager.markEncounter('sara', 9);
        expect(memory.sara.metCount).toBe(2);
        expect(memory.sara.lastDepthMet).toBe(9);
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('adjustAffinity clamps to [-5, +5] and persists every call', () => {
        const memory = makeDefaultNpcMemoryMap();
        const save = vi.fn();
        const manager = new NpcManager(memory, save);

        manager.adjustAffinity('gogi', 4);
        manager.adjustAffinity('gogi', 4); // 8 -> clamped to 5
        expect(memory.gogi.affinity).toBe(5);

        manager.adjustAffinity('gogi', -20); // -15 -> clamped to -5
        expect(memory.gogi.affinity).toBe(-5);

        expect(save).toHaveBeenCalledTimes(3);
    });

    it('addFlag is idempotent: a duplicate flag does not save again', () => {
        const memory = makeDefaultNpcMemoryMap();
        const save = vi.fn();
        const manager = new NpcManager(memory, save);

        manager.addFlag('sara', 'gave-token');
        manager.addFlag('sara', 'gave-token'); // duplicate -> no-op
        manager.addFlag('sara', 'refused-pact');

        expect(memory.sara.flags).toEqual(['gave-token', 'refused-pact']);
        expect(save).toHaveBeenCalledTimes(2);
        expect(manager.hasFlag('sara', 'gave-token')).toBe(true);
        expect(manager.hasFlag('sara', 'never-set')).toBe(false);
    });
});

describe('NpcManager.pickForRole', () => {
    it('returns null when no NPC matches the requested role', () => {
        const manager = new NpcManager(makeDefaultNpcMemoryMap(), () => {});
        // Exercise the empty-candidates branch with a role string no NPC owns.
        // The casting NPCs only carry 'merchant' and 'wanderer'.
        const unknownRole = 'shrine' as unknown as Parameters<typeof manager.pickForRole>[0];
        expect(manager.pickForRole(unknownRole, 1)).toBeNull();
    });

    it('returns an NPC whose role matches the request', () => {
        // Pin Math.random so the noise term is deterministic; the highest-score
        // candidate must still be a merchant.
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const manager = new NpcManager(makeDefaultNpcMemoryMap(), () => {});
        const id = manager.pickForRole('merchant', 1);
        expect(id).not.toBeNull();
        expect(NPCS[id!].role).toBe('merchant');
    });
});

describe('NpcManager.pickDialog', () => {
    it('on the first encounter picks the "first" stage beat', () => {
        const manager = new NpcManager(makeDefaultNpcMemoryMap(), () => {});
        const picked = manager.pickDialog('sara', ctx());
        expect(picked.beat.stage).toBe('first');
        // Sara has a farewell beat in her cast definition.
        expect(picked.farewell?.stage).toBe('farewell');
        expect(picked.npc.id).toBe('sara');
    });

    it('after 3+ encounters with affinity >= 2, picks the "deep" beat tagged "liked"', () => {
        const memory = makeDefaultNpcMemoryMap();
        memory.sara.metCount = 3;
        memory.sara.affinity = 3; // -> 'liked' tag
        const manager = new NpcManager(memory, () => {});

        const picked = manager.pickDialog('sara', ctx());
        expect(picked.beat.stage).toBe('deep');
        expect(picked.activeTags).toContain('liked');
    });

    it('hides offers gated by requiresAffinity / onlyAfterMet until prerequisites are met', () => {
        // Inject a synthetic NPC with a gated offer so we don't depend on
        // the production offer table tuning.
        const memory = makeDefaultNpcMemoryMap();
        const manager = new NpcManager(memory, () => {});
        const original = NPCS.sara.offers.slice();
        NPCS.sara.offers.push({
            id: 'sara_secret',
            label: { en: 'secret', ru: 'секрет' },
            onlyAfterMet: 2,
            requiresAffinity: 3,
        });
        try {
            // Met 0 / aff 0: offer hidden.
            expect(
                manager.pickDialog('sara', ctx()).offers.find((o) => o.id === 'sara_secret')
            ).toBeUndefined();

            // Met 5 / aff 0: still hidden by affinity gate.
            memory.sara.metCount = 5;
            expect(
                manager.pickDialog('sara', ctx()).offers.find((o) => o.id === 'sara_secret')
            ).toBeUndefined();

            // Met 5 / aff 4: visible.
            memory.sara.affinity = 4;
            expect(
                manager.pickDialog('sara', ctx()).offers.find((o) => o.id === 'sara_secret')
            ).toBeDefined();
        } finally {
            NPCS.sara.offers = original;
        }
    });
});

describe('NpcManager.getMemorySummary', () => {
    it('skips NPCs that have never been met', () => {
        const memory = makeDefaultNpcMemoryMap();
        memory.sara.metCount = 2;
        memory.sara.affinity = 4; // -> 'trusted'
        // gogi has metCount=0 -> excluded from the summary.
        const manager = new NpcManager(memory, () => {});

        const en = manager.getMemorySummary('en');
        expect(en).toHaveLength(1);
        expect(en[0]).toContain('Sara');
        expect(en[0]).toContain('met x2');
        expect(en[0]).toContain('trusted');

        const ru = manager.getMemorySummary('ru');
        expect(ru[0]).toContain('Сара');
        expect(ru[0]).toContain('встреч x2');
        expect(ru[0]).toContain('доверие');
    });

    it('returns an empty list when no NPC has been encountered', () => {
        const manager = new NpcManager(makeDefaultNpcMemoryMap(), () => {});
        expect(manager.getMemorySummary('en')).toEqual([]);
    });
});

describe('NpcManager.pickLowHpRecall', () => {
    it('returns null when no NPC has affinity >= 1', () => {
        const manager = new NpcManager(makeDefaultNpcMemoryMap(), () => {});
        expect(manager.pickLowHpRecall('en')).toBeNull();
    });

    it('returns a recall line from a friendly NPC when at least one is bonded', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0); // deterministic friend + line index
        const memory = makeDefaultNpcMemoryMap();
        memory.sara.affinity = 2;
        const manager = new NpcManager(memory, () => {});
        expect(manager.pickLowHpRecall('en')).toBe(
            'Sara\'s voice, from a memory: "I hope you survive."'
        );
    });
});
