import { RoomType } from './MapGenerator';
import type { MapNode } from './MapGenerator';

export class DungeonManager {
    public currentNode!: MapNode;
    public nodes: MapNode[] = [];
    private onRoomEnterCallback: (node: MapNode) => void;

    constructor(nodes: MapNode[], startNodeId: string, onRoomEnter: (node: MapNode) => void) {
        this.nodes = nodes;
        this.onRoomEnterCallback = onRoomEnter;
        const startNode = nodes.find(n => n.id === startNodeId);
        if (startNode) {
            this.currentNode = startNode;
            this.currentNode.visited = true;
        }
    }

    getConnectedNodes(): MapNode[] {
        return this.currentNode.edges.map(id => this.nodes.find(n => n.id === id) as MapNode);
    }

    canMoveTo(nodeId: string): boolean {
        return this.currentNode.edges.includes(nodeId);
    }

    moveTo(nodeId: string) {
        if (!this.canMoveTo(nodeId)) return;

        const nextNode = this.nodes.find(n => n.id === nodeId);
        if (nextNode) {
            this.currentNode = nextNode;
            this.currentNode.visited = true;
            this.onRoomEnterCallback(this.currentNode);
        }
    }
}
