interface EnemyTextConfig {
    name: string;
    description: string;
}

// Russian enemy names and combat-card descriptions.
// Keys must match enemy `name` values in GameConfig.ts exactly.
//
// PLACEHOLDER COPY: every visible string is currently `тест_<key>` so each
// label in the running game maps 1:1 back to the locale slot it lives in.
// When final copy arrives, replace the right-hand side; the keys (Rat,
// Slime, …) are canonical and must NOT change because they're used for
// drop-table and boss-blueprint lookups.
export const RU_ENEMY_TEXT: Record<string, EnemyTextConfig> = {
    Rat: {
        name: 'тест_имя_rat',
        description: 'тест_описание_rat',
    },
    Slime: {
        name: 'тест_имя_slime',
        description: 'тест_описание_slime',
    },
    Skeleton: {
        name: 'тест_имя_skeleton',
        description: 'тест_описание_skeleton',
    },
    Bat: {
        name: 'тест_имя_bat',
        description: 'тест_описание_bat',
    },
    Ghoul: {
        name: 'тест_имя_ghoul',
        description: 'тест_описание_ghoul',
    },
    'Steel Lynx': {
        name: 'тест_имя_steel_lynx',
        description: 'тест_описание_steel_lynx',
    },
    'Skeleton Swordsman': {
        name: 'тест_имя_skeleton_swordsman',
        description: 'тест_описание_skeleton_swordsman',
    },
    'Death Knight': {
        name: 'тест_имя_death_knight',
        description: 'тест_описание_death_knight',
    },
};
