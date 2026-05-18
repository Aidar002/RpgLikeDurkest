import { MAP_CONFIG, RUN_CONFIG } from '../data/GameConfig';
import { POST_MAJOR_RECOVERY_POOL, RoomType, type BossKind, type MapNode } from '../data/MapTypes';
import { type MapValidationReport, formatMapDebug, validateMap } from './map/validate';
import { defaultRng, type Rng } from './Rng';

// Re-exported from `data/MapTypes.ts`. New code should import the
// types from `data/MapTypes` directly; the re-exports here exist so
// existing call sites that do `import { RoomType } from
// '../systems/MapGenerator'` keep compiling.
export { RoomType };
export type { BossKind, MapNode };

// Re-exported from `systems/map/validate.ts` for back-compat. New
// callers should import from that module directly.
export { validateMap, formatMapDebug };
export type { MapValidationReport };

const BASE_ROOM_POOL: RoomType[] = [
    RoomType.ENEMY,
    RoomType.EMPTY,
    RoomType.REST,
    RoomType.TREASURE,
];

/**
 * Recovery / reward pool used right before the final boss layer.
 */
const FINAL_APPROACH_POOL: RoomType[] = [
    RoomType.REST,
    RoomType.SHRINE,
    RoomType.MERCHANT,
    RoomType.TREASURE,
];

/** Minimum width of the final-approach layer so the player always
 *  has at least two recovery / reward options before choosing which
 *  final-boss node to enter. */
const FINAL_APPROACH_MIN_WIDTH = 2;

/**
 * Forced number of children in the START room's child layer
 * (depth = 1). The player should always see 4 directional choices
 * from the very first step — one in each grid direction — so the
 * run feels open right away.
 */
const START_FANOUT_WIDTH = 4;

/**
 * Container-local coordinates of the START node. Chosen so that the
 * map container's resting position centres START at the viewport
 * focal point used by {@link MapView.getMapOffset}.
 */
const MAP_START_X = 360;
/** @see MAP_START_X */
const MAP_START_Y = 380;

/**
 * Pixel spacing between adjacent grid cells. Matches the previous
 * preferred-edge length so the visual feel is unchanged: every
 * 90° step on the grid is exactly one screen segment.
 */
const GRID_CELL = 150;

/**
 * Soft cap on the number of distinct cells in any non-START layer.
 * Layer 1 is always exactly {@link START_FANOUT_WIDTH} (4) so the
 * player has a 4-way hub on entry; deeper layers are capped here so
 * the diamond-perimeter growth doesn't explode for long runs.
 *
 * When the rolled fanouts produce more candidate cells than this,
 * we keep the cells with the most parent claims (i.e. the
 * diagonals shared by two parents) — this naturally consolidates
 * the graph into a "main road plus side streets" layout.
 */
const MAX_LAYER_WIDTH = 4;

/**
 * Probability mass for each fanout count (1..4). Fanout 1 is rare
 * by design — a node with a single forward edge feels like a forced
 * corridor and the user explicitly asked for those to be uncommon.
 * The forced-min rule in {@link MapGenerator.buildLayer} additionally
 * guarantees no two single-fanout nodes appear back-to-back on any
 * path.
 *
 * Distribution is biased toward 2-4 (10/30/30/30) so corridor cells
 * stay rare (~10%) while branching, three-way and four-way splits
 * each get equal weight — keeps the run feeling "branchy" without
 * over-favouring max fanout.
 */
const FANOUT_WEIGHTS: readonly number[] = [0.1, 0.3, 0.3, 0.3];

const GRID_DIRS: ReadonlyArray<{ dx: number; dy: number }> = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
];

function clamp(value: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, value));
}

function gridKey(gx: number, gy: number): string {
    return `${gx},${gy}`;
}

function manhattan(gx: number, gy: number): number {
    return Math.abs(gx) + Math.abs(gy);
}

interface GridPos {
    gx: number;
    gy: number;
}

/**
 * The (up to 3) grid neighbours of `(gx, gy)` that are one step
 * **further** from the origin in BFS / Manhattan terms — i.e. the
 * forward grid moves available to a player standing at this cell.
 *
 *  - Origin `(0, 0)`: all 4 directions are forward.
 *  - Axis cell (e.g. `(d, 0)`): 3 forward moves.
 *  - Diagonal cell (e.g. `(a, b)` with `a, b ≠ 0`): 2 forward moves.
 */
function forwardNeighbours(gx: number, gy: number): GridPos[] {
    const d = manhattan(gx, gy);
    const out: GridPos[] = [];
    for (const dir of GRID_DIRS) {
        const ngx = gx + dir.dx;
        const ngy = gy + dir.dy;
        if (manhattan(ngx, ngy) === d + 1) out.push({ gx: ngx, gy: ngy });
    }
    return out;
}

// =============================================================================
// MapGenerator routing map (see .agents/skills/rpg-like-durkest/SKILL.md for the cross-file picture)
// -----------------------------------------------------------------------------
// Public exports: type re-exports (RoomType / MapNode / BossKind
//   from data/MapTypes), validation re-exports (validateMap /
//   formatMapDebug / MapValidationReport from systems/map/validate)
// Module-private constants: BASE_ROOM_POOL, FINAL_APPROACH_POOL,
//   FINAL_APPROACH_MIN_WIDTH, START_FANOUT_WIDTH,
//   MAP_START_X / MAP_START_Y, GRID_CELL, MAX_LAYER_WIDTH,
//   FANOUT_WEIGHTS, GRID_DIRS, gridKey / manhattan / forwardNeighbours
// MapGenerator class — full top-of-class field declarations + ctor +
//   the layered build / promotion / type-resolution / boss-adjacency
//   pipeline. Validation (`validateMap` and friends) lives in
//   `systems/map/validate.ts` to keep this file under ~900 lines.
// =============================================================================
export class MapGenerator {
    private counter = 0;
    private availableRooms = new Set<RoomType>(BASE_ROOM_POOL);
    private rng: Rng;
    /**
     * Total run length (final boss is at this depth). Defaults to
     * {@link RUN_CONFIG.runLength} but can be overridden per
     * generator instance.
     */
    private runLength: number;

    /**
     * Per-node "steps since the last boss along this branch". Used
     * by the bossPressure pass to decide whether a node is forced
     * into a MINI_BOSS / major BOSS slot. Combined across incoming
     * parents with `Math.max(...)` so a long-pressure path can't be
     * masked by a freshly-reset cross-link.
     */
    private stepsSinceBoss = new Map<string, number>();

    /** Running tallies of mid-run bosses placed so far, used to
     *  enforce the runLength-derived budgets without overshooting. */
    private majorBossesPlaced = 0;
    private miniBossesPlaced = 0;

    /** All grid cells we've ever produced, keyed by `${gx},${gy}`. */
    private occupied = new Map<string, MapNode>();

    constructor(
        initialRooms: RoomType[] = BASE_ROOM_POOL,
        rng: Rng = defaultRng,
        runLength: number = RUN_CONFIG.runLength
    ) {
        this.rng = rng;
        this.runLength = runLength;
        this.setAvailableRoomTypes(initialRooms);
    }

    /**
     * The final-boss depth this generator targets. Public so tests
     * and validation can compute path-length invariants without
     * reaching into the config singleton.
     */
    getRunLength(): number {
        return this.runLength;
    }

    /** Pressure window for the current run length, in branch steps
     *  since the last boss. */
    private getPressureWindow(): { start: number; end: number } {
        const cfg = RUN_CONFIG.bossPressure;
        return {
            start: Math.max(
                cfg.windowStartFloor,
                Math.round(this.runLength * cfg.windowStartFactor)
            ),
            end: Math.max(cfg.windowEndFloor, Math.round(this.runLength * cfg.windowEndFactor)),
        };
    }

    /** Mid-run major-boss budget, scaled to the current run length. */
    private getTargetMajorBosses(): number {
        const cfg = RUN_CONFIG.bossPressure;
        return clamp(
            Math.round(this.runLength / cfg.targetMajorFactor),
            cfg.targetMajorMin,
            cfg.targetMajorMax
        );
    }

    /** Mid-run mini-boss budget, scaled to the current run length. */
    private getTargetMiniBosses(): number {
        const cfg = RUN_CONFIG.bossPressure;
        return clamp(
            Math.round(this.runLength / cfg.targetMiniFactor),
            cfg.targetMiniMin,
            cfg.targetMiniMax
        );
    }

    setAvailableRoomTypes(roomTypes: RoomType[]) {
        this.availableRooms = new Set(
            roomTypes.filter((type) => type !== RoomType.START && type !== RoomType.BOSS)
        );
        BASE_ROOM_POOL.forEach((type) => this.availableRooms.add(type));
    }

    generateInitialMap(lookahead: number = MAP_CONFIG.initialLookahead): MapNode[] {
        const all: MapNode[] = [];
        const start = this.makeNode(0, 0, RoomType.START);
        start.gx = 0;
        start.gy = 0;
        start.x = MAP_START_X;
        start.y = MAP_START_Y;
        start.visited = true;
        all.push(start);
        this.occupied.set(gridKey(0, 0), start);
        this.stepsSinceBoss.set(start.id, 0);

        const lastDepth = Math.min(lookahead, this.runLength);
        let previousLayer: MapNode[] = [start];
        for (let depth = 1; depth <= lastDepth; depth++) {
            previousLayer = this.buildLayer(depth, previousLayer, all);
        }

        return all;
    }

    generateNextLayer(allNodes: MapNode[], fromDepth: number): MapNode[] {
        if (fromDepth >= this.runLength) {
            return [];
        }
        // Re-sync the occupied grid map from the caller's snapshot
        // — DungeonManager owns the canonical node list and may
        // outlive the generator that built it.
        for (const n of allNodes) {
            const k = gridKey(n.gx, n.gy);
            if (!this.occupied.has(k)) {
                this.occupied.set(k, n);
            }
        }
        const previousLayer = allNodes.filter((node) => node.depth === fromDepth);
        // buildLayer pushes new nodes into its third argument, so
        // pass a defensive copy — DungeonManager re-merges via
        // `addNodes`.
        const newLayer = this.buildLayer(fromDepth + 1, previousLayer, [...allNodes]);
        return newLayer;
    }

    /**
     * Build one layer of the BFS DAG. Layer `depth` contains the
     * grid cells at Manhattan distance `depth` from the origin
     * that are forward neighbours of at least one parent in
     * `previousLayer`.
     *
     * Invariants enforced:
     *
     * - START always has exactly 4 children (one in each cardinal
     *   direction).
     * - Every parent ends up with ≥ 1 forward edge.
     * - No parent's outgoing edges exceed `MAP_CONFIG.maxEdgesPerNode`.
     * - "Single-path streaks" never run more than 1 cell long: if
     *   any predecessor of a parent had fanout 1 (forced
     *   corridor), we force the parent's own fanout to ≥ 2 so the
     *   player never walks two corridor cells in a row.
     * - Final-boss adjacency / post-major-recovery rules are
     *   preserved from the previous generator.
     */
    private buildLayer(depth: number, previousLayer: MapNode[], allNodes: MapNode[]): MapNode[] {
        if (depth === 1) {
            return this.buildStartChildLayer(previousLayer, allNodes);
        }

        const isFinalLayer = depth === this.runLength;
        const isFinalApproach = depth === this.runLength - 1;

        // Pass A: forced minimum fanout per parent. Anchors the
        // "no two single-path nodes in a row" rule on the previous
        // generator step's outputs.
        const forcedMin = new Map<string, number>();
        for (const parent of previousLayer) {
            let fmin = 1;
            const preds = allNodes.filter(
                (n) => n.depth === depth - 2 && n.edges.includes(parent.id)
            );
            for (const pred of preds) {
                if (pred.edges.length === 1) {
                    fmin = 2;
                    break;
                }
            }
            forcedMin.set(parent.id, fmin);
        }

        // Pass B: each parent picks its forward grid neighbours.
        // Multiple parents may claim the same neighbour (DAG
        // sharing), which is what makes the diamond layout
        // converge nicely as depth grows.
        const claims = new Map<string, MapNode[]>();
        const claimOrder: string[] = [];

        // Stable iteration order keyed by node id so seed-replay is
        // deterministic regardless of how previousLayer was built.
        const sortedParents = [...previousLayer].sort((a, b) => a.id.localeCompare(b.id));

        for (const parent of sortedParents) {
            const fwd = forwardNeighbours(parent.gx, parent.gy);
            // Defensive filter: forward neighbours occupied at a
            // *different* depth (impossible on a clean grid, but we
            // keep the check so a hand-built test fixture can't
            // smuggle in a same-depth diagonal that would corrupt
            // the BFS layering).
            const valid = fwd.filter((p) => {
                const existing = this.occupied.get(gridKey(p.gx, p.gy));
                return !existing || existing.depth === depth;
            });
            const shuffled = this.shuffle([...valid]);
            const fmin = forcedMin.get(parent.id) ?? 1;
            const fanout = this.rollFanout(fmin, shuffled.length);
            const chosen = shuffled.slice(0, fanout);
            for (const slot of chosen) {
                const k = gridKey(slot.gx, slot.gy);
                const existing = claims.get(k);
                if (existing) {
                    existing.push(parent);
                } else {
                    claims.set(k, [parent]);
                    claimOrder.push(k);
                }
            }
        }

        // Pass C: cap the layer width so the diamond doesn't blow
        // up on long runs. We pick cells via coverage-greedy: each
        // pick favours cells whose claimers still need to satisfy
        // their forced-min ("no two corridors in a row"), then
        // breaks ties by total claim count so the graph consolidates
        // into shared diagonals. A small overage above MAX_LAYER_WIDTH
        // is permitted only when a parent would otherwise be left
        // with fewer cells than their forced-min target — without
        // that escape hatch the no-corridor rule could not always
        // hold.
        if (claimOrder.length > MAX_LAYER_WIDTH) {
            const claimCount = (k: string) => claims.get(k)!.length;
            const need = new Map<string, number>();
            for (const p of sortedParents) {
                need.set(p.id, forcedMin.get(p.id) ?? 1);
            }
            const remaining = new Set(claimOrder);
            const kept = new Set<string>();

            const pickBest = (): string | null => {
                let bestKey: string | null = null;
                let bestUnmet = -1;
                let bestClaims = -1;
                for (const k of remaining) {
                    const claimers = claims.get(k)!;
                    let unmetCovered = 0;
                    for (const p of claimers) {
                        if ((need.get(p.id) ?? 0) > 0) unmetCovered++;
                    }
                    const total = claimers.length;
                    const better =
                        unmetCovered > bestUnmet ||
                        (unmetCovered === bestUnmet && total > bestClaims) ||
                        (unmetCovered === bestUnmet &&
                            total === bestClaims &&
                            (bestKey === null || k < bestKey));
                    if (better) {
                        bestKey = k;
                        bestUnmet = unmetCovered;
                        bestClaims = total;
                    }
                }
                return bestKey;
            };

            // Phase 1: fill up to the cap with coverage-greedy picks.
            while (kept.size < MAX_LAYER_WIDTH && remaining.size > 0) {
                const k = pickBest();
                if (k === null) break;
                kept.add(k);
                remaining.delete(k);
                for (const p of claims.get(k)!) {
                    const cur = need.get(p.id) ?? 0;
                    if (cur > 0) need.set(p.id, cur - 1);
                }
            }

            // Phase 2: ensure every parent meets
            // min(forcedMin, theirClaimedCellCount). Any cell added
            // here pushes the layer slightly over MAX_LAYER_WIDTH —
            // this is the trade-off that lets us guarantee no two
            // single-fanout corridors in a row.
            for (const parent of sortedParents) {
                const myKeys = claimOrder.filter((k) => claims.get(k)!.includes(parent));
                if (myKeys.length === 0) continue;
                const target = Math.min(forcedMin.get(parent.id) ?? 1, myKeys.length);
                const myKept = myKeys.filter((k) => kept.has(k));
                if (myKept.length >= target) continue;
                const myDropped = myKeys
                    .filter((k) => !kept.has(k))
                    .sort((a, b) => {
                        const diff = claimCount(b) - claimCount(a);
                        return diff !== 0 ? diff : a.localeCompare(b);
                    });
                let restored = myKept.length;
                for (const k of myDropped) {
                    if (restored >= target) break;
                    kept.add(k);
                    restored++;
                }
            }

            for (const k of [...claims.keys()]) {
                if (!kept.has(k)) claims.delete(k);
            }
            const newOrder = claimOrder.filter((k) => kept.has(k));
            claimOrder.length = 0;
            claimOrder.push(...newOrder);
        }

        // Pass C': enforce the final-approach minimum width — the
        // player must always see ≥ 2 recovery rooms before picking a
        // final boss, even if the rolled fanouts happened to converge.
        if (isFinalApproach && claimOrder.length < FINAL_APPROACH_MIN_WIDTH) {
            for (const parent of sortedParents) {
                if (claimOrder.length >= FINAL_APPROACH_MIN_WIDTH) break;
                const fwd = forwardNeighbours(parent.gx, parent.gy);
                for (const slot of fwd) {
                    if (claimOrder.length >= FINAL_APPROACH_MIN_WIDTH) break;
                    const k = gridKey(slot.gx, slot.gy);
                    if (claims.has(k)) continue;
                    claims.set(k, [parent]);
                    claimOrder.push(k);
                }
            }
        }

        // Pass D: materialize new cells and wire edges.
        const newLayer: MapNode[] = [];
        for (let slotIdx = 0; slotIdx < claimOrder.length; slotIdx++) {
            const key = claimOrder[slotIdx];
            const claimingParents = claims.get(key)!;
            const [gxStr, gyStr] = key.split(',');
            const gx = Number(gxStr);
            const gy = Number(gyStr);

            const bossKind: BossKind = isFinalLayer
                ? 'final'
                : this.decideBossKind(claimingParents, isFinalApproach);
            const type = this.resolveRoomType(bossKind, depth, claimingParents);

            const cell = this.makeNode(depth, slotIdx, type, bossKind);
            cell.gx = gx;
            cell.gy = gy;
            cell.x = MAP_START_X + gx * GRID_CELL;
            cell.y = MAP_START_Y + gy * GRID_CELL;
            newLayer.push(cell);
            allNodes.push(cell);
            this.occupied.set(key, cell);

            for (const parent of claimingParents) {
                if (this.bossAdjacencyBlocks(parent, bossKind)) continue;
                if (!parent.edges.includes(cell.id)) {
                    parent.edges.push(cell.id);
                }
            }

            if (bossKind === 'major') this.majorBossesPlaced++;
            else if (bossKind === 'mini') this.miniBossesPlaced++;
        }

        // Pass E: every parent must end up with ≥ 1 forward edge.
        // Adoption / fallback creation here is the safety net for
        // pathological cases where the layer cap or boss-adjacency
        // rule left a parent with no rolled children.
        for (const parent of previousLayer) {
            if (newLayer.some((n) => parent.edges.includes(n.id))) continue;
            const fwd = forwardNeighbours(parent.gx, parent.gy);
            for (const slot of fwd) {
                const existing = newLayer.find((n) => n.gx === slot.gx && n.gy === slot.gy);
                if (existing && !this.parentChildBlocked(parent, existing)) {
                    parent.edges.push(existing.id);
                    break;
                }
            }
            if (newLayer.some((n) => parent.edges.includes(n.id))) continue;
            // Last resort — create a fresh non-boss cell so the
            // run never deadlocks with an orphan parent. Forcing
            // the cell to a recovery type here keeps the
            // post-major / final-approach invariants safe even on
            // this fallback path.
            const slot = fwd[0];
            if (!slot) continue;
            const safeKind: BossKind = isFinalLayer ? 'final' : null;
            const safeType = this.resolveRoomType(safeKind, depth, [parent]);
            const cell = this.makeNode(depth, newLayer.length, safeType, safeKind);
            cell.gx = slot.gx;
            cell.gy = slot.gy;
            cell.x = MAP_START_X + slot.gx * GRID_CELL;
            cell.y = MAP_START_Y + slot.gy * GRID_CELL;
            newLayer.push(cell);
            allNodes.push(cell);
            this.occupied.set(gridKey(slot.gx, slot.gy), cell);
            parent.edges.push(cell.id);
            // safeKind here is always 'final' or null — the fallback
            // never spawns a fresh mid-run boss — so we don't bump
            // the major/mini placement counters.
        }

        // Pass F: recompute stepsSinceBoss with the **max** strategy
        // across incoming parents so a long-pressure path can't be
        // masked by a freshly-reset cross-link.
        for (const node of newLayer) {
            if (node.bossKind !== null) {
                this.stepsSinceBoss.set(node.id, 0);
                continue;
            }
            const parents = previousLayer.filter((p) => p.edges.includes(node.id));
            const maxSteps =
                parents.length === 0
                    ? 0
                    : Math.max(...parents.map((p) => this.stepsSinceBoss.get(p.id) ?? 0));
            this.stepsSinceBoss.set(node.id, maxSteps + 1);
        }

        return newLayer;
    }

    /**
     * Build the depth-1 layer: the START room is a 4-way hub, so
     * we always create exactly four children, one in each cardinal
     * direction.
     */
    private buildStartChildLayer(previousLayer: MapNode[], allNodes: MapNode[]): MapNode[] {
        const start = previousLayer[0];
        const isFinalLayer = 1 === this.runLength;
        const isFinalApproach = 1 === this.runLength - 1;

        const dirs: GridPos[] = [
            { gx: 1, gy: 0 },
            { gx: -1, gy: 0 },
            { gx: 0, gy: 1 },
            { gx: 0, gy: -1 },
        ];
        // START_FANOUT_WIDTH is module-private but used to index
        // `order` below; we'd run off the end if anyone ever raises
        // it past the 4 cardinal directions without expanding the
        // `dirs` array. Assert here so a future tuning change yells
        // at the next contributor instead of silently picking up
        // `undefined` slots.
        if (START_FANOUT_WIDTH > dirs.length) {
            throw new Error(
                `START_FANOUT_WIDTH (${START_FANOUT_WIDTH}) cannot exceed available cardinal directions (${dirs.length})`
            );
        }
        const order = this.shuffle([...dirs]);

        const newLayer: MapNode[] = [];
        for (let i = 0; i < START_FANOUT_WIDTH; i++) {
            const slot = order[i];
            const bossKind: BossKind = isFinalLayer
                ? 'final'
                : isFinalApproach
                  ? null
                  : this.decideBossKind([start], isFinalApproach);
            const type = this.resolveRoomType(bossKind, 1, [start]);
            const cell = this.makeNode(1, i, type, bossKind);
            cell.gx = slot.gx;
            cell.gy = slot.gy;
            cell.x = MAP_START_X + slot.gx * GRID_CELL;
            cell.y = MAP_START_Y + slot.gy * GRID_CELL;
            newLayer.push(cell);
            allNodes.push(cell);
            this.occupied.set(gridKey(slot.gx, slot.gy), cell);
            start.edges.push(cell.id);
            if (bossKind === 'major') this.majorBossesPlaced++;
            else if (bossKind === 'mini') this.miniBossesPlaced++;
        }

        for (const node of newLayer) {
            if (node.bossKind !== null) {
                this.stepsSinceBoss.set(node.id, 0);
            } else {
                this.stepsSinceBoss.set(node.id, (this.stepsSinceBoss.get(start.id) ?? 0) + 1);
            }
        }
        return newLayer;
    }

    /**
     * Roll a fanout count (1..N) for a parent, biased to 2-3 with a
     * rare 1 and an occasional 4. `forcedMin` clamps the floor —
     * e.g. 2 when the parent's predecessor itself had fanout 1, to
     * avoid two consecutive single-path nodes.
     */
    private rollFanout(forcedMin: number, slotsAvailable: number): number {
        const cap = Math.min(slotsAvailable, MAP_CONFIG.maxEdgesPerNode);
        if (cap <= 0) return 0;
        const lo = Math.max(1, forcedMin);
        if (cap <= lo) return cap;

        let totalW = 0;
        for (let f = lo; f <= cap; f++) {
            totalW += FANOUT_WEIGHTS[f - 1] ?? 0.05;
        }
        let roll = this.rng.next() * totalW;
        for (let f = lo; f <= cap; f++) {
            const w = FANOUT_WEIGHTS[f - 1] ?? 0.05;
            roll -= w;
            if (roll <= 0) return f;
        }
        return cap;
    }

    /**
     * Boss-encounter decision for a non-final, non-final-approach
     * cell. Combines incoming parents' `stepsSinceBoss` with the
     * **max** strategy — see {@link buildLayer} pass F. Returns
     * `null` when at least one parent is itself a boss (no
     * boss-to-boss edges).
     */
    private decideBossKind(parents: MapNode[], isFinalApproach: boolean): BossKind {
        if (isFinalApproach) return null;
        if (parents.length === 0) return null;
        if (parents.some((p) => p.bossKind !== null)) return null;

        const cfg = RUN_CONFIG.bossPressure;
        const window = this.getPressureWindow();
        // Manual reduce instead of Math.max(...spread) so the empty-
        // parents case (already short-circuited above) couldn't slip
        // through as -Infinity if a future refactor changes the
        // early-return ordering.
        let maxSteps = 0;
        for (const p of parents) {
            const s = this.stepsSinceBoss.get(p.id) ?? 0;
            if (s > maxSteps) maxSteps = s;
        }
        const steps = maxSteps + 1;
        if (steps < window.start) return null;

        const targetMajor = this.getTargetMajorBosses();
        const targetMini = this.getTargetMiniBosses();
        const majorAvailable = this.majorBossesPlaced < targetMajor;
        const miniAvailable = this.miniBossesPlaced < targetMini;
        if (!majorAvailable && !miniAvailable) return null;

        if (steps >= window.end) {
            if (majorAvailable && this.rng.next() < cfg.majorOddsAtForcedEnd) {
                return 'major';
            }
            return miniAvailable ? 'mini' : 'major';
        }
        const denom = window.end - window.start;
        const t = denom === 0 ? 1 : (steps - window.start) / denom;
        if (this.rng.next() >= t) return null;
        if (majorAvailable && this.rng.next() < cfg.majorOddsInWindow) {
            return 'major';
        }
        return miniAvailable ? 'mini' : 'major';
    }

    /**
     * Pick the room type for a new cell. Bosses always get
     * `BOSS` / `MINI_BOSS`; otherwise we honour final-approach and
     * post-major-recovery overrides before falling through to the
     * weighted regular pool.
     */
    private resolveRoomType(bossKind: BossKind, depth: number, parents: MapNode[]): RoomType {
        if (bossKind === 'final' || bossKind === 'major') return RoomType.BOSS;
        if (bossKind === 'mini') return RoomType.MINI_BOSS;

        if (depth === this.runLength - 1) {
            const r = this.pickRecoveryType(FINAL_APPROACH_POOL);
            if (r) return r;
        }
        if (parents.some((p) => p.bossKind === 'major')) {
            const r = this.pickRecoveryType(POST_MAJOR_RECOVERY_POOL);
            if (r) return r;
        }

        const allowed = this.getAllowedRoomTypes(depth);
        return this.pickWeightedRoom(allowed);
    }

    private bossAdjacencyBlocks(parent: MapNode, childKind: BossKind): boolean {
        if (childKind === null) return false;
        return parent.bossKind !== null;
    }

    /**
     * Edge-level invariant check used by the Pass E adoption step.
     * An edge from {@code parent} to {@code child} is rejected if it
     * would put two boss rooms back-to-back, or if it would attach a
     * non-recovery room directly after a major boss.
     */
    private parentChildBlocked(parent: MapNode, child: MapNode): boolean {
        if (this.bossAdjacencyBlocks(parent, child.bossKind)) return true;
        if (parent.bossKind === 'major' && !POST_MAJOR_RECOVERY_POOL.includes(child.type)) {
            return true;
        }
        return false;
    }

    private getAllowedRoomTypes(depth: number): RoomType[] {
        const depthRestrictedPool: RoomType[] =
            depth <= MAP_CONFIG.safeDepths
                ? BASE_ROOM_POOL
                : [
                      RoomType.ENEMY,
                      RoomType.EMPTY,
                      RoomType.TREASURE,
                      RoomType.TRAP,
                      RoomType.REST,
                      RoomType.SHRINE,
                      RoomType.MERCHANT,
                      RoomType.ELITE,
                  ];
        const allowed = depthRestrictedPool.filter((t) => this.availableRooms.has(t));
        return allowed.length > 0 ? allowed : BASE_ROOM_POOL;
    }

    private pickRecoveryType(pool: RoomType[]): RoomType | null {
        const available = pool.filter((t) => this.availableRooms.has(t));
        return available.length > 0 ? this.pickWeightedRoom(available) : null;
    }

    private pickWeightedRoom(pool: RoomType[]): RoomType {
        if (pool.length === 0) {
            throw new Error('pickWeightedRoom called with empty pool');
        }
        const totalWeight = pool.reduce((sum, t) => sum + this.getWeight(t), 0);
        // If every entry in `pool` weights to 0 (e.g. an unmaintained
        // tuning table), `Math.random() * 0` is 0 and the loop below
        // happily returns pool[0]. Spell that out explicitly so the
        // intent is clear (uniform fallback over the pool) instead
        // of relying on the cursor never advancing.
        if (totalWeight <= 0) {
            const idx = Math.min(pool.length - 1, Math.floor(this.rng.next() * pool.length));
            return pool[idx];
        }
        const roll = this.rng.next() * totalWeight;
        let cursor = 0;
        for (const t of pool) {
            cursor += this.getWeight(t);
            if (roll <= cursor) return t;
        }
        return pool[pool.length - 1];
    }

    private getWeight(type: RoomType): number {
        const weights: Partial<Record<RoomType, number>> = MAP_CONFIG.roomTypeWeights;
        return weights[type] ?? 0;
    }

    private shuffle<T>(arr: T[]): T[] {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng.next() * (i + 1));
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr;
    }

    private makeNode(
        depth: number,
        slot: number,
        type: RoomType,
        bossKind: BossKind = null
    ): MapNode {
        return {
            id: `n${this.counter++}`,
            depth,
            slot,
            gx: 0,
            gy: 0,
            x: 0,
            y: 0,
            type,
            bossKind,
            visited: false,
            cleared: false,
            edges: [],
        };
    }
}
