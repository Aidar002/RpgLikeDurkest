export enum RoomType {
    START = 'START',
    ENEMY = 'ENEMY',
    TREASURE = 'TREASURE',
    TRAP = 'TRAP',
    REST = 'REST',
    BOSS = 'BOSS',
    EMPTY = 'EMPTY'
}

export interface MapNode {
    id: string;
    x: number; // grid x
    y: number; // grid y
    type: RoomType;
    visited: boolean;
    edges: string[]; // connected node ids
}

export class MapGenerator {
    // Generates a simple grid-based graph
    generateGraph(nodeCount: number): MapNode[] {
        const nodes: MapNode[] = [];
        const grid: { [key: string]: MapNode } = {};

        const addNode = (x: number, y: number, type: RoomType): MapNode => {
            const id = `${x},${y}`;
            const node: MapNode = { id, x, y, type, visited: false, edges: [] };
            nodes.push(node);
            grid[id] = node;
            return node;
        };

        const connect = (n1: MapNode, n2: MapNode) => {
            if (!n1.edges.includes(n2.id)) n1.edges.push(n2.id);
            if (!n2.edges.includes(n1.id)) n2.edges.push(n1.id);
        };

        // Start node at 0,0
        let current = addNode(0, 0, RoomType.START);

        const dirs = [
            { dx: 1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: -1, dy: 0 },
            { dx: 0, dy: -1 }
        ];

        // Random walk to generate nodes
        let x = 0;
        let y = 0;
        
        for (let i = 1; i < nodeCount; i++) {
            // Pick a random direction
            let placed = false;
            let attempts = 0;
            
            while (!placed && attempts < 10) {
                const dir = dirs[Math.floor(Math.random() * dirs.length)];
                const nx = x + dir.dx;
                const ny = y + dir.dy;
                const nid = `${nx},${ny}`;
                
                if (!grid[nid]) {
                    // Create node
                    const isLast = i === nodeCount - 1;
                    const type = isLast ? RoomType.BOSS : this.getRandomRoomType();
                    const newNode = addNode(nx, ny, type);
                    connect(current, newNode);
                    x = nx;
                    y = ny;
                    current = newNode;
                    placed = true;
                } else {
                    // Node exists, just connect and move there (creates loops sometimes)
                    if (Math.random() > 0.5) {
                        connect(current, grid[nid]);
                    }
                    x = nx;
                    y = ny;
                    current = grid[nid];
                    attempts++;
                }
            }
        }

        return nodes;
    }

    private getRandomRoomType(): RoomType {
        const r = Math.random();
        if (r < 0.5) return RoomType.ENEMY; // 50% enemy
        if (r < 0.7) return RoomType.EMPTY; // 20% empty
        if (r < 0.8) return RoomType.TREASURE; // 10% treasure
        if (r < 0.9) return RoomType.TRAP; // 10% trap
        return RoomType.REST; // 10% rest
    }
}
