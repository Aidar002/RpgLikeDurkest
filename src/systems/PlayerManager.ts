import {
    COMBAT_CONFIG,
    EXPEDITION_CONFIG,
    LEVEL_UP_CONFIG,
    PLAYER_CONFIG,
} from '../data/GameConfig';
import { Emitter } from './Emitter';
import type { PlayerMetaBonuses } from './MetaProgressionManager';
import { pickLocalized } from './LocalizedText';
import type { RelicAggregate, RelicId } from './Relics';
import { aggregateRelics, emptyAggregate, RELICS } from './Relics';
import { emptyStatusState } from './StatusEffects';
import type { StatusState } from './StatusEffects';

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
    resolve: number;
    maxResolve: number;
    relicShards: number;
}

export class PlayerManager {
    public stats: PlayerStats;
    public resources: RunResources;
    public killCount = 0;
    public status: StatusState = emptyStatusState();
    public relics: RelicId[] = [];

    public readonly hpChange = new Emitter<{ hp: number; max: number }>();
    public readonly death = new Emitter<void>();
    public readonly levelUp = new Emitter<{ level: number }>();
    public readonly statsChange = new Emitter<void>();
    public readonly resourcesChange = new Emitter<void>();
    public readonly relicsChange = new Emitter<void>();

    private goldGainMult: number;
    private relicAggregate: RelicAggregate = emptyAggregate();

    constructor(bonuses: Partial<PlayerMetaBonuses> = {}) {
        const maxHpBonus = bonuses.maxHp ?? 0;
        const attackBonus = bonuses.attack ?? 0;
        const defenseBonus = bonuses.defenseBonus ?? 0;

        this.stats = {
            maxHp: PLAYER_CONFIG.maxHp + maxHpBonus,
            hp: PLAYER_CONFIG.hp + maxHpBonus,
            attack: PLAYER_CONFIG.attack + attackBonus,
            defense: PLAYER_CONFIG.defense + defenseBonus,
            level: PLAYER_CONFIG.level,
            xp: PLAYER_CONFIG.xp,
        };

        this.resources = {
            gold: EXPEDITION_CONFIG.startingGold,
            potions: EXPEDITION_CONFIG.startingPotions,
            resolve: EXPEDITION_CONFIG.startingResolve,
            maxResolve: PLAYER_CONFIG.maxResolve,
            relicShards: 0,
        };

        this.goldGainMult = bonuses.goldGainMult ?? 1;
    }

    get xpToNextLevel(): number {
        return this.stats.level * LEVEL_UP_CONFIG.xpPerLevel;
    }

    get aggregate(): RelicAggregate {
        return this.relicAggregate;
    }

    getAttackPower(): number {
        let setBonus = 0;
        // Flesh set: +2 attack while HP < 50% (lives/max strictly less).
        if (this.relicAggregate.sets.flesh && this.stats.hp * 2 < this.stats.maxHp) {
            setBonus += 2;
        }
        return this.stats.attack + this.relicAggregate.bonusAttack + setBonus;
    }

    getCritChance(): number {
        return COMBAT_CONFIG.baseCritChance;
    }

    getEffectiveDefense(): number {
        let setBonus = 0;
        // Flesh set: +1 defense while HP > 50% (strictly more).
        if (this.relicAggregate.sets.flesh && this.stats.hp * 2 > this.stats.maxHp) {
            setBonus += 1;
        }
        return this.stats.defense + this.relicAggregate.bonusDefense + setBonus;
    }

    takeDamage(
        amount: number,
        flatBlock: number = 0,
        source: 'combat' | 'trap' | 'true' = 'combat'
    ): number {
        const defense = source === 'true' ? 0 : this.getEffectiveDefense();
        const reduced = amount - flatBlock - defense;
        const actual =
            reduced <= 0 && source !== 'true'
                ? 0
                : Math.max(source === 'true' ? 1 : COMBAT_CONFIG.minDamage, reduced);

        this.stats.hp = Math.max(0, this.stats.hp - actual);

        this.emitAllChanges();

        if (this.stats.hp === 0) {
            this.death.emit();
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
        // [FIX-9] Hard level cap. Past the cap, no further XP is awarded
        // and no level-up loop can fire.
        if (this.stats.level >= LEVEL_UP_CONFIG.levelCap) {
            this.stats.xp = 0;
            this.emitStats();
            return 0;
        }
        const scaledAmount = Math.max(1, Math.round(amount));
        this.stats.xp += scaledAmount;

        while (this.stats.level < LEVEL_UP_CONFIG.levelCap && this.stats.xp >= this.xpToNextLevel) {
            this.stats.xp -= this.xpToNextLevel;
            this.applyLevelUp();
        }

        if (this.stats.level >= LEVEL_UP_CONFIG.levelCap) {
            this.stats.xp = 0;
        }

        this.emitStats();
        return scaledAmount;
    }

    /** True when the player has reached the configured level cap. */
    get atLevelCap(): boolean {
        return this.stats.level >= LEVEL_UP_CONFIG.levelCap;
    }

    registerKill() {
        this.killCount++;
        this.emitStats();
    }

    gainGold(amount: number): number {
        if (amount <= 0) return 0;
        const scaled = Math.max(0, Math.round(amount * this.goldGainMult));
        if (scaled <= 0) return 0;
        this.resources.gold += scaled;
        this.emitResources();
        return scaled;
    }

    spendGold(amount: number): boolean {
        if (amount > this.resources.gold) return false;
        this.resources.gold -= amount;
        this.emitResources();
        return true;
    }

    gainPotions(amount: number): number {
        if (amount <= 0) return 0;
        this.resources.potions += amount;
        this.emitResources();
        return amount;
    }

    spendPotion(): boolean {
        if (this.resources.potions <= 0) return false;
        this.resources.potions -= 1;
        this.emitResources();
        return true;
    }

    gainResolve(amount: number): number {
        if (amount <= 0) return 0;
        const previous = this.resources.resolve;
        this.resources.resolve = Math.min(
            this.resources.maxResolve,
            this.resources.resolve + amount
        );
        this.emitResources();
        return this.resources.resolve - previous;
    }

    spendResolve(amount: number): boolean {
        if (amount > this.resources.resolve) return false;
        // [FIX-3] Defensive clamp — guarantees `resolve >= 0` even if a
        // bug elsewhere requested a negative-spend.
        this.resources.resolve = Math.max(
            0,
            Math.min(this.resources.maxResolve, this.resources.resolve - amount)
        );
        this.emitResources();
        return true;
    }

    gainRelicShards(amount: number): number {
        if (amount <= 0) return 0;
        this.resources.relicShards += amount;
        this.emitResources();
        return amount;
    }

    spendRelicShard(amount: number): boolean {
        if (amount > this.resources.relicShards) return false;
        this.resources.relicShards -= amount;
        this.emitResources();
        return true;
    }

    addRelic(id: RelicId) {
        if (this.relics.includes(id)) return;
        this.relics.push(id);
        this.recomputeAggregate();
    }

    removeRelic(id: RelicId) {
        const idx = this.relics.indexOf(id);
        if (idx < 0) return;
        this.relics.splice(idx, 1);
        this.recomputeAggregate();
    }

    getRelicNames(language: 'ru' | 'en' = 'ru'): string[] {
        return this.relics.map((id) => pickLocalized(language, RELICS[id].name));
    }

    addAttackBonus(amount: number) {
        if (amount <= 0) return;
        this.stats.attack += amount;
        this.emitStats();
    }

    addDefenseBonus(amount: number) {
        if (amount <= 0) return;
        this.stats.defense += amount;
        this.emitStats();
    }

    addMaxHpBonus(amount: number, healAmount: number = amount) {
        if (amount <= 0) return;
        this.stats.maxHp += amount;
        this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + Math.max(0, healAmount));
        this.emitStats();
    }

    /**
     * Toggle the Sara "vampire blessing" buff via aggregate. Stored on
     * the aggregate so combat code can read it through the same hook
     * relic effects use; no extra plumbing needed.
     */
    setVampireBlessing(active: boolean) {
        this.relicAggregate.vampireBlessingChance = active ? 0.25 : 0;
        this.relicAggregate.vampireBlessingAmount = active ? 2 : 0;
    }

    private recomputeAggregate() {
        const prev = this.relicAggregate;
        const next = aggregateRelics(this.relics);

        // MaxHp relic bonus is applied once when aggregate grows.
        const addedMaxHp = next.bonusMaxHp - prev.bonusMaxHp;
        if (addedMaxHp > 0) {
            this.stats.maxHp += addedMaxHp;
            this.stats.hp += addedMaxHp;
        } else if (addedMaxHp < 0) {
            this.stats.maxHp = Math.max(1, this.stats.maxHp + addedMaxHp);
            this.stats.hp = Math.min(this.stats.hp, this.stats.maxHp);
        }

        // Preserve the Sara vampire-blessing buff across relic changes.
        const vampireChance = prev.vampireBlessingChance;
        const vampireAmount = prev.vampireBlessingAmount;
        next.vampireBlessingChance = Math.max(next.vampireBlessingChance, vampireChance);
        next.vampireBlessingAmount = Math.max(next.vampireBlessingAmount, vampireAmount);

        this.relicAggregate = next;
        this.emitAllChanges();
        this.relicsChange.emit();
    }

    private applyLevelUp() {
        // [FIX-9] Belt-and-braces guard: gainXp() is the only caller and
        // already blocks past the cap, but applyLevelUp() is safe even
        // if a future call site forgets that.
        if (this.stats.level >= LEVEL_UP_CONFIG.levelCap) {
            return;
        }
        this.stats.level++;
        this.stats.maxHp += LEVEL_UP_CONFIG.hpGainPerLevel;
        this.stats.attack += LEVEL_UP_CONFIG.attackGainPerLevel;

        if (this.stats.level % LEVEL_UP_CONFIG.defenseEveryNLevels === 0) {
            this.stats.defense++;
        }

        if (this.stats.level % LEVEL_UP_CONFIG.resolveEveryNLevels === 0) {
            this.resources.maxResolve += 1;
            this.resources.resolve = this.resources.maxResolve;
        }

        if (LEVEL_UP_CONFIG.healOnLevelUp) {
            this.stats.hp = this.stats.maxHp;
        }

        this.emitAllChanges();
        this.levelUp.emit({ level: this.stats.level });
    }

    private emitStats() {
        this.hpChange.emit({ hp: this.stats.hp, max: this.stats.maxHp });
        this.statsChange.emit();
    }

    private emitResources() {
        this.resourcesChange.emit();
        this.statsChange.emit();
    }

    private emitAllChanges() {
        this.emitStats();
        this.resourcesChange.emit();
    }
}
