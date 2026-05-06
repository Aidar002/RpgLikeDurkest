/**
 * Coverage for the dungeon traversal state machine: position
 * tracking, movement validation (forward-only edges), cleared-room
 * marking, and the lookahead callback that asks the host scene for
 * more nodes when the buffer runs thin.
 */
import { describe, expect, it, vi } from 'vitest';

import { MAP_CONFIG } from '../src/data/GameConfig';
import { DungeonManager } from '../src/systems/DungeonManager';
import { RoomType, type MapNode } from '../src/systems/MapGenerator';

/**
 * Build a small linear graph: 0 → 1 → 2 → ... → (depth-1). Each
 * depth has a single slot=0 node with a single forward edge to the
 * next id. Returns the node array in canonical order.
 */
function makeLinearGraph(depth: number): MapNode[] {
    const nodes: MapNode[] = [];
    for (let i = 0; i < depth; i++) {
        nodes.push({
            id: `n${i}`,
            depth: i,
            slot: 0,
            x: i * 180,
            y: 0,
            type: i === 0 ? RoomType.START : RoomType.ENEMY,
            visited: false,
            cleared: false,
            edges: i < depth - 1 ? [`n${i + 1}`] : [],
        });
    }
    return nodes;
}

/**
 * Build a wide graph at depth 1 — START at depth 0 with edges to
 * three siblings at depth 1, none of which connect onward. Useful
 * for testing forward-edge enumeration and slot ordering.
 */
function makeForkedGraph(): MapNode[] {
    return [
        {
            id: 'start',
            depth: 0,
            slot: 0,
            x: 0,
            y: 0,
            type: RoomType.START,
            visited: false,
            cleared: false,
            edges: ['a', 'b', 'c'],
        },
        {
            id: 'a',
            depth: 1,
            slot: -1,
            x: 180,
            y: -140,
            type: RoomType.ENEMY,
            visited: false,
            cleared: false,
            edges: [],
        },
        {
            id: 'b',
            depth: 1,
            slot: 0,
            x: 180,
            y: 0,
            type: RoomType.TREASURE,
            visited: false,
            cleared: false,
            edges: [],
        },
        {
            id: 'c',
            depth: 1,
            slot: 1,
            x: 180,
            y: 140,
            type: RoomType.REST,
            visited: false,
            cleared: false,
            edges: [],
        },
    ];
}

describe('DungeonManager — construction', () => {
    it('starts at the depth-0 node and marks it visited', () => {
        const nodes = makeLinearGraph(3);
        const dungeon = new DungeonManager(
            nodes,
            () => {},
            () => {},
        );

        expect(dungeon.currentNode.id).toBe('n0');
        expect(dungeon.currentDepth).toBe(0);
        expect(nodes[0].visited).toBe(true);
        // Other nodes start untouched.
        expect(nodes[1].visited).toBe(false);
        expect(nodes[2].visited).toBe(false);
    });

    it('exposes all initial nodes via getAllNodes()', () => {
        const nodes = makeLinearGraph(4);
        const dungeon = new DungeonManager(
            nodes,
            () => {},
            () => {},
        );

        expect(dungeon.getAllNodes()).toHaveLength(4);
        expect(dungeon.getMaxDepth()).toBe(3);
    });
});

describe('DungeonManager — movement validation', () => {
    it('canMoveTo accepts only ids in the current node\u2019s edge list', () => {
        const dungeon = new DungeonManager(
            makeForkedGraph(),
            () => {},
            () => {},
        );

        expect(dungeon.canMoveTo('a')).toBe(true);
        expect(dungeon.canMoveTo('b')).toBe(true);
        expect(dungeon.canMoveTo('c')).toBe(true);
        expect(dungeon.canMoveTo('start')).toBe(false);
        expect(dungeon.canMoveTo('does-not-exist')).toBe(false);
    });

    it('moveTo to a non-edge id is a no-op (current node unchanged)', () => {
        const onMove = vi.fn();
        const dungeon = new DungeonManager(
            makeLinearGraph(3),
            onMove,
            () => {},
        );

        dungeon.moveTo('n2'); // not adjacent to n0 in a linear graph

        expect(dungeon.currentNode.id).toBe('n0');
        expect(onMove).not.toHaveBeenCalled();
    });

    it('moveTo updates currentNode/depth, marks visited, fires onMove', () => {
        const onMove = vi.fn();
        const nodes = makeLinearGraph(3);
        const dungeon = new DungeonManager(nodes, onMove, () => {});

        dungeon.moveTo('n1');

        expect(dungeon.currentNode.id).toBe('n1');
        expect(dungeon.currentDepth).toBe(1);
        expect(nodes[1].visited).toBe(true);
        expect(onMove).toHaveBeenCalledTimes(1);
        const [target, prev] = onMove.mock.calls[0];
        expect(target.id).toBe('n1');
        expect(prev.id).toBe('n0');
    });

    it('marks every node at-or-before the previous depth as cleared', () => {
        const nodes = makeLinearGraph(4);
        const dungeon = new DungeonManager(
            nodes,
            () => {},
            () => {},
        );

        dungeon.moveTo('n1');
        // n0 (depth 0 ≤ prev=0) should be cleared.
        expect(nodes[0].cleared).toBe(true);
        // The new current room is NOT cleared yet.
        expect(nodes[1].cleared).toBe(false);

        dungeon.moveTo('n2');
        expect(nodes[0].cleared).toBe(true);
        expect(nodes[1].cleared).toBe(true);
        expect(nodes[2].cleared).toBe(false);
    });
});

describe('DungeonManager — forward enumeration', () => {
    it('getForwardNodes returns the resolved edge nodes', () => {
        const dungeon = new DungeonManager(
            makeForkedGraph(),
            () => {},
            () => {},
        );

        const ids = dungeon.getForwardNodes().map((n) => n.id).sort();
        expect(ids).toEqual(['a', 'b', 'c']);
    });

    it('getForwardNodes is empty after moving to a leaf', () => {
        const dungeon = new DungeonManager(
            makeForkedGraph(),
            () => {},
            () => {},
        );

        dungeon.moveTo('a');
        expect(dungeon.getForwardNodes()).toEqual([]);
    });
});

describe('DungeonManager — lookahead callback', () => {
    it('fires onNeedNodes when the buffer runs thin', () => {
        const onNeed = vi.fn();
        // Linear graph just barely under the buffer: max depth 2,
        // moving to depth 1 means lookahead is 2-1=1 < buffer (3).
        const dungeon = new DungeonManager(
            makeLinearGraph(3),
            () => {},
            onNeed,
        );

        dungeon.moveTo('n1');

        // The first arg is the depth to extend from = current max depth.
        expect(onNeed).toHaveBeenCalledTimes(1);
        expect(onNeed).toHaveBeenCalledWith(2);
    });

    it('does NOT fire onNeedNodes while buffer is comfortable', () => {
        const onNeed = vi.fn();
        // Buffer is configured to lookaheadBuffer (3). Build a graph
        // that has plenty of buffer ahead so the very first move
        // doesn't trigger generation.
        const nodes = makeLinearGraph(MAP_CONFIG.lookaheadBuffer + 5);
        const dungeon = new DungeonManager(nodes, () => {}, onNeed);

        dungeon.moveTo('n1');

        expect(onNeed).not.toHaveBeenCalled();
    });

    it('addNodes appends to the live graph and bumps getMaxDepth', () => {
        const nodes = makeLinearGraph(3);
        const dungeon = new DungeonManager(
            nodes,
            () => {},
            () => {},
        );

        dungeon.addNodes([
            {
                id: 'extra',
                depth: 5,
                slot: 0,
                x: 5 * 180,
                y: 0,
                type: RoomType.ENEMY,
                visited: false,
                cleared: false,
                edges: [],
            },
        ]);

        expect(dungeon.getAllNodes()).toHaveLength(4);
        expect(dungeon.getMaxDepth()).toBe(5);
    });
});
