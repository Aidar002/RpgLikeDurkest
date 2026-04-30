// Status effect engine. Runs on both enemy and player sides.
// Effects:
//   bleed:  stacks * dmg at end of each turn for N turns
//   stun:   skips next enemy turn(s)
//   weaken: enemy attack -X for N turns
//   mark:   next incoming attack on this target is guaranteed critical
//   guard:  flat damage block for the next N incoming hits
//   focus:  +X attack for N turns (player)
//   regen:  heals per turn for N turns (player)

export type StatusId =
    | 'bleed'
    | 'stun'
    | 'weaken'
    | 'mark'
    | 'guard'
    | 'focus'
    | 'regen';

export interface StatusState {
    bleed: { stacks: number; turns: number };
    stun: { turns: number };
    weaken: { turns: number; amount: number };
    mark: { turns: number };
    guard: { hits: number; amount: number };
    focus: { turns: number; amount: number };
    regen: { turns: number; amount: number };
}

type StatusLanguage = 'ru' | 'en';

export function emptyStatusState(): StatusState {
    return {
        bleed: { stacks: 0, turns: 0 },
        stun: { turns: 0 },
        weaken: { turns: 0, amount: 0 },
        mark: { turns: 0 },
        guard: { hits: 0, amount: 0 },
        focus: { turns: 0, amount: 0 },
        regen: { turns: 0, amount: 0 },
    };
}

export function applyBleed(s: StatusState, stacks: number, turns: number) {
    s.bleed.stacks = Math.min(8, s.bleed.stacks + stacks);
    s.bleed.turns = Math.max(s.bleed.turns, turns);
}

export function applyStun(s: StatusState, turns: number) {
    s.stun.turns = Math.max(s.stun.turns, turns);
}

export function applyWeaken(s: StatusState, amount: number, turns: number) {
    if (amount > s.weaken.amount) s.weaken.amount = amount;
    s.weaken.turns = Math.max(s.weaken.turns, turns);
}

export function applyMark(s: StatusState, turns: number) {
    s.mark.turns = Math.max(s.mark.turns, turns);
}

export function applyGuard(s: StatusState, hits: number, amount: number) {
    s.guard.hits += hits;
    if (amount > s.guard.amount) s.guard.amount = amount;
}

export function applyFocus(s: StatusState, amount: number, turns: number) {
    if (amount > s.focus.amount) s.focus.amount = amount;
    s.focus.turns = Math.max(s.focus.turns, turns);
}

export function applyRegen(s: StatusState, amount: number, turns: number) {
    if (amount > s.regen.amount) s.regen.amount = amount;
    s.regen.turns = Math.max(s.regen.turns, turns);
}

/** Returns true if the holder should skip its next action (and decrements). */
export function consumeStunForTurn(s: StatusState): boolean {
    if (s.stun.turns > 0) {
        s.stun.turns -= 1;
        return true;
    }
    return false;
}

/** Pops a mark if present so the next hit is critical. */
export function consumeMark(s: StatusState): boolean {
    if (s.mark.turns > 0) {
        s.mark.turns = 0;
        return true;
    }
    return false;
}

/** Returns bonus damage at end of a turn (bleed) and ticks statuses. */
export interface TickResult {
    bleedDamage: number;
    expired: StatusId[];
    regenHeal: number;
}

export function tickTurn(s: StatusState): TickResult {
    const expired: StatusId[] = [];
    let bleedDamage = 0;
    let regenHeal = 0;

    if (s.bleed.turns > 0 && s.bleed.stacks > 0) {
        bleedDamage = s.bleed.stacks;
        s.bleed.turns -= 1;
        if (s.bleed.turns <= 0) {
            s.bleed.stacks = 0;
            expired.push('bleed');
        }
    }

    if (s.weaken.turns > 0) {
        s.weaken.turns -= 1;
        if (s.weaken.turns <= 0) {
            s.weaken.amount = 0;
            expired.push('weaken');
        }
    }

    if (s.mark.turns > 0) {
        s.mark.turns -= 1;
        if (s.mark.turns <= 0) expired.push('mark');
    }

    if (s.focus.turns > 0) {
        s.focus.turns -= 1;
        if (s.focus.turns <= 0) {
            s.focus.amount = 0;
            expired.push('focus');
        }
    }

    if (s.regen.turns > 0) {
        regenHeal = s.regen.amount;
        s.regen.turns -= 1;
        if (s.regen.turns <= 0) {
            s.regen.amount = 0;
            expired.push('regen');
        }
    }

    return { bleedDamage, expired, regenHeal };
}

/** Apply guard block to incoming damage and decrement hit counter. */
export function consumeGuardBlock(s: StatusState, incoming: number): number {
    if (s.guard.hits <= 0) return incoming;
    const blocked = Math.min(incoming, s.guard.amount);
    s.guard.hits -= 1;
    if (s.guard.hits <= 0) s.guard.amount = 0;
    return incoming - blocked;
}

interface StatusLabels {
    bleed: (stacks: number, turns: number) => string;
    stun: (turns: number) => string;
    weaken: (amount: number, turns: number) => string;
    mark: () => string;
    guard: (amount: number, hits: number) => string;
    focus: (amount: number, turns: number) => string;
    regen: (amount: number, turns: number) => string;
}

const STATUS_LABELS: Record<StatusLanguage, StatusLabels> = {
    ru: {
        bleed: (stacks, turns) => `Кровотечение x${stacks}/${turns}х`,
        stun: (turns) => `Оглуш. ${turns}х`,
        weaken: (amount, turns) => `Слаб. -${amount}/${turns}х`,
        mark: () => 'Метка',
        guard: (amount, hits) => `Защита ${amount}x${hits}`,
        focus: (amount, turns) => `Фокус +${amount}/${turns}х`,
        regen: (amount, turns) => `Реген. +${amount}/${turns}х`,
    },
    en: {
        bleed: (stacks, turns) => `Bleed x${stacks}/${turns}t`,
        stun: (turns) => `Stun ${turns}t`,
        weaken: (amount, turns) => `Weaken -${amount}/${turns}t`,
        mark: () => 'Marked',
        guard: (amount, hits) => `Guard ${amount}x${hits}`,
        focus: (amount, turns) => `Focus +${amount}/${turns}t`,
        regen: (amount, turns) => `Regen +${amount}/${turns}t`,
    },
};

export function statusSummary(s: StatusState, language: StatusLanguage = 'en'): string {
    const labels = STATUS_LABELS[language];
    const parts: string[] = [];
    if (s.bleed.turns > 0) parts.push(labels.bleed(s.bleed.stacks, s.bleed.turns));
    if (s.stun.turns > 0) parts.push(labels.stun(s.stun.turns));
    if (s.weaken.turns > 0) parts.push(labels.weaken(s.weaken.amount, s.weaken.turns));
    if (s.mark.turns > 0) parts.push(labels.mark());
    if (s.guard.hits > 0) parts.push(labels.guard(s.guard.amount, s.guard.hits));
    if (s.focus.turns > 0) parts.push(labels.focus(s.focus.amount, s.focus.turns));
    if (s.regen.turns > 0) parts.push(labels.regen(s.regen.amount, s.regen.turns));
    return parts.join(' | ');
}
