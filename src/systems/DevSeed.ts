import type { Language } from './Localization';

/**
 * Parsed shape of the dev-only `?seed=...&inv=...&lang=...` query
 * string. Only populated when {@link parseDevSeedQuery} finds at least
 * one recognised key — so a {@code null} return means "no dev seed,
 * use the normal boot flow".
 *
 * Keys:
 *  - `seed`: integer seed for the {@link Mulberry32} that drives map
 *    generation. Coerced to unsigned 32-bit.
 *  - `inv`: starting inventory bumps applied after {@link PlayerManager}
 *    construction. Currently supports `gold` and `potion(s)`.
 *  - `lang`: force the UI language regardless of the persisted
 *    `localStorage` choice.
 *
 * `depth` is intentionally not parsed yet — the dungeon transition
 * pipeline animates every step, so jumping ahead requires a
 * fast-forward path that bypasses the room-fade animation. Track in
 * a follow-up if the use case appears.
 */
export interface DevSeedConfig {
    seed?: number;
    inv?: DevSeedInventory;
    lang?: Language;
}

export interface DevSeedInventory {
    gold?: number;
    potions?: number;
}

/**
 * Parse a `window.location.search`-style query string. Returns
 * {@code null} if no recognised keys are present so callers can keep
 * the no-op path fast.
 *
 * Examples (matching the README cheat sheet):
 * ```
 * ?seed=42                        -> { seed: 42 }
 * ?inv=potion:3,gold:50           -> { inv: { potions: 3, gold: 50 } }
 * ?seed=7&lang=ru&inv=gold:999    -> { seed: 7, lang: 'ru', inv: {...} }
 * ```
 */
export function parseDevSeedQuery(search: string): DevSeedConfig | null {
    if (!search) return null;

    const params = new URLSearchParams(search);
    const config: DevSeedConfig = {};

    const seedRaw = params.get('seed');
    if (seedRaw !== null) {
        const seed = Number.parseInt(seedRaw, 10);
        if (Number.isFinite(seed)) {
            // Force unsigned 32-bit so the Mulberry32 state space lines
            // up with what `new Mulberry32(seed)` accepts.
            config.seed = seed >>> 0;
        }
    }

    const invRaw = params.get('inv');
    if (invRaw) {
        const inv = parseInventory(invRaw);
        if (inv) config.inv = inv;
    }

    const langRaw = params.get('lang');
    if (langRaw === 'ru' || langRaw === 'en') {
        config.lang = langRaw;
    }

    return Object.keys(config).length > 0 ? config : null;
}

function parseInventory(raw: string): DevSeedInventory | null {
    const inv: DevSeedInventory = {};
    for (const pair of raw.split(',')) {
        const [keyRaw, valueRaw] = pair.split(':');
        if (!keyRaw || valueRaw === undefined) continue;
        const value = Number.parseInt(valueRaw, 10);
        if (!Number.isFinite(value) || value <= 0) continue;

        const key = keyRaw.trim().toLowerCase();
        if (key === 'potion' || key === 'potions') {
            inv.potions = (inv.potions ?? 0) + value;
        } else if (key === 'gold') {
            inv.gold = (inv.gold ?? 0) + value;
        }
    }
    return Object.keys(inv).length > 0 ? inv : null;
}
