/**
 * Shared helpers for combat-flavoured tests. Extracted out of the
 * old monolithic `tests/CombatManager.test.ts` and the headless
 * smoke test so we have ONE place that knows the shape of
 * `ActiveEnemy` and the `EventLog` surface CombatManager calls into.
 *
 * Three helpers:
 *  - {@link makeManager}: builds a `{ combat, player, seenMessages }`
 *    triple from a deterministic `Mulberry32(seed)`. Drop-in for
 *    the per-test `makeManager` that used to live inline.
 *  - {@link makeEventLogStub}: returns the same minimal
 *    `addMessage(text, color?)` shim cast to {@link EventLog}, used
 *    by both the combat tests and the smoke run.
 *  - {@link makeActiveEnemy}: fills the boring defaults of an
 *    `ActiveEnemy` (`kind: 'normal'`, `canonicalName: name`,
 *    `turnsAlive: 0`, `status: emptyStatusState()`,
 *    `currentIntent: null`, …) so callers only specify the fields
 *    that actually matter for the assertion under test.
 */
import { CombatManager, type ActiveEnemy } from '../../src/systems/CombatManager';
import { PlayerManager } from '../../src/systems/PlayerManager';
import { Mulberry32 } from '../../src/systems/Rng';
import { emptyStatusState } from '../../src/systems/StatusEffects';
import type { EventLog } from '../../src/ui/EventLog';

/**
 * Returns a minimal `EventLog`-shaped stub that records every
 * `addMessage(text, color?)` call into the provided `messages`
 * array (or its own internal one if not supplied). Use this
 * everywhere a test wants to assert combat narration without
 * importing the real (Phaser-coupled) `EventLog`.
 */
export function makeEventLogStub(messages: string[] = []): {
    log: EventLog;
    messages: string[];
} {
    const log = {
        addMessage: (text: string, _color?: string) => {
            messages.push(text);
        },
    } as unknown as EventLog;
    return { log, messages };
}

/**
 * Build a deterministic `{ combat, player, seenMessages }` triple
 * from a single seed. The seed flows into the in-combat RNG via
 * `Mulberry32(seed)`, so two calls with the same seed produce the
 * same dice rolls.
 */
export function makeManager(seed: number): {
    combat: CombatManager;
    player: PlayerManager;
    seenMessages: string[];
} {
    const player = new PlayerManager();
    const { log, messages } = makeEventLogStub();
    const combat = new CombatManager(player, log, undefined, new Mulberry32(seed));
    return { combat, player, seenMessages: messages };
}

/**
 * Default-fill an `ActiveEnemy`. Callers pass only the fields that
 * matter for the assertion (e.g. `name`, `hp`, `maxHp`, `attack`,
 * `passive`, `pendingPrepare`); the rest are populated with sane
 * defaults that match what `CombatManager.setupEnemy` would have
 * produced for a non-boss encounter.
 *
 * Required: `name` (also used as `canonicalName` if not set).
 * Common optionals tests set:
 *  - `hp`, `maxHp`, `attack`, `color`, `profile`
 *  - `passive` (any `EnemyPassive` shape)
 *  - `pendingPrepare` (windup test setup)
 *  - `xp`, `gold` (used by spawn-on-death assertions)
 */
export function makeActiveEnemy(partial: Partial<ActiveEnemy> & { name: string }): ActiveEnemy {
    const defaults: ActiveEnemy = {
        kind: 'normal',
        name: partial.name,
        canonicalName: partial.canonicalName ?? partial.name,
        description: partial.description ?? 'test',
        icon: partial.icon ?? '?',
        hp: partial.hp ?? 1,
        maxHp: partial.maxHp ?? partial.hp ?? 1,
        attack: partial.attack ?? 1,
        color: partial.color ?? 0x808080,
        xp: partial.xp ?? 0,
        gold: partial.gold ?? 0,
        profile: partial.profile ?? 'brute',
        turnsAlive: partial.turnsAlive ?? 0,
        status: partial.status ?? emptyStatusState(),
        currentIntent: partial.currentIntent ?? null,
    };
    return { ...defaults, ...partial };
}
