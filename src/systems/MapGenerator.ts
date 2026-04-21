export const RoomType = {
    START: 'START',
    ENEMY: 'ENEMY',
    TREASURE: 'TREASURE',
    TRAP: 'TRAP',
    REST: 'REST',
    BOSS: 'BOSS',
    EMPTY: 'EMPTY'
} as const;

export type RoomType = (typeof RoomType)[keyof typeof RoomType];

export interface MapNode {
    id: string;
    depth: number;   // column index, increases going forward
    slot: number;    // row within column
    type: RoomType;
    visited: boolean;
    cleared: boolean; // player has left this room behind
    edges: string[]; // ids of nodes at depth+1 this connects to
}

export class MapGenerator {
    private counter = 0;

    generateInitialMap(lookahead: number = 4): MapNode[] {
        const all: MapNode[] = [];
        const start = this.makeNode(0, 0, RoomType.START);
        start.visited = true;
        all.push(start);

        let prev = [start];
        for (let d = 1; d <= lookahead; d++) {
            prev = this.buildLayer(d, prev, all);
        }
        return all;
    }

    // Appends a new layer at fromDepth+1, connecting from nodes at fromDepth
    generateNextLayer(allNodes: MapNode[], fromDepth: number): MapNode[] {
        const prevLayer = allNodes.filter(n => n.depth === fromDepth);
        return this.buildLayer(fromDepth + 1, prevLayer, allNodes);
    }

    private buildLayer(depth: number, prevLayer: MapNode[], all: MapNode[]): MapNode[] {
        const isBossDepth = depth > 0 && depth % 8 === 0;
        const count = isBossDepth ? 1 : (Math.random() < 0.4 ? 1 : 2);
        const newLayer: MapNode[] = [];

        for (let slot = 0; slot < count; slot++) {
            const type = isBossDepth ? RoomType.BOSS : this.randomType();
            const node = this.makeNode(depth, slot, type);
            all.push(node);
            newLayer.push(node);
        }

        // connect prev -> new
        prevLayer.forEach(prev => {
            const targets = newLayer.filter(() => Math.random() > 0.35);
            const chosen = targets.length ? targets : [newLayer[0]];
            chosen.forEach(t => {
                if (!prev.edges.includes(t.id)) prev.edges.push(t.id);
            });
        });

        // every new node must have at least one parent
        newLayer.forEach(n => {
            const hasParent = prevLayer.some(p => p.edges.includes(n.id));
            if (!hasParent) {
                const p = prevLayer[Math.floor(Math.random() * prevLayer.length)];
                if (!p.edges.includes(n.id)) p.edges.push(n.id);
            }
        });

        return newLayer;
    }

    private makeNode(depth: number, slot: number, type: RoomType): MapNode {
        return { id: `n${this.counter++}`, depth, slot, type, visited: false, cleared: false, edges: [] };
    }

    private randomType(): RoomType {
        const r = Math.random();
        if (r < 0.45) return RoomType.ENEMY;
        if (r < 0.60) return RoomType.EMPTY;
        if (r < 0.72) return RoomType.TREASURE;
        if (r < 0.84) return RoomType.TRAP;
        return RoomType.REST;
    }
}
