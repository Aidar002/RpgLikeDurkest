export type Language = 'ru' | 'en';

type Vars = Record<string, string | number>;

const STORAGE_KEY = 'rpglikedurkest-language';

const TEXT = {
    en: {
        bootTagline: 'A grim roguelike about ruin, nerve, and second chances.',
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
        beginSilence: 'The expedition steps into silence.',
        dungeonListens: 'The dungeon listens, and slowly learns what kind of survivor you are.',
        levelUp: 'You reach level {level}.',
        revive: 'Last Stand pulls you back from the edge. Revives left: {count}.',
        lightLower: 'The lantern gutters: -{count} light.',
        unlocked: 'Unlocked forever: {label}.',
        chooseMove: 'Choose your next move.',
        actionAttack: '[1] Strike',
        actionDefend: '[2] Guard',
        actionStagger: '[3] Break',
        actionPotion: '[{num}] Potion',
        actionCareful: '[1] Open carefully',
        actionForce: '[2] Force it',
        actionLeave: '[3] Leave it',
        actionRush: '[1] Push through',
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
        actionLantern: '[{num}] Lantern {cost}g',
        actionArmor: '[{num}] Armor {cost}g',
        actionRelic: '[{num}] Relic oil {cost}s',
        collectSelf: 'Catch your breath and keep going.',
        intentLine: 'Intent: {label}. {detail}',
        guardLine: 'Guard: {guard}.',
        staggerCost: 'Break costs {cost} resolve.',
        potionHint: 'Potions heal first. The enemy acts after.',
        treasureLeaveGain: 'You leave the cache alone and recover {parts}.',
        treasureLeaveNoGain: 'You leave the cache untouched and keep your nerve.',
        treasureSecured: 'You take the spoils: {parts}.',
        lockBites: 'The lock bites back for {damage} damage.',
        plusXp: '+{value} XP',
        plusGold: '+{value} gold',
        plusPotion: '+1 potion',
        plusAttack: '+{value} attack',
        plusShard: '+{value} shard',
        trapRush: 'You force your way through the trap and take {damage} damage.',
        trapDisarm: 'You calm the mechanism and salvage {gold} gold.',
        trapSnap: 'The mechanism snaps shut: {damage} damage.',
        trapSnapIntel: 'The trap bites before you can pull away.',
        trapProbe: 'You spend resolve and take the mechanism apart: {parts}.',
        restRecover: 'You rest and recover {parts}.',
        focusResolve: 'You steady your breathing and gain {value} resolve.',
        focusXp: 'You listen to the quiet and gain {value} XP.',
        shrineAttack: 'The altar answers: +1 attack for this run.',
        shrineWound: 'The altar cuts you for {damage}, then grants {resolve} resolve.',
        shrineOffer: 'Your offering grants +{value} max HP for this run.',
        shrineRite: 'The relic rite grants +{hp} max HP and +{resolve} resolve.',
        buyPotion: 'You buy a potion.',
        buyLantern: 'You refill the lantern: +{value} light.',
        buyArmor: 'You reinforce your armor: +{value} defense.',
        buyRelic: 'Relic oil grants +{attack} attack and +{potions} potion.',
        emptyScout: 'Your search turns up {parts}.',
        emptySteady: 'You steady yourself and gain {value} resolve.',
        emptyStudy: 'You study the silence and gain {value} XP.',
        enemyFallback: 'Something nameless steps into the light.',
        enemyInfoLocked: 'Enemy details will become clear deeper down.',
        pathOpen: 'The way forward is open again.',
        victoryRewards: 'Spoils: {parts}.',
        deathTitle: 'THE EXPEDITION ENDS',
        deathSummary: 'Best depth: {depth}\nBosses defeated: {bosses}\nPrestige earned: +{prestige}\n{line}',
        deathRunLine: 'Depth {depth}  |  Bosses {bosses}  |  Prestige +{prestige}',
        restart: 'Begin New Expedition',
        reset: 'Reset soul memory',
        prestigeBank: 'Prestige bank: {value}',
        nextDiscovery: 'Next permanent discovery: {requirement} -> {label}.',
        allDiscovered: 'Every planned permanent discovery has been found.',
        levelCard: 'Lv {level}/{max}',
        max: 'MAX',
        cost: 'Cost {cost}',
        confirmResetTitle: 'Reset all progress?',
        confirmResetBody: 'This erases prestige, permanent upgrades, and discoveries.\nThe next run starts from a clean profile.',
        confirmResetYes: 'Yes, erase all',
        cancel: 'Cancel',
        hostile: 'HOSTILE',
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
        roomEmpty: 'Empty',
        intentAttack: 'Strike',
        intentAttackDetail: 'A direct hit. Guard softens it.',
        intentHeavy: 'Crush',
        intentHeavyDetail: 'Heavy damage. Guard or Break are your best answers.',
        intentGuard: 'Guard',
        intentGuardDetail: 'Adds block. Break punches through it.',
        intentCharge: 'Wind-up',
        intentChargeDetail: 'The next attack will hit harder unless you break it.',
        intentCurse: 'Curse',
        intentCurseDetail: 'Drains health and light. Break interrupts it.',
        combatBoss: 'The floor answers with a ruler.',
        combatElite: 'A marked enemy steps forward.',
        combatHostile: 'Hostile contact.',
        strikeCrit: 'Critical strike: {damage} damage.',
        strike: 'You strike for {damage} damage.',
        brace: 'You brace for the hit.',
        needResolve: 'You do not have enough resolve.',
        skillStagger: 'You break the {intent} and deal {damage} damage.',
        skillLand: 'Your technique lands for {damage} damage.',
        noPotions: 'No potions left.',
        drinkPotion: 'You drink a potion and recover {healed} HP.',
        enemyFalls: '{name} falls.',
        planBreaks: "{name}'s plan falls apart.",
        darknessCloses: 'Darkness closes over the expedition.',
        guardAbsorbs: "{name}'s guard absorbs {blocked}.",
        enemyGuard: '{name} raises a guard ({guard} block).',
        enemyCharge: '{name} gathers force for the next strike.',
        enemyCurse: '{name} curses you for {damage}{suffix}.',
        curseSuffix: ' and drains {light} light',
        enemyStrikes: '{name} strikes',
        enemyHeavy: '{name} commits to a crushing blow',
        enemyHits: '{label}: {damage} damage.',
        absorb: 'Your guard absorbs the whole impact.',
    },
    ru: {
        bootTagline: 'Мрачный roguelike о риске, тьме и второй попытке.',
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
        beginSilence: 'Экспедиция входит в тишину.',
        dungeonListens: 'Подземелье слушает и постепенно понимает, каким выжившим ты станешь.',
        levelUp: 'Ты достигаешь уровня {level}.',
        revive: 'Последний шанс вытаскивает тебя с края. Осталось: {count}.',
        lightLower: 'Фонарь чадит слабее: -{count} света.',
        unlocked: 'Открыто навсегда: {label}.',
        chooseMove: 'Выбери следующий ход.',
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
        actionLantern: '[{num}] Фонарь {cost}з',
        actionArmor: '[{num}] Броня {cost}з',
        actionRelic: '[{num}] Масло {cost}о',
        collectSelf: 'Переведи дыхание и иди дальше.',
        intentLine: 'Намерение: {label}. {detail}',
        guardLine: 'Блок: {guard}.',
        staggerCost: 'Сломать намерение стоит {cost} воли.',
        potionHint: 'Эликсир лечит сразу. Потом ходит враг.',
        treasureLeaveGain: 'Ты не трогаешь тайник и восстанавливаешь {parts}.',
        treasureLeaveNoGain: 'Ты оставляешь тайник закрытым и сохраняешь самообладание.',
        treasureSecured: 'Ты забираешь добычу: {parts}.',
        lockBites: 'Замок кусает в ответ: {damage} урона.',
        plusXp: '+{value} опыта',
        plusGold: '+{value} золота',
        plusPotion: '+1 эликсир',
        plusAttack: '+{value} атаки',
        plusShard: '+{value} осколок',
        trapRush: 'Ты прорываешься через ловушку и получаешь {damage} урона.',
        trapDisarm: 'Ты успокаиваешь механизм и находишь {gold} золота.',
        trapSnap: 'Механизм захлопывается: {damage} урона.',
        trapSnapIntel: 'Ловушка срабатывает раньше, чем ты успеваешь отдернуть руку.',
        trapProbe: 'Ты тратишь волю и разбираешь механизм: {parts}.',
        restRecover: 'Ты отдыхаешь и восстанавливаешь {parts}.',
        focusResolve: 'Ты выравниваешь дыхание и получаешь {value} воли.',
        focusXp: 'Ты вслушиваешься в тишину и получаешь {value} опыта.',
        shrineAttack: 'Алтарь отвечает: +1 атаки до конца забега.',
        shrineWound: 'Алтарь режет тебя на {damage}, затем дает {resolve} воли.',
        shrineOffer: 'Жертва дает +{value} макс. ОЗ до конца забега.',
        shrineRite: 'Обряд реликта дает +{hp} макс. ОЗ и +{resolve} воли.',
        buyPotion: 'Ты покупаешь эликсир.',
        buyLantern: 'Ты доливаешь масло в фонарь: +{value} света.',
        buyArmor: 'Ты усиливаешь броню: +{value} защиты.',
        buyRelic: 'Реликтовое масло дает +{attack} атаки и +{potions} эликсир.',
        emptyScout: 'Обыск приносит {parts}.',
        emptySteady: 'Ты собираешься и получаешь {value} воли.',
        emptyStudy: 'Ты изучаешь тишину и получаешь {value} опыта.',
        enemyFallback: 'Безымянная угроза выходит на свет.',
        enemyInfoLocked: 'Сведения о врагах откроются глубже.',
        pathOpen: 'Путь дальше снова открыт.',
        victoryRewards: 'Добыча: {parts}.',
        deathTitle: 'ЭКСПЕДИЦИЯ ОКОНЧЕНА',
        deathSummary: 'Лучшая глубина: {depth}\nБоссов побеждено: {bosses}\nПрестиж: +{prestige}\n{line}',
        deathRunLine: 'Глубина {depth}  |  Боссы {bosses}  |  Престиж +{prestige}',
        restart: 'Новая экспедиция',
        reset: 'Стереть память души',
        prestigeBank: 'Запас престижа: {value}',
        nextDiscovery: 'Следующее постоянное открытие: {requirement} -> {label}.',
        allDiscovered: 'Все постоянные открытия уже найдены.',
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
        intentAttackDetail: 'Обычная атака. Блок смягчит урон.',
        intentHeavy: 'Размах',
        intentHeavyDetail: 'Много урона. Лучше блокировать или сломать намерение.',
        intentGuard: 'Защита',
        intentGuardDetail: 'Враг получит блок. Сломать намерение пробивает его.',
        intentCharge: 'Подготовка',
        intentChargeDetail: 'Следующий удар станет сильнее, если его не сорвать.',
        intentCurse: 'Проклятие',
        intentCurseDetail: 'Крадет здоровье и свет. Сломать намерение прерывает его.',
        combatBoss: 'Этаж отвечает своим хозяином.',
        combatElite: 'Вперед выходит меченый враг.',
        combatHostile: 'Враждебный контакт.',
        strikeCrit: 'Критический удар: {damage} урона.',
        strike: 'Ты наносишь {damage} урона.',
        brace: 'Ты готовишься принять удар.',
        needResolve: 'Не хватает воли.',
        skillStagger: 'Ты ломаешь намерение "{intent}" и наносишь {damage} урона.',
        skillLand: 'Прием попадает: {damage} урона.',
        noPotions: 'Эликсиров не осталось.',
        drinkPotion: 'Ты пьешь эликсир и восстанавливаешь {healed} ОЗ.',
        enemyFalls: '{name} падает.',
        planBreaks: 'Замысел {name} рассыпается.',
        darknessCloses: 'Тьма смыкается над экспедицией.',
        guardAbsorbs: 'Блок {name} поглощает {blocked}.',
        enemyGuard: '{name} поднимает блок ({guard}).',
        enemyCharge: '{name} копит силу для следующего удара.',
        enemyCurse: '{name} проклинает тебя: {damage}{suffix}.',
        curseSuffix: ' и гасит {light} света',
        enemyStrikes: '{name} бьет',
        enemyHeavy: '{name} вкладывается в сокрушительный удар',
        enemyHits: '{label}: {damage} урона.',
        absorb: 'Твой блок поглощает весь удар.',
    },
} as const;

const RU_ENEMIES: Record<string, { name: string; description: string }> = {
    'Ash Rat': {
        name: 'Пепельная крыса',
        description: 'Мелкий падальщик с быстрым укусом и полным отсутствием страха.',
    },
    'Rot Walker': {
        name: 'Гнилой ходок',
        description: 'Медленный, упрямый и живучий сильнее, чем кажется.',
    },
    'Grave Bat': {
        name: 'Могильная мышь',
        description: 'Падает из темноты и заставляет решать быстро.',
    },
    'Bone Warden': {
        name: 'Костяной страж',
        description: 'Ржавая броня дает ему время перемолоть твою защиту.',
    },
    'Gloom Adept': {
        name: 'Адепт мрака',
        description: 'Его проклятия наказывают затяжные бои и слабые нервы.',
    },
    'Hollow Hound': {
        name: 'Полая гончая',
        description: 'Слишком быстрая, чтобы эликсир всегда успевал вовремя.',
    },
    'Catacomb Veteran': {
        name: 'Ветеран катакомб',
        description: 'Дисциплинированная грубая сила, проверяющая твою защиту.',
    },
    'Shade Hunter': {
        name: 'Охотник из тени',
        description: 'Превращает низкое здоровье в настоящую проблему.',
    },
    'Ossuary Arcanist': {
        name: 'Арканист костницы',
        description: 'Терпеливый колдун, который карает жадные ходы.',
    },
    'Dread Knight': {
        name: 'Рыцарь ужаса',
        description: 'Запечатанный чемпион. Чем дольше бой, тем ближе его победа.',
    },
    'Void Channeler': {
        name: 'Проводник пустоты',
        description: 'Превращает каждую ошибку в обвал всей комнаты.',
    },
    'Night Talon': {
        name: 'Ночной коготь',
        description: 'Безжалостный хищник, вскрывающий слабую подготовку.',
    },
    'Necromancer Regent': {
        name: 'Некромант-регент',
        description: 'Терпеливый тиран, проверяющий честность всего забега.',
    },
    'The Lich of Cinders': {
        name: 'Лич пепла',
        description: 'Требует глубокого забега, а не просто удачной серии ходов.',
    },
    'Nameless Maw': {
        name: 'Безымянная пасть',
        description: 'Само подземелье смотрит в ответ и просит большего.',
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
                return `Начинай каждый забег с +${nextLevel * 3} макс. ОЗ.`;
            case 'might':
                return `Начинай каждый забег с +${nextLevel} атаки.`;
            case 'wisdom':
                return `Получай +${nextLevel * 15}% опыта из всех источников.`;
            case 'recovery':
                return `Привал лечит на +${nextLevel * 2}; ловушки наносят -${nextLevel} урона.`;
            case 'preparation':
                return `Когда свет открыт, начинай с +${nextLevel} света.`;
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
