/**
 * Coverage for the player state machine: hp / xp / level / resources /
 * relics. PlayerManager is one of the largest pure-logic systems in the
 * codebase. These tests pin down the contract callers (CombatManager,
 * RoomFlow, the scene) rely on so future refactors can move methods
 * around safely.
 */
import { describe, expect, it } from 'vitest';

import {
    COMBAT_CONFIG,
    EXPEDITION_CONFIG,
    LEVEL_UP_CONFIG,
    PLAYER_CONFIG,
} from '../src/data/GameConfig';
import { PlayerManager } from '../src/systems/PlayerManager';

describe('PlayerManager — construction', () => {
    it('starts at config defaults with no bonuses', () => {
        const player = new PlayerManager();

        expect(player.stats.maxHp).toBe(PLAYER_CONFIG.maxHp);
        expect(player.stats.hp).toBe(PLAYER_CONFIG.hp);
        expect(player.stats.attack).toBe(PLAYER_CONFIG.attack);
        expect(player.stats.defense).toBe(PLAYER_CONFIG.defense);
        expect(player.stats.level).toBe(PLAYER_CONFIG.level);
        expect(player.stats.xp).toBe(0);

        expect(player.resources.gold).toBe(EXPEDITION_CONFIG.startingGold);
        expect(player.resources.potions).toBe(EXPEDITION_CONFIG.startingPotions);
        expect(player.resources.light).toBe(EXPEDITION_CONFIG.startingLight);
        expect(player.resources.resolve).toBe(EXPEDITION_CONFIG.startingResolve);
        expect(player.resources.relicShards).toBe(0);

        expect(player.killCount).toBe(0);
        expect(player.relics).toEqual([]);
    });

    it('applies meta bonuses (maxHp / attack / defense)', () => {
        const player = new PlayerManager({
            maxHp: 6,
            attack: 2,
            defenseBonus: 3,
        });

        expect(player.stats.maxHp).toBe(PLAYER_CONFIG.maxHp + 6);
        expect(player.stats.hp).toBe(PLAYER_CONFIG.hp + 6);
        expect(player.stats.attack).toBe(PLAYER_CONFIG.attack + 2);
        expect(player.stats.defense).toBe(PLAYER_CONFIG.defense + 3);
    });
});

describe('PlayerManager — damage and death', () => {
    it('reduces hp by amount minus defense, clamped to minDamage', () => {
        const player = new PlayerManager();
        const before = player.stats.hp;
        const def = PLAYER_CONFIG.defense;

        player.takeDamage(5);

        expect(player.stats.hp).toBe(
            before - Math.max(COMBAT_CONFIG.minDamage, 5 - def),
        );
    });

    it('emits hpChange with the new hp/max when damaged', () => {
        const player = new PlayerManager();
        const seen: { hp: number; max: number }[] = [];
        player.hpChange.on((p) => seen.push(p));

        player.takeDamage(3);

        expect(seen.length).toBeGreaterThan(0);
        expect(seen[seen.length - 1]).toEqual({
            hp: player.stats.hp,
            max: player.stats.maxHp,
        });
    });

    it('emits death exactly once when hp hits 0 with no revives', () => {
        const player = new PlayerManager();
        let deaths = 0;
        player.death.on(() => deaths++);

        player.takeDamage(9999);

        expect(player.stats.hp).toBe(0);
        expect(deaths).toBe(1);
    });

    it('treats source="true" damage as ignoring defense and forcing minimum 1', () => {
        const player = new PlayerManager();
        const before = player.stats.hp;

        // amount=2, flatBlock=0, source=true → defense ignored.
        const dealt = player.takeDamage(2, 0, 'true');

        expect(dealt).toBe(2);
        expect(player.stats.hp).toBe(before - 2);
    });

    it('respects flatBlock (e.g. defend stance) before defense reduction', () => {
        const player = new PlayerManager();
        const before = player.stats.hp;
        const def = PLAYER_CONFIG.defense;

        // 5 raw - 3 block - def, with the minDamage clamp on the floor.
        player.takeDamage(5, 3);

        expect(player.stats.hp).toBe(
            before - Math.max(COMBAT_CONFIG.minDamage, 5 - 3 - def),
        );
    });
});

describe('PlayerManager — heal and resources', () => {
    it('caps heal at maxHp and returns the actual amount healed', () => {
        const player = new PlayerManager();
        player.takeDamage(5);
        const healed = player.heal(999);

        expect(player.stats.hp).toBe(player.stats.maxHp);
        expect(healed).toBeGreaterThan(0);
    });

    it('gainGold adds and emits resourcesChange; spendGold validates', () => {
        const player = new PlayerManager();
        let resourceEvents = 0;
        player.resourcesChange.on(() => resourceEvents++);

        const gained = player.gainGold(10);
        expect(gained).toBe(10);
        expect(player.resources.gold).toBe(EXPEDITION_CONFIG.startingGold + 10);
        expect(resourceEvents).toBeGreaterThan(0);

        const ok = player.spendGold(5);
        expect(ok).toBe(true);
        expect(player.resources.gold).toBe(EXPEDITION_CONFIG.startingGold + 5);

        const tooMuch = player.spendGold(9999);
        expect(tooMuch).toBe(false);
    });

    it('spendPotion fails when at zero', () => {
        const player = new PlayerManager();
        // Spend until empty.
        for (let i = 0; i < EXPEDITION_CONFIG.startingPotions; i++) {
            expect(player.spendPotion()).toBe(true);
        }
        expect(player.spendPotion()).toBe(false);
    });

    it('gainLight is capped at maxLight; spendLight floors at 0', () => {
        const player = new PlayerManager();
        player.gainLight(999);
        expect(player.resources.light).toBe(EXPEDITION_CONFIG.maxLight);

        player.spendLight(999);
        expect(player.resources.light).toBe(0);
    });

    it('hasHighLight / hasLowLight flip with the configured thresholds', () => {
        const player = new PlayerManager();

        // [FIX-2] hasLowLight is strictly `< lowLightThreshold`, so we
        // gain `threshold - 1` here to land inside the low band.
        player.spendLight(player.resources.light);
        player.gainLight(Math.max(0, EXPEDITION_CONFIG.lowLightThreshold - 1));
        expect(player.hasLowLight).toBe(true);
        expect(player.hasHighLight).toBe(false);

        // Right at the threshold the player is no longer low-light.
        player.gainLight(1);
        expect(player.hasLowLight).toBe(false);

        player.gainLight(EXPEDITION_CONFIG.maxLight);
        expect(player.hasHighLight).toBe(true);
        expect(player.hasLowLight).toBe(false);
    });

    it('gainResolve clamps at maxResolve; spendResolve validates affordability', () => {
        const player = new PlayerManager();
        player.gainResolve(999);
        expect(player.resources.resolve).toBe(player.resources.maxResolve);

        const ok = player.spendResolve(player.resources.maxResolve);
        expect(ok).toBe(true);
        expect(player.resources.resolve).toBe(0);

        expect(player.spendResolve(1)).toBe(false);
    });
});

describe('PlayerManager — xp and level up', () => {
    it('gainXp accumulates and applies a level-up at xpPerLevel', () => {
        const player = new PlayerManager();
        const startingMaxHp = player.stats.maxHp;
        const startingAttack = player.stats.attack;

        let levelUps = 0;
        player.levelUp.on(() => levelUps++);

        player.gainXp(LEVEL_UP_CONFIG.xpPerLevel);

        expect(player.stats.level).toBe(2);
        expect(levelUps).toBe(1);
        expect(player.stats.maxHp).toBe(
            startingMaxHp + LEVEL_UP_CONFIG.hpGainPerLevel,
        );
        expect(player.stats.attack).toBe(
            startingAttack + LEVEL_UP_CONFIG.attackGainPerLevel,
        );
    });

    it('healOnLevelUp restores hp to max', () => {
        const player = new PlayerManager();
        player.takeDamage(5);
        expect(player.stats.hp).toBeLessThan(player.stats.maxHp);

        player.gainXp(LEVEL_UP_CONFIG.xpPerLevel);

        if (LEVEL_UP_CONFIG.healOnLevelUp) {
            expect(player.stats.hp).toBe(player.stats.maxHp);
        }
    });

    it('goldGainMult scales every gainGold call after rounding', () => {
        const player = new PlayerManager({ goldGainMult: 1.2 });
        const startGold = player.resources.gold;

        const gained = player.gainGold(10); // 10 * 1.2 = 12
        expect(gained).toBe(12);
        expect(player.resources.gold).toBe(startGold + 12);
    });

    it('multiple level-ups happen in one call when xp overflows several thresholds', () => {
        const player = new PlayerManager();
        let levelUps = 0;
        player.levelUp.on(() => levelUps++);

        // Enough to span at least 2 level thresholds.
        player.gainXp(LEVEL_UP_CONFIG.xpPerLevel * 5);

        expect(levelUps).toBeGreaterThanOrEqual(2);
        expect(player.stats.level).toBeGreaterThanOrEqual(3);
    });
});

describe('PlayerManager — kills and stat bonuses', () => {
    it('registerKill increments killCount', () => {
        const player = new PlayerManager();
        player.registerKill();
        player.registerKill();
        expect(player.killCount).toBe(2);
    });

    it('addAttackBonus / addDefenseBonus / addMaxHpBonus are non-negative gates', () => {
        const player = new PlayerManager();
        const atk = player.stats.attack;
        const def = player.stats.defense;
        const max = player.stats.maxHp;

        player.addAttackBonus(0);
        player.addAttackBonus(-5);
        player.addDefenseBonus(0);
        player.addMaxHpBonus(0);
        expect(player.stats.attack).toBe(atk);
        expect(player.stats.defense).toBe(def);
        expect(player.stats.maxHp).toBe(max);

        player.addAttackBonus(2);
        player.addDefenseBonus(1);
        player.addMaxHpBonus(5);
        expect(player.stats.attack).toBe(atk + 2);
        expect(player.stats.defense).toBe(def + 1);
        expect(player.stats.maxHp).toBe(max + 5);
    });

    it('addMaxHpBonus does not overheal past the new max', () => {
        const player = new PlayerManager();
        player.takeDamage(5);
        const beforeHp = player.stats.hp;
        const beforeMax = player.stats.maxHp;

        player.addMaxHpBonus(3, 999); // huge heal request, should clamp.
        expect(player.stats.maxHp).toBe(beforeMax + 3);
        expect(player.stats.hp).toBeLessThanOrEqual(player.stats.maxHp);
        expect(player.stats.hp).toBeGreaterThan(beforeHp);
    });
});

describe('PlayerManager — relics', () => {
    it('addRelic is idempotent (cannot stack the same relic id)', () => {
        const player = new PlayerManager();
        let changes = 0;
        player.relicsChange.on(() => changes++);

        player.addRelic('worn_ring');
        player.addRelic('worn_ring');

        expect(player.relics).toEqual(['worn_ring']);
        expect(changes).toBe(1);
    });

    it('removeRelic removes only the matching id and emits change', () => {
        const player = new PlayerManager();
        player.addRelic('worn_ring');
        player.addRelic('cracked_shield');

        let changes = 0;
        player.relicsChange.on(() => changes++);

        player.removeRelic('worn_ring');
        expect(player.relics).toEqual(['cracked_shield']);
        expect(changes).toBe(1);

        // Removing a non-present id is a no-op (no event).
        player.removeRelic('worn_ring');
        expect(changes).toBe(1);
    });

    it('getRelicNames returns one localized name per relic in order', () => {
        const player = new PlayerManager();
        player.addRelic('worn_ring');
        player.addRelic('cracked_shield');

        const names = player.getRelicNames('en');
        expect(names).toHaveLength(2);
        for (const name of names) {
            expect(typeof name).toBe('string');
            expect(name.length).toBeGreaterThan(0);
        }
    });
});
