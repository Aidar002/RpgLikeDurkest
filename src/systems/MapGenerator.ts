import { MAP_CONFIG, RUN_CONFIG } from '../data/GameConfig';
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
     * pass (PR-2) when a branch's `stepsSinceBoss` enters the
     * pressure window. Pairs with `bossKind === 'mini'`.
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
 * Tag for seal-granting rooms (PR-3). Major bosses produce
 * `'major'` seals; a fraction of mini bosses produce `'mini'`
 * seals (controlled by `RUN_CONFIG.seals.miniSealOdds`). The
 * combat-side `player.seals` inventory and the requiredSeals
 * gate at the final-boss entry are intentionally not yet
 * implemented — see TODO(seals) markers in `GameScene.ts` and
 * the final-boss combat code.
 */
export type SealType = 'major' | 'mini';

/**
 * One room in the dungeon graph.
 *
 * `depth` is the **logical** distance from START in graph hops — it
 * drives map shape (final layer at `RUN_CONFIG.runLength`, run
 * progress). `x` / `y` are **visual** positions in container-local
 * coordinates and are picked at generation time so that a layer's
 * children can sit in any direction around their parent (not only
 * to the right). `slot` is retained for back-compat with hand-built
 * test fixtures and is no longer used for layout.
 *
 * `bossKind` is non-null only for boss-encounter rooms. PR-1 wires
 * up `'final'` for the final layer; `'major'` / `'mini'` are
 * placed by the bossPressure pass in PR-2.
 */
export interface MapNode {
    id: string;
    depth: number;
    slot: number;
    /** Container-local x position (px), set by {@link MapGenerator}. */
    x: number;
    /** Container-local y position (px), set by {@link MapGenerator}. */
    y: number;
    type: RoomType;
    /**
     * Boss-encounter classification, or `null` for a regular room.
     * See {@link BossKind} for the semantics of each value.
     */
    bossKind: BossKind;
    /**
     * Whether clearing this room grants a seal (PR-3). Always
     * `true` on major-boss rooms, sometimes `true` on mini-boss
     * rooms (see `RUN_CONFIG.seals.miniSealOdds`), `false`
     * otherwise. Final-boss rooms never grant seals — they are
     * the *target* of the seal gate, not a seal source.
     */
    grantsSeal: boolean;
    /** Seal flavour, present iff {@link grantsSeal} is `true`. */
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
 * Every depth `runLength - 1` room is forced to one of these so the
 * player can stabilize before the final encounter.
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
 * Compute the `requiredSeals` budget for a given run length using
 * `RUN_CONFIG.seals`. Mirrors the bossPressure target formulas so
 * scaling stays consistent across runLength variants.
 *
 *     requiredSeals = clamp(round(runLength / requiredSealsFactor), min, max)
 */
export function getRequiredSeals(runLength: number): number {
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

/** Preferred 2D distance (px) between a parent node and its child. */
const EDGE_LENGTH = 150;
/**
 * Soft cap on the parent→child segment length we *want* to stay
 * under. The bonus-edge pass enforces this strictly so the
 * "1–4 next rooms" guarantee never produces a cross-screen line.
 * The placement fallback may still exceed this on geometrically
 * congested layers (in which case the test failure budget kicks
 * in), but Pass 1 and Pass 2 always look for a sub-cap clean spot
 * first.
 */
const MAX_EDGE_LENGTH = 240;
/**
 * Reach used by the deeper placement fallback passes (and the
 * bonus-edge / parent-rescue passes) when the preferred radius
 * fails. Allows just enough slack to dodge crossings on
 * congested layers without producing the cross-screen lines
 * that broke the Darkest-Dungeon look.
 */
const FALLBACK_EDGE_LENGTH = 360;
const FALLBACK_EDGE_LENGTH_SQ = FALLBACK_EDGE_LENGTH * FALLBACK_EDGE_LENGTH;
/**
 * Pathological last-resort radius used only when even
 * {@link FALLBACK_EDGE_LENGTH} can't find a clean spot — we
 * accept the visual hit over deadlocking the run.
 */
const LAST_RESORT_EDGE_LENGTH = EDGE_LENGTH * 5;
/**
 * Minimum 2D distance (px) we want between any two nodes. Slightly
 * larger than the rendered NODE_SZ (80) plus surrounding glow so that
 * neighbouring rooms don't visually touch.
 */
const MIN_NODE_DISTANCE = 130;
/**
 * How wide a buffer (px) we keep around each non-endpoint node when
 * routing an edge — i.e. an edge segment must not pass closer than
 * this to any node it does not touch. NODE_SZ is 80, so half that
 * (40 px) is the outer edge of the rendered icon; we add a small
 * visual buffer on top so the line never visually clips the frame.
 */
const NODE_BLOCKER_RADIUS = 50;
/** Number of random angles to sample when placing a node. */
const PLACEMENT_ATTEMPTS = 32;
/**
 * Half-width of the "fan" cone used to bias child placement away
 * from the direction the parent itself was reached from. ±90°
 * gives every child a full half-plane to spread into, which feels
 * organic without ever placing a child *behind* the parent.
 */
const PLACEMENT_CONE = Math.PI / 2;

interface Point {
    x: number;
    y: number;
}

/**
 * Standard left-turn signed area for three points. Positive when
 * `c` lies to the left of the directed segment `a→b`.
 */
function ccw(a: Point, b: Point, c: Point): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Whether the open segments `p1p2` and `p3p4` properly cross.
 * Segments that only share an endpoint do **not** count as crossing
 * — that's the normal case for two siblings of the same parent.
 */
function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
    if (
        (p1.x === p3.x && p1.y === p3.y) ||
        (p1.x === p4.x && p1.y === p4.y) ||
        (p2.x === p3.x && p2.y === p3.y) ||
        (p2.x === p4.x && p2.y === p4.y)
    ) {
        return false;
    }

    const d1 = ccw(p3, p4, p1);
    const d2 = ccw(p3, p4, p2);
    const d3 = ccw(p1, p2, p3);
    const d4 = ccw(p1, p2, p4);

    return (
        ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    );
}

interface EdgeSegment {
    a: Point;
    b: Point;
    /** id of source node, used so we can ignore edges that share an endpoint. */
    srcId: string;
    /** id of target node. */
    tgtId: string;
}

/**
 * Snapshot every parent→child edge in the current graph as a list of
 * geometric segments, so {@link MapGenerator.placeNode} can test a
 * candidate edge against everything we've placed so far.
 */
function collectEdgeSegments(allNodes: MapNode[]): EdgeSegment[] {
    const byId = new Map(allNodes.map((node) => [node.id, node]));
    const segs: EdgeSegment[] = [];
    for (const node of allNodes) {
        for (const edgeId of node.edges) {
            const target = byId.get(edgeId);
            if (target) {
                segs.push({
                    a: { x: node.x, y: node.y },
                    b: { x: target.x, y: target.y },
                    srcId: node.id,
                    tgtId: target.id,
                });
            }
        }
    }
    return segs;
}

/**
 * Whether a candidate edge `src→cand` would visually cross any edge
 * already in `edges`. Edges that share `src` as an endpoint are
 * skipped (siblings naturally meet at the parent).
 */
function edgeCrossesAny(
    src: MapNode,
    cand: Point,
    edges: EdgeSegment[],
): boolean {
    const srcPt: Point = { x: src.x, y: src.y };
    for (const e of edges) {
        if (e.srcId === src.id || e.tgtId === src.id) {
            continue;
        }
        if (segmentsCross(srcPt, cand, e.a, e.b)) {
            return true;
        }
    }
    return false;
}

/**
 * Squared distance from point `p` to segment `a→b` (clamped to the
 * segment, not the infinite line). Used by
 * {@link edgePassesThroughAnyNode} to keep edges from clipping
 * through the icon rectangles of unrelated rooms.
 */
function pointSegmentDistanceSq(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return squaredDistance(p, a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const ddx = p.x - cx;
    const ddy = p.y - cy;
    return ddx * ddx + ddy * ddy;
}

/**
 * Whether the segment from `src` to `cand` passes through (or close
 * enough to clip) any node that is not the segment's endpoint.
 * Endpoints are excluded via `excludeIds`; this is what stops the
 * line from clipping the parent's own icon and lets bonus edges
 * land on a sibling whose centre is at the segment's tail.
 */
function edgePassesThroughAnyNode(
    src: Point,
    cand: Point,
    allNodes: MapNode[],
    excludeIds: Set<string>,
): boolean {
    const radSq = NODE_BLOCKER_RADIUS * NODE_BLOCKER_RADIUS;
    for (const n of allNodes) {
        if (excludeIds.has(n.id)) continue;
        const distSq = pointSegmentDistanceSq(
            { x: n.x, y: n.y },
            src,
            cand,
        );
        if (distSq < radSq) return true;
    }
    return false;
}

/**
 * Whether placing a node at `cand` would block (sit on top of) any
 * existing edge segment in `edges`. The complement of
 * {@link edgePassesThroughAnyNode}: there we ask whether a *new
 * edge* clips an existing node; here we ask whether a *new node*
 * lands on top of an existing edge. Both invariants are needed
 * because edges are added across multiple layers and placement of
 * a later sibling can otherwise land on top of an older edge
 * routed through what was empty space.
 */
function nodeBlocksAnyEdge(cand: Point, edges: EdgeSegment[]): boolean {
    const radSq = NODE_BLOCKER_RADIUS * NODE_BLOCKER_RADIUS;
    for (const e of edges) {
        const distSq = pointSegmentDistanceSq(cand, e.a, e.b);
        if (distSq < radSq) return true;
    }
    return false;
}

export class MapGenerator {
    private counter = 0;
    private availableRooms = new Set<RoomType>(BASE_ROOM_POOL);
    private rng: Rng;
    /**
     * Total run length (final boss is at this depth). Defaults to
     * {@link RUN_CONFIG.runLength} but can be overridden per
     * generator instance — useful for tests that exercise the
     * scaling behavior at multiple lengths (25 / 35 / 50 / 75 / …).
     */
    private runLength: number;
    /**
     * Per-node "outward direction" (angle from the node's first
     * parent toward the node itself). Children placed off this node
     * fan into the half-plane in this direction, so each branch
     * naturally grows outward from the trunk instead of doubling
     * back through earlier rooms.
     */
    private outwardAngles = new Map<string, number>();

    /**
     * Per-node "steps since the last boss along this branch". Used
     * by the bossPressure pass to decide whether a node is forced
     * into a MINI_BOSS / major BOSS slot. We always combine
     * incoming parents with `Math.max(...)` so a long-pressure
     * path can't be masked by a freshly-reset cross-link
     * (the **max strategy** the user explicitly approved).
     */
    private stepsSinceBoss = new Map<string, number>();

    /** Running tallies of mid-run bosses placed so far, used to
     *  enforce the runLength-derived budgets without overshooting. */
    private majorBossesPlaced = 0;
    private miniBossesPlaced = 0;

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

    /**
     * Pressure window for the current run length, in branch steps
     * since the last boss. Below `start` a boss is impossible;
     * inside `[start, end)` a boss becomes increasingly likely;
     * at `end` a boss is forced.
     */
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

    /**
     * Outward direction we want children of `parent` to lean
     * towards. For interior nodes that's just the angle of the
     * incoming edge (parent's parent → parent). For START there's
     * no incoming edge yet, so we cache a single random angle so
     * consecutive sessions of the same RNG seed are deterministic.
     */
    private getOutwardBias(parent: MapNode): number {
        const cached = this.outwardAngles.get(parent.id);
        if (cached !== undefined) return cached;
        // START node — no incoming edge yet; pick a random direction
        // that will seed the whole map's overall fan-out.
        const angle = this.rng.next() * Math.PI * 2;
        this.outwardAngles.set(parent.id, angle);
        return angle;
    }

    setAvailableRoomTypes(roomTypes: RoomType[]) {
        this.availableRooms = new Set(roomTypes.filter((type) => type !== RoomType.START && type !== RoomType.BOSS));
        BASE_ROOM_POOL.forEach((type) => this.availableRooms.add(type));
    }

    generateInitialMap(lookahead: number = MAP_CONFIG.initialLookahead): MapNode[] {
        const all: MapNode[] = [];
        const start = this.makeNode(0, 0, RoomType.START);
        start.x = MAP_START_X;
        start.y = MAP_START_Y;
        start.visited = true;
        all.push(start);
        // START seeds the bossPressure counter at 0 so the first
        // depth's `stepsSinceBoss` is 1.
        this.stepsSinceBoss.set(start.id, 0);

        // Never generate past the final-boss depth. If a caller
        // (or test) asks for `lookahead >= runLength`, we simply
        // build the whole run up to the final layer and stop —
        // there is nothing beyond the final layer.
        const lastDepth = Math.min(lookahead, this.runLength);
        let previousLayer = [start];
        for (let depth = 1; depth <= lastDepth; depth++) {
            previousLayer = this.buildLayer(depth, previousLayer, all);
        }

        if (lastDepth >= this.runLength) {
            this.enforceSealCoverage(all);
        }

        return all;
    }

    generateNextLayer(allNodes: MapNode[], fromDepth: number): MapNode[] {
        // The final layer is terminal — never extend past it.
        if (fromDepth >= this.runLength) {
            return [];
        }
        const previousLayer = allNodes.filter((node) => node.depth === fromDepth);
        // Defensive copy so buildLayer's local push doesn't mutate
        // the caller's node array — DungeonManager owns that and
        // re-merges via `addNodes`.
        const newLayer = this.buildLayer(fromDepth + 1, previousLayer, [...allNodes]);
        // The final-boss layer was just built — promote enough mini
        // bosses to grant seal so every full path meets `requiredSeals`.
        // We mutate the caller's array in-place via the new-layer
        // refs, plus any earlier mini-boss nodes already in `allNodes`.
        if (fromDepth + 1 >= this.runLength) {
            this.enforceSealCoverage([...allNodes, ...newLayer]);
        }
        return newLayer;
    }

    /**
     * Post-generation pass: greedily promote mini-boss nodes to
     * grant a seal until every full START → final-boss path
     * traverses at least `requiredSeals` seal-granting nodes.
     *
     * Mini bosses are tagged at creation time with `grantsSeal`
     * rolled at `RUN_CONFIG.seals.miniSealOdds`. That gives nice
     * variety on average but doesn't guarantee that *every* path
     * the player can pick has enough seal opportunities — a
     * branchy player might happen to walk past every non-seal
     * mini and arrive at the final boss short on seals. This
     * pass walks the DAG, finds paths below the seal budget, and
     * upgrades the mini boss whose promotion covers the most
     * deficient paths until either the invariant holds or no
     * non-seal mini boss is left to promote.
     *
     * The pass is deterministic for a given seed: when several
     * candidates tie, we break ties by id (smallest first), and
     * the rng is not consulted. This keeps replays stable.
     */
    private enforceSealCoverage(allNodes: MapNode[]): void {
        const required = getRequiredSeals(this.runLength);
        if (required <= 0) return;
        let safety = allNodes.length * 2;
        while (safety-- > 0) {
            const stat = computeMinSealsPerPath(allNodes);
            if (stat === null || stat.min >= required) return;
            // Phase 1: promote an existing non-seal mini boss that
            // covers a deficit path. This is cheap and preserves
            // the boss-budget targets from PR-2.
            const miniCandidate = pickBestSealPromotion(allNodes, required);
            if (miniCandidate) {
                miniCandidate.grantsSeal = true;
                miniCandidate.sealType = 'mini';
                continue;
            }
            // Phase 2: no existing mini sits on a deficit path.
            // Promote a regular (non-boss) room to a mini boss
            // so the deficit path picks up a seal. The choice is
            // constrained to nodes that respect boss-adjacency and
            // post-major-recovery invariants — see
            // {@link pickRegularNodeToPromoteToMini}.
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

    private buildLayer(depth: number, previousLayer: MapNode[], allNodes: MapNode[]): MapNode[] {
        // Final-boss layer — every node here is a final-boss room
        // (`bossKind: 'final'`). Multiple final-boss nodes by design
        // (see RUN_CONFIG / map architecture spec): no forced
        // bottleneck, the player picks which one to enter.
        const isFinalLayer = depth === this.runLength;
        // The room right before the final layer is forced to a
        // recovery / reward type so the player can stabilize before
        // the final encounter.
        const isFinalApproach = depth === this.runLength - 1;

        const branchRoll = this.rng.next();
        const { one, two } = MAP_CONFIG.branchRolls;
        const rolledCount =
            branchRoll < one ? 1 : branchRoll < one + two ? 2 : 3;
        // Final-approach layer always offers ≥ FINAL_APPROACH_MIN_WIDTH
        // recovery rooms so the player has a real choice of which
        // final-boss node to head into. Open layers require at least
        // one new node per previous-layer parent so every parent
        // keeps a forward edge (multidirectional placement can't
        // fan many parents into a single child without crossings).
        const minWidth = isFinalApproach ? FINAL_APPROACH_MIN_WIDTH : 1;
        const count = Math.max(rolledCount, previousLayer.length, minWidth);
        const newLayer: MapNode[] = [];

        for (let slot = 0; slot < count; slot++) {
            // Round-robin primary parent so each previous-layer
            // node fans out roughly evenly. If that parent can't
            // host a clean (non-crossing, non-clipping) placement,
            // try the other parents before falling back to the
            // original with the strict invariants relaxed.
            //
            // Note: PR-1 removed the legacy converging PRE-BOSS /
            // BOSS bottleneck. Both the final-approach layer and
            // the final-boss layer use the standard fan-out
            // placement — multiple parents fan onto multiple
            // children, no forced single-point convergence.
            const primaryIndex = slot % previousLayer.length;
            const parentOrder: MapNode[] = [];
            for (let i = 0; i < previousLayer.length; i++) {
                parentOrder.push(
                    previousLayer[(primaryIndex + i) % previousLayer.length],
                );
            }
            const primaryParent = parentOrder[0];

            // Boss-pressure decision uses the primary parent's
            // counter as a stand-in for "the player's pressure when
            // they enter this room". After all routing for this
            // layer settles, every node's stepsSinceBoss is
            // recomputed as the **max** across all its real
            // parents — that's the long-pressure-wins guarantee.
            const bossKind: BossKind = isFinalLayer
                ? 'final'
                : this.decideBossKind(primaryParent, isFinalApproach);
            const type = this.resolveRoomType(
                bossKind,
                depth,
                primaryParent,
                allNodes,
                newLayer,
            );
            const node = this.makeNode(depth, slot, type, bossKind);

            let chosenParent: MapNode | null = null;
            let chosenPoint: Point | null = null;

            // Slot placement honours both invariants up front so we
            // never have to repair a violation later: skip any
            // candidate parent that would form a boss-to-boss edge
            // OR break the recovery-after-major rule.
            for (const candidateParent of parentOrder) {
                if (
                    this.edgeViolatesInvariant(candidateParent, type, bossKind)
                ) {
                    continue;
                }
                const bias = this.getOutwardBias(candidateParent);
                const place = this.tryPlaceNode(
                    candidateParent,
                    allNodes,
                    bias,
                );
                if (place) {
                    chosenParent = candidateParent;
                    chosenPoint = place;
                    break;
                }
            }
            if (!chosenParent || !chosenPoint) {
                // Fallback: pick the first invariant-safe parent we
                // can find (or, as a last resort, the primary
                // parent with the strict invariants relaxed —
                // orphaning the node would be worse).
                const fallbackParent =
                    parentOrder.find(
                        (p) => !this.edgeViolatesInvariant(p, type, bossKind),
                    ) ?? primaryParent;
                chosenParent = fallbackParent;
                chosenPoint = this.placeNode(
                    fallbackParent,
                    allNodes,
                    this.getOutwardBias(fallbackParent),
                );
            }

            node.x = chosenPoint.x;
            node.y = chosenPoint.y;
            // Cache outward direction so this node's own children
            // will fan further along the same trajectory rather than
            // doubling back through their grandparent.
            this.outwardAngles.set(
                node.id,
                Math.atan2(node.y - chosenParent.y, node.x - chosenParent.x),
            );
            allNodes.push(node);
            newLayer.push(node);
            chosenParent.edges.push(node.id);

            // Tally mid-run boss budget consumption immediately so
            // subsequent slots in this layer (and later layers) see
            // the updated counters.
            if (bossKind === 'major') this.majorBossesPlaced++;
            else if (bossKind === 'mini') this.miniBossesPlaced++;
        }

        // Make sure every previous-layer parent that doesn't yet
        // connect into this layer gets a child edge — otherwise the
        // player could be stranded on a node with no forward options.
        previousLayer.forEach((parent) => {
            const hasChild = parent.edges.some((id) =>
                newLayer.some((n) => n.id === id),
            );
            if (hasChild) return;

            const candidates = newLayer
                .filter((cand) => !this.edgeViolatesInvariant(parent, cand))
                .slice()
                .sort(
                    (a, b) => squaredDistance(parent, a) - squaredDistance(parent, b),
                );
            const edges = collectEdgeSegments(allNodes);
            for (const cand of candidates) {
                if (this.edgeIsClear(parent, cand, edges, allNodes)) {
                    parent.edges.push(cand.id);
                    return;
                }
            }
            // Last resort: connect to the closest invariant-safe
            // candidate (or, if none survive, the closest sibling
            // outright — preserves connectivity even at the cost
            // of a short-lived violation that the bonus-edge /
            // safety-net passes can't repair).
            const fallback = candidates[0] ?? newLayer
                .slice()
                .sort(
                    (a, b) =>
                        squaredDistance(parent, a) - squaredDistance(parent, b),
                )[0];
            if (fallback) parent.edges.push(fallback.id);
        });

        // Bonus edges per parent — picks a target outgoing fanout
        // from {@link MAP_CONFIG.fanoutRolls} (1–4) and tries to
        // raise this parent's child-count up to that target. Each
        // candidate is the closest remaining sibling within
        // {@link FALLBACK_EDGE_LENGTH}, gated by the no-crossing /
        // no-clipping / no-boss-adjacency invariants so we never
        // trade visual clarity (or PR-2's adjacency rule) for
        // extra paths.
        previousLayer.forEach((parent) => {
            if (newLayer.length <= 1) return;

            const targetFanout = this.rollFanout();
            const cap = Math.min(MAP_CONFIG.maxEdgesPerNode, newLayer.length);
            let need = Math.min(targetFanout, cap) - parent.edges.length;
            if (need <= 0) return;

            const candidates = newLayer
                .filter((cand) => !parent.edges.includes(cand.id))
                .filter((cand) => !this.edgeViolatesInvariant(parent, cand))
                .slice()
                .sort(
                    (a, b) =>
                        squaredDistance(parent, a) -
                        squaredDistance(parent, b),
                );

            for (const cand of candidates) {
                if (need <= 0) break;
                if (squaredDistance(parent, cand) > FALLBACK_EDGE_LENGTH_SQ) {
                    // Sorted nearest-first, so subsequent siblings
                    // are even farther — stop scanning.
                    break;
                }
                const edges = collectEdgeSegments(allNodes);
                if (this.edgeIsClear(parent, cand, edges, allNodes)) {
                    parent.edges.push(cand.id);
                    need--;
                }
            }
        });

        // Safety net: if a child somehow ended up parentless (e.g. its
        // primary parent assignment landed on a node already saturated),
        // hand it the closest clean parent.
        newLayer.forEach((node) => {
            const hasParent = previousLayer.some((parent) => parent.edges.includes(node.id));
            if (hasParent) return;

            const sorted = previousLayer
                .filter((p) => !this.edgeViolatesInvariant(p, node))
                .slice()
                .sort(
                    (a, b) =>
                        squaredDistance(a, node) - squaredDistance(b, node),
                );
            const edges = collectEdgeSegments(allNodes);
            for (const parent of sorted) {
                if (this.edgeIsClear(parent, node, edges, allNodes)) {
                    parent.edges.push(node.id);
                    return;
                }
            }
            // Truly nowhere clean to attach — accept a violation
            // rather than orphan the node so the run can continue.
            // We prefer a non-adjacency parent if any survived the
            // pre-filter; otherwise fall back to the closest parent
            // outright.
            const fallback = sorted[0] ?? previousLayer
                .slice()
                .sort(
                    (a, b) =>
                        squaredDistance(a, node) - squaredDistance(b, node),
                )[0];
            if (fallback) fallback.edges.push(node.id);
        });

        // Now that all incoming edges are settled, recompute each
        // new node's stepsSinceBoss as the **max** across its real
        // parents (resetting to 0 if this node is itself a boss).
        // Final / major / mini bosses all reset the counter; the
        // final layer is terminal so the value is mostly cosmetic
        // there but kept consistent.
        for (const node of newLayer) {
            if (node.bossKind !== null) {
                this.stepsSinceBoss.set(node.id, 0);
                continue;
            }
            const parents = previousLayer.filter((p) =>
                p.edges.includes(node.id),
            );
            const parentSteps = parents.map(
                (p) => this.stepsSinceBoss.get(p.id) ?? 0,
            );
            const maxSteps = parentSteps.length === 0
                ? 0
                : Math.max(...parentSteps);
            this.stepsSinceBoss.set(node.id, maxSteps + 1);
        }

        return newLayer;
    }

    /**
     * `true` iff connecting `parent` directly to a child with
     * `childKind` would create a boss-to-boss edge (the
     * no-adjacent-bosses invariant). The final-boss layer is
     * exempt because its own children don't exist — the only
     * adjacency that could form is **into** the final layer, and
     * that's an explicit rule we enforce via the final-approach
     * layer being recovery-only.
     */
    private bossAdjacencyBlocks(parent: MapNode, childKind: BossKind): boolean {
        if (childKind === null) return false;
        return parent.bossKind !== null;
    }

    /**
     * `true` iff connecting a major-boss `parent` directly to a
     * child of `childType` would violate the recovery-after-major
     * invariant. Only major bosses trigger this; mini bosses get
     * regular rooms downstream by design.
     */
    private recoveryAfterMajorBlocks(
        parent: MapNode,
        childType: RoomType,
    ): boolean {
        if (parent.bossKind !== 'major') return false;
        return !POST_MAJOR_RECOVERY_POOL.includes(childType);
    }

    /**
     * Combined invariant gate used by every edge-adding pass
     * (primary placement, parent fix-up, bonus-edge, safety net).
     * Centralizing the check keeps the four passes from drifting
     * apart as new invariants land. Also callable with a
     * not-yet-constructed `(type, bossKind)` pair so the slot
     * loop can vet a parent before it commits to a child node.
     */
    private edgeViolatesInvariant(parent: MapNode, child: MapNode): boolean;
    private edgeViolatesInvariant(
        parent: MapNode,
        prospectiveType: RoomType,
        prospectiveKind: BossKind,
    ): boolean;
    private edgeViolatesInvariant(
        parent: MapNode,
        childOrType: MapNode | RoomType,
        prospectiveKind?: BossKind,
    ): boolean {
        const childType =
            typeof childOrType === 'string' ? childOrType : childOrType.type;
        const childKind: BossKind =
            typeof childOrType === 'string' ? prospectiveKind ?? null : childOrType.bossKind;
        return (
            this.bossAdjacencyBlocks(parent, childKind) ||
            this.recoveryAfterMajorBlocks(parent, childType)
        );
    }

    /**
     * Decide whether the about-to-be-placed child of `primaryParent`
     * should be promoted to a mid-run boss room. Returns the chosen
     * {@link BossKind} (`'mini'`, `'major'`, or `null` for "no
     * promotion"). Final-boss placement is handled by the caller.
     */
    private decideBossKind(
        primaryParent: MapNode,
        isFinalApproach: boolean,
    ): BossKind {
        // The final-approach layer is forced to recovery / reward
        // rooms so the player always has a clean step into the
        // final encounter — never a boss right before it.
        if (isFinalApproach) return null;
        // No two bosses in a row — if the primary parent is itself
        // a boss room, this slot stays a regular room.
        if (primaryParent.bossKind !== null) return null;

        const parentSteps = this.stepsSinceBoss.get(primaryParent.id) ?? 0;
        const steps = parentSteps + 1;
        const window = this.getPressureWindow();
        if (steps < window.start) return null;

        const targetMajor = this.getTargetMajorBosses();
        const targetMini = this.getTargetMiniBosses();
        const majorAvailable = this.majorBossesPlaced < targetMajor;
        const miniAvailable = this.miniBossesPlaced < targetMini;
        // Both budgets exhausted — no mid-run boss can be placed
        // even though pressure has built up. The branch will keep
        // accumulating steps; if a downstream branch still has a
        // budget left it can still trigger.
        if (!majorAvailable && !miniAvailable) return null;

        const cfg = RUN_CONFIG.bossPressure;
        // At or past the upper window edge a boss is forced.
        if (steps >= window.end) {
            if (
                majorAvailable &&
                this.rng.next() < cfg.majorOddsAtForcedEnd
            ) {
                return 'major';
            }
            return miniAvailable ? 'mini' : 'major';
        }
        // Inside the window the boss probability rises linearly
        // from 0 (at `start`) to 1 (at `end`). We then split the
        // outcome between MINI / MAJOR using `majorOddsInWindow`,
        // gated by remaining budgets so we never overshoot.
        const denom = window.end - window.start;
        const t = denom === 0 ? 1 : (steps - window.start) / denom;
        if (this.rng.next() >= t) return null;
        if (majorAvailable && this.rng.next() < cfg.majorOddsInWindow) {
            return 'major';
        }
        return miniAvailable ? 'mini' : 'major';
    }

    /**
     * Resolve the final {@link RoomType} given a (possibly null)
     * boss kind decided by {@link decideBossKind}. Major / final
     * bosses use {@link RoomType.BOSS}; minis use
     * {@link RoomType.MINI_BOSS}. Non-boss rooms fall through to
     * {@link pickRoomType} which honours the post-major recovery
     * forcing via {@link getForcedRoomType}.
     */
    private resolveRoomType(
        bossKind: BossKind,
        depth: number,
        primaryParent: MapNode,
        allNodes: MapNode[],
        newLayer: MapNode[],
    ): RoomType {
        if (bossKind === 'final' || bossKind === 'major') {
            return RoomType.BOSS;
        }
        if (bossKind === 'mini') {
            return RoomType.MINI_BOSS;
        }
        return this.pickRoomType(depth, allNodes, newLayer, primaryParent);
    }

    /**
     * Convenience predicate combining both edge-routing invariants:
     * the candidate edge must not cross any existing edge **and**
     * must not pass through any unrelated node's icon rect.
     */
    private edgeIsClear(
        src: MapNode,
        tgt: MapNode,
        edges: EdgeSegment[],
        allNodes: MapNode[],
    ): boolean {
        const candPt: Point = { x: tgt.x, y: tgt.y };
        if (edgeCrossesAny(src, candPt, edges)) return false;
        return !edgePassesThroughAnyNode(
            { x: src.x, y: src.y },
            candPt,
            allNodes,
            new Set([src.id, tgt.id]),
        );
    }

    /**
     * Roll the target outgoing-edge count for a parent room (1–4)
     * using {@link MAP_CONFIG.fanoutRolls}. The result is later
     * clamped against the actual size of the next layer and the
     * global {@link MAP_CONFIG.maxEdgesPerNode} cap.
     */
    private rollFanout(): number {
        const r = this.rng.next();
        const f = MAP_CONFIG.fanoutRolls;
        if (r < f.one) return 1;
        if (r < f.one + f.two) return 2;
        if (r < f.one + f.two + f.three) return 3;
        return 4;
    }

    /**
     * Like {@link placeNode} but returns `null` instead of falling
     * back to a crossing position. Used by the layer builder so a
     * different parent can be tried before we resort to crossings.
     */
    private tryPlaceNode(
        parent: MapNode,
        allNodes: MapNode[],
        biasAngle?: number,
    ): Point | null {
        const edges = collectEdgeSegments(allNodes);
        const minDistSq = MIN_NODE_DISTANCE * MIN_NODE_DISTANCE;
        const parentSrc: Point = { x: parent.x, y: parent.y };
        const excludeIds = new Set([parent.id]);

        const candidatePassesAll = (point: Point): boolean => {
            if (edgeCrossesAny(parent, point, edges)) return false;
            if (
                edgePassesThroughAnyNode(
                    parentSrc,
                    point,
                    allNodes,
                    excludeIds,
                )
            ) {
                return false;
            }
            // A new node at `point` must also not land on top of any
            // existing edge — otherwise that earlier edge would visually
            // pass through this freshly-placed room icon.
            if (nodeBlocksAnyEdge(point, edges)) return false;
            return true;
        };

        // Pass 1: random angles at preferred radii — ideal placement
        // (no crossing, no clipping, no min-distance violation). When
        // an outward bias is supplied we restrict angles to a half-
        // plane around it so the branch fans onward instead of doubling
        // back through earlier rooms.
        for (let i = 0; i < PLACEMENT_ATTEMPTS; i++) {
            const angle =
                biasAngle === undefined
                    ? this.rng.next() * Math.PI * 2
                    : biasAngle + (this.rng.next() * 2 - 1) * PLACEMENT_CONE;
            for (const distance of [EDGE_LENGTH, EDGE_LENGTH * 1.1, EDGE_LENGTH * 1.2]) {
                const point: Point = {
                    x: parent.x + Math.cos(angle) * distance,
                    y: parent.y + Math.sin(angle) * distance,
                };
                const tooClose = allNodes.some(
                    (n) => squaredDistance(n, point) < minDistSq,
                );
                if (!tooClose && candidatePassesAll(point)) {
                    return point;
                }
            }
        }

        // Pass 2: dense deterministic angle sweep at growing radii,
        // preferring fully clean candidates that respect the
        // min-distance. Capped at {@link MAX_EDGE_LENGTH} so we
        // never produce a cross-screen edge here — if no clean
        // spot exists under the cap, we yield to {@link placeNode}
        // for the relaxed fallback. We pick the candidate that
        // maximises separation from the nearest existing node so
        // two siblings sharing a parent don't deterministically
        // converge on the same first-clear angle.
        const sweepCount = 192;
        // We sweep tight radii first (the cheap, common path) so
        // most edges stay close to the preferred {@link EDGE_LENGTH},
        // then expand only as far as we have to in order to find a
        // non-crossing spot. Returning `null` from this method lets
        // the caller try a different parent before {@link placeNode}
        // resorts to crossings.
        const expandedDistances = [
            EDGE_LENGTH,
            EDGE_LENGTH * 1.1,
            EDGE_LENGTH * 1.2,
            MAX_EDGE_LENGTH,
            MAX_EDGE_LENGTH * 1.15,
            FALLBACK_EDGE_LENGTH,
            EDGE_LENGTH * 2.2,
            EDGE_LENGTH * 2.6,
            EDGE_LENGTH * 3.2,
        ];

        let bestIdeal: { point: Point; minDistSq: number } | null = null;
        let bestRelaxed: { point: Point; minDistSq: number } | null = null;

        for (const distance of expandedDistances) {
            for (let i = 0; i < sweepCount; i++) {
                const angle = (i / sweepCount) * Math.PI * 2;
                const point: Point = {
                    x: parent.x + Math.cos(angle) * distance,
                    y: parent.y + Math.sin(angle) * distance,
                };
                if (!candidatePassesAll(point)) continue;

                let nearestSq = Infinity;
                for (const n of allNodes) {
                    const d2 = squaredDistance(n, point);
                    if (d2 < nearestSq) nearestSq = d2;
                }

                if (nearestSq >= minDistSq) {
                    if (!bestIdeal || nearestSq > bestIdeal.minDistSq) {
                        bestIdeal = { point, minDistSq: nearestSq };
                    }
                } else {
                    if (!bestRelaxed || nearestSq > bestRelaxed.minDistSq) {
                        bestRelaxed = { point, minDistSq: nearestSq };
                    }
                }
            }
            if (bestIdeal) return (bestIdeal as { point: Point }).point;
        }

        if (bestRelaxed) return (bestRelaxed as { point: Point }).point;

        return null;
    }

    /**
     * Pick a 2D position for a fresh child of `parent`. Tries random
     * angles around `parent`, rejecting candidates that
     *   1. land too close to an existing node, or
     *   2. would cause the parent→child edge to cross an existing edge.
     *
     * Strategy:
     *  1. Random-angle sweep at the preferred distance; accept the
     *     first ideal candidate (no crossing, no overlap).
     *  2. Same sweep at progressively larger radii.
     *  3. Deterministic dense angle sweep — still requiring no
     *     crossing — first relaxing the min-distance, then sweeping
     *     at larger radii so dense maps still find a clean spot.
     *  4. Absolute last resort: fall back to *any* candidate, even
     *     a crossing one, so the run never deadlocks.
     *
     * Crossings are the strict invariant; min-distance is best-effort.
     */
    private placeNode(
        parent: MapNode,
        allNodes: MapNode[],
        biasAngle?: number,
    ): Point {
        const edges = collectEdgeSegments(allNodes);
        const minDistSq = MIN_NODE_DISTANCE * MIN_NODE_DISTANCE;
        const parentSrc: Point = { x: parent.x, y: parent.y };
        const excludeIds = new Set([parent.id]);

        const evaluate = (
            angle: number,
            distance: number,
        ): {
            point: Point;
            tooClose: boolean;
            crosses: boolean;
            clipsNode: boolean;
            blocksEdge: boolean;
        } => {
            const point: Point = {
                x: parent.x + Math.cos(angle) * distance,
                y: parent.y + Math.sin(angle) * distance,
            };
            const tooClose = allNodes.some(
                (n) => squaredDistance(n, point) < minDistSq,
            );
            const crosses = edgeCrossesAny(parent, point, edges);
            const clipsNode = edgePassesThroughAnyNode(
                parentSrc,
                point,
                allNodes,
                excludeIds,
            );
            const blocksEdge = nodeBlocksAnyEdge(point, edges);
            return { point, tooClose, crosses, clipsNode, blocksEdge };
        };

        const randomAngles: number[] = [];
        for (let i = 0; i < PLACEMENT_ATTEMPTS; i++) {
            randomAngles.push(
                biasAngle === undefined
                    ? this.rng.next() * Math.PI * 2
                    : biasAngle + (this.rng.next() * 2 - 1) * PLACEMENT_CONE,
            );
        }

        // Pass 1: random angles at preferred radii — ideal placement.
        // Most successful placements happen here, so most edges land
        // close to the preferred {@link EDGE_LENGTH}.
        for (const distance of [EDGE_LENGTH, EDGE_LENGTH * 1.1, EDGE_LENGTH * 1.2]) {
            for (const angle of randomAngles) {
                const cand = evaluate(angle, distance);
                if (
                    !cand.tooClose &&
                    !cand.crosses &&
                    !cand.clipsNode &&
                    !cand.blocksEdge
                ) {
                    return cand.point;
                }
            }
        }

        // Pass 2: dense deterministic sweep — keep all edge invariants
        // (no crossings, no edge clipping a node, no node landing on
        // an existing edge), relax min-distance. Radii grow up to
        // {@link LAST_RESORT_EDGE_LENGTH} only because boss-converging
        // layers occasionally have NO clean spot under the soft cap;
        // when that happens we'd rather take a longer edge than a
        // crossing one. Pass 1 already exits early for the common
        // case so most edges stay ≤ {@link MAX_EDGE_LENGTH}.
        const denseAngles: number[] = [];
        const sweepCount = 96;
        for (let i = 0; i < sweepCount; i++) {
            denseAngles.push((i / sweepCount) * Math.PI * 2);
        }

        const expandedDistances = [
            EDGE_LENGTH,
            EDGE_LENGTH * 1.1,
            EDGE_LENGTH * 1.2,
            MAX_EDGE_LENGTH,
            MAX_EDGE_LENGTH * 1.15,
            FALLBACK_EDGE_LENGTH,
            EDGE_LENGTH * 2.2,
            EDGE_LENGTH * 2.6,
            EDGE_LENGTH * 3.2,
            EDGE_LENGTH * 4,
            LAST_RESORT_EDGE_LENGTH,
        ];
        for (const distance of expandedDistances) {
            for (const angle of denseAngles) {
                const cand = evaluate(angle, distance);
                if (!cand.crosses && !cand.clipsNode && !cand.blocksEdge) {
                    return cand.point;
                }
            }
        }

        // Pass 3: still no crossings, but tolerate a node graze if
        // unavoidable.
        for (const distance of expandedDistances) {
            for (const angle of denseAngles) {
                const cand = evaluate(angle, distance);
                if (!cand.crosses) {
                    return cand.point;
                }
            }
        }

        // Pass 4: pathological — accept a crossing candidate as a
        // last resort so the run never deadlocks. Pick the radius
        // and angle that minimised total violations during the
        // dense sweep (with a tiny shortest-edge tiebreaker so we
        // don't pointlessly stretch a fallback).
        let fallback: { point: Point; score: number } | null = null;
        for (const distance of expandedDistances) {
            for (const angle of denseAngles) {
                const cand = evaluate(angle, distance);
                const score =
                    (cand.crosses ? 1000 : 0) +
                    (cand.clipsNode ? 500 : 0) +
                    (cand.blocksEdge ? 500 : 0) +
                    (cand.tooClose ? 100 : 0) +
                    distance * 0.001;
                if (fallback === null || score < fallback.score) {
                    fallback = { point: cand.point, score };
                }
            }
        }
        return fallback!.point;
    }

    private pickRoomType(
        depth: number,
        allNodes: MapNode[],
        pendingNodes: MapNode[],
        primaryParent: MapNode | null = null,
    ): RoomType {
        const forcedType = this.getForcedRoomType(
            depth,
            primaryParent,
            allNodes,
            pendingNodes,
        );
        if (forcedType) {
            return forcedType;
        }

        const allowedRooms = this.getAllowedRoomTypes(depth);
        return this.pickWeightedRoom(allowedRooms);
    }

    private getAllowedRoomTypes(depth: number): RoomType[] {
        const depthRestrictedPool =
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

        const allowed = depthRestrictedPool.filter((type) => this.availableRooms.has(type));
        return allowed.length > 0 ? allowed : BASE_ROOM_POOL;
    }

    private getForcedRoomType(
        depth: number,
        primaryParent: MapNode | null,
        _allNodes: MapNode[],
        _pendingNodes: MapNode[],
    ): RoomType | null {
        // Final-approach layer (`runLength - 1`) is forced to a
        // recovery / reward type so the player can stabilize before
        // any final-boss node.
        if (depth === this.runLength - 1) {
            const recovery = this.pickRecoveryType(FINAL_APPROACH_POOL);
            if (recovery) return recovery;
        }
        // Direct child of a mid-run major BOSS — same recovery
        // pool, scaled-down "post-boss reward" room. Mini bosses
        // do *not* trigger this; their pacing pressure is mild
        // enough that a regular room is fine afterwards.
        if (primaryParent && primaryParent.bossKind === 'major') {
            const recovery = this.pickRecoveryType(POST_MAJOR_RECOVERY_POOL);
            if (recovery) return recovery;
        }
        return null;
    }

    private pickRecoveryType(pool: RoomType[]): RoomType | null {
        const available = pool.filter((type) => this.availableRooms.has(type));
        return available.length > 0 ? this.pickWeightedRoom(available) : null;
    }

    private pickWeightedRoom(pool: RoomType[]): RoomType {
        if (pool.length === 0) {
            throw new Error('pickWeightedRoom called with empty pool');
        }
        const totalWeight = pool.reduce((sum, type) => sum + this.getWeight(type), 0);
        const roll = this.rng.next() * totalWeight;
        let cursor = 0;

        for (const type of pool) {
            cursor += this.getWeight(type);
            if (roll <= cursor) {
                return type;
            }
        }

        return pool[pool.length - 1];
    }

    private getWeight(type: RoomType): number {
        const weights: Partial<Record<RoomType, number>> = MAP_CONFIG.roomTypeWeights;
        return weights[type] ?? 0;
    }

    private makeNode(
        depth: number,
        slot: number,
        type: RoomType,
        bossKind: BossKind = null,
    ): MapNode {
        // Seal assignment (PR-3): every major boss grants a seal,
        // mini bosses opt in via `RUN_CONFIG.seals.miniSealOdds`.
        // Final bosses never grant seals — they are the *target*
        // of the seal gate, not a seal source.
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
 * Snapshot-style report produced by {@link validateMap}. Every
 * field is plain data so consumers (debug HUD, tests, dev tools)
 * can render it without coupling to MapGenerator internals.
 *
 * The report is intentionally non-throwing: even an inconsistent
 * graph still returns a populated report so the caller decides
 * how to react (log, assert, gate run start, etc.).
 */
export interface MapValidationReport {
    /** Configured run length (depth of the final-boss layer). */
    runLength: number;
    /** Mirrors `runLength`; kept under both names so debug output
     *  is unambiguous when other systems reference `finalDepth`. */
    finalDepth: number;
    /** Total nodes generated so far, including START. */
    totalNodes: number;
    /** Total directed edges in the graph. */
    totalEdges: number;
    /** Whether the final layer (`depth === runLength`) has been
     *  generated yet. The other final-layer invariants are only
     *  meaningful when this is `true`. */
    finalLayerGenerated: boolean;
    /** Number of nodes at `depth === runLength`. */
    finalNodeCount: number;
    /**
     * `true` iff every node at the final depth has
     * `bossKind === 'final'` and `type === RoomType.BOSS`.
     * Trivially `true` when no final layer exists yet.
     */
    allFinalAreBossKindFinal: boolean;
    /**
     * `true` iff every leaf of the generated graph is a final-boss
     * node. Only meaningful once the final layer is generated; we
     * report `null` for an incomplete graph so the caller can
     * distinguish "not checked" from "checked and passed".
     */
    everyFullPathEndsInFinalBoss: boolean | null;
    /**
     * `true` iff every non-final node has a forward path to some
     * final-boss node. Only meaningful once the final layer is
     * generated; reports `null` until then.
     */
    allNodesReachAFinalBoss: boolean | null;
    /**
     * Count of non-START nodes that lack any incoming edge. Should
     * always be 0 — a non-zero value indicates a generator bug.
     */
    orphanNodeCount: number;
    /**
     * Count of nodes that are *not* at the final depth and have no
     * outgoing edges. Should always be 0 once the final layer
     * exists — pre-final-layer nodes always need a forward edge.
     */
    deadEndCount: number;
    /**
     * Count of edges that connect two boss-encounter nodes
     * (`bossKind !== null`). The bossPressure pass actively
     * prevents this; a non-zero value means an unrecoverable
     * placement fallback bypassed the invariant.
     */
    bossAdjacencyViolations: number;
    /** Number of mid-run major bosses (`bossKind === 'major'`). */
    majorBossCount: number;
    /** Number of mid-run mini bosses (`bossKind === 'mini'`). */
    miniBossCount: number;
    /** Number of final bosses (`bossKind === 'final'`). Mirrors
     *  `finalNodeCount` once the final layer is generated. */
    finalBossCount: number;
    /**
     * Count of direct children of a major-boss node whose `type` is
     * NOT one of the recovery / reward room types (REST / SHRINE /
     * MERCHANT / TREASURE). Should always be 0 — bossPressure forces
     * recovery rooms after every major boss. A non-zero value
     * indicates the generator's recovery-after-major invariant has
     * been bypassed.
     */
    postMajorRecoveryViolations: number;
    /** Configured `requiredSeals` budget for this run. */
    requiredSeals: number;
    /** Number of nodes with `grantsSeal === true`. */
    sealOpportunityCount: number;
    /**
     * Min / max / average count of seal-granting rooms encountered
     * across every full path from START to a final-boss node.
     * `null` until the final layer is generated.
     */
    sealsPerPath: { min: number; max: number; avg: number } | null;
    /**
     * Min / max / average count of boss-threat rooms (major + mini
     * + final) encountered across every full path from START to a
     * final-boss node. `null` until the final layer is generated.
     */
    bossesPerPath: { min: number; max: number; avg: number } | null;
    /**
     * `true` iff the worst-case full path's seal opportunities are
     * `>= requiredSeals`. The hard player-side gate (final boss
     * blocked when seals < requiredSeals) is intentionally NOT yet
     * implemented — see TODO(seals) markers in the combat code.
     * `null` until the final layer is generated.
     */
    pathMeetsRequiredSeals: boolean | null;
    /**
     * Diagnostic tag for the per-node `stepsSinceBoss` aggregation
     * strategy used by the bossPressure pass. The user explicitly
     * approved `"max"` (long-pressure path always wins). Per-edge
     * pressure is left as a possible v2 — see `decideBossKind`.
     */
    pressureStrategy: 'max';
}

/**
 * Run the full set of map-shape invariants against a snapshot of
 * the graph. Pure function so tests can call it on hand-built or
 * generator-produced node lists alike. The check intentionally
 * stays read-only so it's safe to invoke after every
 * `generateInitialMap` / `generateNextLayer` call in dev builds.
 *
 * The report's path-related fields are only meaningful when the
 * final layer has actually been built (incremental generation
 * does not eagerly produce all depths). For early-game graphs
 * `everyFullPathEndsInFinalBoss` and `allNodesReachAFinalBoss`
 * report `null` so callers can distinguish "not yet checked"
 * from a real pass / fail.
 */
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
            // No-adjacent-bosses invariant — boss-to-boss edges
            // shouldn't exist once the bossPressure pass is wired
            // up. We still count them so a regression is loud.
            if (node.bossKind !== null && target.bossKind !== null) {
                bossAdjacencyViolations++;
            }
            // Recovery-after-major invariant — every direct child
            // of a major-boss node must be a recovery room.
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
        // Walk the graph from START forward; every leaf must be a
        // final-boss node. We treat any node whose outgoing edges
        // don't lead to nodes in this snapshot as a leaf — that's
        // a generator bug we report via `deadEndCount`, not a
        // path-validation pass condition.
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

        // Reverse adjacency so we can BFS backwards from each
        // final-boss node and tag every ancestor as "can reach a
        // final boss".
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

        // A "leaf" of the graph reachable from START is any node in
        // `reachableFromStart` whose outgoing edges all lead
        // outside the snapshot (i.e. zero edges in PR-1, since the
        // graph is fully materialized at validation time). Every
        // such leaf must be a final-boss node.
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

        // Per-path stats over full START → final-boss paths. Weight
        // each path equally (the player's choice is free, so an
        // arithmetic mean is the right summary). Path counts blow
        // up exponentially in wide graphs, so we use BigInt for
        // the running totals.
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
 * Format a {@link MapValidationReport} as a human-readable, fixed-
 * width block suitable for `console.log` debugging or copy-pasting
 * into bug reports. Stable order, includes every field the user's
 * PR-3 spec lists for the per-map debug dump (runLength,
 * boss/seal counts, per-path stats, invariant counts, pressure
 * strategy). Returns the formatted string instead of logging so
 * tests can assert on it.
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

/**
 * Trimmed variant of {@link computePerPathStat} that returns only
 * `min` for the seal score — used by the seal-coverage pass which
 * runs in a tight loop and doesn't need max / avg.
 */
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

/**
 * Walk the DAG and pick the non-seal mini-boss whose promotion
 * benefits the most "deficit" paths (paths whose seal count is
 * still below {@link required}). Ties are broken by node id for
 * deterministic seed-replay.
 *
 * Returns `null` if no non-seal mini boss exists or no candidate
 * actually sits on a deficit path (in which case we cannot help).
 */
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

    // Forward DP: for every node, the minimum seal count over all
    // partial paths from START. This is the same shortest-path DP
    // as {@link computeMinSealsPerPath} but we keep it locally to
    // chain into a "deficit" check below.
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

    // Backward DP: for every node, the minimum seal count over all
    // partial paths to *some* final boss (not counting the node
    // itself — we add that below).
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

    // For every non-seal mini, compute the worst-case full-path
    // seal count *passing through this node*. Picking the mini
    // with the lowest such value targets the most deficient
    // paths first.
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
        // Total seal count on the worst full path through `cand`
        // (counting `cand` itself, which currently doesn't grant).
        const worst = before + after;
        // Skip candidates whose worst-case path is already
        // satisfied — promoting them would be pure waste.
        if (worst >= required) continue;
        if (worst < bestScore) {
            bestScore = worst;
            bestNode = cand;
        }
    }
    return bestNode;
}

/**
 * Pick a regular (non-boss) node on a deficit START → final path
 * and convert it to a mini-boss seal-grant. Used by the seal
 * coverage pass when no existing mini boss covers a deficit path
 * (so we cannot satisfy the `requiredSeals` invariant by simple
 * promotion). Returns `null` when no candidate respects all of:
 *
 *   - non-START / non-final / non-boss
 *   - not the recovery slot of a major boss (would break the
 *     post-major-recovery invariant)
 *   - no boss-typed parent or child (would break boss-adjacency)
 *   - sits on a path whose worst-case seal count is below
 *     `required` even after this node grants one (i.e. promoting
 *     it actually helps).
 *
 * Ties broken by node id for deterministic seed-replay.
 */
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
    // Reverse adjacency — we need to know each node's parents to
    // enforce no-boss-adjacency and post-major-recovery rules.
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

    // Forward / backward DP for min seal count from / to each node.
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
            // Final-approach layer is forced to recovery types
            // and shouldn't be promoted to a mini boss.
            if (n.depth === runLength - 1) return false;
            // Respect the bossPressure window (PR-2 invariant) —
            // never place a fresh threat before the window opens
            // along its branch. We approximate the per-branch
            // `stepsSinceBoss` constraint with a flat depth gate
            // (every node has depth >= stepsSinceBoss), so this is
            // strictly safe.
            if (n.depth < pressureWindowStart) return false;
            // Skip recovery slots after a major boss (would
            // demote the post-major reward room to a threat).
            const ps = parents.get(n.id) ?? [];
            if (ps.some((p) => p.bossKind === 'major')) return false;
            // No boss adjacency — neither parents nor children
            // may be boss rooms.
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
        // Worst-case full-path seal count *passing through* this
        // node, after promotion (so +1 for `cand` itself).
        const worstAfter = before + after + 1;
        if (worstAfter > required) continue; // already enough on every path through cand
        // Also skip if `cand` doesn't sit on a deficit path —
        // the path's existing minimum is already adequate.
        const worstBefore = before + after;
        if (worstBefore >= required) continue;
        if (worstBefore < bestScore) {
            bestScore = worstBefore;
            bestNode = cand;
        }
    }
    return bestNode;
}

/**
 * Min / max / average count of nodes matching `score` across every
 * full START → final-boss path in the DAG. Pure helper for
 * {@link validateMap}; runs in O(V+E) time using two topologically
 * ordered scans (forward for `min/max` and path counts, backward
 * for paths-to-final). Path counts use plain `number` — for
 * realistic runLengths (≤80, fanout ≤4) the totals stay well
 * below `Number.MAX_VALUE` and 1e-15 relative error in the avg
 * is invisible at three-decimal reporting precision.
 */
function computePerPathStat(
    allNodes: readonly MapNode[],
    byId: Map<string, MapNode>,
    start: MapNode,
    finalNodes: readonly MapNode[],
    score: (n: MapNode) => number,
): { min: number; max: number; avg: number } | null {
    if (finalNodes.length === 0) return null;

    // Topological order by depth (the graph is depth-ordered by
    // construction so this is just a stable sort).
    const ordered = allNodes.slice().sort((a, b) => a.depth - b.depth);

    // Forward DP: shortest / longest score sum from START to each
    // node, plus the number of distinct paths from START. Nodes
    // unreachable from START keep `pathsFromStart === 0` and are
    // skipped naturally below.
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

    // Backward DP: number of paths from each node to *some* final
    // boss. Combined with `pathsFromStart`, gives us the number of
    // full paths passing through each node — the weight used to
    // compute the arithmetic mean.
    const pathsToFinal = new Map<string, number>();
    for (const f of finalNodes) pathsToFinal.set(f.id, 1);
    const reverseOrder = ordered.slice().reverse();
    for (const node of reverseOrder) {
        if (pathsToFinal.has(node.id)) continue; // already 1 for finals
        let sum = 0;
        for (const eid of node.edges) {
            const child = byId.get(eid);
            if (!child) continue;
            sum += pathsToFinal.get(child.id) ?? 0;
        }
        if (sum > 0) pathsToFinal.set(node.id, sum);
    }

    // Min / max are the best / worst score on any final-boss node
    // reachable from START. (Finals unreachable from START don't
    // appear in `minScore`, so they're skipped naturally.)
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const f of finalNodes) {
        const fmin = minScore.get(f.id);
        const fmax = maxScore.get(f.id);
        if (fmin !== undefined) min = Math.min(min, fmin);
        if (fmax !== undefined) max = Math.max(max, fmax);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

    // Weighted average: for each node `n`, the number of full paths
    // passing through `n` is `pathsFromStart * pathsToFinal`, and
    // `n` contributes `score(n)` to every such path.
    let weightedScoreSum = 0;
    let totalPaths = 0;
    for (const node of allNodes) {
        const fromStart = pathsFromStart.get(node.id) ?? 0;
        const toFinal = pathsToFinal.get(node.id) ?? 0;
        if (fromStart === 0 || toFinal === 0) continue;
        const s = score(node);
        if (s !== 0) weightedScoreSum += s * fromStart * toFinal;
    }
    for (const f of finalNodes) {
        totalPaths += pathsFromStart.get(f.id) ?? 0;
    }
    if (totalPaths === 0 || !Number.isFinite(totalPaths)) return null;
    const avg = Math.round((weightedScoreSum / totalPaths) * 1000) / 1000;

    return { min, max, avg };
}

function squaredDistance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}
