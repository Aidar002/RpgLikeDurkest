export interface PlayerStats {
    maxHp: number;
    hp: number;
    attack: number;
    defense: number;
    level: number;
    xp: number;
}

export class PlayerManager {
    public stats: PlayerStats;
    public killCount = 0;

    public onHpChange: (hp: number, max: number) => void = () => {};
    public onDeath: () => void = () => {};
    public onLevelUp: (level: number) => void = () => {};

    constructor() {
        this.stats = { maxHp: 20, hp: 20, attack: 5, defense: 1, level: 1, xp: 0 };
    }

    takeDamage(amount: number): number {
        const actual = Math.max(1, amount - this.stats.defense);
        this.stats.hp = Math.max(0, this.stats.hp - actual);
        this.onHpChange(this.stats.hp, this.stats.maxHp);
        if (this.stats.hp === 0) this.onDeath();
        return actual;
    }

    heal(amount: number) {
        this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + amount);
        this.onHpChange(this.stats.hp, this.stats.maxHp);
    }

    gainXp(amount: number) {
        this.stats.xp += amount;
        const needed = this.stats.level * 10;
        if (this.stats.xp >= needed) {
            this.stats.xp -= needed;
            this.levelUp();
        }
    }

    private levelUp() {
        this.stats.level++;
        this.stats.maxHp += 5;
        this.stats.hp = this.stats.maxHp;
        this.stats.attack += 1;
        this.onHpChange(this.stats.hp, this.stats.maxHp);
        this.onLevelUp(this.stats.level);
    }
}
