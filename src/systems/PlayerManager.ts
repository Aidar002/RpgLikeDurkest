import { COMBAT_CONFIG, EXPEDITION_CONFIG, LEVEL_UP_CONFIG, PLAYER_CONFIG } from '../data/GameConfig';
import type { PlayerMetaBonuses } from './MetaProgressionManager';

export interface PlayerStats {
    maxHp: number;
    hp: number;
    attack: number;
    defense: number;
    level: number;
    xp: number;
}

export interface RunResources {
    gold: number;
    potions: number;
    light: number;
    resolve: number;
    maxResolve: number;
    relicShards: number;
}

export interface RunResourceUnlocks {
    gold: boolean;
    potions: boolean;
    resolve: boolean;
    light: boolean;
    relicShards: boolean;
}

export class PlayerManager {
    public stats: PlayerStats;
    public resources: RunResources;
    public killCount = 0;

    public onHpChange: (hp: number, max: number) => void = () => {};
    public onDeath: () => void = () => {};
    public onLevelUp: (level: number) => void = () => {};
    public onStatsChange: () => void = () => {};
    public onResourcesChange: () => void = () => {};
    public onRevive: (remaining: number) => void = () => {};

    private xpMultiplier: number;
    private reviveCharges: number;
    private resourceUnlocks: RunResourceUnlocks;

    constructor(
        bonuses: Partial<PlayerMetaBonuses> = {},
        startingUnlocks: Partial<RunResourceUnlocks> = {}
    ) {
        const maxHpBonus = bonuses.maxHp ?? 0;
        const attackBonus = bonuses.attack ?? 0;
        const startingLightBonus = bonuses.startingLightBonus ?? 0;

        this.stats = {
            maxHp: PLAYER_CONFIG.maxHp + maxHpBonus,
            hp: PLAYER_CONFIG.hp + maxHpBonus,
            attack: PLAYER_CONFIG.attack + attackBonus,
            defense: PLAYER_CONFIG.defense,
            level: PLAYER_CONFIG.level,
            xp: PLAYER_CONFIG.xp,
        };

        this.resourceUnlocks = {
            gold: startingUnlocks.gold ?? false,
            potions: startingUnlocks.potions ?? false,
            resolve: startingUnlocks.resolve ?? false,
            light: startingUnlocks.light ?? false,
            relicShards: startingUnlocks.relicShards ?? false,
        };

        this.resources = {
            gold: this.resourceUnlocks.gold ? EXPEDITION_CONFIG.startingGold : 0,
            potions: this.resourceUnlocks.potions ? EXPEDITION_CONFIG.startingPotions : 0,
            light: this.resourceUnlocks.light
                ? Math.min(
                      EXPEDITION_CONFIG.maxLight,
                      EXPEDITION_CONFIG.startingLight + startingLightBonus
                  )
                : 0,
            resolve: this.resourceUnlocks.resolve ? EXPEDITION_CONFIG.startingResolve : 0,
            maxResolve: PLAYER_CONFIG.maxResolve,
            relicShards: 0,
        };

        this.xpMultiplier = bonuses.xpMultiplier ?? 1;
        this.reviveCharges = bonuses.reviveCharges ?? 0;
    }

    get xpToNextLevel(): number {
        return this.stats.level * LEVEL_UP_CONFIG.xpPerLevel;
    }

    get remainingRevives(): number {
        return this.reviveCharges;
    }

    get isGoldUnlocked(): boolean {
        return this.resourceUnlocks.gold;
    }

    get isPotionUnlocked(): boolean {
        return this.resourceUnlocks.potions;
    }

    get isResolveUnlocked(): boolean {
        return this.resourceUnlocks.resolve;
    }

    get isLightUnlocked(): boolean {
        return this.resourceUnlocks.light;
    }

    get isRelicShardUnlocked(): boolean {
        return this.resourceUnlocks.relicShards;
    }

    get hasHighLight(): boolean {
        return this.isLightUnlocked && this.resources.light >= EXPEDITION_CONFIG.highLightThreshold;
    }

    get hasLowLight(): boolean {
        return this.isLightUnlocked && this.resources.light <= EXPEDITION_CONFIG.lowLightThreshold;
    }

    getAttackPower(): number {
        return this.stats.attack + (this.hasHighLight ? COMBAT_CONFIG.highLightAttackBonus : 0);
    }

    getCritChance(): number {
        return this.hasHighLight ? COMBAT_CONFIG.criticalChanceFromHighLight : 0;
    }

    getEnemyAttackBonusFromLight(): number {
        return this.hasLowLight ? COMBAT_CONFIG.lowLightEnemyAttackBonus : 0;
    }

    getRewardMultiplierFromLowLight(): number {
        return this.hasLowLight ? COMBAT_CONFIG.lowLightRewardMultiplier : 1;
    }

    takeDamage(amount: number, flatBlock: number = 0): number {
        const reduced = amount - flatBlock - this.stats.defense;
        const actual = reduced <= 0 ? 0 : Math.max(COMBAT_CONFIG.minDamage, reduced);

        this.stats.hp = Math.max(0, this.stats.hp - actual);

        if (this.stats.hp === 0 && this.reviveCharges > 0) {
            this.reviveCharges--;
            this.stats.hp = Math.max(1, Math.ceil(this.stats.maxHp * 0.4));
            this.emitAllChanges();
            this.onRevive(this.reviveCharges);
            return actual;
        }

        this.emitAllChanges();

        if (this.stats.hp === 0) {
            this.onDeath();
        }

        return actual;
    }

    heal(amount: number): number {
        const previousHp = this.stats.hp;
        this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + amount);
        this.emitStats();
        return this.stats.hp - previousHp;
    }

    gainXp(amount: number): number {
        const scaledAmount = Math.max(1, Math.round(amount * this.xpMultiplier));
        this.stats.xp += scaledAmount;

        while (this.stats.xp >= this.xpToNextLevel) {
            this.stats.xp -= this.xpToNextLevel;
            this.levelUp();
        }

        this.emitStats();
        return scaledAmount;
    }

    registerKill() {
        this.killCount++;
        this.emitStats();
    }

    gainGold(amount: number): number {
        if (!this.isGoldUnlocked || amount <= 0) {
            return 0;
        }

        this.resources.gold += amount;
        this.emitResources();
        return amount;
    }

    spendGold(amount: number): boolean {
        if (!this.isGoldUnlocked || amount > this.resources.gold) {
            return false;
        }

        this.resources.gold -= amount;
        this.emitResources();
        return true;
    }

    gainPotions(amount: number): number {
        if (!this.isPotionUnlocked || amount <= 0) {
            return 0;
        }

        this.resources.potions += amount;
        this.emitResources();
        return amount;
    }

    spendPotion(): boolean {
        if (!this.isPotionUnlocked || this.resources.potions <= 0) {
            return false;
        }

        this.resources.potions -= 1;
        this.emitResources();
        return true;
    }

    gainResolve(amount: number): number {
        if (!this.isResolveUnlocked || amount <= 0) {
            return 0;
        }

        const previous = this.resources.resolve;
        this.resources.resolve = Math.min(this.resources.maxResolve, this.resources.resolve + amount);
        this.emitResources();
        return this.resources.resolve - previous;
    }

    spendResolve(amount: number): boolean {
        if (!this.isResolveUnlocked || amount > this.resources.resolve) {
            return false;
        }

        this.resources.resolve -= amount;
        this.emitResources();
        return true;
    }

    gainLight(amount: number): number {
        if (!this.isLightUnlocked || amount <= 0) {
            return 0;
        }

        const previous = this.resources.light;
        this.resources.light = Math.min(EXPEDITION_CONFIG.maxLight, this.resources.light + amount);
        this.emitAllChanges();
        return this.resources.light - previous;
    }

    spendLight(amount: number): number {
        if (!this.isLightUnlocked || amount <= 0) {
            return 0;
        }

        const previous = this.resources.light;
        this.resources.light = Math.max(0, this.resources.light - amount);
        this.emitAllChanges();
        return previous - this.resources.light;
    }

    gainRelicShards(amount: number): number {
        if (!this.isRelicShardUnlocked || amount <= 0) {
            return 0;
        }

        this.resources.relicShards += amount;
        this.emitResources();
        return amount;
    }

    spendRelicShard(amount: number): boolean {
        if (!this.isRelicShardUnlocked || amount > this.resources.relicShards) {
            return false;
        }

        this.resources.relicShards -= amount;
        this.emitResources();
        return true;
    }

    unlockGold(initialGold: number = 0) {
        if (this.isGoldUnlocked) {
            return;
        }

        this.resourceUnlocks.gold = true;
        this.resources.gold = Math.max(0, initialGold);
        this.emitResources();
    }

    unlockPotions(initialPotions: number = 0) {
        if (this.isPotionUnlocked) {
            return;
        }

        this.resourceUnlocks.potions = true;
        this.resources.potions = Math.max(0, initialPotions);
        this.emitResources();
    }

    unlockResolve(initialResolve: number = EXPEDITION_CONFIG.startingResolve) {
        if (this.isResolveUnlocked) {
            return;
        }

        this.resourceUnlocks.resolve = true;
        this.resources.resolve = Math.min(this.resources.maxResolve, Math.max(0, initialResolve));
        this.emitResources();
    }

    unlockLight(initialLight: number) {
        if (this.isLightUnlocked) {
            return;
        }

        this.resourceUnlocks.light = true;
        this.resources.light = Math.min(EXPEDITION_CONFIG.maxLight, Math.max(0, initialLight));
        this.emitAllChanges();
    }

    unlockRelicShards() {
        if (this.isRelicShardUnlocked) {
            return;
        }

        this.resourceUnlocks.relicShards = true;
        this.resources.relicShards = Math.max(0, this.resources.relicShards);
        this.emitResources();
    }

    addAttackBonus(amount: number) {
        if (amount <= 0) {
            return;
        }

        this.stats.attack += amount;
        this.emitStats();
    }

    addDefenseBonus(amount: number) {
        if (amount <= 0) {
            return;
        }

        this.stats.defense += amount;
        this.emitStats();
    }

    addMaxHpBonus(amount: number, healAmount: number = amount) {
        if (amount <= 0) {
            return;
        }

        this.stats.maxHp += amount;
        this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + Math.max(0, healAmount));
        this.emitStats();
    }

    private levelUp() {
        this.stats.level++;
        this.stats.maxHp += LEVEL_UP_CONFIG.hpGainPerLevel;
        this.stats.attack += LEVEL_UP_CONFIG.attackGainPerLevel;

        if (this.stats.level % LEVEL_UP_CONFIG.defenseEveryNLevels === 0) {
            this.stats.defense++;
        }

        if (this.isResolveUnlocked && this.stats.level % LEVEL_UP_CONFIG.resolveEveryNLevels === 0) {
            this.resources.maxResolve += 1;
            this.resources.resolve = this.resources.maxResolve;
        }

        if (LEVEL_UP_CONFIG.healOnLevelUp) {
            this.stats.hp = this.stats.maxHp;
        }

        this.emitAllChanges();
        this.onLevelUp(this.stats.level);
    }

    private emitStats() {
        this.onHpChange(this.stats.hp, this.stats.maxHp);
        this.onStatsChange();
    }

    private emitResources() {
        this.onResourcesChange();
        this.onStatsChange();
    }

    private emitAllChanges() {
        this.emitStats();
        this.onResourcesChange();
    }
}
