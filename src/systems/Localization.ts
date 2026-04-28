export type Language = 'ru' | 'en';

type Vars = Record<string, string | number>;

const STORAGE_KEY = 'rpglikedurkest-language';

const TEXT = {
    en: {
        bootTagline: 'Go down, bring back what you can, remember what killed you.',
        bootStart: 'Begin Expedition',
        uiVital: 'LIFE',
        eventLog: 'JOURNAL',
        hp: 'HP',
        level: 'LVL',
        xp: 'XP',
        attackShort: 'ATK',
        defenseShort: 'DEF',
        reviveShort: 'REV',
        bright: 'LIT',
        dark: 'DIM',
        goldShort: 'G',
        potionShort: 'P',
        resolveShort: 'R',
        lightShort: 'L',
        shardShort: 'S',
        depthShort: 'D',
        killShort: 'K',
        bossShort: 'B',
        prestige: 'PRESTIGE',
        depth: 'Depth',
        mapDepth: 'DEPTH',
        returnToMap: '[Space] Back to map',
        beginSilence: 'The gate closes behind you.',
        dungeonListens: 'Each room teaches the next one how to hurt you.',
        levelUp: 'Level {level} reached.',
        revive: 'Last Stand saves you. Revives left: {count}.',
        lightLower: 'The lantern loses {count} light.',
        unlocked: 'Permanent unlock: {label}.',
        chooseMove: 'Choose a move.',
        actionAttack: '[1] Strike',
        actionDefend: '[2] Guard',
        actionStagger: '[3] Break',
        actionPotion: '[{num}] Potion',
        actionCareful: '[1] Careful',
        actionForce: '[2] Force',
        actionLeave: '[3] Leave',
        actionRush: '[1] Rush',
        actionDisarm: '[2] Disarm',
        actionProbe: '[3] Study',
        actionRecover: '[1] Rest',
        actionFocus: '[2] Focus',
        actionScout: '[1] Search',
        actionSteady: '[2] Steady',
        actionPray: '[1] Pray',
        actionOffer: '[2] Offer {cost}g',
        actionRite: '[3] Rite {cost}s',
        actionDynamicLeave: '[{num}] Leave',
        actionBuyPotion: '[1] Potion {cost}g',
        actionLantern: '[{num}] Oil {cost}g',
        actionArmor: '[{num}] Armor {cost}g',
        actionRelic: '[{num}] Relic oil {cost}s',
        collectSelf: 'Catch your breath and move on.',
        intentLine: '{detail}',
        guardLine: 'Block: {guard}.',
        treasureLeaveGain: 'You leave the cache closed and recover {parts}.',
        treasureLeaveNoGain: 'You leave the cache and keep moving.',
        treasureSecured: 'You take: {parts}.',
        lockBites: 'The lock cuts your hand: {damage} damage.',
        plusXp: '+{value} XP',
        plusGold: '+{value} gold',
        plusPotion: '+1 potion',
        plusAttack: '+{value} attack',
        plusShard: '+{value} shard',
        trapRush: 'You rush through and take {damage} damage.',
        trapDisarm: 'You disarm the trap and find {gold} gold.',
        trapSnap: 'The trap snaps shut: {damage} damage.',
        trapSnapIntel: 'The trap fires before you can pull back.',
        trapProbe: 'You spend resolve and take the trap apart: {parts}.',
        restRecover: 'You rest and recover {parts}.',
        focusResolve: 'You slow your breathing and gain {value} resolve.',
        focusXp: 'You study the room and gain {value} XP.',
        shrineAttack: 'The altar marks your weapon: +1 attack this run.',
        shrineWound: 'The altar takes {damage} HP and gives {resolve} resolve.',
        shrineOffer: 'Your offering gives +{value} max HP this run.',
        shrineRite: 'The rite gives +{hp} max HP and +{resolve} resolve.',
        buyPotion: 'You buy a potion.',
        buyLantern: 'You refill the lantern: +{value} light.',
        buyArmor: 'You reinforce your armor: +{value} defense.',
        buyRelic: 'Relic oil gives +{attack} attack and +{potions} potion.',
        emptyScout: 'You search the room and find {parts}.',
        emptySteady: 'You take a moment and gain {value} resolve.',
        emptyStudy: 'You study the marks on the walls and gain {value} XP.',
        enemyFallback: 'Something steps into the light.',
        enemyInfoLocked: 'Enemy details unlock deeper down.',
        pathOpen: 'The path is clear.',
        victoryRewards: 'Reward: {parts}.',
        deathTitle: 'EXPEDITION LOST',
        deathSummary: 'Best depth: {depth}\nBosses defeated: {bosses}\nPrestige earned: +{prestige}\n{line}',
        deathRunLine: 'Depth {depth}  |  Bosses {bosses}  |  Prestige +{prestige}',
        restart: 'Start New Run',
        reset: 'Reset soul memory',
        prestigeBank: 'Prestige bank: {value}',
        nextDiscovery: 'Next permanent unlock: {requirement} -> {label}.',
        allDiscovered: 'All permanent unlocks are open.',
        levelCard: 'Lv {level}/{max}',
        max: 'MAX',
        cost: 'Cost {cost}',
        confirmResetTitle: 'Reset all progress?',
        confirmResetBody: 'This erases prestige, permanent upgrades, and discoveries.\nThe next run starts from a clean profile.',
        confirmResetYes: 'Yes, erase all',
        cancel: 'Cancel',
        hostile: 'ENEMY',
        elite: 'ELITE',
        boss: 'BOSS',
        start: 'CAMP',
        treasure: 'CACHE',
        trap: 'TRAP',
        rest: 'REST',
        shrine: 'ALTAR',
        merchant: 'TRADER',
        empty: 'EMPTY',
        roomCamp: 'Camp',
        roomEnemy: 'Enemy',
        roomTreasure: 'Cache',
        roomTrap: 'Trap',
        roomRest: 'Rest',
        roomShrine: 'Altar',
        roomMerchant: 'Trader',
        roomElite: 'Elite',
        roomBoss: 'Boss',
        roomEmpty: 'Empty room',
        intentAttack: 'Strike',
        intentAttackDetail: 'Prepares to strike.',
        intentHeavy: 'Heavy strike',
        intentHeavyDetail: 'Raises its weapon for a heavy blow.',
        intentGuard: 'Guard',
        intentGuardDetail: 'Pulls back and covers itself.',
        intentCharge: 'Prepare',
        intentChargeDetail: 'Prepares for a stronger hit.',
        intentCurse: 'Curse',
        intentCurseDetail: 'Whispers a curse.',
        combatBoss: 'A floor keeper blocks the way.',
        combatElite: 'A stronger enemy blocks the way.',
        combatHostile: 'Enemy contact.',
        strikeCrit: 'Critical hit: {damage} damage.',
        strike: 'You deal {damage} damage.',
        brace: 'You raise your guard.',
        needResolve: 'Not enough resolve.',
        skillStagger: 'You break "{intent}" and deal {damage} damage.',
        skillLand: 'The technique deals {damage} damage.',
        noPotions: 'No potions left.',
        drinkPotion: 'You drink a potion and heal {healed} HP.',
        enemyFalls: '{name} falls.',
        planBreaks: "{name}'s move is stopped.",
        darknessCloses: 'You fall in the dark.',
        guardAbsorbs: "{name}'s block absorbs {blocked}.",
        enemyGuard: '{name} gains {guard} block.',
        enemyCharge: '{name} prepares a stronger hit.',
        enemyCurse: '{name} curses you for {damage}{suffix}.',
        curseSuffix: ' and drains {light} light',
        enemyStrikes: '{name} strikes',
        enemyHeavy: '{name} swings hard',
        enemyHits: '{label}: {damage} damage.',
        absorb: 'Your guard absorbs the hit.',
    },
    ru: {
        bootTagline: 'Спустись, вынеси добычу, запомни, что тебя убило.',
        bootStart: 'Начать экспедицию',
        uiVital: 'ЖИЗНЬ',
        eventLog: 'ЖУРНАЛ',
        hp: 'ОЗ',
        level: 'УР',
        xp: 'ОПЫТ',
        attackShort: 'АТК',
        defenseShort: 'ЗЩТ',
        reviveShort: 'ШНС',
        bright: 'СВЕТ',
        dark: 'ТЬМА',
        goldShort: 'З',
        potionShort: 'Э',
        resolveShort: 'В',
        lightShort: 'С',
        shardShort: 'О',
        depthShort: 'Г',
        killShort: 'У',
        bossShort: 'Б',
        prestige: 'ПРЕСТИЖ',
        depth: 'Глубина',
        mapDepth: 'ГЛУБИНА',
        returnToMap: '[Пробел] К карте',
        beginSilence: 'Ворота закрываются за спиной.',
        dungeonListens: 'Каждая комната учит следующую, как тебя убить.',
        levelUp: 'Получен уровень {level}.',
        revive: 'Последний шанс спасает тебя. Осталось: {count}.',
        lightLower: 'Фонарь теряет {count} света.',
        unlocked: 'Открыто навсегда: {label}.',
        chooseMove: 'Выбери ход.',
        actionAttack: '[1] Удар',
        actionDefend: '[2] Блок',
        actionStagger: '[3] Сломать',
        actionPotion: '[{num}] Эликсир',
        actionCareful: '[1] Осторожно',
        actionForce: '[2] Вскрыть',
        actionLeave: '[3] Оставить',
        actionRush: '[1] Прорваться',
        actionDisarm: '[2] Разрядить',
        actionProbe: '[3] Изучить',
        actionRecover: '[1] Отдохнуть',
        actionFocus: '[2] Собраться',
        actionScout: '[1] Обыскать',
        actionSteady: '[2] Устоять',
        actionPray: '[1] Молиться',
        actionOffer: '[2] Жертва {cost}з',
        actionRite: '[3] Обряд {cost}о',
        actionDynamicLeave: '[{num}] Уйти',
        actionBuyPotion: '[1] Эликсир {cost}з',
        actionLantern: '[{num}] Масло {cost}з',
        actionArmor: '[{num}] Броня {cost}з',
        actionRelic: '[{num}] Масло {cost}о',
        collectSelf: 'Переведи дыхание и иди дальше.',
        intentLine: '{detail}',
        guardLine: 'Блок: {guard}.',
        treasureLeaveGain: 'Ты оставляешь тайник закрытым и восстанавливаешь {parts}.',
        treasureLeaveNoGain: 'Ты оставляешь тайник и идешь дальше.',
        treasureSecured: 'Ты забираешь: {parts}.',
        lockBites: 'Замок режет ладонь: {damage} урона.',
        plusXp: '+{value} опыта',
        plusGold: '+{value} золота',
        plusPotion: '+1 эликсир',
        plusAttack: '+{value} атаки',
        plusShard: '+{value} осколок',
        trapRush: 'Ты прорываешься и получаешь {damage} урона.',
        trapDisarm: 'Ты разряжаешь ловушку и находишь {gold} золота.',
        trapSnap: 'Ловушка срабатывает: {damage} урона.',
        trapSnapIntel: 'Ловушка срабатывает раньше, чем ты отдергиваешь руку.',
        trapProbe: 'Ты тратишь волю и разбираешь ловушку: {parts}.',
        restRecover: 'Ты отдыхаешь и восстанавливаешь {parts}.',
        focusResolve: 'Ты выравниваешь дыхание и получаешь {value} воли.',
        focusXp: 'Ты изучаешь комнату и получаешь {value} опыта.',
        shrineAttack: 'Алтарь метит оружие: +1 атаки до конца забега.',
        shrineWound: 'Алтарь забирает {damage} ОЗ и дает {resolve} воли.',
        shrineOffer: 'Жертва дает +{value} макс. ОЗ до конца забега.',
        shrineRite: 'Обряд дает +{hp} макс. ОЗ и +{resolve} воли.',
        buyPotion: 'Ты покупаешь эликсир.',
        buyLantern: 'Ты доливаешь масло: +{value} света.',
        buyArmor: 'Ты усиливаешь броню: +{value} защиты.',
        buyRelic: 'Реликтовое масло дает +{attack} атаки и +{potions} эликсир.',
        emptyScout: 'Ты обыскиваешь комнату и находишь {parts}.',
        emptySteady: 'Ты берешь паузу и получаешь {value} воли.',
        emptyStudy: 'Ты изучаешь метки на стенах и получаешь {value} опыта.',
        enemyFallback: 'Кто-то выходит на свет.',
        enemyInfoLocked: 'Сведения о врагах откроются глубже.',
        pathOpen: 'Путь свободен.',
        victoryRewards: 'Награда: {parts}.',
        deathTitle: 'ЭКСПЕДИЦИЯ ПОТЕРЯНА',
        deathSummary: 'Лучшая глубина: {depth}\nБоссов побеждено: {bosses}\nПрестиж: +{prestige}\n{line}',
        deathRunLine: 'Глубина {depth}  |  Боссы {bosses}  |  Престиж +{prestige}',
        restart: 'Новый забег',
        reset: 'Стереть память души',
        prestigeBank: 'Запас престижа: {value}',
        nextDiscovery: 'Следующее открытие: {requirement} -> {label}.',
        allDiscovered: 'Все постоянные открытия уже получены.',
        levelCard: 'Ур {level}/{max}',
        max: 'МАКС',
        cost: 'Цена {cost}',
        confirmResetTitle: 'Сбросить весь прогресс?',
        confirmResetBody: 'Это сотрет престиж, постоянные улучшения и открытия.\nСледующий забег начнется с чистого профиля.',
        confirmResetYes: 'Да, стереть все',
        cancel: 'Отмена',
        hostile: 'ВРАГ',
        elite: 'ЭЛИТА',
        boss: 'БОСС',
        start: 'ЛАГЕРЬ',
        treasure: 'ТАЙНИК',
        trap: 'ЛОВУШКА',
        rest: 'ПРИВАЛ',
        shrine: 'АЛТАРЬ',
        merchant: 'ТОРГОВЕЦ',
        empty: 'ПУСТО',
        roomCamp: 'Лагерь',
        roomEnemy: 'Враг',
        roomTreasure: 'Тайник',
        roomTrap: 'Ловушка',
        roomRest: 'Привал',
        roomShrine: 'Алтарь',
        roomMerchant: 'Торговец',
        roomElite: 'Элита',
        roomBoss: 'Босс',
        roomEmpty: 'Пустая комната',
        intentAttack: 'Удар',
        intentAttackDetail: 'Готовится к удару.',
        intentHeavy: 'Сильный удар',
        intentHeavyDetail: 'Замахивается для сильного удара.',
        intentGuard: 'Защита',
        intentGuardDetail: 'Отступает и прикрывается.',
        intentCharge: 'Подготовка',
        intentChargeDetail: 'Готовит удар сильнее обычного.',
        intentCurse: 'Проклятие',
        intentCurseDetail: 'Шепчет проклятие.',
        combatBoss: 'Хранитель этажа перекрывает путь.',
        combatElite: 'Сильный враг перекрывает путь.',
        combatHostile: 'Враг рядом.',
        strikeCrit: 'Критический удар: {damage} урона.',
        strike: 'Ты наносишь {damage} урона.',
        brace: 'Ты поднимаешь блок.',
        needResolve: 'Не хватает воли.',
        skillStagger: 'Ты ломаешь "{intent}" и наносишь {damage} урона.',
        skillLand: 'Прием наносит {damage} урона.',
        noPotions: 'Эликсиров нет.',
        drinkPotion: 'Ты пьешь эликсир и лечишь {healed} ОЗ.',
        enemyFalls: '{name} падает.',
        planBreaks: 'Ход {name} сорван.',
        darknessCloses: 'Ты падаешь в темноте.',
        guardAbsorbs: 'Блок {name} поглощает {blocked}.',
        enemyGuard: '{name} получает {guard} блока.',
        enemyCharge: '{name} готовит сильный удар.',
        enemyCurse: '{name} проклинает тебя: {damage}{suffix}.',
        curseSuffix: ' и гасит {light} света',
        enemyStrikes: '{name} бьет',
        enemyHeavy: '{name} бьет со всей силы',
        enemyHits: '{label}: {damage} урона.',
        absorb: 'Твой блок поглощает удар.',
    },
} as const;

const RU_ENEMIES: Record<string, { name: string; description: string }> = {
    'Ash Rat': {
        name: 'Пепельная крыса',
        description: 'Маленькая, быстрая, всегда первой бросается к крови.',
    },
    'Rot Walker': {
        name: 'Гнилой ходок',
        description: 'Медленный мертвец. Его трудно добить быстро.',
    },
    'Grave Bat': {
        name: 'Могильная мышь',
        description: 'Падает сверху и не дает спокойно лечиться.',
    },
    'Bone Warden': {
        name: 'Костяной страж',
        description: 'Старый страж в ржавой броне. Часто прикрывается.',
    },
    'Gloom Adept': {
        name: 'Адепт мрака',
        description: 'Колдун, который тянет бой и гасит свет.',
    },
    'Hollow Hound': {
        name: 'Полая гончая',
        description: 'Быстрая тварь. Наказывает промедление.',
    },
    'Catacomb Veteran': {
        name: 'Ветеран катакомб',
        description: 'Опытный боец. Проверяет, умеешь ли ты защищаться.',
    },
    'Shade Hunter': {
        name: 'Охотник из тени',
        description: 'Становится опаснее, когда ты уже ранен.',
    },
    'Ossuary Arcanist': {
        name: 'Арканист костницы',
        description: 'Терпеливый маг. Жадные ходы против него опасны.',
    },
    'Dread Knight': {
        name: 'Рыцарь ужаса',
        description: 'Тяжелый боец. Чем дольше бой, тем хуже для тебя.',
    },
    'Void Channeler': {
        name: 'Проводник пустоты',
        description: 'Копит силу и ломает план, если дать ему время.',
    },
    'Night Talon': {
        name: 'Ночной коготь',
        description: 'Быстрый охотник. Слабая подготовка против него заметна сразу.',
    },
    'Necromancer Regent': {
        name: 'Некромант-регент',
        description: 'Хранитель первых глубин. Проверяет весь твой маршрут.',
    },
    'The Lich of Cinders': {
        name: 'Лич пепла',
        description: 'Ждет тех, кто научился выживать долго.',
    },
    'Nameless Maw': {
        name: 'Безымянная пасть',
        description: 'Глубина, которая перестала притворяться комнатой.',
    },
};

export class Localization {
    readonly language: Language;

    constructor(language: Language = getSavedLanguage()) {
        this.language = language;
    }

    t(key: keyof typeof TEXT.en, vars: Vars = {}): string {
        const template: string = TEXT[this.language][key] || TEXT.en[key];
        return Object.entries(vars).reduce(
            (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
            template
        );
    }

    enemyName(name: string): string {
        return this.language === 'ru' ? RU_ENEMIES[name]?.name ?? name : name;
    }

    enemyDescription(name: string, fallback: string): string {
        return this.language === 'ru' ? RU_ENEMIES[name]?.description ?? fallback : fallback;
    }

    upgradeTitle(id: string, fallback: string): string {
        if (this.language === 'en') {
            return fallback;
        }

        return (
            {
                vitality: 'Живучесть',
                might: 'Сила',
                wisdom: 'Опыт',
                recovery: 'Передышка',
                preparation: 'Подготовка',
                lastStand: 'Последний шанс',
            } as Record<string, string>
        )[id] ?? fallback;
    }

    upgradeDescription(id: string, fallback: string, nextLevel: number): string {
        if (this.language === 'en') {
            return fallback;
        }

        switch (id) {
            case 'vitality':
                return `В начале забега: +${nextLevel * 3} макс. ОЗ.`;
            case 'might':
                return `В начале забега: +${nextLevel} атаки.`;
            case 'wisdom':
                return `Опыт из всех источников: +${nextLevel * 15}%.`;
            case 'recovery':
                return `Привал лечит на +${nextLevel * 2}; ловушки наносят -${nextLevel} урона.`;
            case 'preparation':
                return `Когда открыт свет, забег начинается с +${nextLevel} света.`;
            case 'lastStand':
                return 'Один раз за забег переживи смертельный удар.';
            default:
                return fallback;
        }
    }

    milestoneLabel(id: string, fallback: string): string {
        if (this.language === 'en') {
            return fallback;
        }

        return (
            {
                'depth-1': 'числа здоровья и текущая глубина',
                'depth-2': 'иконки комнат, опыт и золото',
                'depth-3': 'ловушки и боевые характеристики',
                'depth-4': 'торговцы, эликсиры и лечение в бою',
                'depth-5': 'воля, алтари и прием "Сломать"',
                'depth-6': 'свет, тьма и фонарь',
                'depth-7': 'элитные комнаты, здоровье врагов и счетчики забега',
                'first-boss': 'осколки, редкие обряды и прогноз престижа',
            } as Record<string, string>
        )[id] ?? fallback;
    }

    milestoneRequirement(id: string, fallback: string): string {
        if (this.language === 'en') {
            return fallback;
        }

        if (id === 'first-boss') {
            return 'Победи первого босса';
        }

        return fallback.replace('Reach depth', 'Достигни глубины');
    }

    toggle(): Language {
        const next = this.language === 'ru' ? 'en' : 'ru';
        saveLanguage(next);
        return next;
    }
}

export function getSavedLanguage(): Language {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ru';
    } catch {
        return 'ru';
    }
}

export function saveLanguage(language: Language): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
        // Language still applies for the current restart path.
    }
}
