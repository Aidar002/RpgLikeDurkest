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

    getSummaryLines(): string[] {
        const s = this.stats;
        const lines: string[] = [];
        lines.push(`Rooms explored: ${s.roomsVisited}`);
        lines.push(`Enemies slain: ${s.enemiesKilled}`);
        if (s.elitesKilled > 0) lines.push(`Elites defeated: ${s.elitesKilled}`);
        if (s.bossesKilled > 0) lines.push(`Bosses felled: ${s.bossesKilled}`);
        lines.push(`Damage dealt: ${s.damageDealt}  |  Taken: ${s.damageTaken}`);
        if (s.criticalHits > 0) lines.push(`Critical hits: ${s.criticalHits}`);
        if (s.goldEarned > 0) lines.push(`Gold earned: ${s.goldEarned}  |  Spent: ${s.goldSpent}`);
        if (s.potionsUsed > 0) lines.push(`Potions consumed: ${s.potionsUsed}`);
        if (s.healingDone > 0) lines.push(`HP restored: ${s.healingDone}`);
        lines.push(`Combat turns: ${s.turnsInCombat}`);
        lines.push(`Level reached: ${s.levelReached}`);
        return lines;
    }

    getRunTitle(): string {
        const s = this.stats;
        if (s.bossesKilled > 0) return 'A WORTHY EXPEDITION';
        if (s.elitesKilled > 0) return 'A BOLD DESCENT';
        if (s.bestDepth >= 5) return 'A DEEP VENTURE';
        if (s.enemiesKilled >= 5) return 'A FIGHTER\'S END';
        if (s.bestDepth >= 3) return 'A PROMISING START';
        return 'A BRIEF EXPEDITION';
    }
}
