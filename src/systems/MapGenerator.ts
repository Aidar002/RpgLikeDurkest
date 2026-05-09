import { FEATURES, MAP_CONFIG, RUN_CONFIG } from '../data/GameConfig';
import { defaultRng, type Rng } from './Rng';

export const RoomType = {
    START: 'START',
    ENEMY: 'ENEMY',
    TREASURE: 'TREASURE',
    TRAP: 'TRAP',
    REST: 'REST',
    SHRINE: 'SHRINE',
    MERCHANT: 'MERCHANT',
    ELITE: 'ELITE',
    BOSS: 'BOSS',
    /**
     * Branch-guardian / mid-run threat. Placed by the bossPressure
     * pass when a branch's `stepsSinceBoss` enters the pressure
     * window. Pairs with `bossKind === 'mini'`.
     */
    MINI_BOSS: 'MINI_BOSS',
    EMPTY: 'EMPTY',
} as const;

export type RoomType = (typeof RoomType)[keyof typeof RoomType];

/**
 * Tag describing what kind of boss-encounter (if any) lives in
 * a node. Set by the generator at node-creation time.
 *
 *  - `'final'` — terminal final-boss node (depth === runLength).
 *    Victory over any of these ends the run.
 *  - `'major'` — mid-run major boss. Always grants a seal.
 *  - `'mini'`  — mid-run threat / branch guardian. Optionally
 *    grants a seal (see `RUN_CONFIG.seals.miniSealOdds`).
 *  - `null`    — non-boss room.
 */
export type BossKind = 'final' | 'major' | 'mini' | null;

/**
 * Tag for seal-granting rooms. Major bosses always grant a major
 * seal; a fraction of mini bosses grant a mini seal.
 */
export type SealType = 'major' | 'mini';

/**
 * One room in the dungeon graph.
 *
 * The dungeon is laid out as a 2D integer grid: every node sits at
 * `(gx, gy)` and connects only to **orthogonally adjacent** cells
 * (Manhattan distance = 1). `depth` is the BFS distance from
 * START — equivalent to the cell's Manhattan distance from the
 * origin — so every forward edge is a 90° step on the grid.
 *
 * `x` / `y` are the rendered pixel coordinates
 * (`MAP_START_X + gx * GRID_CELL`, etc.). They are convenience
 * copies of the grid position scaled for the renderer; consumers
 * should use `gx`/`gy` for any topology reasoning.
 *
 * `slot` is retained for back-compat with hand-built test
 * fixtures and is no longer used for layout.
 */
export interface MapNode {
    id: string;
    depth: number;
    slot: number;
    /** Integer grid X coordinate (cells). */
    gx: number;
    /** Integer grid Y coordinate (cells). */
    gy: number;
    /** Container-local x position (px). Always `MAP_START_X + gx * GRID_CELL`. */
    x: number;
    /** Container-local y position (px). Always `MAP_START_Y + gy * GRID_CELL`. */
    y: number;
    type: RoomType;
    bossKind: BossKind;
    grantsSeal: boolean;
    sealType: SealType | null;
    visited: boolean;
    cleared: boolean;
    edges: string[];
}

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
 * Recovery / reward room types forced as the **direct child** of a
 * mid-run major boss (`bossKind === 'major'`). Mini-bosses do *not*
 * trigger this — only major bosses interrupt the run hard enough
 * to deserve a guaranteed catch-your-breath room afterwards.
 */
const POST_MAJOR_RECOVERY_POOL: RoomType[] = [
    RoomType.REST,
    RoomType.SHRINE,
    RoomType.MERCHANT,
    RoomType.TREASURE,
];

function clamp(value: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, value));
}

/**
 * Compute the `requiredSeals` budget for a given run length.
 *
 * When the seal feature is disabled (see {@link FEATURES.seals}) we
 * return 0 so the generator skips the seal-coverage promotion pass —
 * promoting plain rooms into mini-bosses for an invisible system
 * would just inflate the boss count and slow generation on long
 * runs.
 */
export function getRequiredSeals(runLength: number): number {
    if (!FEATURES.seals) return 0;
    const cfg = RUN_CONFIG.seals;
    return clamp(
        Math.round(runLength / cfg.requiredSealsFactor),
        cfg.requiredSealsMin,
        cfg.requiredSealsMax,
    );
}

/**
 * Container-local coordinates of the START node. Chosen so that the
 * map container's resting position centres START at the viewport
 * focal point used by {@link MapView.getMapOffset}.
 */
export const MAP_START_X = 360;
/** @see MAP_START_X */
export const MAP_START_Y = 380;

/**
 * Pixel spacing between adjacent grid cells. Matches the previous
 * preferred-edge length so the visual feel is unchanged: every
 * 90° step on the grid is exactly one screen segment.
 */
export const GRID_CELL = 150;

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
// RoomType enum + MapNode + room pools (BASE / FINAL_APPROACH /
//   POST_MAJOR_RECOVERY) . . . . . . . . . . . . . . . . . . . . .   4 - 123
// Pure helpers: clamp, getRequiredSeals, GRID_DIRS, gridKey,
//   manhattan, forwardNeighbours . . . . . . . . . . . . . . . . . 125 - 230
// MapGenerator class:
//   Field declarations . . . . . . . . . . . . . . . . . . . . . . 232 - 258
//   constructor / getRunLength / pressure-window helpers . . . . . 260 - 313
//   setAvailableRoomTypes / generateInitialMap / generateNextLayer  315 - 379
//   enforceSealCoverage (post-build seal/promotion pass) . . . . . 381 - 426
//   buildLayer (the heavy "for each parent → place children" core)  428 - 720
//   buildStartChildLayer / rollFanout / decideBossKind . . . . . . 722 - 845
//   resolveRoomType / boss adjacency / parent-child blocking . . . 847 - 886
//   getAllowedRoomTypes / pickRecoveryType / pickWeightedRoom /
//     getWeight / shuffle / makeNode . . . . . . . . . . . . . . . 888 - 980
// validateMap (post-build invariant report) . . . . . . . . . . .  985 - 1173
// formatMapDebug (human-readable dump for tests/console) . . . . 1178 - 1198
// computeMinSealsPerPath / pickBestSealPromotion /
//   pickRegularNodeToPromoteToMini / computePerPathStat . . . . . 1200 - end
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
        runLength: number = RUN_CONFIG.runLength,
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
                Math.round(this.runLength * cfg.windowStartFactor),
            ),
            end: Math.max(
                cfg.windowEndFloor,
                Math.round(this.runLength * cfg.windowEndFactor),
            ),
        };
    }

    /** Mid-run major-boss budget, scaled to the current run length. */
    private getTargetMajorBosses(): number {
        const cfg = RUN_CONFIG.bossPressure;
        return clamp(
            Math.round(this.runLength / cfg.targetMajorFactor),
            cfg.targetMajorMin,
            cfg.targetMajorMax,
        );
    }

    /** Mid-run mini-boss budget, scaled to the current run length. */
    private getTargetMiniBosses(): number {
        const cfg = RUN_CONFIG.bossPressure;
        return clamp(
            Math.round(this.runLength / cfg.targetMiniFactor),
            cfg.targetMiniMin,
            cfg.targetMiniMax,
        );
    }

    setAvailableRoomTypes(roomTypes: RoomType[]) {
        this.availableRooms = new Set(
            roomTypes.filter(
                (type) => type !== RoomType.START && type !== RoomType.BOSS,
            ),
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

        if (lastDepth >= this.runLength) {
            this.enforceSealCoverage(all);
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
        const newLayer = this.buildLayer(fromDepth + 1, previousLayer, [
            ...allNodes,
        ]);
        if (fromDepth + 1 >= this.runLength) {
            this.enforceSealCoverage([...allNodes, ...newLayer]);
        }
        return newLayer;
    }

    /**
     * Post-generation pass: greedily promote mini-boss nodes (or, if
     * none cover a deficit path, plain rooms) to grant a seal until
     * every full path traverses ≥ `requiredSeals` seal-granting
     * nodes. Deterministic for a given seed: ties broken by id.
     */
    private enforceSealCoverage(allNodes: MapNode[]): void {
        const required = getRequiredSeals(this.runLength);
        if (required <= 0) return;
        let safety = allNodes.length * 2;
        while (safety-- > 0) {
            const stat = computeMinSealsPerPath(allNodes);
            if (stat === null || stat.min >= required) return;
            const miniCandidate = pickBestSealPromotion(allNodes, required);
            if (miniCandidate) {
                miniCandidate.grantsSeal = true;
                miniCandidate.sealType = 'mini';
                continue;
            }
            const promoteRegular = pickRegularNodeToPromoteToMini(
                allNodes,
                this.runLength,
                required,
                this.getPressureWindow().start,
            );
            if (!promoteRegular) return;
            promoteRegular.type = RoomType.MINI_BOSS;
            promoteRegular.bossKind = 'mini';
            promoteRegular.grantsSeal = true;
            promoteRegular.sealType = 'mini';
            this.miniBossesPlaced++;
        }
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
    private buildLayer(
        depth: number,
        previousLayer: MapNode[],
        allNodes: MapNode[],
    ): MapNode[] {
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
                (n) => n.depth === depth - 2 && n.edges.includes(parent.id),
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
        const sortedParents = [...previousLayer].sort((a, b) =>
            a.id.localeCompare(b.id),
        );

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
                const myKeys = claimOrder.filter((k) =>
                    claims.get(k)!.includes(parent),
                );
                if (myKeys.length === 0) continue;
                const target = Math.min(
                    forcedMin.get(parent.id) ?? 1,
                    myKeys.length,
                );
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
            const type = this.resolveRoomType(
                bossKind,
                depth,
                claimingParents,
            );

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
                const existing = newLayer.find(
                    (n) => n.gx === slot.gx && n.gy === slot.gy,
                );
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
            const cell = this.makeNode(
                depth,
                newLayer.length,
                safeType,
                safeKind,
            );
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
            const parents = previousLayer.filter((p) =>
                p.edges.includes(node.id),
            );
            const maxSteps = parents.length === 0
                ? 0
                : Math.max(
                      ...parents.map(
                          (p) => this.stepsSinceBoss.get(p.id) ?? 0,
                      ),
                  );
            this.stepsSinceBoss.set(node.id, maxSteps + 1);
        }

        return newLayer;
    }

    /**
     * Build the depth-1 layer: the START room is a 4-way hub, so
     * we always create exactly four children, one in each cardinal
     * direction.
     */
    private buildStartChildLayer(
        previousLayer: MapNode[],
        allNodes: MapNode[],
    ): MapNode[] {
        const start = previousLayer[0];
        const isFinalLayer = 1 === this.runLength;
        const isFinalApproach = 1 === this.runLength - 1;

        const dirs: GridPos[] = [
            { gx: 1, gy: 0 },
            { gx: -1, gy: 0 },
            { gx: 0, gy: 1 },
            { gx: 0, gy: -1 },
        ];
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
                this.stepsSinceBoss.set(
                    node.id,
                    (this.stepsSinceBoss.get(start.id) ?? 0) + 1,
                );
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
    private decideBossKind(
        parents: MapNode[],
        isFinalApproach: boolean,
    ): BossKind {
        if (isFinalApproach) return null;
        if (parents.some((p) => p.bossKind !== null)) return null;

        const cfg = RUN_CONFIG.bossPressure;
        const window = this.getPressureWindow();
        const maxSteps = Math.max(
            ...parents.map((p) => this.stepsSinceBoss.get(p.id) ?? 0),
        );
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
    private resolveRoomType(
        bossKind: BossKind,
        depth: number,
        parents: MapNode[],
    ): RoomType {
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
        if (parent.bossKind === 'major' &&
            !POST_MAJOR_RECOVERY_POOL.includes(child.type)) {
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
        const allowed = depthRestrictedPool.filter((t) =>
            this.availableRooms.has(t),
        );
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
        const totalWeight = pool.reduce(
            (sum, t) => sum + this.getWeight(t),
            0,
        );
        const roll = this.rng.next() * totalWeight;
        let cursor = 0;
        for (const t of pool) {
            cursor += this.getWeight(t);
            if (roll <= cursor) return t;
        }
        return pool[pool.length - 1];
    }

    private getWeight(type: RoomType): number {
        const weights: Partial<Record<RoomType, number>> =
            MAP_CONFIG.roomTypeWeights;
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
        bossKind: BossKind = null,
    ): MapNode {
        let grantsSeal = false;
        let sealType: SealType | null = null;
        if (bossKind === 'major') {
            grantsSeal = true;
            sealType = 'major';
        } else if (bossKind === 'mini') {
            if (this.rng.next() < RUN_CONFIG.seals.miniSealOdds) {
                grantsSeal = true;
                sealType = 'mini';
            }
        }
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
            grantsSeal,
            sealType,
            visited: false,
            cleared: false,
            edges: [],
        };
    }
}

/**
 * Snapshot-style report produced by {@link validateMap}.
 */
export interface MapValidationReport {
    runLength: number;
    finalDepth: number;
    totalNodes: number;
    totalEdges: number;
    finalLayerGenerated: boolean;
    finalNodeCount: number;
    allFinalAreBossKindFinal: boolean;
    everyFullPathEndsInFinalBoss: boolean | null;
    allNodesReachAFinalBoss: boolean | null;
    orphanNodeCount: number;
    deadEndCount: number;
    bossAdjacencyViolations: number;
    majorBossCount: number;
    miniBossCount: number;
    finalBossCount: number;
    postMajorRecoveryViolations: number;
    requiredSeals: number;
    sealOpportunityCount: number;
    sealsPerPath: { min: number; max: number; avg: number } | null;
    bossesPerPath: { min: number; max: number; avg: number } | null;
    pathMeetsRequiredSeals: boolean | null;
    pressureStrategy: 'max';
}

export function validateMap(
    allNodes: readonly MapNode[],
    runLength: number,
): MapValidationReport {
    const byId = new Map(allNodes.map((n) => [n.id, n]));
    const incoming = new Map<string, number>();
    const recoveryPool = new Set<RoomType>(POST_MAJOR_RECOVERY_POOL);
    let totalEdges = 0;
    let bossAdjacencyViolations = 0;
    let postMajorRecoveryViolations = 0;
    let majorBossCount = 0;
    let miniBossCount = 0;
    let finalBossCount = 0;
    let sealOpportunityCount = 0;

    for (const node of allNodes) {
        if (node.bossKind === 'major') majorBossCount++;
        else if (node.bossKind === 'mini') miniBossCount++;
        else if (node.bossKind === 'final') finalBossCount++;
        if (node.grantsSeal) sealOpportunityCount++;
        for (const edgeId of node.edges) {
            const target = byId.get(edgeId);
            if (!target) continue;
            totalEdges++;
            incoming.set(edgeId, (incoming.get(edgeId) ?? 0) + 1);
            if (node.bossKind !== null && target.bossKind !== null) {
                bossAdjacencyViolations++;
            }
            if (node.bossKind === 'major' && !recoveryPool.has(target.type)) {
                postMajorRecoveryViolations++;
            }
        }
    }

    const finalNodes = allNodes.filter((n) => n.depth === runLength);
    const finalLayerGenerated = finalNodes.length > 0;
    const requiredSeals = getRequiredSeals(runLength);

    const allFinalAreBossKindFinal =
        !finalLayerGenerated ||
        finalNodes.every(
            (n) => n.bossKind === 'final' && n.type === RoomType.BOSS,
        );

    let orphanNodeCount = 0;
    for (const node of allNodes) {
        if (node.type === RoomType.START) continue;
        if ((incoming.get(node.id) ?? 0) === 0) orphanNodeCount++;
    }

    let deadEndCount = 0;
    for (const node of allNodes) {
        if (node.depth === runLength) continue;
        if (node.edges.length === 0) deadEndCount++;
    }

    let everyFullPathEndsInFinalBoss: boolean | null = null;
    let allNodesReachAFinalBoss: boolean | null = null;
    let sealsPerPath: { min: number; max: number; avg: number } | null = null;
    let bossesPerPath: { min: number; max: number; avg: number } | null = null;
    let pathMeetsRequiredSeals: boolean | null = null;
    if (finalLayerGenerated) {
        const reachableFromStart = new Set<string>();
        const start = allNodes.find((n) => n.type === RoomType.START);
        if (start) {
            const stack: MapNode[] = [start];
            while (stack.length) {
                const cur = stack.pop()!;
                if (reachableFromStart.has(cur.id)) continue;
                reachableFromStart.add(cur.id);
                for (const eid of cur.edges) {
                    const next = byId.get(eid);
                    if (next) stack.push(next);
                }
            }
        }

        const reverse = new Map<string, MapNode[]>();
        for (const node of allNodes) {
            for (const eid of node.edges) {
                const t = byId.get(eid);
                if (!t) continue;
                const list = reverse.get(t.id);
                if (list) list.push(node);
                else reverse.set(t.id, [node]);
            }
        }
        const ancestorsOfFinal = new Set<string>();
        const queue: MapNode[] = [...finalNodes];
        for (const f of finalNodes) ancestorsOfFinal.add(f.id);
        while (queue.length) {
            const cur = queue.shift()!;
            for (const parent of reverse.get(cur.id) ?? []) {
                if (ancestorsOfFinal.has(parent.id)) continue;
                ancestorsOfFinal.add(parent.id);
                queue.push(parent);
            }
        }

        allNodesReachAFinalBoss = allNodes.every((n) =>
            ancestorsOfFinal.has(n.id),
        );

        let endsCorrectly = true;
        for (const id of reachableFromStart) {
            const node = byId.get(id);
            if (!node) continue;
            const isLeaf =
                node.edges.length === 0 ||
                node.edges.every((e) => !byId.has(e));
            if (!isLeaf) continue;
            if (node.bossKind !== 'final') {
                endsCorrectly = false;
                break;
            }
        }
        everyFullPathEndsInFinalBoss = endsCorrectly;

        if (start) {
            sealsPerPath = computePerPathStat(
                allNodes,
                byId,
                start,
                finalNodes,
                (n) => (n.grantsSeal ? 1 : 0),
            );
            bossesPerPath = computePerPathStat(
                allNodes,
                byId,
                start,
                finalNodes,
                (n) => (n.bossKind !== null ? 1 : 0),
            );
            if (sealsPerPath) {
                pathMeetsRequiredSeals = sealsPerPath.min >= requiredSeals;
            }
        }
    }

    return {
        runLength,
        finalDepth: runLength,
        totalNodes: allNodes.length,
        totalEdges,
        finalLayerGenerated,
        finalNodeCount: finalNodes.length,
        allFinalAreBossKindFinal,
        everyFullPathEndsInFinalBoss,
        allNodesReachAFinalBoss,
        orphanNodeCount,
        deadEndCount,
        bossAdjacencyViolations,
        majorBossCount,
        miniBossCount,
        finalBossCount,
        postMajorRecoveryViolations,
        requiredSeals,
        sealOpportunityCount,
        sealsPerPath,
        bossesPerPath,
        pathMeetsRequiredSeals,
        pressureStrategy: 'max',
    };
}

/**
 * Format a {@link MapValidationReport} as a human-readable block.
 */
export function formatMapDebug(report: MapValidationReport): string {
    const fmtStat = (s: { min: number; max: number; avg: number } | null) =>
        s ? `min=${s.min} max=${s.max} avg=${s.avg}` : 'n/a';
    const fmtBool = (b: boolean | null) => (b === null ? 'n/a' : String(b));
    const lines = [
        `runLength=${report.runLength}  finalDepth=${report.finalDepth}`,
        `totalNodes=${report.totalNodes}  totalEdges=${report.totalEdges}`,
        `bosses: major=${report.majorBossCount}  mini=${report.miniBossCount}  final=${report.finalBossCount}`,
        `seals: required=${report.requiredSeals}  opportunities=${report.sealOpportunityCount}`,
        `sealsPerPath:  ${fmtStat(report.sealsPerPath)}`,
        `bossesPerPath: ${fmtStat(report.bossesPerPath)}`,
        `pathMeetsRequiredSeals: ${fmtBool(report.pathMeetsRequiredSeals)}`,
        `finalLayerGenerated=${report.finalLayerGenerated}  finalNodeCount=${report.finalNodeCount}`,
        `allFinalAreBossKindFinal=${fmtBool(report.allFinalAreBossKindFinal)}`,
        `everyFullPathEndsInFinalBoss=${fmtBool(report.everyFullPathEndsInFinalBoss)}`,
        `allNodesReachAFinalBoss=${fmtBool(report.allNodesReachAFinalBoss)}`,
        `invariants: orphans=${report.orphanNodeCount}  deadEnds=${report.deadEndCount}  bossAdjacency=${report.bossAdjacencyViolations}  postMajorRecovery=${report.postMajorRecoveryViolations}`,
        `pressureStrategy=${report.pressureStrategy}`,
    ];
    return lines.join('\n');
}

function computeMinSealsPerPath(
    allNodes: readonly MapNode[],
): { min: number } | null {
    const start = allNodes.find((n) => n.type === RoomType.START);
    if (!start) return null;
    const finalNodes = allNodes.filter((n) => n.bossKind === 'final');
    if (finalNodes.length === 0) return null;
    const byId = new Map<string, MapNode>();
    for (const n of allNodes) byId.set(n.id, n);

    const ordered = allNodes.slice().sort((a, b) => a.depth - b.depth);
    const minScore = new Map<string, number>();
    minScore.set(start.id, start.grantsSeal ? 1 : 0);
    for (const node of ordered) {
        const here = minScore.get(node.id);
        if (here === undefined) continue;
        for (const eid of node.edges) {
            const child = byId.get(eid);
            if (!child) continue;
            const cand = here + (child.grantsSeal ? 1 : 0);
            const prev = minScore.get(child.id);
            if (prev === undefined || cand < prev) minScore.set(child.id, cand);
        }
    }
    let min = Number.POSITIVE_INFINITY;
    for (const f of finalNodes) {
        const v = minScore.get(f.id);
        if (v !== undefined) min = Math.min(min, v);
    }
    if (!Number.isFinite(min)) return null;
    return { min };
}

function pickBestSealPromotion(
    allNodes: readonly MapNode[],
    required: number,
): MapNode | null {
    const start = allNodes.find((n) => n.type === RoomType.START);
    if (!start) return null;
    const finalNodes = allNodes.filter((n) => n.bossKind === 'final');
    if (finalNodes.length === 0) return null;
    const byId = new Map<string, MapNode>();
    for (const n of allNodes) byId.set(n.id, n);

    const ordered = allNodes.slice().sort((a, b) => a.depth - b.depth);
    const minSealsToHere = new Map<string, number>();
    minSealsToHere.set(start.id, start.grantsSeal ? 1 : 0);
    for (const node of ordered) {
        const here = minSealsToHere.get(node.id);
        if (here === undefined) continue;
        for (const eid of node.edges) {
            const child = byId.get(eid);
            if (!child) continue;
            const cand = here + (child.grantsSeal ? 1 : 0);
            const prev = minSealsToHere.get(child.id);
            if (prev === undefined || cand < prev) {
                minSealsToHere.set(child.id, cand);
            }
        }
    }

    const minSealsFromHere = new Map<string, number>();
    for (const f of finalNodes) minSealsFromHere.set(f.id, 0);
    for (const node of ordered.slice().reverse()) {
        if (minSealsFromHere.has(node.id)) continue;
        let best = Number.POSITIVE_INFINITY;
        for (const eid of node.edges) {
            const child = byId.get(eid);
            if (!child) continue;
            const childForward = minSealsFromHere.get(child.id);
            if (childForward === undefined) continue;
            const cand = (child.grantsSeal ? 1 : 0) + childForward;
            if (cand < best) best = cand;
        }
        if (Number.isFinite(best)) minSealsFromHere.set(node.id, best);
    }

    let bestNode: MapNode | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const candidates = allNodes
        .filter((n) => n.bossKind === 'mini' && !n.grantsSeal)
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id));
    for (const cand of candidates) {
        const before = minSealsToHere.get(cand.id);
        const after = minSealsFromHere.get(cand.id);
        if (before === undefined || after === undefined) continue;
        const worst = before + after;
        if (worst >= required) continue;
        if (worst < bestScore) {
            bestScore = worst;
            bestNode = cand;
        }
    }
    return bestNode;
}

function pickRegularNodeToPromoteToMini(
    allNodes: readonly MapNode[],
    runLength: number,
    required: number,
    pressureWindowStart: number,
): MapNode | null {
    const start = allNodes.find((n) => n.type === RoomType.START);
    if (!start) return null;
    const finalNodes = allNodes.filter((n) => n.bossKind === 'final');
    if (finalNodes.length === 0) return null;
    const byId = new Map<string, MapNode>();
    for (const n of allNodes) byId.set(n.id, n);
    const parents = new Map<string, MapNode[]>();
    for (const node of allNodes) {
        for (const eid of node.edges) {
            const t = byId.get(eid);
            if (!t) continue;
            const list = parents.get(t.id);
            if (list) list.push(node);
            else parents.set(t.id, [node]);
        }
    }

    const ordered = allNodes.slice().sort((a, b) => a.depth - b.depth);
    const minSealsToHere = new Map<string, number>();
    minSealsToHere.set(start.id, start.grantsSeal ? 1 : 0);
    for (const node of ordered) {
        const here = minSealsToHere.get(node.id);
        if (here === undefined) continue;
        for (const eid of node.edges) {
            const child = byId.get(eid);
            if (!child) continue;
            const cand = here + (child.grantsSeal ? 1 : 0);
            const prev = minSealsToHere.get(child.id);
            if (prev === undefined || cand < prev) minSealsToHere.set(child.id, cand);
        }
    }
    const minSealsFromHere = new Map<string, number>();
    for (const f of finalNodes) minSealsFromHere.set(f.id, 0);
    for (const node of ordered.slice().reverse()) {
        if (minSealsFromHere.has(node.id)) continue;
        let best = Number.POSITIVE_INFINITY;
        for (const eid of node.edges) {
            const child = byId.get(eid);
            if (!child) continue;
            const childForward = minSealsFromHere.get(child.id);
            if (childForward === undefined) continue;
            const cand = (child.grantsSeal ? 1 : 0) + childForward;
            if (cand < best) best = cand;
        }
        if (Number.isFinite(best)) minSealsFromHere.set(node.id, best);
    }

    let bestNode: MapNode | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const candidates = allNodes
        .filter((n) => {
            if (n.bossKind !== null) return false;
            if (n.type === RoomType.START) return false;
            if (n.depth === runLength) return false;
            if (n.depth === runLength - 1) return false;
            if (n.depth < pressureWindowStart) return false;
            const ps = parents.get(n.id) ?? [];
            if (ps.some((p) => p.bossKind === 'major')) return false;
            if (ps.some((p) => p.bossKind !== null)) return false;
            for (const eid of n.edges) {
                const c = byId.get(eid);
                if (c && c.bossKind !== null) return false;
            }
            return true;
        })
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id));
    for (const cand of candidates) {
        const before = minSealsToHere.get(cand.id);
        const after = minSealsFromHere.get(cand.id);
        if (before === undefined || after === undefined) continue;
        const worstAfter = before + after + 1;
        if (worstAfter > required) continue;
        const worstBefore = before + after;
        if (worstBefore >= required) continue;
        if (worstBefore < bestScore) {
            bestScore = worstBefore;
            bestNode = cand;
        }
    }
    return bestNode;
}

function computePerPathStat(
    allNodes: readonly MapNode[],
    byId: Map<string, MapNode>,
    start: MapNode,
    finalNodes: readonly MapNode[],
    score: (n: MapNode) => number,
): { min: number; max: number; avg: number } | null {
    if (finalNodes.length === 0) return null;

    const ordered = allNodes.slice().sort((a, b) => a.depth - b.depth);

    const minScore = new Map<string, number>();
    const maxScore = new Map<string, number>();
    const pathsFromStart = new Map<string, number>();
    minScore.set(start.id, score(start));
    maxScore.set(start.id, score(start));
    pathsFromStart.set(start.id, 1);

    for (const node of ordered) {
        const minHere = minScore.get(node.id);
        const maxHere = maxScore.get(node.id);
        const pathsHere = pathsFromStart.get(node.id) ?? 0;
        if (minHere === undefined || maxHere === undefined || pathsHere === 0) {
            continue;
        }
        for (const eid of node.edges) {
            const child = byId.get(eid);
            if (!child) continue;
            const childScore = score(child);
            const candidateMin = minHere + childScore;
            const candidateMax = maxHere + childScore;
            const prevMin = minScore.get(child.id);
            const prevMax = maxScore.get(child.id);
            if (prevMin === undefined || candidateMin < prevMin) {
                minScore.set(child.id, candidateMin);
            }
            if (prevMax === undefined || candidateMax > prevMax) {
                maxScore.set(child.id, candidateMax);
            }
            pathsFromStart.set(
                child.id,
                (pathsFromStart.get(child.id) ?? 0) + pathsHere,
            );
        }
    }

    const pathsToFinal = new Map<string, number>();
    for (const f of finalNodes) pathsToFinal.set(f.id, 1);
    for (const node of ordered.slice().reverse()) {
        if (pathsToFinal.has(node.id)) continue;
        let total = 0;
        for (const eid of node.edges) {
            const child = byId.get(eid);
            if (!child) continue;
            total += pathsToFinal.get(child.id) ?? 0;
        }
        if (total > 0) pathsToFinal.set(node.id, total);
    }

    let totalScoreSum = 0;
    let totalPaths = 0;
    let pathMin = Number.POSITIVE_INFINITY;
    let pathMax = Number.NEGATIVE_INFINITY;
    for (const f of finalNodes) {
        const m = minScore.get(f.id);
        const x = maxScore.get(f.id);
        const p = pathsFromStart.get(f.id);
        if (m === undefined || x === undefined || p === undefined || p === 0) {
            continue;
        }
        if (m < pathMin) pathMin = m;
        if (x > pathMax) pathMax = x;
    }
    for (const node of ordered) {
        const pf = pathsFromStart.get(node.id) ?? 0;
        const pt = pathsToFinal.get(node.id) ?? 0;
        if (pf === 0 || pt === 0) continue;
        totalScoreSum += score(node) * pf * pt;
    }
    for (const f of finalNodes) {
        totalPaths += pathsFromStart.get(f.id) ?? 0;
    }
    if (totalPaths === 0) return null;
    const avg = totalScoreSum / totalPaths;
    if (!Number.isFinite(pathMin) || !Number.isFinite(pathMax)) return null;
    return { min: pathMin, max: pathMax, avg };
}
