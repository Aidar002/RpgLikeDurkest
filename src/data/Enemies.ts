import { ENEMY_TIERS, BOSSES } from './GameConfig';
import type { EnemyDef } from './GameConfig';

export type { EnemyDef };

export function getEnemyForDepth(depth: number): EnemyDef {
    const tier = [...ENEMY_TIERS].reverse().find(t => depth >= t.minDepth)!;
    const pool = tier.pool;
    return pool[Math.floor(Math.random() * pool.length)];
}

export function getBossForDepth(depth: number): EnemyDef {
    const match = [...BOSSES].reverse().find(b => depth >= b.depth);
    return match ? match.def : BOSSES[0].def;
}
