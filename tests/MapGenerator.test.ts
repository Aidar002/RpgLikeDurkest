import { describe, expect, it } from 'vitest';
import { MAP_CONFIG } from '../src/data/GameConfig';
import { MapGenerator, RoomType } from '../src/systems/MapGenerator';
import { Mulberry32 } from '../src/systems/Rng';

function countByType(nodes: { type: string }[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const node of nodes) out[node.type] = (out[node.type] ?? 0) + 1;
    return out;
}

describe('MapGenerator', () => {
    it('is deterministic for a given seed', () => {
        const a = new MapGenerator(undefined, new Mulberry32(7));
        const b = new MapGenerator(undefined, new Mulberry32(7));
        const mapA = a.generateInitialMap();
        const mapB = b.generateInitialMap();
        expect(mapA.map((n) => n.type)).toEqual(mapB.map((n) => n.type));
        expect(mapA.map((n) => n.edges.join(','))).toEqual(mapB.map((n) => n.edges.join(',')));
    });

    it('places a BOSS exactly at every bossEveryNDepths', () => {
        const rng = new Mulberry32(123);
        const gen = new MapGenerator(
            [RoomType.ENEMY, RoomType.EMPTY, RoomType.TREASURE, RoomType.ELITE],
            rng
        );
        // Generate enough layers to include the first boss.
        const lookahead = MAP_CONFIG.bossEveryNDepths + 2;
        const nodes = gen.generateInitialMap(lookahead);

        const bossDepths = nodes.filter((n) => n.type === RoomType.BOSS).map((n) => n.depth);
        expect(bossDepths).toContain(MAP_CONFIG.bossEveryNDepths);
    });

    it('guarantees an ELITE or PREP room right before the boss when the pool allows it', () => {
        // Run many seeds to make sure the forced-room logic fires consistently.
        const bossDepth = MAP_CONFIG.bossEveryNDepths;
        for (let seed = 0; seed < 20; seed++) {
            const gen = new MapGenerator(
                [
                    RoomType.ENEMY,
                    RoomType.EMPTY,
                    RoomType.TREASURE,
                    RoomType.TRAP,
                    RoomType.REST,
                    RoomType.SHRINE,
                    RoomType.MERCHANT,
                    RoomType.ELITE,
                ],
                new Mulberry32(seed)
            );
            const nodes = gen.generateInitialMap(bossDepth);
            const preBossNodes = nodes.filter((n) => n.depth === bossDepth - 1);
            const types = new Set(preBossNodes.map((n) => n.type));
            const hasEliteOrPrep =
                types.has(RoomType.ELITE) ||
                types.has(RoomType.REST) ||
                types.has(RoomType.SHRINE) ||
                types.has(RoomType.MERCHANT);
            expect(hasEliteOrPrep).toBe(true);
        }
    });

    it('never emits START or BOSS outside designated depths', () => {
        const gen = new MapGenerator(undefined, new Mulberry32(3));
        const nodes = gen.generateInitialMap();
        const counts = countByType(nodes);
        // Exactly one START at depth 0.
        expect(counts.START).toBe(1);
        expect(nodes.find((n) => n.type === RoomType.START)?.depth).toBe(0);
        // No BOSS in the initial lookahead unless the lookahead reaches bossEvery.
        if (MAP_CONFIG.initialLookahead < MAP_CONFIG.bossEveryNDepths) {
            expect(counts.BOSS ?? 0).toBe(0);
        }
    });

    it('generateNextLayer extends the map by one depth', () => {
        const gen = new MapGenerator(undefined, new Mulberry32(5));
        const nodes = gen.generateInitialMap(3);
        const maxDepth = Math.max(...nodes.map((n) => n.depth));
        const extension = gen.generateNextLayer(nodes, maxDepth);
        expect(extension.length).toBeGreaterThan(0);
        expect(extension.every((n) => n.depth === maxDepth + 1)).toBe(true);
    });

    it('keeps the crossing-edge rate well under 5% across many seeds', () => {
        interface Point { x: number; y: number }
        interface Segment { src: string; tgt: string; a: Point; b: Point }

        const ccw = (a: Point, b: Point, c: Point) =>
            (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

        const segmentsCross = (s: Segment, t: Segment): boolean => {
            // Edges that share an endpoint never count as crossing
            // (siblings of the same parent meet at the parent node).
            if (s.src === t.src || s.src === t.tgt || s.tgt === t.src || s.tgt === t.tgt) {
                return false;
            }
            const d1 = ccw(t.a, t.b, s.a);
            const d2 = ccw(t.a, t.b, s.b);
            const d3 = ccw(s.a, s.b, t.a);
            const d4 = ccw(s.a, s.b, t.b);
            return (
                ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
                ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
            );
        };

        // The map topology forces N parents to fan into a single
        // PRE-BOSS / BOSS child every five depths. With fully
        // multidirectional placement, this convergence is sometimes
        // geometrically impossible to route without crossing edges.
        // We accept that as long as the rate is well-bounded.
        const SEED_COUNT = 200;
        const MAX_FAILURE_RATE = 0.05;
        let failingSeeds = 0;

        for (let seed = 0; seed < SEED_COUNT; seed++) {
            const gen = new MapGenerator(undefined, new Mulberry32(seed));
            const nodes = gen.generateInitialMap(8);
            const byId = new Map(nodes.map((n) => [n.id, n]));

            const segments: Segment[] = [];
            for (const src of nodes) {
                for (const tgtId of src.edges) {
                    const tgt = byId.get(tgtId);
                    if (!tgt) continue;
                    segments.push({
                        src: src.id,
                        tgt: tgt.id,
                        a: { x: src.x, y: src.y },
                        b: { x: tgt.x, y: tgt.y },
                    });
                }
            }

            outer: for (let i = 0; i < segments.length; i++) {
                for (let j = i + 1; j < segments.length; j++) {
                    if (segmentsCross(segments[i], segments[j])) {
                        failingSeeds += 1;
                        break outer;
                    }
                }
            }
        }

        const rate = failingSeeds / SEED_COUNT;
        expect(rate).toBeLessThan(MAX_FAILURE_RATE);
    });

    it('keeps the rate of edges clipping through unrelated rooms well under 5% across many seeds', () => {
        // Companion to the crossing-edges test: it's not enough that
        // edges don't cross each other — they also must not pass
        // *through* the icon rectangle of another room. With the
        // forced PRE-BOSS / BOSS convergence in fully multidirectional
        // placement this is occasionally unavoidable, so we bound the
        // failure rate the same way we bound crossings.
        const NODE_HALF = 40; // NODE_SZ / 2 — match MapView render.
        const BUFFER = 4;
        const blockerRadius = NODE_HALF + BUFFER;
        const blockerRadSq = blockerRadius * blockerRadius;

        const pointSegmentDistanceSq = (
            p: { x: number; y: number },
            a: { x: number; y: number },
            b: { x: number; y: number },
        ): number => {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const lenSq = dx * dx + dy * dy;
            if (lenSq === 0) {
                const ax = p.x - a.x;
                const ay = p.y - a.y;
                return ax * ax + ay * ay;
            }
            let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t));
            const cx = a.x + t * dx;
            const cy = a.y + t * dy;
            const ddx = p.x - cx;
            const ddy = p.y - cy;
            return ddx * ddx + ddy * ddy;
        };

        const SEED_COUNT = 200;
        const MAX_FAILURE_RATE = 0.05;
        let failingSeeds = 0;

        for (let seed = 0; seed < SEED_COUNT; seed++) {
            const gen = new MapGenerator(undefined, new Mulberry32(seed));
            const nodes = gen.generateInitialMap(8);
            const byId = new Map(nodes.map((n) => [n.id, n]));

            interface Seg {
                srcId: string;
                tgtId: string;
                a: { x: number; y: number };
                b: { x: number; y: number };
            }
            const segments: Seg[] = [];
            for (const src of nodes) {
                for (const tgtId of src.edges) {
                    const tgt = byId.get(tgtId);
                    if (!tgt) continue;
                    segments.push({
                        srcId: src.id,
                        tgtId: tgt.id,
                        a: { x: src.x, y: src.y },
                        b: { x: tgt.x, y: tgt.y },
                    });
                }
            }

            outer: for (const seg of segments) {
                for (const n of nodes) {
                    if (n.id === seg.srcId || n.id === seg.tgtId) continue;
                    const distSq = pointSegmentDistanceSq(
                        { x: n.x, y: n.y },
                        seg.a,
                        seg.b,
                    );
                    if (distSq < blockerRadSq) {
                        failingSeeds += 1;
                        break outer;
                    }
                }
            }
        }

        const rate = failingSeeds / SEED_COUNT;
        expect(rate).toBeLessThan(MAX_FAILURE_RATE);
    });

    it('every target node has at least one parent edge', () => {
        for (let seed = 0; seed < 30; seed++) {
            const gen = new MapGenerator(undefined, new Mulberry32(seed));
            const nodes = gen.generateInitialMap(8);
            const maxDepth = Math.max(...nodes.map((n) => n.depth));

            for (let d = 1; d <= maxDepth; d++) {
                const targets = nodes.filter((n) => n.depth === d);
                const sources = nodes.filter((n) => n.depth === d - 1);
                for (const target of targets) {
                    const hasParent = sources.some((s) =>
                        s.edges.includes(target.id),
                    );
                    expect(hasParent).toBe(true);
                }
            }
        }
    });

    it('respects the per-room outgoing-edge cap', () => {
        // Every non-bottleneck parent should have at most
        // MAP_CONFIG.maxEdgesPerNode forward transitions, and at
        // least 1 (so the player can always advance from any
        // non-leaf room).
        const seenFanouts = new Set<number>();
        for (let seed = 0; seed < 100; seed++) {
            const gen = new MapGenerator(undefined, new Mulberry32(seed));
            const nodes = gen.generateInitialMap(8);
            const maxDepth = Math.max(...nodes.map((n) => n.depth));
            for (const node of nodes) {
                if (node.depth === maxDepth) continue; // leaves
                expect(node.edges.length).toBeGreaterThanOrEqual(1);
                expect(node.edges.length).toBeLessThanOrEqual(
                    MAP_CONFIG.maxEdgesPerNode,
                );
                seenFanouts.add(node.edges.length);
            }
        }
        // Across many seeds we should see a meaningful spread of
        // fanouts, not just the always-1 baseline. Require at least
        // some 2-outgoing rooms so the bonus-edge pass is actually
        // exercised end-to-end.
        expect(seenFanouts.has(2)).toBe(true);
    });

    it('keeps most non-bottleneck edges close to the preferred length', () => {
        // The user-visible "no cross-screen lines" guarantee. The
        // forced PRE-BOSS / BOSS convergence still occasionally
        // produces a long edge (parents spread out then collapse
        // into one PRE-BOSS room), so we only check non-converging
        // edges here. Most regular parent→child edges should land
        // within ~1.5× of the preferred edge length used inside
        // MapGenerator.
        const SEED_COUNT = 100;
        const SOFT_CAP_PX = 240; // mirrors MAX_EDGE_LENGTH internally
        let total = 0;
        let overCap = 0;
        for (let seed = 0; seed < SEED_COUNT; seed++) {
            const gen = new MapGenerator(undefined, new Mulberry32(seed));
            const nodes = gen.generateInitialMap(8);
            const byId = new Map(nodes.map((n) => [n.id, n]));
            for (const src of nodes) {
                for (const tgtId of src.edges) {
                    const tgt = byId.get(tgtId);
                    if (!tgt) continue;
                    // Skip edges into a forced bottleneck (PRE-BOSS / BOSS).
                    const tgtIsBottleneck =
                        tgt.type === RoomType.BOSS ||
                        tgt.depth % MAP_CONFIG.bossEveryNDepths ===
                            MAP_CONFIG.bossEveryNDepths - 1;
                    if (tgtIsBottleneck) continue;
                    const dx = tgt.x - src.x;
                    const dy = tgt.y - src.y;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    total += 1;
                    if (len > SOFT_CAP_PX) overCap += 1;
                }
            }
        }
        // Allow up to 25% of non-bottleneck edges to exceed the
        // soft cap (covers placement fallbacks on congested
        // layers); the rest should be at the preferred length.
        expect(overCap / total).toBeLessThan(0.25);
    });
});
