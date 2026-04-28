export type Language = 'ru' | 'en';

type Vars = Record<string, string | number>;

const STORAGE_KEY = 'rpglikedurkest-language';

const TEXT = {
    en: {
        uiVital: 'VITAL',
        eventLog: 'EVENT LOG',
        hp: 'HP',
        level: 'LVL',
        xp: 'XP',
        attackShort: 'ATK',
        defenseShort: 'DEF',
        reviveShort: 'REV',
        bright: 'BRIGHT',
        dark: 'DARK',
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
        returnToMap: '[Space] Return to map',
        beginSilence: 'The expedition begins in silence.',
        dungeonListens: 'The dungeon listens for the kind of person you become.',
        levelUp: 'You rise to level {level}.',
        revive: 'Last Stand keeps you alive. Revives left: {count}.',
        lightLower: 'Your lantern burns lower: -{count} light.',
        unlocked: 'Unlocked forever: {label}.',
        chooseMove: 'Choose your next move.',
        actionAttack: '[1] Attack',
        actionDefend: '[2] Defend',
        actionStagger: '[3] Stagger',
        actionPotion: '[{num}] Potion',
        actionCareful: '[1] Careful',
        actionForce: '[2] Force',
        actionLeave: '[3] Leave',
        actionRush: '[1] Rush',
        actionDisarm: '[2] Disarm',
        actionProbe: '[3] Probe',
        actionRecover: '[1] Recover',
        actionFocus: '[2] Focus',
        actionScout: '[1] Scout',
        actionSteady: '[2] Steady',
        actionPray: '[1] Pray',
        actionOffer: '[2] Offer {cost}g',
        actionRite: '[3] Rite {cost}s',
        actionDynamicLeave: '[{num}] Leave',
        actionBuyPotion: '[1] Potion {cost}g',
        actionLantern: '[{num}] Lantern {cost}g',
        actionArmor: '[{num}] Armor {cost}g',
        actionRelic: '[{num}] Relic {cost}s',
        collectSelf: 'Collect yourself and continue deeper.',
        intentLine: 'Intent: {label}. {detail}',
        guardLine: 'Guard {guard}.',
        staggerCost: 'Stagger costs {cost} resolve.',
        potionHint: 'Potions heal immediately, then the enemy acts.',
        treasureLeaveGain: 'You leave the cache untouched and recover {parts}.',
        treasureLeaveNoGain: 'You leave the cache untouched and keep your hands steady.',
        treasureSecured: 'Treasure secured: {parts}.',
        lockBites: 'The lock bites for {damage} damage.',
        plusXp: '+{value} XP',
        plusGold: '+{value} gold',
        plusPotion: '+1 potion',
        plusAttack: '+{value} attack',
        plusShard: '+{value} shard',
        trapRush: 'You rush the trap and suffer {damage} damage.',
        trapDisarm: 'You disarm it cleanly and salvage {gold} gold.',
        trapSnap: 'The mechanism snaps shut for {damage} damage.',
        trapSnapIntel: 'The trap bites before you can pull away.',
        trapProbe: 'You spend resolve and take the mechanism apart: {parts}.',
        restRecover: 'You rest and recover {parts}.',
        focusResolve: 'You focus and gain {value} resolve.',
        focusXp: 'You study the quiet and gain {value} XP.',
        shrineAttack: 'The shrine answers: +1 attack for this run.',
        shrineWound: 'The shrine wounds you for {damage}, but grants {resolve} resolve.',
        shrineOffer: 'You offer gold and gain +{value} max HP for this run.',
        shrineRite: 'The relic rite grants +{hp} max HP and +{resolve} resolve.',
        buyPotion: 'You buy a potion.',
        buyLantern: 'You refill your lantern: +{value} light.',
        buyArmor: 'You reinforce your armor: +{value} defense.',
        buyRelic: 'Relic oil grants +{attack} attack and +{potions} potion.',
        emptyScout: 'Your search yields {parts}.',
        emptySteady: 'You steady yourself and gain {value} resolve.',
        emptyStudy: 'You study the silence and gain {value} XP.',
        enemyFallback: 'An unnamed threat emerges.',
        enemyInfoLocked: 'Enemy info unlocks deeper down.',
        pathOpen: 'The path forward is open again.',
        victoryRewards: 'Victory rewards: {parts}.',
        deathTitle: 'THE EXPEDITION ENDS',
        deathSummary: 'Best depth: {depth}\nBosses defeated: {bosses}\nPrestige earned: +{prestige}\n{line}',
        restart: 'Begin New Expedition',
        reset: 'Reset soul memory',
        prestigeBank: 'Prestige bank: {value}',
        nextDiscovery: 'Next permanent discovery: {requirement} -> {label}.',
        allDiscovered: 'Every planned layer of permanent content has been unlocked.',
        levelCard: 'Lv {level}/{max}',
        max: 'MAX',
        cost: 'Cost {cost}',
        confirmResetTitle: 'Reset all progress?',
        confirmResetBody: 'This will erase prestige, permanent upgrades, and discoveries.\nThe next run starts from a clean profile.',
        confirmResetYes: 'Yes, erase all',
        cancel: 'Cancel',
        hostile: 'HOSTILE',
        elite: 'ELITE',
        boss: 'BOSS',
        start: 'START',
        treasure: 'TREASURE',
        trap: 'TRAP',
        rest: 'REST',
        shrine: 'SHRINE',
        merchant: 'MERCHANT',
        empty: 'EMPTY',
        intentAttack: 'Attack',
        intentAttackDetail: 'A normal strike. Defend can soften it.',
        intentHeavy: 'Heavy',
        intentHeavyDetail: 'Big damage. Defend or Stagger are strong answers.',
        intentGuard: 'Guard',
        intentGuardDetail: 'Adds block. Stagger pierces it cleanly.',
        intentCharge: 'Charge',
        intentChargeDetail: 'Next attack becomes nastier unless staggered.',
        intentCurse: 'Curse',
        intentCurseDetail: 'Drains light and health. Stagger interrupts it.',
        combatBoss: 'Boss encounter.',
        combatElite: 'Elite encounter.',
        combatHostile: 'Hostile contact.',
        strikeCrit: 'Critical strike for {damage} damage.',
        strike: 'You strike for {damage} damage.',
        brace: 'You brace for the incoming blow.',
        needResolve: 'You need more resolve to use your skill.',
        skillStagger: 'Your skill staggers the {intent} for {damage} damage.',
        skillLand: 'Your skill lands for {damage} damage.',
        noPotions: 'No potions remain.',
        drinkPotion: 'You drink a potion and recover {healed} HP.',
        enemyFalls: '{name} falls.',
        planBreaks: "{name}'s plan breaks before it lands.",
        darknessCloses: 'Darkness closes over the expedition.',
        guardAbsorbs: "{name}'s guard absorbs {blocked}.",
        enemyGuard: '{name} raises a guard ({guard} block).',
        enemyCharge: '{name} gathers speed for the next hit.',
        enemyCurse: '{name} curses you for {damage}{suffix}.',
        curseSuffix: ' and drains {light} light',
        enemyStrikes: '{name} strikes',
        enemyHeavy: '{name} commits to a heavy blow',
        enemyHits: '{label} for {damage}.',
        absorb: 'You absorb the whole impact.',
    },
    ru: {
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
        beginSilence: 'Экспедиция начинается в тишине.',
        dungeonListens: 'Подземелье прислушивается к тому, кем ты станешь.',
        levelUp: 'Ты поднимаешься до уровня {level}.',
        revive: 'Последний шанс удержал тебя. Осталось: {count}.',
        lightLower: 'Фонарь горит тусклее: -{count} света.',
        unlocked: 'Открыто навсегда: {label}.',
        chooseMove: 'Выбери следующий ход.',
        actionAttack: '[1] Атака',
        actionDefend: '[2] Защита',
        actionStagger: '[3] Сбить',
        actionPotion: '[{num}] Эликсир',
        actionCareful: '[1] Осторожно',
        actionForce: '[2] Взломать',
        actionLeave: '[3] Оставить',
        actionRush: '[1] Рвануть',
        actionDisarm: '[2] Обезвредить',
        actionProbe: '[3] Изучить',
        actionRecover: '[1] Лечиться',
        actionFocus: '[2] Собраться',
        actionScout: '[1] Осмотреть',
        actionSteady: '[2] Устоять',
        actionPray: '[1] Молиться',
        actionOffer: '[2] Жертва {cost}з',
        actionRite: '[3] Ритуал {cost}о',
        actionDynamicLeave: '[{num}] Уйти',
        actionBuyPotion: '[1] Эликсир {cost}з',
        actionLantern: '[{num}] Фонарь {cost}з',
        actionArmor: '[{num}] Броня {cost}з',
        actionRelic: '[{num}] Реликт {cost}о',
        collectSelf: 'Соберись и иди глубже.',
        intentLine: 'Намерение: {label}. {detail}',
        guardLine: 'Защита {guard}.',
        staggerCost: 'Сбить стоит {cost} воли.',
        potionHint: 'Эликсир лечит сразу, затем ходит враг.',
        treasureLeaveGain: 'Ты оставляешь тайник и восстанавливаешь {parts}.',
        treasureLeaveNoGain: 'Ты оставляешь тайник нетронутым и сохраняешь выдержку.',
        treasureSecured: 'Добыча получена: {parts}.',
        lockBites: 'Замок кусает на {damage} урона.',
        plusXp: '+{value} опыта',
        plusGold: '+{value} золота',
        plusPotion: '+1 эликсир',
        plusAttack: '+{value} атаки',
        plusShard: '+{value} осколок',
        trapRush: 'Ты прорываешься через ловушку и получаешь {damage} урона.',
        trapDisarm: 'Ты чисто разбираешь механизм и находишь {gold} золота.',
        trapSnap: 'Механизм захлопывается: {damage} урона.',
        trapSnapIntel: 'Ловушка кусает раньше, чем ты успеваешь отдернуть руку.',
        trapProbe: 'Ты тратишь волю и разбираешь механизм: {parts}.',
        restRecover: 'Ты отдыхаешь и восстанавливаешь {parts}.',
        focusResolve: 'Ты собираешься с духом и получаешь {value} воли.',
        focusXp: 'Ты вслушиваешься в тишину и получаешь {value} опыта.',
        shrineAttack: 'Святилище отвечает: +1 атаки на этот забег.',
        shrineWound: 'Святилище ранит на {damage}, но дает {resolve} воли.',
        shrineOffer: 'Ты отдаешь золото и получаешь +{value} макс. ОЗ на забег.',
        shrineRite: 'Реликтовый ритуал дает +{hp} макс. ОЗ и +{resolve} воли.',
        buyPotion: 'Ты покупаешь эликсир.',
        buyLantern: 'Ты доливаешь масло: +{value} света.',
        buyArmor: 'Ты усиливаешь броню: +{value} защиты.',
        buyRelic: 'Реликтовое масло дает +{attack} атаки и +{potions} эликсир.',
        emptyScout: 'Поиск приносит {parts}.',
        emptySteady: 'Ты успокаиваешь дыхание и получаешь {value} воли.',
        emptyStudy: 'Ты изучаешь тишину и получаешь {value} опыта.',
        enemyFallback: 'Безымянная угроза выходит из темноты.',
        enemyInfoLocked: 'Сведения о враге откроются глубже.',
        pathOpen: 'Путь снова открыт.',
        victoryRewards: 'Награды: {parts}.',
        deathTitle: 'ЭКСПЕДИЦИЯ ЗАКОНЧЕНА',
        deathSummary: 'Лучшая глубина: {depth}\nПобеждено боссов: {bosses}\nПрестиж: +{prestige}\n{line}',
        restart: 'Новая экспедиция',
        reset: 'Развеять память души',
        prestigeBank: 'Запас престижа: {value}',
        nextDiscovery: 'Следующее открытие: {requirement} -> {label}.',
        allDiscovered: 'Все запланированные постоянные открытия уже найдены.',
        levelCard: 'Ур {level}/{max}',
        max: 'МАКС',
        cost: 'Цена {cost}',
        confirmResetTitle: 'Сбросить весь прогресс?',
        confirmResetBody: 'Это сотрет престиж, постоянные улучшения и открытия.\nСледующий забег начнется с чистого профиля.',
        confirmResetYes: 'Да, стереть всё',
        cancel: 'Отмена',
        hostile: 'ВРАГ',
        elite: 'ЭЛИТА',
        boss: 'БОСС',
        start: 'СТАРТ',
        treasure: 'ТАЙНИК',
        trap: 'ЛОВУШКА',
        rest: 'ПРИВАЛ',
        shrine: 'АЛТАРЬ',
        merchant: 'ТОРГОВЕЦ',
        empty: 'ПУСТО',
        intentAttack: 'Атака',
        intentAttackDetail: 'Обычный удар. Защита смягчит его.',
        intentHeavy: 'Сильный удар',
        intentHeavyDetail: 'Много урона. Лучше защищаться или сбить.',
        intentGuard: 'Защита',
        intentGuardDetail: 'Добавляет блок. Сбить пробивает его.',
        intentCharge: 'Рывок',
        intentChargeDetail: 'Следующая атака станет опаснее, если не сбить.',
        intentCurse: 'Проклятие',
        intentCurseDetail: 'Крадет свет и здоровье. Сбить прерывает.',
        combatBoss: 'Босс выходит навстречу.',
        combatElite: 'Элитная угроза.',
        combatHostile: 'Враждебный контакт.',
        strikeCrit: 'Критический удар: {damage} урона.',
        strike: 'Ты наносишь {damage} урона.',
        brace: 'Ты готовишься принять удар.',
        needResolve: 'Не хватает воли, чтобы сбить врага.',
        skillStagger: 'Ты сбиваешь намерение "{intent}" и наносишь {damage} урона.',
        skillLand: 'Прием наносит {damage} урона.',
        noPotions: 'Эликсиров не осталось.',
        drinkPotion: 'Ты пьешь эликсир и восстанавливаешь {healed} ОЗ.',
        enemyFalls: '{name} падает.',
        planBreaks: 'Замысел {name} рушится до удара.',
        darknessCloses: 'Тьма смыкается над экспедицией.',
        guardAbsorbs: 'Защита {name} поглощает {blocked}.',
        enemyGuard: '{name} поднимает защиту ({guard} блока).',
        enemyCharge: '{name} собирает силу для следующего удара.',
        enemyCurse: '{name} проклинает тебя на {damage}{suffix}.',
        curseSuffix: ' и гасит {light} света',
        enemyStrikes: '{name} бьет',
        enemyHeavy: '{name} вкладывается в тяжелый удар',
        enemyHits: '{label}: {damage} урона.',
        absorb: 'Ты полностью принимаешь удар на защиту.',
    },
} as const;

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
        if (this.language === 'en') {
            return name;
        }

        return (
            {
                'Ash Rat': 'Пепельная крыса',
                'Rot Walker': 'Гнилой ходок',
                'Grave Bat': 'Могильная летучая мышь',
                'Bone Warden': 'Костяной страж',
                'Gloom Adept': 'Адепт мрака',
                'Hollow Hound': 'Пустотная гончая',
                'Catacomb Veteran': 'Ветеран катакомб',
                'Shade Hunter': 'Охотник из тени',
                'Ossuary Arcanist': 'Арканист костницы',
                'Dread Knight': 'Рыцарь ужаса',
                'Void Channeler': 'Проводник пустоты',
                'Night Talon': 'Ночной коготь',
                'Necromancer Regent': 'Некромант-регент',
                'The Lich of Cinders': 'Лич пепла',
                'Nameless Maw': 'Безымянная пасть',
            } as Record<string, string>
        )[name] ?? name;
    }

    enemyDescription(name: string, fallback: string): string {
        if (this.language === 'en') {
            return fallback;
        }

        return (
            {
                'Ash Rat': 'Падальщик с быстрым укусом и полным отсутствием страха.',
                'Rot Walker': 'Медленный, упрямый и живучий сильнее, чем кажется.',
                'Grave Bat': 'Пикирует из темноты и вынуждает решать быстро.',
                'Bone Warden': 'Ржавая броня дает ему время перемолоть тебя.',
                'Gloom Adept': 'Его проклятия наказывают долгие бои и слабые нервы.',
                'Hollow Hound': 'Слишком быстрая, чтобы эликсир казался своевременным.',
                'Catacomb Veteran': 'Дисциплинированная грубая сила, проверяющая защиту.',
                'Shade Hunter': 'Превращает низкое здоровье в настоящую проблему.',
                'Ossuary Arcanist': 'Терпеливый колдун, карающий жадные ходы.',
                'Dread Knight': 'Запечатанный чемпион, который побеждает затяжкой боя.',
                'Void Channeler': 'Превращает каждую ошибку в обвал всей комнаты.',
                'Night Talon': 'Безжалостный хищник, проверяющий слабую подготовку.',
                'Necromancer Regent': 'Терпеливый тиран, проверяющий честность всего забега.',
                'The Lich of Cinders': 'Требует глубокого забега, а не просто удачи.',
                'Nameless Maw': 'Само подземелье смотрит в ответ и просит большего.',
            } as Record<string, string>
        )[name] ?? fallback;
    }

    upgradeTitle(id: string, fallback: string): string {
        if (this.language === 'en') {
            return fallback;
        }

        return (
            {
                vitality: 'Живучесть',
                might: 'Сила',
                wisdom: 'Мудрость',
                recovery: 'Восстановление',
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
                return `Привал лечит на +${nextLevel * 2}; ловушки наносят -${nextLevel}.`;
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
                'depth-5': 'воля, алтари и прием "Сбить"',
                'depth-6': 'свет, тьма и фонарь',
                'depth-7': 'элитные комнаты, здоровье врагов и счетчики забега',
                'first-boss': 'осколки, редкие ритуалы и прогноз престижа',
            } as Record<string, string>
        )[id] ?? fallback;
    }

    milestoneRequirement(id: string, fallback: string): string {
        if (this.language === 'en') {
            return fallback;
        }

        return id === 'first-boss' ? 'Победи первого босса' : fallback.replace('Reach depth', 'Достигни глубины');
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
        // Ignore storage failures; language still applies for the current restart path.
    }
}
