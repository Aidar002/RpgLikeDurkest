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
    relicsFound: number;
    bleedDamageDealt: number;
    stressResolutions: number;
    peakStress: number;
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
        relicsFound: 0,
        bleedDamageDealt: 0,
        stressResolutions: 0,
        peakStress: 0,
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
            if (s.bossesKilled > 0) lines.push(`Боссов побеждено: ${s.bossesKilled}`);
            lines.push(`Урон: ${s.damageDealt} нанесено  |  ${s.damageTaken} получено`);
            if (s.criticalHits > 0) lines.push(`Критических ударов: ${s.criticalHits}`);
            if (s.goldEarned > 0) lines.push(`Золото: ${s.goldEarned} найдено  |  ${s.goldSpent} потрачено`);
            if (s.potionsUsed > 0) lines.push(`Эликсиров выпито: ${s.potionsUsed}`);
            if (s.healingDone > 0) lines.push(`ОЗ восстановлено: ${s.healingDone}`);
            lines.push(`Ходов в бою: ${s.turnsInCombat}`);
            lines.push(`Достигнутый уровень: ${s.levelReached}`);
            if (s.relicsFound > 0) lines.push(`Реликвий найдено: ${s.relicsFound}`);
            if (s.bleedDamageDealt > 0) lines.push(`Урон кровотечением: ${s.bleedDamageDealt}`);
            if (s.peakStress > 0) lines.push(`Пик стресса: ${s.peakStress}`);
            if (s.stressResolutions > 0) lines.push(`Срывов/откровений: ${s.stressResolutions}`);
            return lines;
        }

        lines.push(`Rooms cleared: ${s.roomsVisited}`);
        lines.push(`Enemies defeated: ${s.enemiesKilled}`);
        if (s.elitesKilled > 0) lines.push(`Elites defeated: ${s.elitesKilled}`);
        if (s.bossesKilled > 0) lines.push(`Bosses defeated: ${s.bossesKilled}`);
        lines.push(`Damage: ${s.damageDealt} dealt  |  ${s.damageTaken} taken`);
        if (s.criticalHits > 0) lines.push(`Critical hits: ${s.criticalHits}`);
        if (s.goldEarned > 0) lines.push(`Gold: ${s.goldEarned} found  |  ${s.goldSpent} spent`);
        if (s.potionsUsed > 0) lines.push(`Potions used: ${s.potionsUsed}`);
        if (s.healingDone > 0) lines.push(`HP restored: ${s.healingDone}`);
        lines.push(`Combat turns: ${s.turnsInCombat}`);
        lines.push(`Level reached: ${s.levelReached}`);
        if (s.relicsFound > 0) lines.push(`Relics acquired: ${s.relicsFound}`);
        if (s.bleedDamageDealt > 0) lines.push(`Bleed damage: ${s.bleedDamageDealt}`);
        if (s.peakStress > 0) lines.push(`Peak stress: ${s.peakStress}`);
        if (s.stressResolutions > 0) lines.push(`Afflictions/virtues: ${s.stressResolutions}`);
        return lines;
    }

    getRunTitle(language: Language): string {
        const s = this.stats;
        if (language === 'ru') {
            if (s.bossesKilled >= 3) return 'ГЛУБОКАЯ ОХОТА';
            if (s.bossesKilled > 0) return 'ХРАНИТЕЛЬ ПАЛ';
            if (s.elitesKilled > 0) return 'СИЛЬНЫЙ ЗАБЕГ';
            if (s.bestDepth >= 5) return 'ГЛУБОКИЙ СПУСК';
            if (s.enemiesKilled >= 5) return 'ТЯЖЕЛЫЙ БОЙ';
            if (s.bestDepth >= 3) return 'ХОРОШЕЕ НАЧАЛО';
            return 'КОРОТКИЙ СПУСК';
        }

        if (s.bossesKilled >= 3) return 'A DEEP HUNT';
        if (s.bossesKilled > 0) return 'A KEEPER FELL';
        if (s.elitesKilled > 0) return 'A STRONG RUN';
        if (s.bestDepth >= 5) return 'A DEEP DESCENT';
        if (s.enemiesKilled >= 5) return 'A HARD FIGHT';
        if (s.bestDepth >= 3) return 'A GOOD START';
        return 'A SHORT DESCENT';
    }
}
