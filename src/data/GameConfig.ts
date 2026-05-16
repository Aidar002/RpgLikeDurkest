// Barrel re-export for the legacy import path
// `src/data/GameConfig`. The actual definitions live in:
//   - {@link ./EnemyTypes}: shape of enemies / passives / prepare defs
//   - {@link ./Tuning}: PLAYER_CONFIG, COMBAT_CONFIG, RUN_CONFIG,
//     MAP_CONFIG, ROOM_CONFIG, DROP_FORMULA, LOCKPICK_CONFIG,
//     ALTAR_EFFECTS, etc. — every designer-tunable knob
//   - {@link ./EnemyTiers}: ENEMY_TIERS depth roster
//   - {@link ./Bosses}: BOSSES array + boss-phase blueprints
//
// Splitting GameConfig.ts (formerly 1144 lines) into these themed
// modules keeps each file readable on a single screen and lets
// grep / jump-to-definition land on a focused section instead of
// trawling through unrelated tables. Existing call sites that
// `import { ... } from '../data/GameConfig'` keep working — every
// export is forwarded through this barrel.

export * from './EnemyTypes';
export * from './Tuning';
export * from './EnemyTiers';
export * from './Bosses';
