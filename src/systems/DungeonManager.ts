import type { MapNode } from './MapGenerator';
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

    constructor(
        nodes: MapNode[],
        onMove: (node: MapNode, prev: MapNode) => void,
        onNeedNodes: (fromDepth: number) => void
    ) {
        this.nodes = nodes;
        this.onMove = onMove;
        this.onNeedNodes = onNeedNodes;

        const start = nodes.find(n => n.depth === 0)!;
        this.currentNode = start;
        start.visited = true;
        this.ensureMinimumChoices();
    }

    addNodes(newNodes: MapNode[]) {
        this.nodes.push(...newNodes);
    }

    getAllNodes(): MapNode[] {
        return this.nodes;
    }

    // nodes reachable from current position (forward only)
    getForwardNodes(): MapNode[] {
        return this.currentNode.edges
            .map(id => this.nodes.find(n => n.id === id)!)
            .filter(Boolean);
    }

    getMaxDepth(): number {
        return Math.max(...this.nodes.map(n => n.depth));
    }

    canMoveTo(nodeId: string): boolean {
        return this.currentNode.edges.includes(nodeId);
    }

    moveTo(nodeId: string) {
        if (!this.canMoveTo(nodeId)) return;
        const target = this.nodes.find(n => n.id === nodeId);
        if (!target) return;

        const prev = this.currentNode;
        // Mark prev and everything before as cleared (no going back)
        this.nodes
            .filter(n => n.depth <= prev.depth)
            .forEach(n => { n.cleared = true; });

        this.currentNode = target;
        this.currentNode.visited = true;
        this.currentDepth = target.depth;

        // generate more if lookahead is thin
        if (this.getMaxDepth() - this.currentDepth < this.lookahead) {
            this.onNeedNodes(this.getMaxDepth());
        }

        this.ensureMinimumChoices();

        this.onMove(target, prev);
    }

    /**
     * Guarantee the player always has at least 2 forward rooms to
     * choose from. If the current node has fewer than 2 forward
     * edges, pick the closest unconnected node at the next depth
     * and wire it up. This prevents long single-path corridors
     * without violating map-generation invariants.
     */
    private ensureMinimumChoices(): void {
        const nextDepth = this.currentDepth + 1;
        const forwardEdges = this.currentNode.edges.filter(id => {
            const n = this.nodes.find(node => node.id === id);
            return n != null && n.depth === nextDepth;
        });

        if (forwardEdges.length >= 2) return;

        const connectedIds = new Set(this.currentNode.edges);
        const candidates = this.nodes
            .filter(n => n.depth === nextDepth && !connectedIds.has(n.id))
            .sort((a, b) => {
                const da = (a.x - this.currentNode.x) ** 2 + (a.y - this.currentNode.y) ** 2;
                const db = (b.x - this.currentNode.x) ** 2 + (b.y - this.currentNode.y) ** 2;
                return da - db;
            });

        const need = 2 - forwardEdges.length;
        for (let i = 0; i < need && i < candidates.length; i++) {
            this.currentNode.edges.push(candidates[i].id);
        }
    }
}
