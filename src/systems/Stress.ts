// Stress mechanic, inspired by Darkest Dungeon.
//
// Stress builds from certain combat/exploration events. When it reaches 100
// the expedition rolls a Resolve Test: 50% Affliction (penalties), 50%
// Virtue (buffs). Stress is then reset to 50 and the resolution persists for
// the remainder of the run.

export type Affliction =
    | 'paranoid' // +1 incoming damage
    | 'hopeless' // -1 outgoing damage
    | 'fearful' // skills cost +1 resolve
    | 'abusive'; // +50% stress gain

export type Virtue =
    | 'courageous' // +1 outgoing damage
    | 'stalwart' // -1 incoming damage, min 0
    | 'focused' // skills cost -1 resolve (min 1)
    | 'vigorous'; // +1 resolve at combat start

export interface Resolution {
    kind: 'affliction' | 'virtue';
    id: Affliction | Virtue;
    name: string;
    description: string;
}

export const AFFLICTIONS: Record<Affliction, Resolution> = {
    paranoid: {
        kind: 'affliction',
        id: 'paranoid',
        name: 'Paranoid',
        description: 'Every shadow hurts. +1 damage taken from enemies.',
    },
    hopeless: {
        kind: 'affliction',
        id: 'hopeless',
        name: 'Hopeless',
        description: 'Your blows feel weightless. -1 damage dealt.',
    },
    fearful: {
        kind: 'affliction',
        id: 'fearful',
        name: 'Fearful',
        description: 'Your hands shake. Skills cost +1 resolve.',
    },
    abusive: {
        kind: 'affliction',
        id: 'abusive',
        name: 'Abusive',
        description: 'Stress feeds on itself. Stress gain +50%.',
    },
};

export const VIRTUES: Record<Virtue, Resolution> = {
    courageous: {
        kind: 'virtue',
        id: 'courageous',
        name: 'Courageous',
        description: 'You step toward the dark. +1 damage dealt.',
    },
    stalwart: {
        kind: 'virtue',
        id: 'stalwart',
        name: 'Stalwart',
        description: 'You shrug off the first ripple of every blow. -1 damage taken.',
    },
    focused: {
        kind: 'virtue',
        id: 'focused',
        name: 'Focused',
        description: 'Your thoughts sharpen. Skills cost -1 resolve.',
    },
    vigorous: {
        kind: 'virtue',
        id: 'vigorous',
        name: 'Vigorous',
        description: 'Adrenaline returns on cue. +1 resolve at combat start.',
    },
};

export class StressManager {
    public value = 0;
    public resolution: Resolution | null = null;

    public onResolution: (r: Resolution) => void = () => {};
    public onChange: (value: number) => void = () => {};

    add(amount: number, reductionPct: number = 0): Resolution | null {
        let delta = Math.max(0, amount * (1 - reductionPct));
        if (this.resolution?.id === 'abusive') delta *= 1.5;
        this.value = Math.min(100, this.value + Math.round(delta));
        this.onChange(this.value);
        if (this.value >= 100) {
            return this.resolve();
        }
        return null;
    }

    relieve(amount: number) {
        this.value = Math.max(0, this.value - amount);
        this.onChange(this.value);
    }

    get isOverwhelmed(): boolean {
        return this.value >= 100;
    }

    private resolve(): Resolution {
        const keys: (Affliction | Virtue)[] =
            Math.random() < 0.5
                ? (Object.keys(AFFLICTIONS) as Affliction[])
                : (Object.keys(VIRTUES) as Virtue[]);
        const pick = keys[Math.floor(Math.random() * keys.length)];
        const next = (AFFLICTIONS as Record<string, Resolution>)[pick]
            ?? (VIRTUES as Record<string, Resolution>)[pick];

        this.resolution = next;
        this.value = 50;
        this.onChange(this.value);
        this.onResolution(next);
        return next;
    }

    damageTakenMod(): number {
        if (this.resolution?.id === 'paranoid') return 1;
        if (this.resolution?.id === 'stalwart') return -1;
        return 0;
    }

    damageDealtMod(): number {
        if (this.resolution?.id === 'hopeless') return -1;
        if (this.resolution?.id === 'courageous') return 1;
        return 0;
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
