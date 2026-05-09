/**
 * Relic-drop dispatcher: rolls a relic on combat / room rewards and
 * applies it to the player.
 *
 * Was previously inlined into `GameScene.maybeDropRelic` /
 * `relicSummary` (~60 lines + 6-line helper). Lifted out so the
 * scene only carries thin wrappers and so the drop logic is
 * grep-able as a single concept (combat vs treasure vs shrine vs
 * boss; per-enemy drop tables vs generic kind-level chance gates).
 *
 * Public API:
 *   - {@link maybeDropRelic}  — roll + apply for a kind/enemy.
 *
 * The caller passes a {@link RelicDropContext} carrying every system
 * the function touches, so this module has zero scene-graph access
 * (no `add.*`, no Phaser types) and is unit-testable in pure-logic
 * tests if needed later.
 */
import { ROOM_CONFIG } from '../data/GameConfig';
import type { EventLog } from '../ui/EventLog';
import type { Localization } from './Localization';
import type { MetaProgressionManager } from './MetaProgressionManager';
import type { PlayerManager } from './PlayerManager';
import { RELICS, rollRelicFor, rollRelicForEnemy, type RelicId, type RelicRarity } from './Relics';
import { defaultRng, type Rng } from './Rng';
import type { RunTracker } from './RunTracker';
import type { SoundManager } from './SoundManager';

/** Reward kinds that can drop a relic. */
export type RelicDropKind = 'normal' | 'elite' | 'boss' | 'treasure' | 'shrine';

interface RelicDropContext {
    meta: MetaProgressionManager;
    player: PlayerManager;
    tracker: RunTracker;
    sfx: SoundManager;
    log: EventLog;
    loc: Localization;
    /** Optional override (defaults to {@link defaultRng}). Tests can
     *  inject a seeded {@link Rng} to make rolls deterministic. */
    rng?: Rng;
}

/**
 * Roll-and-grant a relic for a reward `kind`. Returns `true` if the
 * player actually picked up a new relic, `false` if the roll missed
 * or no eligible drop exists.
 *
 * Rules:
 *   - Combat drops with a known `enemyName` (`normal` / `elite` /
 *     `boss`) consult the per-enemy drop table directly: each entry
 *     rolls its own chance, so the legacy kind-level chance gate is
 *     skipped.
 *   - Treasure / shrine / unknown-enemy paths gate on a per-kind
 *     chance (see {@link ROOM_CONFIG}) and then roll from the
 *     generic rarity pool.
 *   - The result is filtered through the unlocked rarity pool from
 *     {@link MetaProgressionManager.getRelicRarityPool}; rolls that
 *     land on a locked rarity downgrade to a common fallback.
 */
export function maybeDropRelic(
    ctx: RelicDropContext,
    kind: RelicDropKind,
    enemyName?: string
): boolean {
    const { meta, player } = ctx;
    const rng = ctx.rng ?? defaultRng;
    const allowedRarities = meta.getRelicRarityPool();

    let relicId: RelicId | null = null;
    if (enemyName && (kind === 'normal' || kind === 'elite' || kind === 'boss')) {
        relicId = rollRelicForEnemy(enemyName, player.relics, rng);
        if (!relicId) return false;
    } else {
        const chance =
            kind === 'boss'
                ? 1
                : kind === 'elite'
                  ? ROOM_CONFIG.elite.relicChance
                  : kind === 'treasure'
                    ? ROOM_CONFIG.treasure.relicChance
                    : kind === 'shrine'
                      ? ROOM_CONFIG.shrine.relicChance
                      : 0;
        if (rng.next() > chance) return false;

        const rollKind = kind === 'treasure' || kind === 'shrine' ? 'normal' : kind;
        relicId = rollRelicFor(player.relics, rollKind as 'normal' | 'elite' | 'boss', rng);
        if (!relicId) return false;
    }

    const relic = RELICS[relicId];
    if (!allowedRarities.includes(relic.rarity as RelicRarity)) {
        // Downgrade to common alternative.
        const fallback = rollRelicFor(player.relics, 'normal', rng);
        if (!fallback) return false;
        return acceptOrOffer(ctx, fallback);
    }

    return acceptOrOffer(ctx, relicId);
}

/**
 * Try to add a relic; on `'full'`, route through `relicOffer` so the
 * HUD can ask the player to drop one of the equipped five (or skip
 * the candidate). Logs / SFX fire only on the successful `'added'`
 * branch \u2014 the swap-modal owns its own pickup log/SFX after the
 * player resolves the choice.
 */
function acceptOrOffer(ctx: RelicDropContext, relicId: RelicId): boolean {
    const { player, tracker, sfx, log, loc } = ctx;
    const outcome = player.addRelic(relicId);
    if (outcome === 'duplicate') return false;

    if (outcome === 'full') {
        player.relicOffer.emit({ id: relicId });
        return false;
    }

    const relic = RELICS[relicId];
    tracker.record('relicsFound');
    sfx.play('relicDrop');
    log.addMessage(
        loc.t('relicObtained', {
            value: loc.pick(relic.name),
            value2: loc.pick(relic.description),
        }),
        relic.rarity === 'unique' ? '#f0a8ff' : relic.rarity === 'rare' ? '#ffd36e' : '#ffcc99'
    );
    return true;
}
