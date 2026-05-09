/**
 * Headless smoke test for a deterministic run.
 *
 * The unit suite already covers individual systems (MapGenerator,
 * CombatManager, PlayerManager, …) in isolation. This file glues
 * them together and walks a real run end-to-end, depth by depth,
 * the same way `GameScene` would — but without booting Phaser.
 *
 * The intent is to catch the "it builds, lint passes, all the
 * isolated tests are green, and yet a freshly-generated run prints
 * `[missing:foo]` or `undefined` somewhere in the log" class of
 * regression. Every line written to the combat log is asserted to
 * be a non-empty string with no missing-locale markers and no
 * unsubstituted `{placeholder}` tokens, in both languages.
 *
 * Cost shape: ~6 simulated runs of ~25 rooms each. The harness
 * picks the first forward node every step, so the path is purely
 * a function of the seed. Combat is driven with `'attack'` only
 * for at most 60 turns per encounter — long enough for the player
 * to either kill the enemy at low depth or get killed by it deeper
 * in the run. Both outcomes are valid; the assertions are about
 * the *shape* of what gets logged, not the gameplay outcome.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { CombatManager } from '../src/systems/CombatManager';
import { DungeonManager } from '../src/systems/DungeonManager';
import { Localization, type Language } from '../src/systems/Localization';
import { RoomType, type MapNode } from '../src/data/MapTypes';
import { MapGenerator } from '../src/systems/MapGenerator';
import { PlayerManager } from '../src/systems/PlayerManager';
import { RunTracker } from '../src/systems/RunTracker';
import { Mulberry32 } from '../src/systems/Rng';
import { handleEmptyRoom } from '../src/systems/rooms/Empty';
import { handleMerchantRoom } from '../src/systems/rooms/Merchant';
import { handleRestRoom } from '../src/systems/rooms/Rest';
import { handleShrineRoom } from '../src/systems/rooms/Shrine';
import { handleTrapRoom } from '../src/systems/rooms/Trap';
import { handleTreasureRoom } from '../src/systems/rooms/Treasure';
import { roomTypeName } from '../src/ui/RoomVisuals';
import type { EventLog } from '../src/ui/EventLog';
import type { CombatEndPayload } from '../src/systems/CombatManager';
import type { GameScene, RoomButtonAction } from '../src/scenes/GameScene';

// `Localization.getSavedLanguage()` reads `window.localStorage`.
// The vitest default environment is jsdom, but other tests that
// run before this one may have stubbed `window.localStorage` with
// an in-memory shim. We don't care which — we just need *some*
// `window.localStorage` to exist so construction doesn't throw.
beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (globalThis as any).window;
    if (w && !w.localStorage) {
        const store: Record<string, string> = {};
        w.localStorage = {
            getItem: (k: string) => (k in store ? store[k] : null),
            setItem: (k: string, v: string) => {
                store[k] = v;
            },
            removeItem: (k: string) => {
                delete store[k];
            },
            clear: () => {
                for (const k of Object.keys(store)) delete store[k];
            },
            key: () => null,
            length: 0,
        };
    }
});

interface SimResult {
    /** Every line written to the combat log, in order. */
    logs: string[];
    /** combatEnd payloads for every combat the *player* won. */
    combatEnds: CombatEndPayload[];
    /** Total combat encounters started (won, lost, or in-flight on death). */
    combatsStarted: number;
    /** Visited node types in walk order, including START. */
    visitedTypes: RoomType[];
    /** Whether the player died during the run. */
    playerDied: boolean;
}

function makeLog(messages: string[]): EventLog {
    // CombatManager only calls `addMessage(text, color?)`. Mirroring
    // the shape used in `tests/CombatManager.test.ts` keeps the
    // smoke test free of the real EventLog (which pulls Phaser).
    return {
        addMessage: (text: string, _color?: string) => {
            messages.push(text);
        },
    } as unknown as EventLog;
}

const COMBAT_ROOMS: ReadonlySet<RoomType> = new Set([
    RoomType.ENEMY,
    RoomType.ELITE,
    RoomType.MINI_BOSS,
    RoomType.BOSS,
]);

function encounterKindFor(node: MapNode): 'normal' | 'elite' | 'boss' {
    if (node.type === RoomType.BOSS || node.type === RoomType.MINI_BOSS) return 'boss';
    if (node.type === RoomType.ELITE) return 'elite';
    return 'normal';
}

/**
 * Drive a single deterministic run with the given seed and language.
 *
 * The harness is intentionally minimal — it only wires the systems
 * needed to surface text. Non-combat rooms are visited (so their
 * locale name is fetched and checked) but not played; the room
 * handler logic in `RoomFlow` requires a full Phaser scene and is
 * not in scope for this smoke test.
 */
function simulateRun(seed: number, language: Language): SimResult {
    const messages: string[] = [];
    const combatEnds: CombatEndPayload[] = [];
    const visitedTypes: RoomType[] = [];

    // Force a stable enemy roll for reproducibility — `startCombat`
    // can fall back to `Math.random` when picking from the enemy
    // pool. Same trick `tests/CombatManager.test.ts` uses.
    let mathIdx = 0;
    const mathSeq = [0.1, 0.5, 0.9];
    const originalRandom = Math.random;
    Math.random = () => mathSeq[mathIdx++ % mathSeq.length];
    let combatsStarted = 0;
    try {
        const mapRng = new Mulberry32(seed);
        const gen = new MapGenerator(undefined, mapRng);
        // Generate the entire run up front so the dungeon manager
        // doesn't have to re-roll for fresh layers mid-walk.
        const nodes = gen.generateInitialMap(gen.getRunLength());

        const dungeon = new DungeonManager(
            nodes,
            () => undefined,
            () => undefined
        );

        const loc = new Localization(language);
        const player = new PlayerManager();
        const combat = new CombatManager(player, makeLog(messages), loc, new Mulberry32(seed + 1));
        combat.combatEnd.on((payload) => {
            combatEnds.push(payload);
        });

        let playerDied = false;
        player.death.on(() => {
            playerDied = true;
        });

        visitedTypes.push(dungeon.currentNode.type);

        // Walk depth-by-depth. To make sure the harness exercises
        // combat (not just exploration), prefer forward nodes that
        // are combat rooms; tie-break by id so the walk is fully
        // deterministic for a given seed.
        let safety = 200;
        while (safety-- > 0) {
            const forward = dungeon.getForwardNodes();
            if (forward.length === 0) break;
            forward.sort((a, b) => {
                const aCombat = COMBAT_ROOMS.has(a.type) ? 0 : 1;
                const bCombat = COMBAT_ROOMS.has(b.type) ? 0 : 1;
                if (aCombat !== bCombat) return aCombat - bCombat;
                return a.id.localeCompare(b.id);
            });
            const next = forward[0];
            dungeon.moveTo(next.id);
            visitedTypes.push(next.type);

            // Always look up the room's name so any RoomVisuals or
            // locale gap shows up as a `[missing:` marker.
            const name = roomTypeName(next.type, loc);
            messages.push(`[room:${next.type}] ${name}`);

            if (COMBAT_ROOMS.has(next.type)) {
                combat.startCombat(next.depth, encounterKindFor(next));
                combatsStarted += 1;
                let turns = 60;
                while (combat.enemy && turns-- > 0 && !playerDied) {
                    combat.processTurn('attack');
                }
                if (playerDied) break;
            }
        }

        return {
            logs: messages,
            combatEnds,
            combatsStarted,
            visitedTypes,
            playerDied,
        };
    } finally {
        Math.random = originalRandom;
    }
}

const SMOKE_SEEDS = [1, 17, 2024];

describe('Smoke run — headless walk through a deterministic seed', () => {
    for (const seed of SMOKE_SEEDS) {
        for (const lang of ['en', 'ru'] as const) {
            it(`seed=${seed} lang=${lang}: produces a clean log and reaches at least one combat`, () => {
                const result = simulateRun(seed, lang);

                // The harness always logs at least the synthetic
                // `[room:…]` line per visited node, so this can only
                // fail if `MapGenerator` returned no forward nodes
                // from depth 0 (which would be a real regression).
                expect(result.visitedTypes.length).toBeGreaterThan(1);

                // We expect at least one combat per run — the harness
                // prefers combat-room nodes when picking a forward
                // step, so 200 paths without one is itself a
                // generator bug. The encounter doesn't have to
                // resolve in the player's favour: a freshly
                // constructed `PlayerManager` only has 5 HP so it
                // routinely dies on the first ENEMY at low depth,
                // which is fine for a *log-shape* smoke test.
                expect(result.combatsStarted).toBeGreaterThan(0);

                // Per-line shape checks. Every line that hits the
                // log MUST be a non-empty string with no missing
                // marker and no unsubstituted `{placeholder}`.
                for (const line of result.logs) {
                    expect(typeof line).toBe('string');
                    expect(line.length).toBeGreaterThan(0);

                    // `Localization.t` does not have a "[missing:]"
                    // path — it falls back to the EN string when a
                    // RU key is undefined. But if the EN side is
                    // also missing, the template is `undefined` and
                    // the call returns an empty string from
                    // `String(undefined)`-like surfaces. We treat
                    // both as bugs.
                    expect(line.includes('undefined')).toBe(false);
                    expect(line.includes('[missing:')).toBe(false);

                    // Anything containing a literal `{key}` after
                    // substitution means the call site forgot to
                    // pass `{ key: value }` for one of the
                    // template's placeholders.
                    const unsubstituted = line.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/);
                    expect(unsubstituted, `unsubstituted placeholder in: ${line}`).toBeNull();
                }
            });
        }
    }

    it('produces stable output across two runs of the same seed', () => {
        const a = simulateRun(42, 'en');
        const b = simulateRun(42, 'en');

        // Walk shape is fully determined by the seed.
        expect(a.visitedTypes).toEqual(b.visitedTypes);

        // Combats happen in the same order with the same number of
        // resolved fights, and any winning encounters refer to the
        // same enemies.
        expect(a.combatsStarted).toBe(b.combatsStarted);
        expect(a.combatEnds.map((c) => c.enemyCanonicalName)).toEqual(
            b.combatEnds.map((c) => c.enemyCanonicalName)
        );
    });

    it('a different seed produces a different visit shape over a full run', () => {
        const a = simulateRun(1, 'en');
        const b = simulateRun(99999, 'en');
        // Two seeds that produced identical visit-type sequences
        // would mean the map generator is ignoring its RNG.
        expect(a.visitedTypes).not.toEqual(b.visitedTypes);
    });

    it('produces Cyrillic text when the run language is ru', () => {
        const ru = simulateRun(1, 'ru');
        // Localized names land in the log via the encounter header
        // (`combatHostileContact / combatEliteEncounter /
        // combatBossEncounter`). If `Localization.enemyName()` /
        // `RU_ENEMY_TEXT` ever drift away from the canonical English
        // keys, the names fall through to English and this catches
        // it.
        const cyrillic = /[\u0400-\u04FF]/;
        expect(ru.logs.some((line) => cyrillic.test(line))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Room-handler smoke coverage.
//
// The walk above visits non-combat rooms but does NOT execute the room
// handlers (Treasure / Trap / Rest / Shrine / Merchant / Empty) because
// those handlers were originally GameScene methods and required Phaser.
// After Task C extracted them into pure functions in `src/systems/rooms/*`,
// they only depend on a small surface of the scene (player, log, loc,
// dungeon, meta, tracker, npcs, sfx, plus a handful of UI shims).
//
// These tests fake that surface, run each handler with a fully-stocked
// player, and click every enabled button — then assert on the same
// log-shape contract as the rest of this file (no `undefined`, no
// `[missing:`, no unsubstituted `{token}`, every label non-empty).
// ---------------------------------------------------------------------------

interface FakeSceneRecord {
    logs: string[];
    intel: string[];
    rooms: Array<{ header: string; title: string; description: string; intel: string }>;
    buttonLabels: string[];
    returnButtonShown: number;
    relicDrops: number;
}

function makeFakeScene(
    language: Language,
    seed: number
): {
    scene: GameScene;
    record: FakeSceneRecord;
} {
    const record: FakeSceneRecord = {
        logs: [],
        intel: [],
        rooms: [],
        buttonLabels: [],
        returnButtonShown: 0,
        relicDrops: 0,
    };

    const loc = new Localization(language);
    const player = new PlayerManager();
    // Stock the player so every "buy" / "spend" path is reachable.
    player.gainGold(500);
    player.gainPotions(3);

    const tracker = new RunTracker();

    // Minimal DungeonManager — `currentDepth` is what the handlers read.
    const mapRng = new Mulberry32(seed);
    const gen = new MapGenerator(undefined, mapRng);
    const nodes = gen.generateInitialMap(8);
    const dungeon = new DungeonManager(
        nodes,
        () => undefined,
        () => undefined
    );

    const log: EventLog = {
        addMessage: (text: string, _color?: string) => {
            record.logs.push(text);
        },
    } as unknown as EventLog;

    // The handlers also reach into `scene.npcs`, `scene.meta`, `scene.sfx`
    // and a couple of text widgets. We stub each as just enough to keep
    // the call sites happy. NPC paths are intentionally suppressed
    // (`pickForRole` returns null) so we exercise the generic empty /
    // generic merchant branches; the NPC presentation path needs the
    // full `npcs.pickDialog` graph and is covered by NpcRegistry tests.
    const fakeScene = {
        loc,
        player,
        dungeon,
        tracker,
        meta: {
            isUnlocked: (_id: string) => true,
            bossesKilledEver: 0,
        },
        npcs: {
            pickForRole: () => null,
        },
        sfx: {
            play: () => undefined,
            updateAmbientDepth: () => undefined,
        },
        log,
        showRoomCard: (
            header: string,
            title: string,
            description: string,
            _color: number,
            _icon: string,
            intel?: string,
            _spriteKey?: string
        ) => {
            record.rooms.push({
                header,
                title,
                description,
                intel: intel ?? '',
            });
        },
        setRoomButtons: (actions: RoomButtonAction[], _useWideOnly?: boolean) => {
            for (const a of actions) record.buttonLabels.push(a.label);
        },
        showReturnButton: () => {
            record.returnButtonShown += 1;
        },
        applyTrapDamage: (rawDamage: number) => {
            // Mirror GameRoomController.applyTrapDamage: take the damage
            // through the player so HP / death narration paths run.
            return player.takeDamage(rawDamage, 0, 'trap');
        },
        maybeDropRelic: (_kind: string) => {
            record.relicDrops += 1;
            return false;
        },
        enemyIntelText: {
            setText: (text: string) => {
                record.intel.push(text);
            },
        },
    };

    const scene = fakeScene as unknown as GameScene;
    return { scene, record };
}

/**
 * Execute a room handler against a fake scene, then click every
 * enabled button (each on a fresh fake) so the callback path is
 * exercised too. Returns the union of all logs, intel lines, room
 * card text, and button labels seen during the runs.
 */
function captureRoomHandlerOutput(
    runHandler: (scene: GameScene) => void,
    language: Language,
    seed: number
): string[] {
    const captured: string[] = [];

    const collect = (rec: FakeSceneRecord) => {
        captured.push(...rec.logs);
        captured.push(...rec.intel);
        for (const r of rec.rooms) {
            captured.push(r.header, r.title, r.description, r.intel);
        }
        captured.push(...rec.buttonLabels);
    };

    // First pass: run the handler, capture initial output, remember
    // buttons.
    const first = makeFakeScene(language, seed);
    runHandler(first.scene);
    collect(first.record);

    // Second-Nth pass: re-run from a fresh fake and click each
    // enabled button, capturing whatever it logs.
    // We snapshot button labels from the first run; on each replay we
    // pick the matching action by index from a fresh setRoomButtons
    // call.
    const seenLabels = [...first.record.buttonLabels];
    for (let i = 0; i < seenLabels.length; i += 1) {
        // Re-run handler so buttons are constructed fresh.
        let captured2: RoomButtonAction[] = [];
        const second = makeFakeScene(language, seed);
        // Patch setRoomButtons to grab the action list.
        const sceneAny = second.scene as unknown as {
            setRoomButtons: (actions: RoomButtonAction[]) => void;
        };
        const originalSet = sceneAny.setRoomButtons;
        sceneAny.setRoomButtons = (actions: RoomButtonAction[]) => {
            captured2 = actions;
            originalSet(actions);
        };
        runHandler(second.scene);
        // Reset records that were filled by the initial run; we only
        // want output produced by the button callback.
        second.record.logs = [];
        second.record.intel = [];
        second.record.rooms = [];
        second.record.buttonLabels = [];
        const action = captured2[i];
        if (!action) continue;
        if (action.enabled === false) continue;
        action.callback();
        collect(second.record);
    }

    return captured;
}

const ROOM_SMOKE_HANDLERS: Array<{
    name: string;
    run: (scene: GameScene) => void;
}> = [
    { name: 'treasure', run: handleTreasureRoom },
    { name: 'trap', run: handleTrapRoom },
    { name: 'rest', run: handleRestRoom },
    { name: 'shrine', run: handleShrineRoom },
    { name: 'merchant', run: handleMerchantRoom },
    { name: 'empty', run: handleEmptyRoom },
];

describe('Smoke — room-handler outputs', () => {
    for (const handler of ROOM_SMOKE_HANDLERS) {
        for (const lang of ['en', 'ru'] as const) {
            it(`${handler.name} (${lang}): clean output across handler + every enabled button`, () => {
                const lines = captureRoomHandlerOutput(handler.run, lang, 1);

                // The handler always renders a room card and at least
                // one action button. If a handler ever short-circuits
                // out without surfacing anything, that's itself a bug
                // worth catching.
                expect(lines.length).toBeGreaterThan(0);

                for (const line of lines) {
                    expect(typeof line).toBe('string');
                    expect(line.length).toBeGreaterThan(0);
                    expect(line.includes('undefined')).toBe(false);
                    expect(line.includes('[missing:')).toBe(false);
                    const unsubstituted = line.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/);
                    expect(unsubstituted, `unsubstituted placeholder in: ${line}`).toBeNull();
                }
            });
        }
    }

    it('shrine produces 5 buttons (4 altar effects + leave)', () => {
        const first = makeFakeScene('en', 1);
        handleShrineRoom(first.scene);
        // Altars: blessing, prayer, speech, counsel + Leave.
        expect(first.record.buttonLabels.length).toBe(5);
    });

    it('rest produces 2 buttons (recover + focus)', () => {
        const first = makeFakeScene('en', 1);
        handleRestRoom(first.scene);
        expect(first.record.buttonLabels.length).toBe(2);
    });
});
