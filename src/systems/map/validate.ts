// Post-build validation for the dungeon graph. Extracted from
// `systems/MapGenerator.ts` (which got uncomfortably large).
//
// `MapGenerator.ts` re-exports `validateMap`, `formatMapDebug`, and
// `MapValidationReport` from this module for back-compat with
// existing import paths.

import { POST_MAJOR_RECOVERY_POOL, type MapNode, RoomType } from '../../data/MapTypes';

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
    bossesPerPath: { min: number; max: number; avg: number } | null;
    pressureStrategy: 'max';
}

export function validateMap(allNodes: readonly MapNode[], runLength: number): MapValidationReport {
    const byId = new Map(allNodes.map((n) => [n.id, n]));
    const incoming = new Map<string, number>();
    const recoveryPool = new Set<RoomType>(POST_MAJOR_RECOVERY_POOL);
    let totalEdges = 0;
    let bossAdjacencyViolations = 0;
    let postMajorRecoveryViolations = 0;
    let majorBossCount = 0;
    let miniBossCount = 0;
    let finalBossCount = 0;

    for (const node of allNodes) {
        if (node.bossKind === 'major') majorBossCount++;
        else if (node.bossKind === 'mini') miniBossCount++;
        else if (node.bossKind === 'final') finalBossCount++;
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

    const allFinalAreBossKindFinal =
        !finalLayerGenerated ||
        finalNodes.every((n) => n.bossKind === 'final' && n.type === RoomType.BOSS);

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
    let bossesPerPath: { min: number; max: number; avg: number } | null = null;
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

        allNodesReachAFinalBoss = allNodes.every((n) => ancestorsOfFinal.has(n.id));

        let endsCorrectly = true;
        for (const id of reachableFromStart) {
            const node = byId.get(id);
            if (!node) continue;
            const isLeaf = node.edges.length === 0 || node.edges.every((e) => !byId.has(e));
            if (!isLeaf) continue;
            if (node.bossKind !== 'final') {
                endsCorrectly = false;
                break;
            }
        }
        everyFullPathEndsInFinalBoss = endsCorrectly;

        if (start) {
            bossesPerPath = computePerPathStat(allNodes, byId, start, finalNodes, (n) =>
                n.bossKind !== null ? 1 : 0
            );
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
        bossesPerPath,
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
        `bossesPerPath: ${fmtStat(report.bossesPerPath)}`,
        `finalLayerGenerated=${report.finalLayerGenerated}  finalNodeCount=${report.finalNodeCount}`,
        `allFinalAreBossKindFinal=${fmtBool(report.allFinalAreBossKindFinal)}`,
        `everyFullPathEndsInFinalBoss=${fmtBool(report.everyFullPathEndsInFinalBoss)}`,
        `allNodesReachAFinalBoss=${fmtBool(report.allNodesReachAFinalBoss)}`,
        `invariants: orphans=${report.orphanNodeCount}  deadEnds=${report.deadEndCount}  bossAdjacency=${report.bossAdjacencyViolations}  postMajorRecovery=${report.postMajorRecoveryViolations}`,
        `pressureStrategy=${report.pressureStrategy}`,
    ];
    return lines.join('\n');
}

function computePerPathStat(
    allNodes: readonly MapNode[],
    byId: Map<string, MapNode>,
    start: MapNode,
    finalNodes: readonly MapNode[],
    score: (n: MapNode) => number
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
            pathsFromStart.set(child.id, (pathsFromStart.get(child.id) ?? 0) + pathsHere);
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
