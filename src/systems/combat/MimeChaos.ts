/**
 * Mime / Mammon boss-specific helpers extracted from CombatManager.
 *
 * Both functions pluck a deterministic random pick out of the
 * supplied RNG (so seeded tests stay reproducible) and write a
 * localised log line.  They take a {@link MimeChaosDeps} bundle
 * instead of a back-reference to CombatManager.
 */
import type { EventLog } from '../../ui/EventLog';
import type { Localization } from '../Localization';
import type { PlayerManager } from '../PlayerManager';
import type { Rng } from '../Rng';
import type { ActiveEnemy, BossPhaseState } from '../CombatManager';
import {
    applyArmorBreak,
    applyBleed,
    applyMark,
    applyPoison,
    applyStun,
    applyWeaken,
} from '../StatusEffects';

/** Dependencies for Mime / Mammon helpers. */
export interface MimeChaosDeps {
    player: PlayerManager;
    log: EventLog;
    loc: Localization;
    rng: Rng;
    emitPlayerStatus(): void;
}

/**
 * Mime "Chaos Lord's Laughter" — pick one status from the action's
 * pool that is NOT the same as the last status applied. The
 * anti-repeat tracker lives on `BossPhaseState.lastRandomStatus`
 * so it survives turn boundaries but resets per-encounter (a
 * fresh `setupEnemy` builds a new BossPhaseState).
 */
export function applyRandomMimeStatus(
    enemy: ActiveEnemy | null,
    state: BossPhaseState,
    cfg: {
        pool: Array<'bleed' | 'poison' | 'stun' | 'weaken' | 'armorBreak' | 'mark'>;
        amount: number;
        turns: number;
    },
    deps: MimeChaosDeps
): void {
    if (!enemy) return;
    const { player, log, loc, rng } = deps;
    const candidates = cfg.pool.filter((s) => s !== state.lastRandomStatus);
    // If anti-repeat would empty the pool (single-element pool),
    // fall back to the full pool so we still apply something.
    const choices = candidates.length > 0 ? candidates : cfg.pool;
    if (choices.length === 0) return;
    const idx = Math.floor(rng.next() * choices.length) % choices.length;
    const pick = choices[idx];
    state.lastRandomStatus = pick;
    // Map status id → its localised display label. The keys are
    // referenced as string literals here so the orphan-key test
    // (`tests/Locale.consistency.test.ts`) can statically detect
    // each call site.
    let statusLabel: string;
    switch (pick) {
        case 'bleed':
            applyBleed(player.status, cfg.amount, cfg.turns);
            statusLabel = loc.t('combatBossMimeStatus_bleed');
            break;
        case 'poison':
            applyPoison(player.status, cfg.amount, cfg.turns);
            statusLabel = loc.t('combatBossMimeStatus_poison');
            break;
        case 'stun':
            applyStun(player.status, cfg.turns);
            statusLabel = loc.t('combatBossMimeStatus_stun');
            break;
        case 'weaken':
            applyWeaken(player.status, cfg.amount, cfg.turns);
            statusLabel = loc.t('combatBossMimeStatus_weaken');
            break;
        case 'armorBreak':
            applyArmorBreak(player.status, cfg.amount, cfg.turns);
            statusLabel = loc.t('combatBossMimeStatus_armorBreak');
            break;
        case 'mark':
            applyMark(player.status, cfg.turns);
            statusLabel = loc.t('combatBossMimeStatus_mark');
            break;
    }
    log.addMessage(
        loc.t('combatBossMimeChaos', {
            name: enemy.name,
            status: statusLabel,
        }),
        '#c0a0d0'
    );
    deps.emitPlayerStatus();
}

/**
 * Mammon's "Greed Lord" relic theft. Picks one of the player's
 * relics deterministically through `rng.next()` and stashes the
 * id on `BossPhaseState.stolenRelicId` so finishCombat can return
 * it on the boss's death. No-op when the player has no relics.
 */
export function stealRandomRelic(
    enemy: ActiveEnemy | null,
    state: BossPhaseState,
    deps: MimeChaosDeps
): void {
    if (!enemy) return;
    const { player, log, loc, rng } = deps;
    const relics = player.relics;
    if (relics.length === 0) {
        // Player carries nothing — narrate the fizzle so the cue
        // is still visible.
        log.addMessage(loc.t('combatBossRelicTheftEmpty', { name: enemy.name }), '#a89070');
        return;
    }
    const idx = Math.floor(rng.next() * relics.length) % relics.length;
    const stolen = relics[idx];
    player.removeRelic(stolen);
    state.stolenRelicId = stolen;
    log.addMessage(loc.t('combatBossRelicStolen', { name: enemy.name }), '#d09a4f');
}
