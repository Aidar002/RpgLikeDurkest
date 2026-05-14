// Pure type definitions for the dungeon graph. Lives in `data/`
// (no imports from `systems/`/`ui/`/`scenes/`) so the `ui/` and
// `data/` layers can refer to room kinds without depending on the
// generator implementation.
//
// Re-exported from `systems/MapGenerator.ts` for back-compat with
// existing import paths — new code should import directly from here.

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
    /**
     * Branch-guardian / mid-run threat. Placed by the bossPressure
     * pass when a branch's `stepsSinceBoss` enters the pressure
     * window. Pairs with `bossKind === 'mini'`.
     */
    MINI_BOSS: 'MINI_BOSS',
    EMPTY: 'EMPTY',
} as const;

export type RoomType = (typeof RoomType)[keyof typeof RoomType];

/**
 * Tag describing what kind of boss-encounter (if any) lives in
 * a node. Set by the generator at node-creation time.
 *
 *  - `'final'` — terminal final-boss node (depth === runLength).
 *    Victory over any of these ends the run.
 *  - `'major'` — mid-run major boss.
 *  - `'mini'`  — mid-run threat / branch guardian.
 *  - `null`    — non-boss room.
 */
export type BossKind = 'final' | 'major' | 'mini' | null;

/**
 * Recovery / reward room types forced as the **direct child** of a
 * mid-run major boss (`bossKind === 'major'`). Mini-bosses do *not*
 * trigger this — only major bosses interrupt the run hard enough
 * to deserve a guaranteed catch-your-breath room afterwards.
 *
 * The generator enforces this when placing children of a major
 * (`pickRecoveryType` and `parentChildBlocked` in `MapGenerator.ts`);
 * the validator checks the same set as a post-build invariant.
 */
export const POST_MAJOR_RECOVERY_POOL: RoomType[] = [
    RoomType.REST,
    RoomType.SHRINE,
    RoomType.MERCHANT,
    RoomType.TREASURE,
];

/**
 * One room in the dungeon graph.
 *
 * The dungeon is laid out as a 2D integer grid: every node sits at
 * `(gx, gy)` and connects only to **orthogonally adjacent** cells
 * (Manhattan distance = 1). `depth` is the BFS distance from
 * START — equivalent to the cell's Manhattan distance from the
 * origin — so every forward edge is a 90° step on the grid.
 *
 * `x` / `y` are the rendered pixel coordinates
 * (`MAP_START_X + gx * GRID_CELL`, etc.). They are convenience
 * copies of the grid position scaled for the renderer; consumers
 * should use `gx`/`gy` for any topology reasoning.
 *
 * `slot` is retained for back-compat with hand-built test
 * fixtures and is no longer used for layout.
 */
export interface MapNode {
    id: string;
    depth: number;
    slot: number;
    /** Integer grid X coordinate (cells). */
    gx: number;
    /** Integer grid Y coordinate (cells). */
    gy: number;
    /** Container-local x position (px). Always `MAP_START_X + gx * GRID_CELL`. */
    x: number;
    /** Container-local y position (px). Always `MAP_START_Y + gy * GRID_CELL`. */
    y: number;
    type: RoomType;
    bossKind: BossKind;
    visited: boolean;
    cleared: boolean;
    edges: string[];
}
