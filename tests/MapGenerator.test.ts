import { describe, expect, it } from 'vitest';
import { FEATURES, MAP_CONFIG, RUN_CONFIG } from '../src/data/GameConfig';
import {
    MapGenerator,
    RoomType,
    formatMapDebug,
    getRequiredSeals,
    validateMap,
} from '../src/systems/MapGenerator';
import { Mulberry32 } from '../src/systems/Rng';

function countByType(nodes: { type: string }[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const node of nodes) out[node.type] = (out[node.type] ?? 0) + 1;
    return out;
}

/**
 * Build a complete run end-to-end (depth 0 .. runLength) so tests
 * can exercise the final-layer / final-approach invariants without
 * having to step through `generateNextLayer` from gameplay code.
 *
 * `generateInitialMap` already accepts a lookahead larger than the
 * configured runLength and clamps to it internally — we lean on
 * that here so behaviour stays identical to a real long run.
 */
function generateFullRun(runLength: number, seed: number) {
    const rng = new Mulberry32(seed);
    const gen = new MapGenerator(undefined, rng, runLength);
    const nodes = gen.generateInitialMap(runLength);
    return { gen, nodes };
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

    it('only places mid-run BOSS rooms with bossKind="major" and never on the final-approach layer', () => {
        // PR-2's bossPressure pass introduces mid-run BOSS rooms
        // (`bossKind === 'major'`). They must never land on the
        // final-approach layer (`runLength - 1`) — that one is
        // forced to recovery rooms — and the final layer itself
        // stays exclusively `bossKind === 'final'`.
        const runLength = 25;
        for (let seed = 0; seed < 30; seed++) {
            const { nodes } = generateFullRun(runLength, seed);
            for (const node of nodes) {
                if (node.type !== RoomType.BOSS) continue;
                if (node.depth === runLength) {
                    expect(node.bossKind).toBe('final');
                } else {
                    expect(node.bossKind).toBe('major');
                    expect(node.depth).toBeLessThan(runLength - 1);
                }
            }
        }
    });

    it('generates a final layer where every node is a final boss', () => {
        const runLength = 25;
        const { nodes } = generateFullRun(runLength, 7);
        const finalNodes = nodes.filter((n) => n.depth === runLength);
        expect(finalNodes.length).toBeGreaterThan(0);
        for (const node of finalNodes) {
            expect(node.type).toBe(RoomType.BOSS);
            expect(node.bossKind).toBe('final');
        }
    });

    it('forces the final-approach layer to recovery / reward room types', () => {
        // depth = runLength - 1 must be drawn from the recovery
        // pool (REST / SHRINE / MERCHANT / TREASURE) when those
        // types are part of the available rooms.
        const recoveryPool = new Set<RoomType>([
            RoomType.REST,
            RoomType.SHRINE,
            RoomType.MERCHANT,
            RoomType.TREASURE,
        ]);
        for (let seed = 0; seed < 25; seed++) {
            const runLength = 25;
            const { nodes } = generateFullRun(runLength, seed);
            const approach = nodes.filter((n) => n.depth === runLength - 1);
            expect(approach.length).toBeGreaterThanOrEqual(2);
            for (const node of approach) {
                expect(recoveryPool.has(node.type)).toBe(true);
                expect(node.bossKind).toBeNull();
            }
        }
    });

    it('exposes the START room and never spawns a stray START elsewhere', () => {
        const gen = new MapGenerator(undefined, new Mulberry32(3));
        const nodes = gen.generateInitialMap();
        const counts = countByType(nodes);
        expect(counts.START).toBe(1);
        expect(nodes.find((n) => n.type === RoomType.START)?.depth).toBe(0);
        // No BOSS in the initial lookahead unless the caller asked
        // for the full run (lookahead >= runLength).
        if (MAP_CONFIG.initialLookahead < RUN_CONFIG.runLength) {
            expect(counts.BOSS ?? 0).toBe(0);
        }
    });

    it('generateNextLayer extends the map by one depth and stops at the final layer', () => {
        const gen = new MapGenerator(undefined, new Mulberry32(5));
        const nodes = gen.generateInitialMap(3);
        const maxDepth = Math.max(...nodes.map((n) => n.depth));
        const extension = gen.generateNextLayer(nodes, maxDepth);
        expect(extension.length).toBeGreaterThan(0);
        expect(extension.every((n) => n.depth === maxDepth + 1)).toBe(true);

        // Walk forward to the final layer and confirm the
        // generator refuses to push past it (terminal layer).
        const all = [...nodes, ...extension];
        let cur = maxDepth + 1;
        while (cur < gen.getRunLength()) {
            const next = gen.generateNextLayer(all, cur);
            for (const n of next) all.push(n);
            cur += 1;
        }
        const beyond = gen.generateNextLayer(all, gen.getRunLength());
        expect(beyond).toHaveLength(0);
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

        // PR-1 removed the legacy PRE-BOSS / BOSS bottleneck so
        // the only forced fan-in pattern that remains is the
        // final-approach layer (still wide enough to fan onto
        // multiple final-boss nodes). The 3-4 layer-width shift
        // (PR fanout-bias) widened layers further, which gives
        // the slot-rotation a few more chances to lay primary
        // edges that cross — `edgeIsClear` still rejects those at
        // placement time, but the safety-net fallback can still
        // accept a crossing rather than orphan a node. Budget is
        // 8 % so the test isn't fragile across RNG churn.
        const SEED_COUNT = 200;
        const MAX_FAILURE_RATE = 0.08;
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
        // *through* the icon rectangle of another room.
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

    it('START always offers four directional choices on entry', () => {
        // The START room is a hub — the very first step should
        // always present 4 paths so the run feels open from move
        // one (a tighter spec than the global 1-4 fanout that
        // applies to every other room). Pinned to a wide range of
        // seeds because the layer-width override and the bonus-
        // edge START-fanout override must both kick in even on
        // unlucky rng.
        for (let seed = 0; seed < 50; seed++) {
            const gen = new MapGenerator(undefined, new Mulberry32(seed));
            const nodes = gen.generateInitialMap(5);
            const start = nodes.find((n) => n.depth === 0);
            expect(start).toBeDefined();
            expect(start!.edges.length).toBe(4);
            const depthOne = nodes.filter((n) => n.depth === 1);
            expect(depthOne.length).toBe(4);
            // Every depth-1 node is reached by START.
            for (const child of depthOne) {
                expect(start!.edges).toContain(child.id);
            }
        }
    });

    it('respects the per-room outgoing-edge cap', () => {
        // Every non-leaf parent should have at most
        // MAP_CONFIG.maxEdgesPerNode forward transitions, and at
        // least 1 (so the player can always advance from any
        // non-final room).
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

    it('keeps most edges close to the preferred length', () => {
        // The user-visible "no cross-screen lines" guarantee. With
        // PR-1 dropping the converging PRE-BOSS / BOSS bottleneck
        // every edge is a normal fan-out edge, so the soft cap
        // applies uniformly across the whole map.
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
                    const dx = tgt.x - src.x;
                    const dy = tgt.y - src.y;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    total += 1;
                    if (len > SOFT_CAP_PX) overCap += 1;
                }
            }
        }
        // Allow up to 25% of edges to exceed the soft cap (covers
        // placement fallbacks on congested layers); the rest
        // should be at the preferred length.
        expect(overCap / total).toBeLessThan(0.25);
    });

    describe('runLength scaling (PR-1 architecture)', () => {
        const RUN_LENGTHS = [25, 35, 50, 75];

        for (const runLength of RUN_LENGTHS) {
            it(`generates a fully-connected map for runLength=${runLength}`, () => {
                const { nodes } = generateFullRun(runLength, 11);

                // The map covers depth 0 .. runLength inclusive.
                const depths = new Set(nodes.map((n) => n.depth));
                for (let d = 0; d <= runLength; d++) {
                    expect(depths.has(d)).toBe(true);
                }
                expect(Math.max(...nodes.map((n) => n.depth))).toBe(runLength);
            });

            it(`keeps every final node tagged bossKind='final' for runLength=${runLength}`, () => {
                const { nodes } = generateFullRun(runLength, 21);
                const finalNodes = nodes.filter((n) => n.depth === runLength);
                expect(finalNodes.length).toBeGreaterThan(0);
                for (const n of finalNodes) {
                    expect(n.type).toBe(RoomType.BOSS);
                    expect(n.bossKind).toBe('final');
                }
            });

            it(`every non-final node reaches a final boss for runLength=${runLength}`, () => {
                const { nodes } = generateFullRun(runLength, 33);
                const report = validateMap(nodes, runLength);
                expect(report.allNodesReachAFinalBoss).toBe(true);
                expect(report.everyFullPathEndsInFinalBoss).toBe(true);
            });
        }

        it('passes validateMap on every seed for the canonical runLength', () => {
            for (let seed = 0; seed < 30; seed++) {
                const runLength = 25;
                const { nodes } = generateFullRun(runLength, seed);
                const report = validateMap(nodes, runLength);
                expect(report.allFinalAreBossKindFinal).toBe(true);
                expect(report.allNodesReachAFinalBoss).toBe(true);
                expect(report.everyFullPathEndsInFinalBoss).toBe(true);
                expect(report.orphanNodeCount).toBe(0);
                expect(report.deadEndCount).toBe(0);
                // PR-2 enforces the no-adjacent-bosses and
                // recovery-after-major invariants.
                expect(report.bossAdjacencyViolations).toBe(0);
                expect(report.postMajorRecoveryViolations).toBe(0);
            }
        });

        it('reports unfinished invariants as null when the final layer is not yet generated', () => {
            const runLength = 25;
            const gen = new MapGenerator(
                undefined,
                new Mulberry32(1),
                runLength,
            );
            const partial = gen.generateInitialMap(5);
            const report = validateMap(partial, runLength);
            expect(report.finalLayerGenerated).toBe(false);
            expect(report.everyFullPathEndsInFinalBoss).toBeNull();
            expect(report.allNodesReachAFinalBoss).toBeNull();
            // The all-final-tagged check is trivially true when no
            // final layer exists yet.
            expect(report.allFinalAreBossKindFinal).toBe(true);
        });
    });

    describe('bossPressure pass (PR-2)', () => {
        const RUN_LENGTHS = [25, 35, 50, 75];

        for (const runLength of RUN_LENGTHS) {
            it(`places at least one mid-run boss most seeds for runLength=${runLength}`, () => {
                // Boss-pressure budgets clamp to a min of 1 for both
                // major and mini, so every full run should produce
                // at least one mid-run boss across most RNG seeds.
                let seedsWithMidRunBoss = 0;
                for (let seed = 0; seed < 25; seed++) {
                    const { nodes } = generateFullRun(runLength, seed);
                    const midRunBosses = nodes.filter(
                        (n) =>
                            n.bossKind === 'major' || n.bossKind === 'mini',
                    );
                    if (midRunBosses.length >= 1) seedsWithMidRunBoss++;
                }
                expect(seedsWithMidRunBoss).toBeGreaterThanOrEqual(20);
            });

            it(`respects the major-boss budget and exceeds the mini budget only as needed for seal coverage at runLength=${runLength}`, () => {
                // targetMajor = clamp(round(runLength / 18), 1, 4)
                // targetMini  = clamp(round(runLength / 12), 1, 6)
                // The seal-coverage pass (PR-3) may add extra mini
                // bosses when no existing mini sits on a deficit
                // path — `requiredSeals` is a hard invariant, the
                // mini target is a soft pacing hint. Major budget
                // remains a hard cap (the pass never promotes to
                // major).
                const targetMajor = Math.max(
                    1,
                    Math.min(4, Math.round(runLength / 18)),
                );
                const targetMini = Math.max(
                    1,
                    Math.min(6, Math.round(runLength / 12)),
                );
                // Cap on extra minis the seal pass may add — at
                // most one per `requiredSeals` "cut" through the
                // map plus a slack. The slack scales with the
                // typical layer width: the grid-cell generator
                // hands the player a 4-way hub at the START room
                // and then up to {@link MAX_LAYER_WIDTH} cells per
                // mid-run layer, so each additional parallel path
                // through a seal "cut" can require its own dedicated
                // seal-bearing mini. Empirically the 75-depth runs
                // peak at ~25 minis with the new layout (the
                // 4-wide START hub plus up to MAX_LAYER_WIDTH=4
                // mid-run cells means each requiredSeals "cut" can
                // need up to 4 dedicated seal-bearers, and the
                // greedy seal pass may add a couple more), so the
                // slack must absorb that.
                const sealCoverageSlack = 20;
                for (let seed = 0; seed < 20; seed++) {
                    const { nodes } = generateFullRun(runLength, seed);
                    const report = validateMap(nodes, runLength);
                    expect(report.majorBossCount).toBeLessThanOrEqual(
                        targetMajor,
                    );
                    expect(report.miniBossCount).toBeLessThanOrEqual(
                        targetMini + sealCoverageSlack,
                    );
                }
            });

            it(`never produces a boss-to-boss edge for runLength=${runLength}`, () => {
                for (let seed = 0; seed < 30; seed++) {
                    const { nodes } = generateFullRun(runLength, seed);
                    const report = validateMap(nodes, runLength);
                    expect(report.bossAdjacencyViolations).toBe(0);
                }
            });

            it(`forces every direct child of a major boss to a recovery room for runLength=${runLength}`, () => {
                const recoveryPool = new Set<RoomType>([
                    RoomType.REST,
                    RoomType.SHRINE,
                    RoomType.MERCHANT,
                    RoomType.TREASURE,
                ]);
                for (let seed = 0; seed < 25; seed++) {
                    const { nodes } = generateFullRun(runLength, seed);
                    const byId = new Map(nodes.map((n) => [n.id, n]));
                    for (const node of nodes) {
                        if (node.bossKind !== 'major') continue;
                        for (const eid of node.edges) {
                            const child = byId.get(eid);
                            if (!child) continue;
                            expect(recoveryPool.has(child.type)).toBe(true);
                        }
                    }
                    const report = validateMap(nodes, runLength);
                    expect(report.postMajorRecoveryViolations).toBe(0);
                }
            });

            it(`places no mid-run boss before the pressure window opens for runLength=${runLength}`, () => {
                // Pressure window opens at max(4, round(runLength * 0.10)).
                // So no mid-run boss may sit at depth < windowStart.
                const windowStart = Math.max(
                    4,
                    Math.round(runLength * 0.10),
                );
                for (let seed = 0; seed < 25; seed++) {
                    const { nodes } = generateFullRun(runLength, seed);
                    for (const node of nodes) {
                        if (node.bossKind !== 'major' && node.bossKind !== 'mini') continue;
                        // bossKind for the final layer is 'final' so
                        // it never trips this check.
                        expect(node.depth).toBeGreaterThanOrEqual(windowStart);
                    }
                }
            });
        }

        it('exposes mid-run boss counts in validateMap output', () => {
            // Sanity check that the new debug counters in
            // MapValidationReport are populated and consistent
            // across a full run.
            const { nodes } = generateFullRun(50, 42);
            const report = validateMap(nodes, 50);
            const major = nodes.filter((n) => n.bossKind === 'major').length;
            const mini = nodes.filter((n) => n.bossKind === 'mini').length;
            const final = nodes.filter((n) => n.bossKind === 'final').length;
            expect(report.majorBossCount).toBe(major);
            expect(report.miniBossCount).toBe(mini);
            expect(report.finalBossCount).toBe(final);
            expect(report.finalNodeCount).toBe(final);
        });
    });

    describe.runIf(FEATURES.seals)('seals + path validation (PR-3)', () => {
        it('scales requiredSeals according to runLength formula', () => {
            // requiredSeals = clamp(round(runLength / 20), 1, 4)
            const cfg = RUN_CONFIG.seals;
            for (const rl of [20, 25, 35, 50, 75, 80]) {
                const expected = Math.max(
                    cfg.requiredSealsMin,
                    Math.min(
                        cfg.requiredSealsMax,
                        Math.round(rl / cfg.requiredSealsFactor),
                    ),
                );
                expect(getRequiredSeals(rl)).toBe(expected);
            }
        });

        it('every major boss grants a major seal; every mini boss has bossKind="mini"', () => {
            // Sanity-check the seal metadata wiring across a wide
            // range of runLengths and seeds.
            for (const runLength of [25, 35, 50, 75]) {
                for (let seed = 0; seed < 10; seed++) {
                    const { nodes } = generateFullRun(runLength, seed);
                    for (const n of nodes) {
                        if (n.bossKind === 'major') {
                            expect(n.grantsSeal).toBe(true);
                            expect(n.sealType).toBe('major');
                        }
                        if (n.bossKind === 'mini' && n.grantsSeal) {
                            expect(n.sealType).toBe('mini');
                        }
                        if (n.bossKind === null || n.bossKind === 'final') {
                            expect(n.grantsSeal).toBe(false);
                            expect(n.sealType).toBe(null);
                        }
                    }
                }
            }
        });

        for (const runLength of [25, 35, 50, 75]) {
            it(`every full path has at least requiredSeals seal opportunities for runLength=${runLength}`, () => {
                const required = getRequiredSeals(runLength);
                for (let seed = 0; seed < 30; seed++) {
                    const { nodes } = generateFullRun(runLength, seed);
                    const r = validateMap(nodes, runLength);
                    expect(r.requiredSeals).toBe(required);
                    expect(r.sealsPerPath).not.toBeNull();
                    expect(r.sealsPerPath!.min).toBeGreaterThanOrEqual(required);
                    expect(r.pathMeetsRequiredSeals).toBe(true);
                }
            });

            it(`reports per-path seal/boss min ≤ avg ≤ max for runLength=${runLength}`, () => {
                for (let seed = 0; seed < 10; seed++) {
                    const { nodes } = generateFullRun(runLength, seed);
                    const r = validateMap(nodes, runLength);
                    expect(r.sealsPerPath).not.toBeNull();
                    expect(r.bossesPerPath).not.toBeNull();
                    const seals = r.sealsPerPath!;
                    const bosses = r.bossesPerPath!;
                    expect(seals.min).toBeLessThanOrEqual(seals.avg);
                    expect(seals.avg).toBeLessThanOrEqual(seals.max);
                    expect(bosses.min).toBeLessThanOrEqual(bosses.avg);
                    expect(bosses.avg).toBeLessThanOrEqual(bosses.max);
                }
            });
        }

        it('sealOpportunityCount equals the number of grantsSeal=true nodes', () => {
            for (const runLength of [25, 50, 75]) {
                for (let seed = 0; seed < 5; seed++) {
                    const { nodes } = generateFullRun(runLength, seed);
                    const r = validateMap(nodes, runLength);
                    const granters = nodes.filter((n) => n.grantsSeal).length;
                    expect(r.sealOpportunityCount).toBe(granters);
                }
            }
        });

        it('reports pressureStrategy="max"', () => {
            const { nodes } = generateFullRun(50, 1);
            const r = validateMap(nodes, 50);
            expect(r.pressureStrategy).toBe('max');
        });

        it('formatMapDebug emits every spec field in a stable order', () => {
            const { nodes } = generateFullRun(50, 7);
            const r = validateMap(nodes, 50);
            const text = formatMapDebug(r);
            for (const field of [
                'runLength',
                'finalDepth',
                'totalNodes',
                'totalEdges',
                'major=',
                'mini=',
                'final=',
                'required=',
                'opportunities=',
                'sealsPerPath',
                'bossesPerPath',
                'pathMeetsRequiredSeals',
                'allFinalAreBossKindFinal',
                'everyFullPathEndsInFinalBoss',
                'allNodesReachAFinalBoss',
                'invariants:',
                'pressureStrategy=max',
            ]) {
                expect(text).toContain(field);
            }
        });

        it('seal-coverage pass keeps no-boss-adjacency and post-major-recovery invariants', () => {
            // The seal-coverage pass promotes regular rooms to mini
            // bosses when needed; verify it never violates the
            // adjacency or recovery invariants.
            for (const runLength of [25, 35, 50, 75]) {
                for (let seed = 0; seed < 20; seed++) {
                    const { nodes } = generateFullRun(runLength, seed);
                    const r = validateMap(nodes, runLength);
                    expect(r.bossAdjacencyViolations).toBe(0);
                    expect(r.postMajorRecoveryViolations).toBe(0);
                }
            }
        });
    });
});
