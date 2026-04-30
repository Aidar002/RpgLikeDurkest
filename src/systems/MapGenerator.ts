import { MAP_CONFIG } from '../data/GameConfig';

export const RoomType = {
    START: 'START',
    ENEMY: 'ENEMY',
    TREASURE: 'TREASURE',
    TRAP: 'TRAP',
    REST: 'REST',
    SHRINE: 'SHRINE',
    MERCHANT: 'MERCHANT',
    ELITE: 'ELITE',
    BOSS: 'BOSS',
    EMPTY: 'EMPTY',
} as const;

export type RoomType = (typeof RoomType)[keyof typeof RoomType];

export interface MapNode {
    id: string;
    depth: number;
    slot: number;
    type: RoomType;
    visited: boolean;
    cleared: boolean;
    edges: string[];
}

const BASE_ROOM_POOL: RoomType[] = [
    RoomType.ENEMY,
    RoomType.EMPTY,
    RoomType.REST,
    RoomType.TREASURE,
];

const PREP_ROOM_POOL: RoomType[] = [RoomType.REST, RoomType.SHRINE, RoomType.MERCHANT];

export class MapGenerator {
    private counter = 0;
    private availableRooms = new Set<RoomType>(BASE_ROOM_POOL);

    constructor(initialRooms: RoomType[] = BASE_ROOM_POOL) {
        this.setAvailableRoomTypes(initialRooms);
    }

    setAvailableRoomTypes(roomTypes: RoomType[]) {
        this.availableRooms = new Set(roomTypes.filter((type) => type !== RoomType.START && type !== RoomType.BOSS));
        BASE_ROOM_POOL.forEach((type) => this.availableRooms.add(type));
    }

    generateInitialMap(lookahead: number = MAP_CONFIG.initialLookahead): MapNode[] {
        const all: MapNode[] = [];
        const start = this.makeNode(0, 0, RoomType.START);
        start.visited = true;
        all.push(start);

        let previousLayer = [start];
        for (let depth = 1; depth <= lookahead; depth++) {
            previousLayer = this.buildLayer(depth, previousLayer, all);
        }

        return all;
    }

    generateNextLayer(allNodes: MapNode[], fromDepth: number): MapNode[] {
        const previousLayer = allNodes.filter((node) => node.depth === fromDepth);
        return this.buildLayer(fromDepth + 1, previousLayer, [...allNodes]);
    }

    private buildLayer(depth: number, previousLayer: MapNode[], allNodes: MapNode[]): MapNode[] {
        const isBossDepth = depth > 0 && depth % MAP_CONFIG.bossEveryNDepths === 0;
        const branchRoll = Math.random();
        const count = isBossDepth
            ? 1
            : branchRoll < MAP_CONFIG.branchRolls.one
              ? 1
              : branchRoll < MAP_CONFIG.branchRolls.one + MAP_CONFIG.branchRolls.two
                ? 2
                : 3;
        const newLayer: MapNode[] = [];

        for (let slot = 0; slot < count; slot++) {
            const type = isBossDepth ? RoomType.BOSS : this.pickRoomType(depth, allNodes, newLayer);
            const node = this.makeNode(depth, slot, type);
            allNodes.push(node);
            newLayer.push(node);
        }

        previousLayer.forEach((previousNode, index) => {
            const anchorIndex =
                previousLayer.length === 1
                    ? Math.floor((newLayer.length - 1) / 2)
                    : Math.round((index / (previousLayer.length - 1)) * (newLayer.length - 1));
            const chosenTargets = [newLayer[anchorIndex]];

            if (newLayer.length > 1 && Math.random() < MAP_CONFIG.edgeProbability) {
                const side = index % 2 === 0 ? 1 : -1;
                const neighbor = newLayer[Math.max(0, Math.min(newLayer.length - 1, anchorIndex + side))];
                if (!chosenTargets.includes(neighbor)) {
                    chosenTargets.push(neighbor);
                }
            }

            chosenTargets.forEach((target) => {
                if (!previousNode.edges.includes(target.id)) {
                    previousNode.edges.push(target.id);
                }
            });
        });

        newLayer.forEach((node) => {
            const hasParent = previousLayer.some((previousNode) => previousNode.edges.includes(node.id));
            if (!hasParent) {
                const parent = previousLayer[Math.floor(Math.random() * previousLayer.length)];
                if (!parent.edges.includes(node.id)) {
                    parent.edges.push(node.id);
                }
            }
        });

        return newLayer;
    }

    private pickRoomType(depth: number, allNodes: MapNode[], pendingNodes: MapNode[]): RoomType {
        const forcedType = this.getForcedRoomType(depth, allNodes, pendingNodes);
        if (forcedType) {
            return forcedType;
        }

        const allowedRooms = this.getAllowedRoomTypes(depth);
        return this.pickWeightedRoom(allowedRooms);
    }

    private getAllowedRoomTypes(depth: number): RoomType[] {
        const depthRestrictedPool =
            depth <= MAP_CONFIG.safeDepths
                ? BASE_ROOM_POOL
                : [
                      RoomType.ENEMY,
                      RoomType.EMPTY,
                      RoomType.TREASURE,
                      RoomType.TRAP,
                      RoomType.REST,
                      RoomType.SHRINE,
                      RoomType.MERCHANT,
                      RoomType.ELITE,
                  ];

        const allowed = depthRestrictedPool.filter((type) => this.availableRooms.has(type));
        return allowed.length > 0 ? allowed : BASE_ROOM_POOL;
    }

    private getForcedRoomType(depth: number, allNodes: MapNode[], pendingNodes: MapNode[]): RoomType | null {
        const bossDepth = this.getUpcomingBossDepth(depth);
        if (bossDepth === null || depth !== bossDepth - 1) {
            return null;
        }

        const eliteWindowStart = bossDepth - 3;
        const prepWindowStart = bossDepth - 2;
        const fullSet = [...allNodes, ...pendingNodes];

        const hasEliteInWindow = fullSet.some(
            (node) =>
                node.depth >= eliteWindowStart &&
                node.depth < bossDepth &&
                node.type === RoomType.ELITE
        );

        if (this.availableRooms.has(RoomType.ELITE) && !hasEliteInWindow) {
            return RoomType.ELITE;
        }

        const availablePrepRooms = PREP_ROOM_POOL.filter((type) => this.availableRooms.has(type));
        const hasPrepInWindow = fullSet.some(
            (node) =>
                node.depth >= prepWindowStart &&
                node.depth < bossDepth &&
                availablePrepRooms.includes(node.type)
        );

        if (availablePrepRooms.length > 0 && !hasPrepInWindow) {
            return this.pickWeightedRoom(availablePrepRooms);
        }

        return null;
    }

    private getUpcomingBossDepth(depth: number): number | null {
        if (depth <= 0) {
            return null;
        }

        return Math.ceil(depth / MAP_CONFIG.bossEveryNDepths) * MAP_CONFIG.bossEveryNDepths;
    }

    private pickWeightedRoom(pool: RoomType[]): RoomType {
        if (pool.length === 0) {
            throw new Error('pickWeightedRoom called with empty pool');
        }
        const totalWeight = pool.reduce((sum, type) => sum + this.getWeight(type), 0);
        const roll = Math.random() * totalWeight;
        let cursor = 0;

        for (const type of pool) {
            cursor += this.getWeight(type);
            if (roll <= cursor) {
                return type;
            }
        }

        return pool[pool.length - 1];
    }

    private getWeight(type: RoomType): number {
        const weights: Partial<Record<RoomType, number>> = MAP_CONFIG.roomTypeWeights;
        return weights[type] ?? 0;
    }

    private makeNode(depth: number, slot: number, type: RoomType): MapNode {
        return {
            id: `n${this.counter++}`,
            depth,
            slot,
            type,
            visited: false,
            cleared: false,
            edges: [],
        };
    }
}
