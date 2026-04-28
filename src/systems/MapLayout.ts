import type { MapNode } from './MapGenerator';

export const MAP_LAYOUT = {
    colWidth: 142,
    rowHeight: 82,
    nodeSize: 44,
    originX: 150,
    originY: 210,
    viewX: 400,
    viewY: 330,
    segmentLength: 5,
    bandHeight: 210,
} as const;

export interface Point {
    x: number;
    y: number;
}

export interface EdgePath {
    points: Point[];
}

export function nodeX(node: MapNode): number {
    const row = Math.floor(node.depth / MAP_LAYOUT.segmentLength);
    const indexInRow = node.depth % MAP_LAYOUT.segmentLength;
    const serpentineIndex = row % 2 === 0 ? indexInRow : MAP_LAYOUT.segmentLength - 1 - indexInRow;
    return MAP_LAYOUT.originX + serpentineIndex * MAP_LAYOUT.colWidth;
}

export function nodeY(node: MapNode, siblingsAtDepth: number): number {
    const row = Math.floor(node.depth / MAP_LAYOUT.segmentLength);
    return MAP_LAYOUT.originY + row * MAP_LAYOUT.bandHeight + (node.slot - (siblingsAtDepth - 1) / 2) * MAP_LAYOUT.rowHeight;
}

export function mapOffset(node: MapNode, siblingsAtDepth: number): Point {
    return {
        x: MAP_LAYOUT.viewX - nodeX(node),
        y: MAP_LAYOUT.viewY - nodeY(node, siblingsAtDepth),
    };
}

export function edgePath(from: Point, to: Point, edgeIndex: number, totalEdges: number): EdgePath {
    if (Math.abs(to.x - from.x) < 8) {
        const direction = to.y >= from.y ? 1 : -1;
        const laneY = from.y + direction * (MAP_LAYOUT.nodeSize + 18 + edgeIndex * 10);
        const laneX = from.x + (edgeIndex - (totalEdges - 1) / 2) * 14;
        return {
            points: [from, { x: from.x, y: laneY }, { x: laneX, y: laneY }, { x: laneX, y: to.y }, to],
        };
    }

    const laneX = from.x + ((to.x - from.x) * (edgeIndex + 1)) / (totalEdges + 1);
    return {
        points: [from, { x: laneX, y: from.y }, { x: laneX, y: to.y }, to],
    };
}
