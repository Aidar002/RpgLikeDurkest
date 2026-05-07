export interface EnemyTextConfig {
    name: string;
    description: string;
}

// Russian enemy names and combat-card descriptions.
// Keys must match enemy `name` values in GameConfig.ts exactly.
export const RU_ENEMY_TEXT: Record<string, EnemyTextConfig> = {
    'Rat': {
        name: 'Крыса',
        description: 'Мелкая тварь. Иногда бросается резче обычного.',
    },
    'Slime': {
        name: 'Слизень',
        description: 'Едкая масса. Жалит в ответ на удар.',
    },
    'Skeleton': {
        name: 'Скелет',
        description: 'Голые кости. Иногда удар проходит мимо.',
    },
    'Bat': {
        name: 'Летучая мышь',
        description: 'Пещерный летун. Пикирует после подготовки.',
    },
    'Ghoul': {
        name: 'Упырь',
        description: 'Нежить, которая гниёт прежде чем ударит.',
    },
    'Steel Lynx': {
        name: 'Стальная рысь',
        description: 'Хищник с когтями, от которых течёт кровь.',
    },
    'Skeleton Swordsman': {
        name: 'Скелет-мечник',
        description: 'Бронированный скелет без хитростей — только сталь.',
    },
    'Death Knight': {
        name: 'Рыцарь смерти',
        description: 'Бронированный мертвец, повелевающий самой смертью.',
    },
};
