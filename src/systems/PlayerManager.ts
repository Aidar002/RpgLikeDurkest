import {
    COMBAT_CONFIG,
    EXPEDITION_CONFIG,
    FEATURES,
    LEVEL_UP_CONFIG,
    PLAYER_CONFIG,
    RELIC_CAP_CONFIG,
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
    light: number;
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
    /**
     * [FIX-8] One-time death-save flag for the run. Once any revive
     * source (Last Stand or Revenant's Spite) has fired, no further
     * revive may consume a charge.
     */
    public deathSaveConsumed = false;

    public readonly hpChange = new Emitter<{ hp: number; max: number }>();
    public readonly death = new Emitter<void>();
    public readonly levelUp = new Emitter<{ level: number }>();
    public readonly statsChange = new Emitter<void>();
    public readonly resourcesChange = new Emitter<void>();
    public readonly revive = new Emitter<{ remaining: number }>();
    public readonly relicsChange = new Emitter<void>();

    private xpMultiplier: number;
    private reviveCharges: number;
    private relicAggregate: RelicAggregate = emptyAggregate();

    constructor(bonuses: Partial<PlayerMetaBonuses> = {}) {
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

        this.resources = {
            gold: EXPEDITION_CONFIG.startingGold,
            potions: EXPEDITION_CONFIG.startingPotions,
            light: Math.min(
                EXPEDITION_CONFIG.maxLight,
                EXPEDITION_CONFIG.startingLight + startingLightBonus
            ),
            resolve: EXPEDITION_CONFIG.startingResolve,
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

    // Kept for historical call sites; resources are always available now.
    get isGoldUnlocked(): boolean { return true; }
    get isPotionUnlocked(): boolean { return true; }
    get isResolveUnlocked(): boolean { return true; }
    get isLightUnlocked(): boolean { return true; }
    get isRelicShardUnlocked(): boolean { return true; }

    get hasHighLight(): boolean {
        return this.resources.light >= EXPEDITION_CONFIG.highLightThreshold;
    }

    /**
     * [FIX-2] Strictly `< lowLightThreshold` (default 4). The previous
     * `<=` made low-light the default for the whole mid-run; the
     * patched threshold means the penalty kicks in only when the
     * lantern dips below the safe band.
     */
    get hasLowLight(): boolean {
        return this.resources.light < EXPEDITION_CONFIG.lowLightThreshold;
    }

    get aggregate(): RelicAggregate {
        return this.relicAggregate;
    }

    getAttackPower(): number {
        const light = FEATURES.light && this.hasHighLight ? COMBAT_CONFIG.highLightAttackBonus : 0;
        return this.stats.attack + light + this.relicAggregate.bonusAttack;
    }

    getCritChance(): number {
        const light = FEATURES.light && this.hasHighLight ? COMBAT_CONFIG.criticalChanceFromHighLight : 0;
        const raw = COMBAT_CONFIG.baseCritChance + light + this.relicAggregate.critChanceBonus;
        // [FIX-13] Hard cap on crit chance so Gambler's Knuckle plus
        // High Light can't push the build past 45%.
        return Math.min(raw, RELIC_CAP_CONFIG.gamblersCritCap);
    }

    getEnemyAttackBonusFromLight(): number {
        if (!FEATURES.light) return 0;
        if (!this.hasLowLight) return 0;
        return Math.round(
            COMBAT_CONFIG.lowLightEnemyAttackBonus * this.relicAggregate.lowLightPenaltyMult
        );
    }

    getRewardMultiplierFromLowLight(): number {
        if (!FEATURES.light) return 1;
        return this.hasLowLight ? COMBAT_CONFIG.lowLightRewardMultiplier : 1;
    }

    getEffectiveDefense(): number {
        return this.stats.defense + this.relicAggregate.bonusDefense;
    }

    takeDamage(amount: number, flatBlock: number = 0, source: 'combat' | 'trap' | 'true' = 'combat'): number {
        const defense = source === 'true' ? 0 : this.getEffectiveDefense();
        const reduced = amount - flatBlock - defense;
        const actual = reduced <= 0 && source !== 'true'
            ? 0
            : Math.max(source === 'true' ? 1 : COMBAT_CONFIG.minDamage, reduced);

        this.stats.hp = Math.max(0, this.stats.hp - actual);

        if (this.stats.hp === 0) {
            // [FIX-8] Last Stand (meta) takes priority over Revenant's
            // Spite (relic). Either source can fire, but only once per
            // run. If the death-save was already consumed earlier in
            // the run, both are blocked.
            if (!this.deathSaveConsumed && this.reviveCharges > 0) {
                this.reviveCharges--;
                this.deathSaveConsumed = true;
                if (this.relicAggregate.reviveOnce) {
                    // Block the relic too so the player can't double-dip.
                    this.relicAggregate.reviveOnce = false;
                }
                this.stats.hp = Math.max(1, Math.ceil(this.stats.maxHp * 0.4));
                this.emitAllChanges();
                this.revive.emit({ remaining: this.reviveCharges });
                return actual;
            }
            if (!this.deathSaveConsumed && this.relicAggregate.reviveOnce) {
                this.relicAggregate.reviveOnce = false;
                this.deathSaveConsumed = true;
                this.stats.hp = 10;
                this.emitAllChanges();
                this.revive.emit({ remaining: this.reviveCharges });
                return actual;
            }
        }

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
        // and no level-up loop can fire. Wisdom XP multiplier also stops
        // applying once we are past `wisdomXpBonusUpToLevel` so the late-
        // run reward curve flattens.
        if (this.stats.level >= LEVEL_UP_CONFIG.levelCap) {
            this.stats.xp = 0;
            this.emitStats();
            return 0;
        }
        const effectiveMult =
            this.stats.level > LEVEL_UP_CONFIG.wisdomXpBonusUpToLevel
                ? 1
                : this.xpMultiplier;
        const scaledAmount = Math.max(1, Math.round(amount * effectiveMult));
        this.stats.xp += scaledAmount;

        while (
            this.stats.level < LEVEL_UP_CONFIG.levelCap &&
            this.stats.xp >= this.xpToNextLevel
        ) {
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
        // [FIX-13] Cursed Coin's gold multiplier cannot exceed
        // RELIC_CAP_CONFIG.cursedCoinGoldMultiplierCap (default 2.0).
        const cappedMult = Math.min(
            this.relicAggregate.goldMultiplier,
            RELIC_CAP_CONFIG.cursedCoinGoldMultiplierCap
        );
        const scaled = Math.max(1, Math.round(amount * cappedMult));
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
        this.resources.resolve = Math.min(this.resources.maxResolve, this.resources.resolve + amount);
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

    gainLight(amount: number): number {
        if (amount <= 0) return 0;
        const previous = this.resources.light;
        this.resources.light = Math.min(EXPEDITION_CONFIG.maxLight, this.resources.light + amount);
        this.emitAllChanges();
        return this.resources.light - previous;
    }

    spendLight(amount: number): number {
        if (amount <= 0) return 0;
        const previous = this.resources.light;
        this.resources.light = Math.max(0, this.resources.light - amount);
        this.emitAllChanges();
        return previous - this.resources.light;
    }

    gainRelicShards(amount: number): number {
        if (!FEATURES.shards) return 0;
        if (amount <= 0) return 0;
        this.resources.relicShards += amount;
        this.emitResources();
        return amount;
    }

    spendRelicShard(amount: number): boolean {
        if (!FEATURES.shards) return false;
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

        // Starting light increase only triggers if we are still on run start.
        const addedLight = next.bonusStartingLight - prev.bonusStartingLight;
        if (addedLight > 0) {
            this.resources.light = Math.min(
                EXPEDITION_CONFIG.maxLight,
                this.resources.light + addedLight
            );
        }

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
