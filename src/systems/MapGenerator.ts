import { MAP_CONFIG } from '../data/GameConfig';
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
    EMPTY: 'EMPTY',
} as const;

export type RoomType = (typeof RoomType)[keyof typeof RoomType];

/**
 * One room in the dungeon graph.
 *
 * `depth` is the **logical** distance from START in graph hops — it
 * still drives game balance (boss every N depths, prep window, run
 * progress). `x` / `y` are **visual** positions in container-local
 * coordinates and are picked at generation time so that a layer's
 * children can sit in any direction around their parent (not only
 * to the right). `slot` is retained for back-compat with hand-built
 * test fixtures and is no longer used for layout.
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

const PREP_ROOM_POOL: RoomType[] = [RoomType.REST, RoomType.SHRINE, RoomType.MERCHANT];

/**
 * Container-local coordinates of the START node. Chosen so that the
 * map container's resting position centres START at the viewport
 * focal point used by {@link MapView.getMapOffset}.
 */
export const MAP_START_X = 360;
/** @see MAP_START_X */
export const MAP_START_Y = 380;

/** Preferred 2D distance (px) between a parent node and its child. */
const EDGE_LENGTH = 180;
/**
 * Minimum 2D distance (px) we want between any two nodes. Slightly
 * larger than the rendered NODE_SZ (80) plus surrounding glow so that
 * neighbouring rooms don't visually touch.
 */
const MIN_NODE_DISTANCE = 130;
/** Number of random angles to sample when placing a node. */
const PLACEMENT_ATTEMPTS = 24;

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

export class MapGenerator {
    private counter = 0;
    private availableRooms = new Set<RoomType>(BASE_ROOM_POOL);
    private rng: Rng;
    /**
     * Per-level growth direction (level = floor(depth / bossEveryNDepths)).
     * All non-converging child placements within a level are biased
     * toward this direction so the layer-by-layer fan-out stays
     * coherent — this dramatically reduces the chance that the
     * forced PRE-BOSS / BOSS convergence has to route across the
     * graph and produce crossing edges.
     */
    private levelDirections = new Map<number, number>();

    constructor(initialRooms: RoomType[] = BASE_ROOM_POOL, rng: Rng = defaultRng) {
        this.rng = rng;
        this.setAvailableRoomTypes(initialRooms);
    }

    private getLevelDirection(depth: number): number {
        const level = Math.floor((depth - 1) / MAP_CONFIG.bossEveryNDepths);
        const cached = this.levelDirections.get(level);
        if (cached !== undefined) return cached;
        // Pick a fresh random direction for this level. Levels can
        // grow in any direction independently — this satisfies the
        // user-facing "rooms in any direction" requirement while
        // keeping each level's layout internally coherent. We avoid
        // re-using the previous level's direction so consecutive
        // levels visibly turn instead of marching straight.
        const angle = this.rng.next() * Math.PI * 2;
        this.levelDirections.set(level, angle);
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

        let previousLayer = [start];
        for (let depth = 1; depth <= lookahead; depth++) {
            previousLayer = this.buildLayer(depth, previousLayer, all);
        }

        return all;
    }

    generateNextLayer(allNodes: MapNode[], fromDepth: number): MapNode[] {
        const previousLayer = allNodes.filter((node) => node.depth === fromDepth);
        // Defensive copy so buildLayer's local push doesn't mutate
        // the caller's node array — DungeonManager owns that and
        // re-merges via `addNodes`.
        return this.buildLayer(fromDepth + 1, previousLayer, [...allNodes]);
    }

    private buildLayer(depth: number, previousLayer: MapNode[], allNodes: MapNode[]): MapNode[] {
        const isBossDepth = depth > 0 && depth % MAP_CONFIG.bossEveryNDepths === 0;
        // Pre-boss collapses the map back to a single gate-room
        // (ELITE / REST / SHRINE / MERCHANT — see getForcedRoomType)
        // so the boss room has exactly one incoming edge.
        const isPreBossDepth =
            !isBossDepth &&
            depth > 0 &&
            (depth + 1) % MAP_CONFIG.bossEveryNDepths === 0;
        const branchRoll = this.rng.next();
        const rolledCount =
            branchRoll < MAP_CONFIG.branchRolls.one
                ? 1
                : branchRoll < MAP_CONFIG.branchRolls.one + MAP_CONFIG.branchRolls.two
                  ? 2
                  : 3;
        // Multidirectional placement makes it impossible to fan many
        // parents into a single child without crossing edges, so for
        // open layers we require at least one new node per
        // previous-layer parent. The BOSS and PRE-BOSS layers are
        // intentional bottlenecks (count = 1).
        const count =
            isBossDepth || isPreBossDepth
                ? 1
                : Math.max(rolledCount, previousLayer.length);
        const newLayer: MapNode[] = [];

        for (let slot = 0; slot < count; slot++) {
            const type = isBossDepth ? RoomType.BOSS : this.pickRoomType(depth, allNodes, newLayer);
            const node = this.makeNode(depth, slot, type);

            const isConvergingLayer =
                (isBossDepth || isPreBossDepth) && previousLayer.length > 1;

            let chosenParent: MapNode | null = null;
            let chosenPoint: Point | null = null;

            if (isConvergingLayer) {
                // For BOSS / PRE-BOSS layers we collapse multiple
                // previous-layer parents into a single child. Placing
                // the child near the *centroid* of its parents (with
                // a forward bias so converging edges fan in the same
                // direction as the rest of the level) keeps edges
                // short and roughly radial, which dramatically
                // reduces crossings against the rest of the graph.
                const levelDir = this.getLevelDirection(depth);
                chosenPoint = this.placeNearCentroid(
                    previousLayer,
                    allNodes,
                    levelDir,
                );
                chosenParent = previousLayer[slot % previousLayer.length];
            } else {
                // Round-robin primary parent so each previous-layer
                // node fans out roughly evenly. If that parent can't
                // host a clean (non-crossing) placement, try the
                // other parents before falling back to the original
                // with a crossing accepted.
                const primaryIndex = slot % previousLayer.length;
                const parentOrder: MapNode[] = [];
                for (let i = 0; i < previousLayer.length; i++) {
                    parentOrder.push(
                        previousLayer[(primaryIndex + i) % previousLayer.length],
                    );
                }

                const levelDir = this.getLevelDirection(depth);
                for (const candidateParent of parentOrder) {
                    const place = this.tryPlaceNode(
                        candidateParent,
                        allNodes,
                        levelDir,
                    );
                    if (place) {
                        chosenParent = candidateParent;
                        chosenPoint = place;
                        break;
                    }
                }
                if (!chosenParent || !chosenPoint) {
                    chosenParent = parentOrder[0];
                    chosenPoint = this.placeNode(chosenParent, allNodes, levelDir);
                }
            }

            node.x = chosenPoint.x;
            node.y = chosenPoint.y;
            allNodes.push(node);
            newLayer.push(node);
            chosenParent.edges.push(node.id);
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
                .slice()
                .sort(
                    (a, b) => squaredDistance(parent, a) - squaredDistance(parent, b),
                );
            const edges = collectEdgeSegments(allNodes);
            for (const cand of candidates) {
                if (!edgeCrossesAny(parent, { x: cand.x, y: cand.y }, edges)) {
                    parent.edges.push(cand.id);
                    return;
                }
            }
            // Last resort: connect to the closest, accepting a crossing.
            parent.edges.push(candidates[0].id);
        });

        // Optional second edge per parent — a bonus path to a sibling
        // child. Only kept if it doesn't cross any existing edge.
        previousLayer.forEach((parent) => {
            if (newLayer.length <= 1) return;
            if (this.rng.next() >= MAP_CONFIG.edgeProbability) return;

            const candidates = newLayer
                .filter((cand) => !parent.edges.includes(cand.id))
                .slice()
                .sort(
                    (a, b) =>
                        squaredDistance(parent, a) - squaredDistance(parent, b),
                );

            const edges = collectEdgeSegments(allNodes);
            for (const cand of candidates) {
                if (edgeCrossesAny(parent, { x: cand.x, y: cand.y }, edges)) {
                    continue;
                }
                parent.edges.push(cand.id);
                break;
            }
        });

        // Safety net: if a child somehow ended up parentless (e.g. its
        // primary parent assignment landed on a node already saturated),
        // hand it the closest non-crossing parent.
        newLayer.forEach((node) => {
            const hasParent = previousLayer.some((parent) => parent.edges.includes(node.id));
            if (hasParent) return;

            const sorted = previousLayer
                .slice()
                .sort(
                    (a, b) =>
                        squaredDistance(a, node) - squaredDistance(b, node),
                );
            const edges = collectEdgeSegments(allNodes);
            for (const parent of sorted) {
                if (!edgeCrossesAny(parent, { x: node.x, y: node.y }, edges)) {
                    parent.edges.push(node.id);
                    return;
                }
            }
            // Truly nowhere clean to attach — accept a crossing rather
            // than orphan the node so the run can continue.
            sorted[0].edges.push(node.id);
        });

        return newLayer;
    }

    /**
     * Placement strategy for converging (BOSS / PRE-BOSS) layers.
     * Multiple parents must point at a single child, so we search
     * for a spot where every parent→child segment is clear. We probe
     * concentric rings around the centroid first (short converging
     * edges) and then around each individual parent so the choice
     * can drift toward whichever parent has the most open space.
     */
    private placeNearCentroid(
        parents: MapNode[],
        allNodes: MapNode[],
        levelDirection?: number,
    ): Point {
        const centroid: Point = {
            x: parents.reduce((sum, p) => sum + p.x, 0) / parents.length,
            y: parents.reduce((sum, p) => sum + p.y, 0) / parents.length,
        };
        const edges = collectEdgeSegments(allNodes);
        const minDistSq = MIN_NODE_DISTANCE * MIN_NODE_DISTANCE;

        const ringRadii = [
            0,
            EDGE_LENGTH * 0.3,
            EDGE_LENGTH * 0.6,
            EDGE_LENGTH,
            EDGE_LENGTH * 1.4,
            EDGE_LENGTH * 1.8,
            EDGE_LENGTH * 2.4,
            EDGE_LENGTH * 3,
            EDGE_LENGTH * 4,
        ];
        const ringSamples = 72;

        const allParentEdgesClear = (cand: Point): boolean =>
            parents.every((p) => !edgeCrossesAny(p, cand, edges));
        const tooClose = (cand: Point): boolean =>
            allNodes.some((n) => squaredDistance(n, cand) < minDistSq);

        // Probe forward-biased centroids first (push along the level
        // direction so converging edges fan ahead of the previous
        // layer rather than back into it), then the centroid itself,
        // and finally each individual parent as a last resort.
        const probeOrigins: Point[] = [];
        if (levelDirection !== undefined) {
            for (const r of [EDGE_LENGTH, EDGE_LENGTH * 1.5, EDGE_LENGTH * 2]) {
                probeOrigins.push({
                    x: centroid.x + Math.cos(levelDirection) * r,
                    y: centroid.y + Math.sin(levelDirection) * r,
                });
            }
        }
        probeOrigins.push(centroid);
        for (const p of parents) probeOrigins.push({ x: p.x, y: p.y });

        // Pass 1: ideal placement (clear edges + spaced from existing nodes).
        for (const origin of probeOrigins) {
            for (const r of ringRadii) {
                const samples = r === 0 ? 1 : ringSamples;
                for (let i = 0; i < samples; i++) {
                    const angle = (i / samples) * Math.PI * 2;
                    const cand: Point = {
                        x: origin.x + Math.cos(angle) * r,
                        y: origin.y + Math.sin(angle) * r,
                    };
                    if (!tooClose(cand) && allParentEdgesClear(cand)) {
                        return cand;
                    }
                }
            }
        }

        // Pass 2: still no crossings, but allow the candidate to sit
        // close to existing nodes if that's the only way to fit.
        for (const origin of probeOrigins) {
            for (const r of ringRadii) {
                const samples = r === 0 ? 1 : ringSamples;
                for (let i = 0; i < samples; i++) {
                    const angle = (i / samples) * Math.PI * 2;
                    const cand: Point = {
                        x: origin.x + Math.cos(angle) * r,
                        y: origin.y + Math.sin(angle) * r,
                    };
                    if (allParentEdgesClear(cand)) {
                        return cand;
                    }
                }
            }
        }

        // Last resort: centroid itself, accepting some crossings.
        return centroid;
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

        // Pass 1: random angles at preferred radii — ideal placement
        // (no crossing, no min-distance violation). When a level
        // direction is supplied we restrict angles to a ±45° cone
        // around it so the layer fans forward instead of sometimes
        // doubling back through earlier rooms.
        const cone = Math.PI / 4;
        for (let i = 0; i < PLACEMENT_ATTEMPTS; i++) {
            const angle =
                biasAngle === undefined
                    ? this.rng.next() * Math.PI * 2
                    : biasAngle + (this.rng.next() * 2 - 1) * cone;
            for (const distance of [EDGE_LENGTH, EDGE_LENGTH * 1.25, EDGE_LENGTH * 1.5]) {
                const point: Point = {
                    x: parent.x + Math.cos(angle) * distance,
                    y: parent.y + Math.sin(angle) * distance,
                };
                const tooClose = allNodes.some(
                    (n) => squaredDistance(n, point) < minDistSq,
                );
                if (!tooClose && !edgeCrossesAny(parent, point, edges)) {
                    return point;
                }
            }
        }

        // Pass 2: dense deterministic angle sweep at growing radii,
        // preferring non-crossing candidates that respect the
        // min-distance. We pick the candidate that maximises
        // separation from the nearest existing node so two siblings
        // sharing a parent don't deterministically converge on the
        // same first-clear angle.
        const sweepCount = 144;
        const expandedDistances = [
            EDGE_LENGTH,
            EDGE_LENGTH * 1.25,
            EDGE_LENGTH * 1.5,
            EDGE_LENGTH * 1.8,
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
                if (edgeCrossesAny(parent, point, edges)) continue;

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

        const evaluate = (
            angle: number,
            distance: number,
        ): { point: Point; tooClose: boolean; crosses: boolean } => {
            const point: Point = {
                x: parent.x + Math.cos(angle) * distance,
                y: parent.y + Math.sin(angle) * distance,
            };
            const tooClose = allNodes.some(
                (n) => squaredDistance(n, point) < minDistSq,
            );
            const crosses = edgeCrossesAny(parent, point, edges);
            return { point, tooClose, crosses };
        };

        const cone = Math.PI / 4;
        const randomAngles: number[] = [];
        for (let i = 0; i < PLACEMENT_ATTEMPTS; i++) {
            randomAngles.push(
                biasAngle === undefined
                    ? this.rng.next() * Math.PI * 2
                    : biasAngle + (this.rng.next() * 2 - 1) * cone,
            );
        }

        // Pass 1: random angles, increasing radii — ideal placement.
        for (const distance of [EDGE_LENGTH, EDGE_LENGTH * 1.25, EDGE_LENGTH * 1.5]) {
            for (const angle of randomAngles) {
                const cand = evaluate(angle, distance);
                if (!cand.tooClose && !cand.crosses) {
                    return cand.point;
                }
            }
        }

        // Pass 2: dense deterministic sweep, still no crossings —
        // relax the min-distance check first, then expand the radius.
        const denseAngles: number[] = [];
        const sweepCount = 72;
        for (let i = 0; i < sweepCount; i++) {
            denseAngles.push((i / sweepCount) * Math.PI * 2);
        }

        const expandedDistances = [
            EDGE_LENGTH,
            EDGE_LENGTH * 1.25,
            EDGE_LENGTH * 1.5,
            EDGE_LENGTH * 1.8,
            EDGE_LENGTH * 2.2,
            EDGE_LENGTH * 2.6,
            EDGE_LENGTH * 3.2,
            EDGE_LENGTH * 4,
            EDGE_LENGTH * 5,
        ];
        for (const distance of expandedDistances) {
            for (const angle of denseAngles) {
                const cand = evaluate(angle, distance);
                if (!cand.crosses) {
                    return cand.point;
                }
            }
        }

        // Pass 3: pathological — accept a crossing candidate as a
        // last resort so the run never deadlocks. Pick the radius
        // and angle that minimised overlap during the dense sweep.
        let fallback: { point: Point; score: number } | null = null;
        for (const distance of expandedDistances) {
            for (const angle of denseAngles) {
                const cand = evaluate(angle, distance);
                const score =
                    (cand.crosses ? 1000 : 0) + (cand.tooClose ? 100 : 0);
                if (fallback === null || score < fallback.score) {
                    fallback = { point: cand.point, score };
                }
            }
        }
        return fallback!.point;
    }

    private pickRoomType(depth: number, allNodes: MapNode[], pendingNodes: MapNode[]): RoomType {
        const forcedType = this.getForcedRoomType(depth, allNodes, pendingNodes);
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

    private getForcedRoomType(depth: number, _allNodes: MapNode[], pendingNodes: MapNode[]): RoomType | null {
        const bossDepth = this.getUpcomingBossDepth(depth);
        if (bossDepth === null || depth !== bossDepth - 1) {
            return null;
        }

        // The pre-boss layer must always offer at least one ELITE
        // (or, failing that, a prep room — REST/SHRINE/MERCHANT) so
        // the player has a choice to gear up before the boss room.
        // We only inspect siblings already placed at this same depth
        // (`pendingNodes`) so the guarantee holds even if the RNG
        // happened to drop an ELITE/PREP earlier in the run.
        const availablePrepRooms = PREP_ROOM_POOL.filter((type) => this.availableRooms.has(type));

        const hasEliteAtThisDepth = pendingNodes.some(
            (node) => node.type === RoomType.ELITE,
        );
        if (this.availableRooms.has(RoomType.ELITE) && !hasEliteAtThisDepth) {
            return RoomType.ELITE;
        }

        const hasPrepAtThisDepth = pendingNodes.some((node) =>
            availablePrepRooms.includes(node.type),
        );
        if (availablePrepRooms.length > 0 && !hasPrepAtThisDepth) {
            return this.pickWeightedRoom(availablePrepRooms);
        }

        return null;
    }

    private getUpcomingBossDepth(depth: number): number | null {
        if (depth <= 0) {
            return null;
        }

        return Math.ceil(depth / MAP_CONFIG.bossEveryNDepths) * MAP_CONFIG.bossEveryNDepths;
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

    private makeNode(depth: number, slot: number, type: RoomType): MapNode {
        return {
            id: `n${this.counter++}`,
            depth,
            slot,
            x: 0,
            y: 0,
            type,
            visited: false,
            cleared: false,
            edges: [],
        };
    }
}

function squaredDistance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}
