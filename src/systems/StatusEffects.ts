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

export function statusSummary(s: StatusState, language: StatusLanguage = 'en'): string {
    const parts: string[] = [];
    if (language === 'ru') {
        if (s.bleed.turns > 0) parts.push(`Кровотечение x${s.bleed.stacks}/${s.bleed.turns}х`);
        if (s.stun.turns > 0) parts.push(`Оглуш. ${s.stun.turns}х`);
        if (s.weaken.turns > 0) parts.push(`Слаб. -${s.weaken.amount}/${s.weaken.turns}х`);
        if (s.mark.turns > 0) parts.push('Метка');
        if (s.guard.hits > 0) parts.push(`Защита ${s.guard.amount}x${s.guard.hits}`);
        if (s.focus.turns > 0) parts.push(`Фокус +${s.focus.amount}/${s.focus.turns}х`);
        if (s.regen.turns > 0) parts.push(`Реген. +${s.regen.amount}/${s.regen.turns}х`);
    } else {
        if (s.bleed.turns > 0) parts.push(`Bleed x${s.bleed.stacks}/${s.bleed.turns}t`);
        if (s.stun.turns > 0) parts.push(`Stun ${s.stun.turns}t`);
        if (s.weaken.turns > 0) parts.push(`Weaken -${s.weaken.amount}/${s.weaken.turns}t`);
        if (s.mark.turns > 0) parts.push('Marked');
        if (s.guard.hits > 0) parts.push(`Guard ${s.guard.amount}x${s.guard.hits}`);
        if (s.focus.turns > 0) parts.push(`Focus +${s.focus.amount}/${s.focus.turns}t`);
        if (s.regen.turns > 0) parts.push(`Regen +${s.regen.amount}/${s.regen.turns}t`);
    }
    return parts.join(' | ');
}
