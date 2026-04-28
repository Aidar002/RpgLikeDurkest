import type { Language } from './Localization';

export interface RunStats {
    roomsVisited: number;
    enemiesKilled: number;
    elitesKilled: number;
    bossesKilled: number;
    damageDealt: number;
    damageTaken: number;
    goldEarned: number;
    goldSpent: number;
    potionsUsed: number;
    healingDone: number;
    skillsUsed: number;
    defendsUsed: number;
    trapsTriggered: number;
    shrinesVisited: number;
    merchantsVisited: number;
    criticalHits: number;
    turnsInCombat: number;
    bestDepth: number;
    levelReached: number;
}

export class RunTracker {
    private stats: RunStats = {
        roomsVisited: 0,
        enemiesKilled: 0,
        elitesKilled: 0,
        bossesKilled: 0,
        damageDealt: 0,
        damageTaken: 0,
        goldEarned: 0,
        goldSpent: 0,
        potionsUsed: 0,
        healingDone: 0,
        skillsUsed: 0,
        defendsUsed: 0,
        trapsTriggered: 0,
        shrinesVisited: 0,
        merchantsVisited: 0,
        criticalHits: 0,
        turnsInCombat: 0,
        bestDepth: 0,
        levelReached: 1,
    };

    record(key: keyof RunStats, amount: number = 1) {
        this.stats[key] += amount;
    }

    trackMax(key: keyof RunStats, value: number) {
        if (value > this.stats[key]) {
            this.stats[key] = value;
        }
    }

    get current(): Readonly<RunStats> {
        return this.stats;
    }

    getSummaryLines(language: Language): string[] {
        const s = this.stats;
        const lines: string[] = [];

        if (language === 'ru') {
            lines.push(`Комнат пройдено: ${s.roomsVisited}`);
            lines.push(`Врагов побеждено: ${s.enemiesKilled}`);
            if (s.elitesKilled > 0) lines.push(`Элиты побеждено: ${s.elitesKilled}`);
            if (s.bossesKilled > 0) lines.push(`Боссов повержено: ${s.bossesKilled}`);
            lines.push(`Урона нанесено: ${s.damageDealt}  |  получено: ${s.damageTaken}`);
            if (s.criticalHits > 0) lines.push(`Критических ударов: ${s.criticalHits}`);
            if (s.goldEarned > 0) lines.push(`Золота найдено: ${s.goldEarned}  |  потрачено: ${s.goldSpent}`);
            if (s.potionsUsed > 0) lines.push(`Эликсиров выпито: ${s.potionsUsed}`);
            if (s.healingDone > 0) lines.push(`ОЗ восстановлено: ${s.healingDone}`);
            lines.push(`Ходов в бою: ${s.turnsInCombat}`);
            lines.push(`Достигнутый уровень: ${s.levelReached}`);
            return lines;
        }

        lines.push(`Rooms explored: ${s.roomsVisited}`);
        lines.push(`Enemies defeated: ${s.enemiesKilled}`);
        if (s.elitesKilled > 0) lines.push(`Elites defeated: ${s.elitesKilled}`);
        if (s.bossesKilled > 0) lines.push(`Bosses felled: ${s.bossesKilled}`);
        lines.push(`Damage dealt: ${s.damageDealt}  |  taken: ${s.damageTaken}`);
        if (s.criticalHits > 0) lines.push(`Critical hits: ${s.criticalHits}`);
        if (s.goldEarned > 0) lines.push(`Gold found: ${s.goldEarned}  |  spent: ${s.goldSpent}`);
        if (s.potionsUsed > 0) lines.push(`Potions used: ${s.potionsUsed}`);
        if (s.healingDone > 0) lines.push(`HP restored: ${s.healingDone}`);
        lines.push(`Combat turns: ${s.turnsInCombat}`);
        lines.push(`Level reached: ${s.levelReached}`);
        return lines;
    }

    getRunTitle(language: Language): string {
        const s = this.stats;
        if (language === 'ru') {
            if (s.bossesKilled > 0) return 'ДОСТОЙНАЯ ЭКСПЕДИЦИЯ';
            if (s.elitesKilled > 0) return 'СМЕЛЫЙ СПУСК';
            if (s.bestDepth >= 5) return 'ГЛУБОКИЙ ЗАХОД';
            if (s.enemiesKilled >= 5) return 'КОНЕЦ БОЙЦА';
            if (s.bestDepth >= 3) return 'ОБЕЩАЮЩЕЕ НАЧАЛО';
            return 'КОРОТКАЯ ЭКСПЕДИЦИЯ';
        }

        if (s.bossesKilled > 0) return 'A WORTHY EXPEDITION';
        if (s.elitesKilled > 0) return 'A BOLD DESCENT';
        if (s.bestDepth >= 5) return 'A DEEP VENTURE';
        if (s.enemiesKilled >= 5) return "A FIGHTER'S END";
        if (s.bestDepth >= 3) return 'A PROMISING START';
        return 'A BRIEF EXPEDITION';
    }
}
