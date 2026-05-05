import type { LocalizedText } from './LocalizedText';
import { lt } from './LocalizedText';
import { Emitter } from './Emitter';
import { defaultRng, type Rng } from './Rng';
import { RESOLVE_TEST_CONFIG, STRESS_BAND_CONFIG } from '../data/GameConfig';

// Stress mechanic, inspired by Darkest Dungeon.
//
// Stress builds from certain combat/exploration events. When it reaches 100
// the expedition rolls a Resolve Test. The base distribution is now 70%
// Affliction / 30% Virtue (FIX-7), modified by light, prior afflictions,
// and elite kills. Stress is then reset to RESOLVE_TEST_CONFIG.stressAfterTest
// (default 50) and the resolution persists for the remainder of the run.

/**
 * [FIX-7] Stress bands. The boundaries are sourced from
 * STRESS_BAND_CONFIG so the gameplay/UI/sim layers all read the same
 * thresholds.
 */
export type StressBand = 'controlled' | 'strained' | 'breaking' | 'overwhelmed';

export function bandFor(value: number): StressBand {
    if (value >= STRESS_BAND_CONFIG.overwhelmedMin) return 'overwhelmed';
    if (value >= STRESS_BAND_CONFIG.breakingMin) return 'breaking';
    if (value >= STRESS_BAND_CONFIG.strainedMin) return 'strained';
    return 'controlled';
}

/**
 * Optional per-roll modifiers for the Resolve Test (FIX-7). Callers pass
 * what they know — defaults match "no modifier".
 */
export interface ResolveTestModifiers {
    highLight?: boolean;
    lowLight?: boolean;
    eliteKilledThisRun?: boolean;
    afflictionActive?: boolean;
}

export type Affliction =
    | 'paranoid' // +1 incoming damage
    | 'hopeless' // -1 outgoing damage
    | 'fearful' // skills cost +1 resolve
    | 'abusive'; // +50% stress gain

export type Virtue =
    | 'courageous' // +1 outgoing damage
    | 'stalwart' // -1 incoming damage (combat min damage still applies)
    | 'focused' // skills cost -1 resolve (min 1)
    | 'vigorous'; // +1 resolve at combat start

export interface Resolution {
    kind: 'affliction' | 'virtue';
    id: Affliction | Virtue;
    name: LocalizedText;
    description: LocalizedText;
}

export const AFFLICTIONS: Record<Affliction, Resolution> = {
    paranoid: {
        kind: 'affliction',
        id: 'paranoid',
        name: lt('Настороженный', 'Paranoid'),
        description: lt(
            'Ты вздрагиваешь от каждого шороха. +1 к урону от врагов.',
            'Every shadow hurts. +1 damage taken from enemies.'
        ),
    },
    hopeless: {
        kind: 'affliction',
        id: 'hopeless',
        name: lt('Сломленный', 'Hopeless'),
        description: lt(
            'Рука не вкладывает вес в удар. -1 к наносимому урону.',
            'Your blows feel weightless. -1 damage dealt.'
        ),
    },
    fearful: {
        kind: 'affliction',
        id: 'fearful',
        name: lt('Перепуганный', 'Fearful'),
        description: lt(
            'Пальцы дрожат на рукояти. Навыки стоят на 1 волю больше.',
            'Your hands shake. Skills cost +1 resolve.'
        ),
    },
    abusive: {
        kind: 'affliction',
        id: 'abusive',
        name: lt('Ожесточённый', 'Abusive'),
        description: lt(
            'Злость цепляется за каждую мелочь. Получение стресса +50%.',
            'Stress feeds on itself. Stress gain +50%.'
        ),
    },
};

export const VIRTUES: Record<Virtue, Resolution> = {
    courageous: {
        kind: 'virtue',
        id: 'courageous',
        name: lt('Отважный', 'Courageous'),
        description: lt(
            'Ты сам делаешь шаг в темноту. +1 к наносимому урону.',
            'You step toward the dark. +1 damage dealt.'
        ),
    },
    stalwart: {
        kind: 'virtue',
        id: 'stalwart',
        name: lt('Непоколебимый', 'Stalwart'),
        description: lt(
            'Ты принимаешь удар корпусом. -1 к получаемому урону.',
            'You shrug off the first ripple of every blow. -1 damage taken.'
        ),
    },
    focused: {
        kind: 'virtue',
        id: 'focused',
        name: lt('Сосредоточенный', 'Focused'),
        description: lt(
            'Мысли собираются в линию. Навыки стоят на 1 волю меньше.',
            'Your thoughts sharpen. Skills cost -1 resolve.'
        ),
    },
    vigorous: {
        kind: 'virtue',
        id: 'vigorous',
        name: lt('Живой', 'Vigorous'),
        description: lt(
            'Кровь горячая, дыхание ровное. +1 воля в начале боя.',
            'Adrenaline returns on cue. +1 resolve at combat start.'
        ),
    },
};

export class StressManager {
    public value = 0;
    public resolution: Resolution | null = null;
    /**
     * [FIX-7] When the player has previously rolled an Affliction in
     * this run, future Virtue rolls are -15%. Tracks whether ANY
     * affliction has ever resolved (sticky).
     */
    public hasResolvedAfflictionThisRun = false;

    public readonly resolutionChange = new Emitter<Resolution>();
    public readonly valueChange = new Emitter<{ value: number }>();

    private rng: Rng;
    /**
     * Optional callback that returns the current Resolve-Test
     * modifiers. Wired by GameScene so we can read live light /
     * elite-kill state without a hard import cycle. The simulator
     * provides its own implementation.
     */
    public modifiersProvider: (() => ResolveTestModifiers) | null = null;

    constructor(rng: Rng = defaultRng) {
        this.rng = rng;
    }

    /** [FIX-7] Current stress band, computed from `value`. */
    get band(): StressBand {
        return bandFor(this.value);
    }

    /**
     * [FIX-7] Apply a stress gain, after accounting for:
     *  - external `reductionPct` (e.g. Ossuary Rosary)
     *  - the abusive-affliction +50% multiplier (legacy)
     *  - the band-based +1 flat surcharge while in Strained / Breaking
     */
    add(amount: number, reductionPct: number = 0): Resolution | null {
        let delta = Math.max(0, amount * (1 - reductionPct));
        if (this.resolution?.id === 'abusive') delta *= 1.5;
        let intDelta = Math.round(delta);
        if (intDelta > 0) {
            const currentBand = this.band;
            if (currentBand === 'strained' || currentBand === 'breaking') {
                intDelta += STRESS_BAND_CONFIG.bandGainBonus;
            }
        }
        this.value = Math.min(100, Math.max(0, this.value + intDelta));
        this.valueChange.emit({ value: this.value });
        if (this.value >= STRESS_BAND_CONFIG.overwhelmedMin) {
            return this.resolve();
        }
        return null;
    }

    relieve(amount: number) {
        this.value = Math.max(0, this.value - amount);
        this.valueChange.emit({ value: this.value });
    }

    get isOverwhelmed(): boolean {
        return this.value >= STRESS_BAND_CONFIG.overwhelmedMin;
    }

    /**
     * [FIX-7] Compute the Virtue chance for the next Resolve Test using
     * the configured base + modifiers, clamped to [min, max]. Exposed
     * for testing and the headless simulator.
     */
    computeVirtueChance(mods: ResolveTestModifiers = {}): number {
        let chance = RESOLVE_TEST_CONFIG.baseVirtueChance;
        if (mods.highLight) chance += RESOLVE_TEST_CONFIG.highLightVirtueBonus;
        if (mods.lowLight) chance += RESOLVE_TEST_CONFIG.lowLightVirtueMalus;
        if (mods.eliteKilledThisRun) chance += RESOLVE_TEST_CONFIG.eliteKilledVirtueBonus;
        if (mods.afflictionActive || this.hasResolvedAfflictionThisRun) {
            chance += RESOLVE_TEST_CONFIG.afflictionActiveVirtueMalus;
        }
        if (chance < RESOLVE_TEST_CONFIG.minVirtueChance) chance = RESOLVE_TEST_CONFIG.minVirtueChance;
        if (chance > RESOLVE_TEST_CONFIG.maxVirtueChance) chance = RESOLVE_TEST_CONFIG.maxVirtueChance;
        return chance;
    }

    private resolve(): Resolution {
        const mods = this.modifiersProvider ? this.modifiersProvider() : {};
        const virtueChance = this.computeVirtueChance(mods);
        const useVirtue = this.rng.next() < virtueChance;
        const next: Resolution = useVirtue
            ? this.pickFrom(VIRTUES)
            : this.pickFrom(AFFLICTIONS);

        if (next.kind === 'affliction') {
            this.hasResolvedAfflictionThisRun = true;
        }
        this.resolution = next;
        this.value = RESOLVE_TEST_CONFIG.stressAfterTest;
        this.valueChange.emit({ value: this.value });
        this.resolutionChange.emit(next);
        return next;
    }

    private pickFrom<K extends string>(table: Record<K, Resolution>): Resolution {
        const keys = Object.keys(table) as K[];
        const chosen = keys[Math.floor(this.rng.next() * keys.length)];
        return table[chosen];
    }

    damageTakenMod(): number {
        if (this.resolution?.id === 'paranoid') return 1;
        if (this.resolution?.id === 'stalwart') return -1;
        return 0;
    }

    damageDealtMod(): number {
        let mod = 0;
        if (this.resolution?.id === 'hopeless') mod -= 1;
        if (this.resolution?.id === 'courageous') mod += 1;
        // [FIX-7] Breaking band gives -1 outgoing damage.
        if (this.band === 'breaking' || this.band === 'overwhelmed') {
            mod += STRESS_BAND_CONFIG.breakingOutgoingDamage;
        }
        return mod;
    }

    resolveCostMod(): number {
        if (this.resolution?.id === 'fearful') return 1;
        if (this.resolution?.id === 'focused') return -1;
        return 0;
    }

    combatStartResolve(): number {
        return this.resolution?.id === 'vigorous' ? 1 : 0;
    }
}
