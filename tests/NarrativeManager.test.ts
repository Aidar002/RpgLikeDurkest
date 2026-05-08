import { describe, expect, it } from 'vitest';
import { NarrativeManager } from '../src/systems/NarrativeManager';
import { Localization } from '../src/systems/Localization';
import { RoomType } from '../src/systems/MapGenerator';
import { MAP_CONFIG } from '../src/data/GameConfig';

// All the narrative copy is private — tests only assert on the public
// observable contract: which key returns null vs. a string, the language
// switch, and the dominantTone effect on roomCard / victoryLine / deathLine.

function make(language: 'en' | 'ru' = 'en') {
    return new NarrativeManager(new Localization(language));
}

describe('NarrativeManager.enterDepth', () => {
    it('returns null for non-trigger depths', () => {
        const n = make('en');
        expect(n.enterDepth(1, false)).toBeNull();
        expect(n.enterDepth(2, false)).toBeNull();
        expect(n.enterDepth(7, false)).toBeNull();
    });

    it('returns the scratched-wall line at depth 3 in English', () => {
        const n = make('en');
        const line = n.enterDepth(3, false);
        expect(line).toBe('Scratched into the wall: "Treasure below. Turn back above."');
    });

    it('returns the scratched-wall line at depth 3 in Russian', () => {
        const n = make('ru');
        const line = n.enterDepth(3, false);
        expect(line).toBe('На стене нацарапано: «Добыча ниже. Назад — выше».');
    });

    it('returns the artifact-near line on the layer just before the final depth', () => {
        const n = make('en');
        const line = n.enterDepth(MAP_CONFIG.finalDepth - 1, false);
        expect(line).toBe(
            'The walls glow faintly. The Wish Artifact is on the next floor. Its guardian waits.'
        );
    });

    it('emits the lantern-warning line on the second consecutive low-light depth', () => {
        const n = make('en');
        // First low-light enter just bumps the darkness counter and returns null
        // (depth=1 is not one of the special-line depths).
        expect(n.enterDepth(1, true)).toBeNull();
        // Second low-light enter: darkness === 2 -> warning line fires.
        expect(n.enterDepth(2, true)).toBe(
            'The lantern is weak. Corners hide movement now.'
        );
    });
});

describe('NarrativeManager.roomCard', () => {
    it('returns title/description/intel strings for every concrete RoomType', () => {
        const n = make('en');
        const types = [
            RoomType.START,
            RoomType.ENEMY,
            RoomType.TREASURE,
            RoomType.TRAP,
            RoomType.REST,
            RoomType.SHRINE,
            RoomType.MERCHANT,
            RoomType.ELITE,
            RoomType.BOSS,
            RoomType.MINI_BOSS,
            RoomType.EMPTY,
        ] as const;
        for (const type of types) {
            const card = n.roomCard(type, 5);
            expect(typeof card.title).toBe('string');
            expect(card.title.length).toBeGreaterThan(0);
            expect(typeof card.description).toBe('string');
            expect(card.description.length).toBeGreaterThan(0);
            expect(typeof card.intel).toBe('string');
            expect(card.intel.length).toBeGreaterThan(0);
        }
    });

    it('shifts the treasure card title when greed becomes the dominant tone', () => {
        const n = make('en');
        // Default (no marks accumulated): 'caution' wins via the seed in dominantTone.
        expect(n.roomCard(RoomType.TREASURE, 4).title).toBe('Old Cache');

        // Push greed past every other mark.
        n.mark('greed', 5);
        expect(n.roomCard(RoomType.TREASURE, 4).title).toBe('Heavy Cache');
    });

    it('returns the artifact-guardian boss copy at the final depth and the floor-keeper copy below it', () => {
        const n = make('en');
        const final = n.roomCard(RoomType.BOSS, MAP_CONFIG.finalDepth);
        expect(final.title).toBe('Artifact Guardian');
        const mid = n.roomCard(RoomType.BOSS, 5);
        expect(mid.title).toBe('Floor Keeper');
    });
});

describe('NarrativeManager language switching', () => {
    it('respects loc.language for the same call', () => {
        const en = make('en').roomCard(RoomType.MERCHANT, 4);
        const ru = make('ru').roomCard(RoomType.MERCHANT, 4);
        expect(en.title).toBe('Quiet Trader');
        expect(ru.title).toBe('Тихий торговец');
    });
});

describe('NarrativeManager.combatIntro', () => {
    it('uses the boss phrasing for boss encounters', () => {
        const n = make('en');
        expect(n.combatIntro('boss', 'Stalker')).toBe('Stalker bars the stair down.');
    });

    it('uses the elite phrasing AND increments the violence mark', () => {
        const n = make('en');
        const intro = n.combatIntro('elite', 'Brute');
        expect(intro).toBe('Brute has seen explorers before. It moves first.');
        // After 4 elite intros, victoryLine should switch to the violence variant.
        n.combatIntro('elite', 'Brute');
        n.combatIntro('elite', 'Brute');
        n.combatIntro('elite', 'Brute');
        expect(n.victoryLine('Brute')).toBe(
            'Brute falls. Your hands stop shaking later than they should.'
        );
    });

    it('uses the corridor phrasing for normal encounters', () => {
        const n = make('en');
        expect(n.combatIntro('normal', 'Goon')).toBe('Goon blocks the corridor.');
    });
});

describe('NarrativeManager memory-driven lines', () => {
    it('choiceLine increments the underlying mark and returns the matching line', () => {
        const n = make('en');
        expect(n.choiceLine('greed')).toBe(
            'You take more than you need. The pack grows heavier.'
        );
        // dominantTone now sees greed=1, caution=0 (seed) -> greed wins on tie-break.
        // deathLine then takes the greed branch.
        expect(n.deathLine()).toBe(
            'You filled your pack but never reached the artifact.'
        );
    });

    it('victoryLine falls back to the neutral phrasing when no tone dominates', () => {
        const n = make('en');
        expect(n.victoryLine('Wraith')).toBe('Wraith falls. The next room waits.');
    });
});
