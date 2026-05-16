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
    'Bee-Butterfly': {
        name: 'тест_имя_bee_butterfly',
        description: 'тест_описание_bee_butterfly',
    },
    'Giant Toad': {
        name: 'тест_имя_giant_toad',
        description: 'тест_описание_giant_toad',
    },
    'Rat Matron': {
        name: 'тест_имя_rat_matron',
        description: 'тест_описание_rat_matron',
    },
    'Gelatinous Cube': {
        name: 'тест_имя_gelatinous_cube',
        description: 'тест_описание_gelatinous_cube',
    },
    'Earth Elemental': {
        name: 'тест_имя_earth_elemental',
        description: 'тест_описание_earth_elemental',
    },
    'Steel Lynx': {
        name: 'тест_имя_steel_lynx',
        description: 'тест_описание_steel_lynx',
    },
    Vampire: {
        name: 'тест_имя_vampire',
        description: 'тест_описание_vampire',
    },
    Demon: {
        name: 'тест_имя_demon',
        description: 'тест_описание_demon',
    },
    'Goblin Horde': {
        name: 'тест_имя_goblin_horde',
        description: 'тест_описание_goblin_horde',
    },
    'Underground Ent': {
        name: 'тест_имя_underground_ent',
        description: 'тест_описание_underground_ent',
    },
    'Skeleton Swordsman': {
        name: 'тест_имя_skeleton_swordsman',
        description: 'тест_описание_skeleton_swordsman',
    },
    Lich: {
        name: 'тест_имя_lich',
        description: 'тест_описание_lich',
    },
    Succubus: {
        name: 'тест_имя_succubus',
        description: 'тест_описание_succubus',
    },
    'Lost Adventurer': {
        name: 'тест_имя_lost_adventurer',
        description: 'тест_описание_lost_adventurer',
    },
    'Death Knight': {
        name: 'тест_имя_death_knight',
        description: 'тест_описание_death_knight',
    },
    Prophet: {
        name: 'тест_имя_prophet',
        description: 'тест_описание_prophet',
    },
    Mammon: {
        name: 'тест_имя_mammon',
        description: 'тест_описание_mammon',
    },
    Nimrod: {
        name: 'тест_имя_nimrod',
        description: 'тест_описание_nimrod',
    },
    Mime: {
        name: 'тест_имя_mime',
        description: 'тест_описание_mime',
    },
    Gilgamesh: {
        name: 'тест_имя_gilgamesh',
        description: 'тест_описание_gilgamesh',
    },
};
