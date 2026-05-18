import type { MapNode } from '../data/MapTypes';
import { MAP_CONFIG } from '../data/GameConfig';

export class DungeonManager {
    public currentNode!: MapNode;
    public currentDepth = 0;

    private nodes: MapNode[];
    // called after move animations should happen; second arg is previous node
    private onMove: (node: MapNode, prev: MapNode) => void;
    // called when lookahead is running thin
    private onNeedNodes: (fromDepth: number) => void;
    private lookahead = MAP_CONFIG.lookaheadBuffer;
    // Cached max depth across `nodes`. Invalidated on every mutation
    // (`addNodes` / `moveTo` doesn't grow nodes but is no-op for the
    // cache). getMaxDepth() previously rebuilt this on every call,
    // which the lookahead-trigger code path runs at every move and
    // the map renderer spams during scrolling.
    private maxDepthCache: number | null = null;

    constructor(
        nodes: MapNode[],
        onMove: (node: MapNode, prev: MapNode) => void,
        onNeedNodes: (fromDepth: number) => void
    ) {
        this.nodes = nodes;
        this.onMove = onMove;
        this.onNeedNodes = onNeedNodes;

        const start = nodes.find((n) => n.depth === 0)!;
        this.currentNode = start;
        start.visited = true;
    }

    addNodes(newNodes: MapNode[]) {
        if (newNodes.length === 0) return;
        this.nodes.push(...newNodes);
        this.maxDepthCache = null;
    }

    getAllNodes(): MapNode[] {
        return this.nodes;
    }

    // nodes reachable from current position (forward only)
    getForwardNodes(): MapNode[] {
        return this.currentNode.edges
            .map((id) => this.nodes.find((n) => n.id === id)!)
            .filter(Boolean);
    }

    getMaxDepth(): number {
        if (this.maxDepthCache !== null) return this.maxDepthCache;
        // Defensive empty-array guard: Math.max(...[]) returns
        // -Infinity, which would silently break downstream lookahead
        // math. Real graphs always have the START node at depth 0,
        // so the floor of 0 matches the canonical "no progress yet"
        // semantic.
        if (this.nodes.length === 0) {
            this.maxDepthCache = 0;
            return 0;
        }
        let max = this.nodes[0].depth;
        for (let i = 1; i < this.nodes.length; i++) {
            const d = this.nodes[i].depth;
            if (d > max) max = d;
        }
        this.maxDepthCache = max;
        return max;
    }

    canMoveTo(nodeId: string): boolean {
        return this.currentNode.edges.includes(nodeId);
    }

    moveTo(nodeId: string) {
        if (!this.canMoveTo(nodeId)) return;
        const target = this.nodes.find((n) => n.id === nodeId);
        if (!target) return;

        const prev = this.currentNode;
        // Mark prev and everything before as cleared (no going back)
        this.nodes
            .filter((n) => n.depth <= prev.depth)
            .forEach((n) => {
                n.cleared = true;
            });

        this.currentNode = target;
        this.currentNode.visited = true;
        this.currentDepth = target.depth;

        // generate more if lookahead is thin
        if (this.getMaxDepth() - this.currentDepth < this.lookahead) {
            this.onNeedNodes(this.getMaxDepth());
        }

        this.onMove(target, prev);
    }
}
