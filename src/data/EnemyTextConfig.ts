export interface EnemyTextConfig {
    name: string;
    description: string;
}

// Russian enemy names and combat-card descriptions.
// Keys must match enemy `name` values in GameConfig.ts exactly.
export const RU_ENEMY_TEXT: Record<string, EnemyTextConfig> = {
    'Ash Rat': {
        name: 'Пепельная крыса',
        description: 'Мелкая и быстрая. Первой чует свежую кровь.',
    },
    'Rot Walker': {
        name: 'Гнилой ходок',
        description: 'Медленный мертвец. Падает не сразу.',
    },
    'Grave Bat': {
        name: 'Могильная летучая мышь',
        description: 'Бьет сверху и срывает лечение.',
    },
    'Fen Leech': {
        name: 'Топяная пиявка',
        description: 'Раздутая тварь. Укус снова открывает рану.',
    },
    'Crawling Vow': {
        name: 'Ползучий обет',
        description: 'Забытая молитва, которой дали зубы и лапы.',
    },
    'Bone Warden': {
        name: 'Костяной страж',
        description: 'Старая броня, старые привычки. Часто закрывается.',
    },
    'Gloom Adept': {
        name: 'Адепт мрака',
        description: 'Тянет бой и гасит фонарь.',
    },
    'Hollow Hound': {
        name: 'Полая гончая',
        description: 'Быстрая тварь. Наказывает паузы.',
    },
    'Shard Fiend': {
        name: 'Осколочный бес',
        description: 'Из каждой раны лезут костяные осколки.',
    },
    'Whispering Priest': {
        name: 'Шепчущий жрец',
        description: 'Каждая его фраза что-то у тебя отнимает.',
    },
    'Catacomb Veteran': {
        name: 'Ветеран катакомб',
        description: 'Опытный боец. Проверяет твою защиту.',
    },
    'Shade Hunter': {
        name: 'Теневой охотник',
        description: 'Особенно опасен, когда ты уже ранен.',
    },
    'Ossuary Arcanist': {
        name: 'Арканист костницы',
        description: 'Терпеливый маг. Не прощает жадности.',
    },
    'Tomb Siren': {
        name: 'Гробовая сирена',
        description: 'Песня ломает выдержку еще до первого удара.',
    },
    'Splinter Lord': {
        name: 'Владыка заноз',
        description: 'Каждая оставленная им рана расползается дальше.',
    },
    'Dread Knight': {
        name: 'Рыцарь ужаса',
        description: 'Тяжелый боец. Чем дольше бой, тем хуже.',
    },
    'Void Channeler': {
        name: 'Проводник пустоты',
        description: 'Копит силу. Если дать время, сорвет твой план.',
    },
    'Night Talon': {
        name: 'Ночной коготь',
        description: 'Быстрый охотник. Сразу видит плохую стойку.',
    },
    'Nameless Screamer': {
        name: 'Безымянный крикун',
        description: 'Он не убивает сразу. Он разбирает тебя по частям.',
    },
    'Carrion Matron': {
        name: 'Падальная матрона',
        description: 'Раны, которые она открывает, не молчат.',
    },
    'Necromancer Regent': {
        name: 'Некромант-регент',
        description: 'Хранитель первых глубин. Проверяет весь твой путь.',
    },
    'The Lich of Cinders': {
        name: 'Лич пепла',
        description: 'Ждет тех, кто уже научился выживать.',
    },
    'Splintered Oracle': {
        name: 'Расколотый оракул',
        description: 'Каждая его рана возвращается твоей.',
    },
    'Nameless Maw': {
        name: 'Безымянная пасть',
        description: 'Глубина перестала притворяться комнатой.',
    },
};
