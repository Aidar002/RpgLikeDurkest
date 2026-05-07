import { describe, expect, it } from 'vitest';
import {
    EXPECTED_BOSS_NAMES,
    assertBossMapping,
    getBossForDepth,
} from '../src/data/Enemies';
import {
    EXPEDITION_CONFIG,
    LEVEL_UP_CONFIG,
    LIGHT_CONFIG,
    RELIC_CAP_CONFIG,
    RUPTURE_CONFIG,
    STRESS_BAND_CONFIG,
    STUN_RESIST_CONFIG,
    RESOLVE_TEST_CONFIG,
    PLAYER_CONFIG,
    MAP_CONFIG,
} from '../src/data/GameConfig';
import { CombatManager } from '../src/systems/CombatManager';
import { PlayerManager } from '../src/systems/PlayerManager';
import { Mulberry32 } from '../src/systems/Rng';
import { aggregateRelics } from '../src/systems/Relics';
import { StressManager } from '../src/systems/Stress';
import { shouldDecayLight } from '../src/systems/Light';
import type { EventLog } from '../src/ui/EventLog';

function makeCombat(seed = 1) {
    const player = new PlayerManager();
    const log = {
        addMessage: () => {
            /* no-op */
        },
    } as unknown as EventLog;
    const combat = new CombatManager(player, log, null, undefined, new Mulberry32(seed));
    return { player, combat };
}

describe('[FIX-4] Boss mapping (canonical depth -> name)', () => {
    it('maps every required depth to the expected boss', () => {
        for (const [depthStr, expectedName] of Object.entries(EXPECTED_BOSS_NAMES)) {
            const def = getBossForDepth(Number(depthStr));
            expect(def.name).toBe(expectedName);
        }
    });

    it('does NOT regress to Nameless Maw at depth 25', () => {
        const def = getBossForDepth(MAP_CONFIG.finalDepth);
        expect(def.name).not.toBe('Nameless Maw');
        expect(def.name).toBe('The Undying Wound');
    });

    it('assertBossMapping does not throw for the canonical table', () => {
        expect(() => assertBossMapping()).not.toThrow();
    });
});

describe('[FIX-1] Final boss configuration', () => {
    it('the depth-25 boss has the configured stats and final-boss profile', () => {
        const def = getBossForDepth(25);
        expect(def.name).toBe('The Undying Wound');
        expect(def.hp).toBe(140);
        expect(def.attack).toBe(15);
        expect(def.profile).toBe('final_boss');
    });

    it('STUN_RESIST_CONFIG has The Undying Wound at 95%', () => {
        expect(STUN_RESIST_CONFIG.bossByName['The Undying Wound']).toBe(0.95);
    });
});

describe('[FIX-3] Starting resolve and clamps', () => {
    it('starting resolve = 2', () => {
        expect(EXPEDITION_CONFIG.startingResolve).toBe(2);
    });

    it('player.gainResolve clamps at maxResolve', () => {
        const p = new PlayerManager();
        const before = p.resources.resolve;
        p.gainResolve(99);
        expect(p.resources.resolve).toBe(p.resources.maxResolve);
        expect(before).toBe(EXPEDITION_CONFIG.startingResolve);
    });
});

describe('[FIX-2] Light economy', () => {
    it('decays every N rooms (default runLength), not every room', () => {
        // At default runLength=25 the derived interval is 2.
        expect(shouldDecayLight(1)).toBe(false);
        expect(shouldDecayLight(2)).toBe(true);
        expect(shouldDecayLight(3)).toBe(false);
        expect(shouldDecayLight(4)).toBe(true);
    });

    it('legacy LIGHT_CONFIG.decayEveryNRooms still reports the short-run baseline', () => {
        expect(LIGHT_CONFIG.decayEveryNRooms).toBe(2);
    });
});

describe('[FIX-5] Rupture cooldown + per-target damage cap', () => {
    it('RUPTURE_CONFIG cooldownTurns is 2', () => {
        expect(RUPTURE_CONFIG.cooldownTurns).toBe(2);
    });

    it('boss damage cap = 15%, elite = 18%, normal = 22%, final = 15%', () => {
        expect(RUPTURE_CONFIG.capByKind.boss).toBeCloseTo(0.15);
        expect(RUPTURE_CONFIG.capByKind.elite).toBeCloseTo(0.18);
        expect(RUPTURE_CONFIG.capByKind.normal).toBeCloseTo(0.22);
        expect(RUPTURE_CONFIG.capByKind.final_boss).toBeCloseTo(0.15);
    });

    it('Rupture against a boss does no more than ceil(15%) + base attack mods', () => {
        const { player, combat } = makeCombat(1);
        combat.startCombat(5, 'boss');
        const enemy = combat.enemy!;
        const cap = Math.ceil(enemy.maxHp * RUPTURE_CONFIG.capByKind.boss);
        const startHp = enemy.hp;
        // Force enough resolve for one Rupture.
        player.gainResolve(99);
        combat.processTurn({ kind: 'skill', id: 'rupture' });
        const dealt = startHp - (combat.enemy?.hp ?? 0);
        // Damage is at least the cap floor and not vastly above cap + atk.
        expect(dealt).toBeGreaterThanOrEqual(Math.min(cap, player.getAttackPower()));
        expect(dealt).toBeLessThanOrEqual(cap + player.getAttackPower() + 4);
    });

    it('Rupture goes on cooldown after use', () => {
        const { player, combat } = makeCombat(2);
        combat.startCombat(5, 'boss');
        player.gainResolve(99);
        combat.processTurn({ kind: 'skill', id: 'rupture' });
        // FIX-5 mandates the rupture is gated for at least 1 player turn after
        // post-turn cooldown decrement.
        expect(combat.isSkillOnCooldown('rupture')).toBe(true);
        expect(combat.skillCooldowns.rupture ?? 0).toBeGreaterThanOrEqual(1);
    });
});

describe('[FIX-6] Adrenaline once per combat', () => {
    it('startCombat resets adrenalineUsedThisCombat', () => {
        const { combat } = makeCombat(3);
        combat.startCombat(5, 'boss');
        expect(combat.adrenalineUsedThisCombat).toBe(false);
    });
});

describe('[FIX-7] Stress bands & Resolve Test virtue chance', () => {
    it('breaking band gives -1 outgoing damage', () => {
        const stress = new StressManager();
        // Push to breaking
        stress.add(80);
        const mod = stress.damageDealtMod();
        expect(mod).toBeLessThanOrEqual(STRESS_BAND_CONFIG.breakingOutgoingDamage);
    });

    it('virtue chance respects clamps', () => {
        const stress = new StressManager();
        stress.hasResolvedAfflictionThisRun = true;
        const chance = stress.computeVirtueChance({ lowLight: true });
        expect(chance).toBeGreaterThanOrEqual(RESOLVE_TEST_CONFIG.minVirtueChance);
        expect(chance).toBeLessThanOrEqual(RESOLVE_TEST_CONFIG.maxVirtueChance);
    });

    it('high light + elite kill bumps virtue chance', () => {
        const stress = new StressManager();
        const baseline = stress.computeVirtueChance({});
        const boosted = stress.computeVirtueChance({ highLight: true, eliteKilledThisRun: true });
        expect(boosted).toBeGreaterThan(baseline);
        expect(boosted).toBeLessThanOrEqual(RESOLVE_TEST_CONFIG.maxVirtueChance);
    });
});

describe('[FIX-9] Level cap', () => {
    it('LEVEL_UP_CONFIG.levelCap is 10', () => {
        expect(LEVEL_UP_CONFIG.levelCap).toBe(10);
    });

    it('XP gain past the level cap is dropped', () => {
        const p = new PlayerManager();
        // Force level to cap.
        p.stats.level = LEVEL_UP_CONFIG.levelCap;
        p.stats.xp = 0;
        const granted = p.gainXp(9999);
        expect(granted).toBe(0);
        expect(p.stats.level).toBe(LEVEL_UP_CONFIG.levelCap);
    });
});

describe('[FIX-13] Relic safety caps via aggregate', () => {
    it('Pyre Ash cannot push bleed bonus past the cap', () => {
        const agg = aggregateRelics(['pyre_ash']);
        expect(agg.bleedStackBonus).toBeLessThanOrEqual(RELIC_CAP_CONFIG.pyreAshBleedStacksCap);
        expect(agg.bleedTurnBonus).toBeLessThanOrEqual(RELIC_CAP_CONFIG.pyreAshBleedTurnsCap);
    });

    it('Cursed Coin gold multiplier is hard-capped', () => {
        const agg = aggregateRelics(['cursed_coin']);
        expect(agg.goldMultiplier).toBeLessThanOrEqual(RELIC_CAP_CONFIG.cursedCoinGoldMultiplierCap);
    });

    it('Player crit chance never exceeds Gambler cap with stacking sources', () => {
        const p = new PlayerManager();
        p.resources.light = EXPEDITION_CONFIG.maxLight;
        // Manually inject a maxed crit aggregate so we can test the cap.
        // (Multiple Gambler's relics aren't possible at runtime, but the
        // cap should still hold even if the aggregate inflates somehow.)
        (p as unknown as { relicAggregate: { critChanceBonus: number } }).relicAggregate.critChanceBonus = 1.0;
        expect(p.getCritChance()).toBeLessThanOrEqual(RELIC_CAP_CONFIG.gamblersCritCap);
    });
});

describe('[FIX-11] Stun resistance configuration', () => {
    it('matches the spec values for normal / elite / each boss', () => {
        expect(STUN_RESIST_CONFIG.normal).toBe(0);
        expect(STUN_RESIST_CONFIG.elite).toBe(0.5);
        expect(STUN_RESIST_CONFIG.bossByName['Necromancer Regent']).toBe(0.7);
        expect(STUN_RESIST_CONFIG.bossByName['The Lich of Cinders']).toBe(0.75);
        expect(STUN_RESIST_CONFIG.bossByName['Splintered Oracle']).toBe(0.8);
        expect(STUN_RESIST_CONFIG.bossByName['Nameless Maw']).toBe(0.9);
        expect(STUN_RESIST_CONFIG.bossByName['The Undying Wound']).toBe(0.95);
    });
});

describe('[FIX-3 / sanity] Player config defaults', () => {
    it('starting hp / max resolve are configured', () => {
        expect(PLAYER_CONFIG.hp).toBeGreaterThan(0);
        expect(PLAYER_CONFIG.maxResolve).toBe(3);
    });
});
