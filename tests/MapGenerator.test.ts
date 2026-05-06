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
});
