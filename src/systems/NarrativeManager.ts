import { RoomType } from './MapGenerator';
import type { RoomType as RoomTypeValue } from './MapGenerator';
import type { EncounterKind } from './CombatManager';
import { Localization } from './Localization';
import { MAP_CONFIG } from '../data/GameConfig';

export type NarrativeMark =
    | 'greed'
    | 'caution'
    | 'faith'
    | 'violence'
    | 'darkness'
    | 'mercy'
    | 'craft'
    | 'commerce';

export interface NarrativeCard {
    title: string;
    description: string;
    intel: string;
}

type NarrativeMemory = Record<NarrativeMark, number>;

const DEFAULT_MEMORY: NarrativeMemory = {
    greed: 0,
    caution: 0,
    faith: 0,
    violence: 0,
    darkness: 0,
    mercy: 0,
    craft: 0,
    commerce: 0,
};

export class NarrativeManager {
    private memory: NarrativeMemory = { ...DEFAULT_MEMORY };
    private deepestRoom = 0;
    private loc: Localization;

    constructor(loc: Localization) {
        this.loc = loc;
    }

    mark(mark: NarrativeMark, amount: number = 1): void {
        this.memory[mark] += amount;
    }

    enterDepth(depth: number, lowLight: boolean): string | null {
        this.deepestRoom = Math.max(this.deepestRoom, depth);

        if (lowLight) {
            this.mark('darkness');
            if (this.memory.darkness === 2) {
                return this.text(
                    'The lantern is weak. Corners hide movement now.',
                    'Фонарь садится. В углах уже шевелится что-то лишнее.'
                );
            }
        }

        if (depth === 3) {
            return this.text(
                'Scratched into the wall: "Treasure below. Turn back above."',
                'На стене нацарапано: «Добыча ниже. Назад — выше».'
            );
        }

        if (depth === 4) {
            return this.text(
                'You find old boot prints beside your own. They turn back before the next room.',
                'Рядом с твоими следами идут старые. Перед следующей дверью они разворачиваются.'
            );
        }

        if (depth === 8) {
            return this.text(
                'The walls carry cut marks from past runs. Some look fresh.',
                'На стенах зарубки прошлых спусков. Несколько светлые, почти свежие.'
            );
        }

        if (depth === 10) {
            return this.text(
                'A dead treasure hunter sits against the wall. His pack is empty, but his map points deeper.',
                'У стены сидит мёртвый искатель. Рюкзак пуст, карта всё ещё указывает вниз.'
            );
        }

        if (depth === 15) {
            return this.text(
                'The air hums with something old. The artifact is closer — you can feel it pulling.',
                'Воздух дрожит в зубах. Артефакт ближе.'
            );
        }

        if (depth === 20) {
            return this.text(
                'No one has carved marks this deep. You are past the last known expedition.',
                'Чужие отметки кончились. Дальше только твои.'
            );
        }

        if (depth >= MAP_CONFIG.finalDepth - 1 && depth < MAP_CONFIG.finalDepth) {
            return this.text(
                'The walls glow faintly. The Wish Artifact is on the next floor. Its guardian waits.',
                'Стены слабо светятся. Артефакт за следующей глубиной. Страж ждёт.'
            );
        }

        return null;
    }

    roomCard(type: RoomTypeValue, depth: number): NarrativeCard {
        const tone = this.dominantTone();

        switch (type) {
            case RoomType.TREASURE:
                return {
                    title: tone === 'greed' ? this.text('Heavy Cache', 'Тяжёлый тайник') : this.text('Old Cache', 'Старый тайник'),
                    description:
                        tone === 'greed'
                            ? this.text('The chest is heavy, and the lock is damaged. Someone tried to force it before you.', 'Сундук тяжёлый, замок сорван по краям. Кто-то уже пробовал силу.')
                            : this.text('A cracked chest sits in the dust. It may hold supplies, or a trap in the lock.', 'В пыли стоит треснувший сундук. Замок грязный, но живой.'),
                    intel: this.text('The lock is weak, but the metal around it is stained.', 'Замок поддаётся. Металл вокруг него в тёмных пятнах.'),
                };
            case RoomType.TRAP:
                return {
                    title: tone === 'craft' ? this.text('Known Trap', 'Знакомая ловушка') : this.text('Floor Trap', 'Ловушка в полу'),
                    description:
                        tone === 'craft'
                            ? this.text('You recognize the wire and the loose stone. You can handle it if you slow down.', 'Проволока знакомая. Камень под ней ходит. Медленно — и можно разобрать.')
                            : this.text('A thin wire crosses the floor. The wall beside it is full of small holes.', 'Тонкая проволока пересекает пол. В стене рядом ряд мелких отверстий.'),
                    intel: this.text('The wire is tight. The holes in the wall are aimed at the floor.', 'Проволока тугая. Отверстия смотрят на голень.'),
                };
            case RoomType.REST:
                return {
                    title: tone === 'violence' ? this.text('Used Camp', 'Чужой привал') : this.text('Small Fire', 'Малый костёр'),
                    description:
                        tone === 'violence'
                            ? this.text('The fire is low. A broken blade lies near it, cleaned and left behind.', 'Костёр почти погас. Рядом лежит вытертый сломанный клинок.')
                            : this.text('Someone made a small fire here. There is enough warmth for a short rest.', 'Кто-то сложил здесь малый костёр. Тепла хватит на передышку.'),
                    intel: this.text('The fire is small, but the room is still warm.', 'Костёр мал, но камень вокруг ещё тёплый.'),
                };
            case RoomType.SHRINE:
                return {
                    title: tone === 'faith' ? this.text('Used Altar', 'Тронутый алтарь') : this.text('Stone Altar', 'Каменный алтарь'),
                    description:
                        tone === 'faith'
                            ? this.text('Your old offering is still on the stone. It is dry, but not gone.', 'Твоё старое подношение всё ещё на камне. Высохло, но не исчезло.')
                            : this.text('Coins, ash, and dried blood cover the altar. The bargain is simple and ugly.', 'На алтаре монеты, пепел и сухая кровь. Сделка простая и грязная.'),
                    intel: this.text('Old cuts cover the stone. Every mark looks deliberate.', 'Камень весь в старых порезах. Ни один не случаен.'),
                };
            case RoomType.MERCHANT:
                return {
                    title: this.text('Quiet Trader', 'Тихий торговец'),
                    description:
                        tone === 'commerce'
                            ? this.text('The trader has already laid out the goods you usually buy.', 'Торговец уже выложил то, что ты обычно берёшь.')
                            : this.text('A masked trader waits behind a torn cloth. The prices are clear.', 'За рваной тканью ждёт торговец в маске. Цены уже написаны.'),
                    intel: this.text('The trader shows only a few items and hides the rest.', 'На столе мало товара. Остальное спрятано под тканью.'),
                };
            case RoomType.EMPTY:
                return {
                    title: tone === 'caution' ? this.text('Quiet Room', 'Тихая комната') : this.text('Empty Room', 'Пустая комната'),
                    description:
                        tone === 'caution'
                            ? this.text('The room is quiet enough to hear water behind the wall.', 'В тишине слышно воду за стеной.')
                            : this.text('No enemy waits here. Dust on the floor shows fresh marks.', 'Врага нет. На пыли свежие следы.'),
                    intel: this.text('The dust is disturbed near the far wall.', 'У дальней стены пыль сбита.'),
                };
            case RoomType.ELITE:
                return {
                    title: this.text('Marked Enemy', 'Меченый враг'),
                    description: this.text('This one carries old scars and a fresh trophy. It has killed explorers before.', 'На нём старые шрамы и свежий трофей. Таких, как ты, он уже встречал.'),
                    intel: this.text('It wears trophies from older expeditions.', 'На нём трофеи старых экспедиций.'),
                };
            case RoomType.BOSS: {
                const isFinal = depth >= MAP_CONFIG.finalDepth;
                const title = isFinal
                    ? this.text('Artifact Guardian', 'Страж Артефакта')
                    : depth >= 16
                      ? this.text('Deep Keeper', 'Глубинный хранитель')
                      : this.text('Floor Keeper', 'Хранитель этажа');
                const description = isFinal
                    ? this.text(
                          'The last keeper stands between you and the Wish Artifact. It will not let you pass.',
                          'Последний хранитель стоит между тобой и Артефактом Желаний. Он не отойдёт.'
                      )
                    : this.text('The floor keeper blocks the only passage down. You cannot go around it.', 'Хранитель этажа держит единственный проход вниз. Обойти нельзя.');
                return { title, description, intel: this.bossAccusation() };
            }
            case RoomType.ENEMY:
                return {
                    title: this.text('Blocked Path', 'Путь перекрыт'),
                    description:
                        tone === 'darkness'
                            ? this.text('Something moves beyond the weak lantern light and steps into the path.', 'За слабым светом фонаря что-то шевелится и выходит в проход.')
                            : this.text('The corridor narrows. An enemy stands between you and the next room.', 'Коридор сужается. Враг занял середину прохода.'),
                    intel: this.text('Its stance gives away the next move.', 'Стойка выдаёт следующий шаг.'),
                };
            case RoomType.START:
                return {
                    title: this.text('Camp', 'Лагерь'),
                    description: this.text('Your camp is above the first stair. Somewhere far below lies the Wish Artifact.', 'Лагерь стоит над первой лестницей. Артефакт Желаний лежит далеко внизу.'),
                    intel: this.text('The first steps are quiet. The artifact waits at the bottom.', 'Первые ступени тихие. Ниже будет хуже.'),
                };
        }
    }

    combatIntro(kind: EncounterKind, enemyName: string): string {
        if (kind === 'boss') {
            return this.text(
                `${enemyName} bars the stair down.`,
                `${enemyName} держит лестницу вниз.`
            );
        }

        if (kind === 'elite') {
            this.mark('violence');
            return this.text(
                `${enemyName} has seen explorers before. It moves first.`,
                `${enemyName} уже видел экспедиции. Он двигается без лишнего шага.`
            );
        }

        return this.text(`${enemyName} blocks the corridor.`, `${enemyName} держит коридор.`);
    }

    choiceLine(mark: NarrativeMark): string {
        this.mark(mark);

        switch (mark) {
            case 'greed':
                return this.text('You take more than you need. The pack grows heavier.', 'Ты берёшь лишнее. Рюкзак тянет плечи.');
            case 'caution':
                return this.text('You slow down and leave fewer mistakes behind.', 'Ты замедляешь шаг и оставляешь меньше следов.');
            case 'faith':
                return this.text('The altar takes its price. The mark stays warm.', 'Алтарь берёт цену. Метка остаётся тёплой.');
            case 'violence':
                return this.text('The floor is quieter after the fight.', 'После боя камень становится тише.');
            case 'darkness':
                return this.text('The light shrinks. The room feels larger.', 'Свет сжимается. Углы отступают дальше.');
            case 'mercy':
                return this.text('You leave it untouched and save your strength.', 'Ты не трогаешь находку и бережёшь силы.');
            case 'craft':
                return this.text('You learn how this place is built to hurt people.', 'Ты видишь, как это место собрано, чтобы ломать людей.');
            case 'commerce':
                return this.text('The trader takes payment and says nothing else.', 'Торговец берёт плату и молчит.');
        }
    }

    victoryLine(enemyName: string): string {
        if (this.memory.violence >= 4) {
            return this.text(
                `${enemyName} falls. Your hands stop shaking later than they should.`,
                `${enemyName} падает. Руки перестают дрожать позже.`
            );
        }

        if (this.memory.caution >= 3) {
            return this.text(`${enemyName} falls. You check the exits before the body stops moving.`, `${enemyName} падает. Ты смотришь на выходы раньше, чем тело стихает.`);
        }

        return this.text(`${enemyName} falls. The next room waits.`, `${enemyName} падает. За дверью уже ждут.`);
    }

    deathLine(): string {
        const tone = this.dominantTone();

        switch (tone) {
            case 'greed':
                return this.text('You filled your pack but never reached the artifact.', 'Рюкзак полон. До артефакта ты не дошёл.');
            case 'faith':
                return this.text('The altar keeps the mark. The artifact remains unclaimed.', 'Алтарь держит метку. Артефакт всё ещё ничей.');
            case 'darkness':
                return this.text('The lantern dies first. The artifact stays hidden in the dark.', 'Сначала гаснет фонарь. Артефакт остаётся ниже.');
            case 'caution':
                return this.text('You avoided many mistakes. Not the last one. The artifact waits for the next hunter.', 'Ты избежал многих ошибок. Последней — нет.');
            case 'commerce':
                return this.text('The trader will sell your gear to the next treasure hunter.', 'Торговец продаст твои вещи следующему искателю.');
            default:
                return this.text(
                    `The hunt ends at depth ${this.deepestRoom}. The artifact still waits below.`,
                    `Спуск заканчивается на глубине ${this.deepestRoom}. Артефакт всё ещё ниже.`
                );
        }
    }

    artifactLine(): string {
        const tone = this.dominantTone();

        if (tone === 'greed') {
            return this.text(
                'The Wish Artifact glows in your hands. Every treasure you took led here.',
                'Артефакт Желаний греет ладони. Каждая лишняя монета довела тебя сюда.'
            );
        }
        if (tone === 'faith') {
            return this.text(
                'The artifact pulses like a prayer answered. The altars were guiding you all along.',
                'Артефакт пульсирует, как ответ на молитву. Алтари знали дорогу.'
            );
        }
        if (tone === 'violence') {
            return this.text(
                'Every fight was a step toward this. The artifact rests in your bloodied hands.',
                'Каждый бой был ступенью. Артефакт лежит в окровавленных руках.'
            );
        }
        return this.text(
            'The Wish Artifact is warm in your hands. The dungeon falls silent around you.',
            'Артефакт Желаний тёплый в руках. Вокруг впервые тихо.'
        );
    }

    private bossAccusation(): string {
        const tone = this.dominantTone();

        if (tone === 'greed') {
            return this.text('It has watched every chest you forced open.', 'Он видел каждый замок, который ты ломал силой.');
        }
        if (tone === 'faith') {
            return this.text('The altar mark burns as it approaches.', 'Метка алтаря жжёт кожу, пока он приближается.');
        }
        if (tone === 'darkness') {
            return this.text('Low light makes this fight more dangerous.', 'Слабый свет делает бой опаснее.');
        }
        if (tone === 'caution') {
            return this.text('You have survived by reading danger. Read this one fast.', 'Ты выжил, потому что читал опасность. Читай быстрее.');
        }

        return this.text('It tests everything you learned on this floor.', 'Он проверяет всё, чему тебя научил этаж.');
    }

    private text(en: string, ru: string): string {
        return this.loc.language === 'ru' ? ru : en;
    }

    private dominantTone(): NarrativeMark {
        return (Object.entries(this.memory) as Array<[NarrativeMark, number]>).reduce(
            (best, current) => (current[1] > best[1] ? current : best),
            ['caution', 0]
        )[0];
    }
}
