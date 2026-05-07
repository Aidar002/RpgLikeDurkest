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

        this.onMove(target, prev);
    }
}
