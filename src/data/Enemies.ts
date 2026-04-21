export interface EnemyDef {
    name: string;
    description: string;
    hp: number;
    attack: number;
    xp: number;
    color: number; // portrait background color
}

const TIERS: { minDepth: number; pool: EnemyDef[] }[] = [
    {
        minDepth: 0,
        pool: [
            { name: 'Крыса-мутант',   description: 'Огромная тварь с горящими глазами.',      hp: 7,  attack: 1, xp: 3,  color: 0x445533 },
            { name: 'Гнилой зомби',   description: 'Медленный, но жаждущий крови.',            hp: 9,  attack: 2, xp: 4,  color: 0x445544 },
            { name: 'Летучая мышь',   description: 'Пищит и атакует роем.',                    hp: 6,  attack: 1, xp: 3,  color: 0x334433 },
        ]
    },
    {
        minDepth: 3,
        pool: [
            { name: 'Скелет-страж',   description: 'Кости в ржавой броне. Смотрит в никуда.', hp: 14, attack: 3, xp: 6,  color: 0x776655 },
            { name: 'Тёмный маг',     description: 'Призывает тьму прямо из воздуха.',         hp: 11, attack: 4, xp: 7,  color: 0x334477 },
            { name: 'Проклятый пёс',  description: 'Глаза горят красным. Быстрый.',            hp: 12, attack: 3, xp: 6,  color: 0x664433 },
        ]
    },
    {
        minDepth: 6,
        pool: [
            { name: 'Элитный страж',    description: 'Ветеран катакомб. Не торопится.',        hp: 22, attack: 4, xp: 10, color: 0x887755 },
            { name: 'Теневой охотник',  description: 'Бесшумный. Смертоносный.',               hp: 17, attack: 5, xp: 11, color: 0x334455 },
            { name: 'Костяной лучник',  description: 'Стреляет из темноты.',                   hp: 15, attack: 5, xp: 10, color: 0x777766 },
        ]
    },
    {
        minDepth: 10,
        pool: [
            { name: 'Проклятый рыцарь', description: 'Душа паладина, скованная тьмой.',        hp: 30, attack: 6, xp: 15, color: 0x663333 },
            { name: 'Демон тьмы',       description: 'Пришёл из-за грани бытия.',              hp: 26, attack: 7, xp: 16, color: 0x440033 },
            { name: 'Аберрация',        description: 'Форма нестабильна. Разум угасает.',       hp: 28, attack: 6, xp: 15, color: 0x334422 },
        ]
    },
];

const BOSSES: { depth: number; def: EnemyDef }[] = [
    { depth: 0,  def: { name: 'Некромант',     description: 'Повелитель мёртвых. Смотрит сквозь вас.',    hp: 45,  attack: 6,  xp: 30, color: 0x330055 } },
    { depth: 16, def: { name: 'Лич',           description: 'Бессмертный. Почти.',                        hp: 70,  attack: 9,  xp: 50, color: 0x220044 } },
    { depth: 24, def: { name: 'Древний Ужас',  description: 'У него нет имени. Только голод.',            hp: 110, attack: 13, xp: 80, color: 0x110022 } },
];

export function getEnemyForDepth(depth: number): EnemyDef {
    const tier = [...TIERS].reverse().find(t => depth >= t.minDepth)!;
    const pool = tier.pool;
    return pool[Math.floor(Math.random() * pool.length)];
}

export function getBossForDepth(depth: number): EnemyDef {
    const match = [...BOSSES].reverse().find(b => depth >= b.depth);
    return match ? match.def : BOSSES[0].def;
}
