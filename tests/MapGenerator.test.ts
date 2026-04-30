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
});
