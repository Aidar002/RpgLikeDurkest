// Narrator flavor lines, inspired by Darkest Dungeon's narrator. Used
// sparingly so they retain weight. Tone: grim, terse, observing.

export type NarrationEvent =
    | 'expedition_start'
    | 'first_blood'
    | 'enter_combat'
    | 'enter_elite'
    | 'enter_boss'
    | 'crit_landed'
    | 'crit_received'
    | 'low_hp'
    | 'low_light'
    | 'bleed_finisher'
    | 'rest'
    | 'relic_found'
    | 'stun_landed'
    | 'affliction'
    | 'virtue'
    | 'revive'
    | 'death';

const LINES: Record<NarrationEvent, string[]> = {
    expedition_start: [
        'The door closes behind you. The artifact waits below.',
        'Forward, then. Treasure hunters never look back.',
        'Another descent. The artifact still waits at the bottom.',
    ],
    first_blood: [
        'A promising start. A terrible omen.',
        'The first body of many, perhaps.',
    ],
    enter_combat: [
        'The corridor narrows.',
        'Something ahead has been waiting.',
        'The dark exhales.',
    ],
    enter_elite: [
        'Discipline in the wrong hands is still discipline.',
        'An older predator blocks the way.',
        'Not every enemy is feral. Remember that.',
    ],
    enter_boss: [
        'A keeper guards the path to deeper treasure. Stand fast.',
        'Everything you learned is being tested at once.',
        'Between you and the treasure below — this.',
    ],
    crit_landed: [
        'A clean strike. Remember the feeling.',
        'Precision — the most underrated weapon.',
    ],
    crit_received: [
        'Pain insists. So must you.',
        'A blow that will be felt for days.',
    ],
    low_hp: [
        'You are made of paper now. Choose your next step.',
        'A single mistake from here on.',
    ],
    low_light: [
        'The lantern dims. The dungeon leans in.',
        'Light fails. Something in the dark smiles.',
    ],
    bleed_finisher: [
        'It falls to wounds it cannot close.',
        'Patience, rewarded in blood.',
    ],
    rest: [
        'Warmth. For a moment. That is all.',
        'The fire asks nothing of you.',
    ],
    relic_found: [
        'Old power, still humming.',
        'Someone carved meaning into this. Now it is yours.',
    ],
    stun_landed: [
        'Its rhythm breaks. Strike while it remembers its name.',
    ],
    affliction: [
        'Something in you gives way.',
        'A quiet part of the mind starts screaming.',
    ],
    virtue: [
        'In the hollow hours, your spine finds itself.',
        'Resolve hardens where it was not.',
    ],
    revive: [
        'Not yet. The expedition is not over.',
        'Against all reason, you rise.',
    ],
    death: [
        'Overconfidence is a slow and insidious killer.',
        'Another treasure hunter joins the bones on these walls.',
        'The artifact remains unclaimed. The dungeon remains patient.',
    ],
};

const RU_LINES: Record<NarrationEvent, string[]> = {
    expedition_start: [
        'Дверь встаёт на засов. Артефакт ждёт ниже.',
        'Вниз, значит вниз. Назад здесь смотрят только мёртвые.',
        'Ещё один спуск. Камень помнит старые шаги.',
    ],
    first_blood: [
        'Первый удар прошёл чисто. Это ещё ничего не значит.',
        'Первое тело осталось на полу. Иди дальше.',
    ],
    enter_combat: [
        'Коридор сужается.',
        'Впереди кто-то успел занять проход.',
        'За поворотом скребёт металл.',
    ],
    enter_elite: [
        'Этот умеет держать оружие. Уважай это.',
        'Старый боец встал поперёк прохода.',
        'Не всякая угроза рычит. Некоторые считают шаги.',
    ],
    enter_boss: [
        'Хранитель держит лестницу вниз. Дыши ровно.',
        'Все прежние уроки сейчас потребуют плату.',
        'Между тобой и нижней дверью стоит это.',
    ],
    crit_landed: [
        'Чистый удар. Рука запомнит.',
        'Точность тише силы, но режет глубже.',
    ],
    crit_received: [
        'Боль требует внимания. Не отдавай ей всё.',
        'Этот удар останется в рёбрах.',
    ],
    low_hp: [
        'Кровь уходит быстро. Следующий шаг считай дважды.',
        'Теперь хватит одной ошибки.',
    ],
    low_light: [
        'Фонарь садится. Углы становятся глубже.',
        'Свет худеет. Стены будто ближе.',
    ],
    bleed_finisher: [
        'Раны сделали своё дело.',
        'Терпение тоже бывает оружием.',
    ],
    rest: [
        'Тепло держится недолго. Этого хватит.',
        'Огонь молчит. Редкая милость.',
    ],
    relic_found: [
        'Старая вещь всё ещё держит заряд.',
        'Кто-то носил это до тебя. Теперь твоя очередь.',
    ],
    stun_landed: [
        'Ритм сломан. Бей, пока он ищет равновесие.',
    ],
    affliction: [
        'Внутри что-то дало трещину.',
        'Тихая мысль сорвалась на крик.',
    ],
    virtue: [
        'Спина выпрямляется раньше мысли.',
        'Опора нашлась там, где её не было.',
    ],
    revive: [
        'Ещё нет. Ноги снова под тобой.',
        'Вопреки телу ты поднимаешься.',
    ],
    death: [
        'Самоуверенность убивает медленно. Подземелье умеет ждать.',
        'Ещё один искатель остался среди камня и пыли.',
        'Артефакт лежит ниже. Камень терпелив.',
    ],
};

export function narrate(event: NarrationEvent, language: 'ru' | 'en' = 'en'): string {
    const pool = language === 'ru' ? RU_LINES[event] : LINES[event];
    if (!pool || pool.length === 0) return '';
    return pool[Math.floor(Math.random() * pool.length)];
}
