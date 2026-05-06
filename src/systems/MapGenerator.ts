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
     * Branch-guardian / mid-run threat. Stub for PR-2 — placement
     * is wired up by the bossPressure pass in the next PR. Already
     * declared so combat / UI / narrative code can pattern-match
     * against it without churn later.
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
 *  - `'major'` — mid-run major boss. Reserved for PR-2; PR-1
 *    never assigns this kind.
 *  - `'mini'`  — mid-run threat / branch guardian. Reserved for
 *    PR-2; PR-1 never assigns this kind.
 *  - `null`    — non-boss room.
 */
export type BossKind = 'final' | 'major' | 'mini' | null;

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

        // Never generate past the final-boss depth. If a caller
        // (or test) asks for `lookahead >= runLength`, we simply
        // build the whole run up to the final layer and stop —
        // there is nothing beyond the final layer.
        const lastDepth = Math.min(lookahead, this.runLength);
        let previousLayer = [start];
        for (let depth = 1; depth <= lastDepth; depth++) {
            previousLayer = this.buildLayer(depth, previousLayer, all);
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
        return this.buildLayer(fromDepth + 1, previousLayer, [...allNodes]);
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
            const type = isFinalLayer
                ? RoomType.BOSS
                : this.pickRoomType(depth, allNodes, newLayer);
            const bossKind: BossKind = isFinalLayer ? 'final' : null;
            const node = this.makeNode(depth, slot, type, bossKind);

            // Round-robin primary parent so each previous-layer
            // node fans out roughly evenly. If that parent can't
            // host a clean (non-crossing, non-clipping) placement,
            // try the other parents before falling back to the
            // original with the strict invariants relaxed.
            //
            // Note: PR-1 removes the legacy converging PRE-BOSS /
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

            let chosenParent: MapNode | null = null;
            let chosenPoint: Point | null = null;

            for (const candidateParent of parentOrder) {
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
                chosenParent = parentOrder[0];
                chosenPoint = this.placeNode(
                    chosenParent,
                    allNodes,
                    this.getOutwardBias(chosenParent),
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
                if (this.edgeIsClear(parent, cand, edges, allNodes)) {
                    parent.edges.push(cand.id);
                    return;
                }
            }
            // Last resort: connect to the closest, accepting a violation.
            parent.edges.push(candidates[0].id);
        });

        // Bonus edges per parent — picks a target outgoing fanout
        // from {@link MAP_CONFIG.fanoutRolls} (1–4) and tries to
        // raise this parent's child-count up to that target. Each
        // candidate is the closest remaining sibling within
        // {@link FALLBACK_EDGE_LENGTH}, gated by the no-crossing /
        // no-clipping invariants so we never trade visual clarity
        // for extra paths.
        //
        // Note: PR-1 removes the legacy PRE-BOSS / BOSS bottleneck
        // skip — every layer (including the final-approach and
        // final-boss layers) participates in fanout, so the player
        // can fan onto multiple final-boss nodes from the same
        // recovery room. The no-adjacent-bosses invariant for
        // intermediate bosses is enforced in PR-2 once MINI_BOSS /
        // major BOSS placement lands.
        previousLayer.forEach((parent) => {
            if (newLayer.length <= 1) return;

            const targetFanout = this.rollFanout();
            const cap = Math.min(MAP_CONFIG.maxEdgesPerNode, newLayer.length);
            let need = Math.min(targetFanout, cap) - parent.edges.length;
            if (need <= 0) return;

            const candidates = newLayer
                .filter((cand) => !parent.edges.includes(cand.id))
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
            // Truly nowhere clean to attach — accept a violation rather
            // than orphan the node so the run can continue.
            sorted[0].edges.push(node.id);
        });

        return newLayer;
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

    private getForcedRoomType(depth: number, _allNodes: MapNode[], _pendingNodes: MapNode[]): RoomType | null {
        // PR-1: the only forced layer is the final-approach
        // (`runLength - 1`). Every room there is a recovery /
        // reward type drawn from {@link FINAL_APPROACH_POOL} so the
        // player can stabilize before any final-boss node. PR-2
        // will add additional forcing (recovery rooms after a
        // major BOSS, no-adjacent-bosses, etc.) — those are
        // intentionally absent here so this PR can be reviewed in
        // isolation.
        if (depth === this.runLength - 1) {
            const availableRecoveryRooms = FINAL_APPROACH_POOL.filter(
                (type) => this.availableRooms.has(type),
            );
            if (availableRecoveryRooms.length > 0) {
                return this.pickWeightedRoom(availableRecoveryRooms);
            }
        }

        return null;
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
        return {
            id: `n${this.counter++}`,
            depth,
            slot,
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
     * (`bossKind !== null`). PR-1 only generates final bosses, so
     * this is always 0; PR-2 will track adjacency violations for
     * intermediate bosses.
     */
    bossAdjacencyViolations: number;
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
    let totalEdges = 0;
    let bossAdjacencyViolations = 0;

    for (const node of allNodes) {
        for (const edgeId of node.edges) {
            const target = byId.get(edgeId);
            if (!target) continue;
            totalEdges++;
            incoming.set(edgeId, (incoming.get(edgeId) ?? 0) + 1);
            // Boss-to-boss edge — the no-adjacent-bosses invariant
            // (relevant once PR-2 lands intermediate bosses).
            if (node.bossKind !== null && target.bossKind !== null) {
                bossAdjacencyViolations++;
            }
        }
    }

    const finalNodes = allNodes.filter((n) => n.depth === runLength);
    const finalLayerGenerated = finalNodes.length > 0;

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
    };
}

function squaredDistance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}
