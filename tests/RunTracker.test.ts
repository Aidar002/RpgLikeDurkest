import { describe, expect, it } from 'vitest';
import { RunTracker } from '../src/systems/RunTracker';

describe('RunTracker', () => {
    describe('record / trackMax / current', () => {
        it('starts at zero except levelReached which begins at 1', () => {
            const t = new RunTracker();
            const s = t.current;
            expect(s.roomsVisited).toBe(0);
            expect(s.enemiesKilled).toBe(0);
            expect(s.bossesKilled).toBe(0);
            expect(s.damageDealt).toBe(0);
            expect(s.bestDepth).toBe(0);
            expect(s.levelReached).toBe(1);
        });

        it('record(key) defaults to incrementing by 1', () => {
            const t = new RunTracker();
            t.record('enemiesKilled');
            t.record('enemiesKilled');
            t.record('enemiesKilled');
            expect(t.current.enemiesKilled).toBe(3);
        });

        it('record(key, amount) accumulates the supplied delta', () => {
            const t = new RunTracker();
            t.record('damageDealt', 7);
            t.record('damageDealt', 5);
            expect(t.current.damageDealt).toBe(12);
        });

        it('trackMax stores the new value only when it strictly exceeds the current', () => {
            const t = new RunTracker();
            t.trackMax('bestDepth', 3);
            expect(t.current.bestDepth).toBe(3);
            t.trackMax('bestDepth', 2); // smaller -> ignored
            expect(t.current.bestDepth).toBe(3);
            t.trackMax('bestDepth', 3); // equal -> ignored (strict >)
            expect(t.current.bestDepth).toBe(3);
            t.trackMax('bestDepth', 7);
            expect(t.current.bestDepth).toBe(7);
        });
    });

    describe('getSummaryLines', () => {
        it('emits the always-present English lines and skips the optional ones at zero', () => {
            const t = new RunTracker();
            t.record('roomsVisited', 4);
            t.record('enemiesKilled', 2);
            t.record('damageDealt', 30);
            t.record('damageTaken', 10);
            t.record('turnsInCombat', 9);

            const lines = t.getSummaryLines('en');
            expect(lines).toEqual([
                'Rooms cleared: 4',
                'Enemies defeated: 2',
                'Damage: 30 dealt  |  10 taken',
                'Combat turns: 9',
                'Level reached: 1',
            ]);
        });

        it('emits the always-present Russian lines and skips the optional ones at zero', () => {
            const t = new RunTracker();
            t.record('roomsVisited', 4);
            t.record('enemiesKilled', 2);
            t.record('damageDealt', 30);
            t.record('damageTaken', 10);
            t.record('turnsInCombat', 9);

            const lines = t.getSummaryLines('ru');
            expect(lines).toEqual([
                'Комнат пройдено: 4',
                'Врагов побеждено: 2',
                'Урон: 30 нанесено  |  10 получено',
                'Ходов в бою: 9',
                'Уровень: 1',
            ]);
        });

        it('appends the optional lines once their stats become non-zero (en)', () => {
            const t = new RunTracker();
            t.record('roomsVisited', 1);
            t.record('enemiesKilled', 1);
            t.record('elitesKilled', 1);
            t.record('bossesKilled', 1);
            t.record('damageDealt', 50);
            t.record('damageTaken', 20);
            t.record('criticalHits', 3);
            t.record('goldEarned', 40);
            t.record('goldSpent', 10);
            t.record('potionsUsed', 2);
            t.record('healingDone', 12);
            t.record('turnsInCombat', 15);
            t.record('relicsFound', 1);
            t.record('bleedDamageDealt', 8);

            const lines = t.getSummaryLines('en');
            expect(lines).toContain('Elites defeated: 1');
            expect(lines).toContain('Bosses defeated: 1');
            expect(lines).toContain('Critical hits: 3');
            expect(lines).toContain('Gold: 40 found  |  10 spent');
            expect(lines).toContain('Potions used: 2');
            expect(lines).toContain('HP restored: 12');
            expect(lines).toContain('Relics acquired: 1');
            expect(lines).toContain('Bleed damage: 8');
        });

        it('appends the optional lines once their stats become non-zero (ru)', () => {
            const t = new RunTracker();
            t.record('roomsVisited', 1);
            t.record('enemiesKilled', 1);
            t.record('elitesKilled', 1);
            t.record('bossesKilled', 1);
            t.record('damageDealt', 50);
            t.record('damageTaken', 20);
            t.record('criticalHits', 3);
            t.record('goldEarned', 40);
            t.record('goldSpent', 10);
            t.record('potionsUsed', 2);
            t.record('healingDone', 12);
            t.record('turnsInCombat', 15);
            t.record('relicsFound', 1);
            t.record('bleedDamageDealt', 8);

            const lines = t.getSummaryLines('ru');
            expect(lines).toContain('Элит побеждено: 1');
            expect(lines).toContain('Боссов побеждено: 1');
            expect(lines).toContain('Критических ударов: 3');
            expect(lines).toContain('Золото: 40 найдено  |  10 потрачено');
            expect(lines).toContain('Эликсиров выпито: 2');
            expect(lines).toContain('ОЗ восстановлено: 12');
            expect(lines).toContain('Реликвий найдено: 1');
            expect(lines).toContain('Урон кровотечением: 8');
        });
    });

    describe('getRunTitle', () => {
        // The titles form a priority cascade. We assert the highest-priority
        // branch wins even when lower-priority conditions also hold.
        it('3+ bosses killed -> deep-hunt title (highest priority)', () => {
            const t = new RunTracker();
            t.record('bossesKilled', 3);
            t.record('elitesKilled', 5); // would otherwise win at lower priority
            t.trackMax('bestDepth', 20);
            expect(t.getRunTitle('en')).toBe('A DEEP HUNT');
            expect(t.getRunTitle('ru')).toBe('ГЛУБОКИЙ СЛЕД');
        });

        it('1+ boss killed -> keeper-fell title', () => {
            const t = new RunTracker();
            t.record('bossesKilled', 1);
            expect(t.getRunTitle('en')).toBe('A KEEPER FELL');
            expect(t.getRunTitle('ru')).toBe('ХРАНИТЕЛЬ ПАЛ');
        });

        it('1+ elite killed (and no bosses) -> strong-run title', () => {
            const t = new RunTracker();
            t.record('elitesKilled', 1);
            expect(t.getRunTitle('en')).toBe('A STRONG RUN');
            expect(t.getRunTitle('ru')).toBe('КРЕПКИЙ ЗАБЕГ');
        });

        it('bestDepth >= 5 (and no elites/bosses) -> deep-descent title', () => {
            const t = new RunTracker();
            t.trackMax('bestDepth', 5);
            expect(t.getRunTitle('en')).toBe('A DEEP DESCENT');
            expect(t.getRunTitle('ru')).toBe('ГЛУБОКИЙ СПУСК');
        });

        it('enemiesKilled >= 5 with shallow depth -> hard-fight title', () => {
            const t = new RunTracker();
            t.record('enemiesKilled', 5);
            t.trackMax('bestDepth', 2);
            expect(t.getRunTitle('en')).toBe('A HARD FIGHT');
            expect(t.getRunTitle('ru')).toBe('ТЯЖЁЛЫЙ БОЙ');
        });

        it('bestDepth >= 3 with few enemies -> good-start title', () => {
            const t = new RunTracker();
            t.trackMax('bestDepth', 3);
            t.record('enemiesKilled', 2);
            expect(t.getRunTitle('en')).toBe('A GOOD START');
            expect(t.getRunTitle('ru')).toBe('ХОРОШЕЕ НАЧАЛО');
        });

        it('fresh tracker -> short-descent fallback title', () => {
            const t = new RunTracker();
            expect(t.getRunTitle('en')).toBe('A SHORT DESCENT');
            expect(t.getRunTitle('ru')).toBe('КОРОТКИЙ СПУСК');
        });
    });
});
