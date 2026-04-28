import { RoomType } from './MapGenerator';
import type { RoomType as RoomTypeValue } from './MapGenerator';
import type { EncounterKind } from './CombatManager';
import { Localization } from './Localization';

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
                    'Фонарь слабеет. В углах уже видно движение.'
                );
            }
        }

        if (depth === 4) {
            return this.text(
                'You find old boot prints beside your own. They turn back before the next room.',
                'Рядом с твоими следами видны старые. Они разворачиваются перед следующей комнатой.'
            );
        }

        if (depth === 8) {
            return this.text(
                'The walls carry cut marks from past runs. Some look fresh.',
                'На стенах зарубки прошлых забегов. Некоторые выглядят свежими.'
            );
        }

        return null;
    }

    roomCard(type: RoomTypeValue, depth: number): NarrativeCard {
        const tone = this.dominantTone();

        switch (type) {
            case RoomType.TREASURE:
                return {
                    title: tone === 'greed' ? this.text('Heavy Cache', 'Тяжелый тайник') : this.text('Old Cache', 'Старый тайник'),
                    description:
                        tone === 'greed'
                            ? this.text('The chest is heavy, and the lock is damaged. Someone tried to force it before you.', 'Сундук тяжелый, замок поврежден. Кто-то уже пытался вскрыть его до тебя.')
                            : this.text('A cracked chest sits in the dust. It may hold supplies, or a trap in the lock.', 'В пыли стоит треснувший сундук. Внутри могут быть припасы или ловушка в замке.'),
                    intel: this.text('The lock is weak, but the metal around it is stained.', 'Замок слабый, но металл вокруг него в пятнах.'),
                };
            case RoomType.TRAP:
                return {
                    title: tone === 'craft' ? this.text('Known Trap', 'Знакомая ловушка') : this.text('Floor Trap', 'Ловушка в полу'),
                    description:
                        tone === 'craft'
                            ? this.text('You recognize the wire and the loose stone. You can handle it if you slow down.', 'Ты узнаешь проволоку и шатающийся камень. Если не спешить, ловушку можно разобрать.')
                            : this.text('A thin wire crosses the floor. The wall beside it is full of small holes.', 'Через пол тянется тонкая проволока. В стене рядом много маленьких отверстий.'),
                    intel: this.text('The wire is tight. The holes in the wall are aimed at the floor.', 'Проволока натянута. Отверстия в стене смотрят в пол.'),
                };
            case RoomType.REST:
                return {
                    title: tone === 'violence' ? this.text('Used Camp', 'Чужой привал') : this.text('Small Fire', 'Малый костер'),
                    description:
                        tone === 'violence'
                            ? this.text('The fire is low. A broken blade lies near it, cleaned and left behind.', 'Костер почти погас. Рядом лежит сломанный клинок, вытертый и брошенный.')
                            : this.text('Someone made a small fire here. There is enough warmth for a short rest.', 'Кто-то развел здесь малый костер. Тепла хватит на короткую передышку.'),
                    intel: this.text('The fire is small, but the room is still warm.', 'Костер мал, но в комнате еще тепло.'),
                };
            case RoomType.SHRINE:
                return {
                    title: tone === 'faith' ? this.text('Used Altar', 'Тронутый алтарь') : this.text('Stone Altar', 'Каменный алтарь'),
                    description:
                        tone === 'faith'
                            ? this.text('Your old offering is still on the stone. It is dry, but not gone.', 'Твоя старая жертва все еще лежит на камне. Она высохла, но не исчезла.')
                            : this.text('Coins, ash, and dried blood cover the altar. The bargain is simple and ugly.', 'Алтарь покрыт монетами, пеплом и засохшей кровью. Сделка простая и неприятная.'),
                    intel: this.text('Old cuts cover the stone. Every mark looks deliberate.', 'Камень покрыт старыми порезами. Каждый след оставлен намеренно.'),
                };
            case RoomType.MERCHANT:
                return {
                    title: this.text('Quiet Trader', 'Тихий торговец'),
                    description:
                        tone === 'commerce'
                            ? this.text('The trader has already laid out the goods you usually buy.', 'Торговец уже разложил товары, которые ты обычно берешь.')
                            : this.text('A masked trader waits behind a torn cloth. The prices are clear.', 'За рваной тканью ждет торговец в маске. Цены написаны заранее.'),
                    intel: this.text('The trader shows only a few items and hides the rest.', 'Торговец показывает лишь несколько вещей, остальное держит под тканью.'),
                };
            case RoomType.EMPTY:
                return {
                    title: tone === 'caution' ? this.text('Quiet Room', 'Тихая комната') : this.text('Empty Room', 'Пустая комната'),
                    description:
                        tone === 'caution'
                            ? this.text('The room is quiet enough to hear water behind the wall.', 'В комнате так тихо, что слышно воду за стеной.')
                            : this.text('No enemy waits here. Dust on the floor shows fresh marks.', 'Здесь нет врага. На пыльном полу видны свежие следы.'),
                    intel: this.text('The dust is disturbed near the far wall.', 'У дальней стены пыль сбита следами.'),
                };
            case RoomType.ELITE:
                return {
                    title: this.text('Marked Enemy', 'Меченый враг'),
                    description: this.text('This one carries old scars and a fresh trophy. It has killed explorers before.', 'На нем старые шрамы и свежий трофей. Он уже убивал таких, как ты.'),
                    intel: this.text('It wears trophies from older expeditions.', 'На нем трофеи старых экспедиций.'),
                };
            case RoomType.BOSS:
                return {
                    title: depth >= 16 ? this.text('Deep Keeper', 'Глубинный хранитель') : this.text('Floor Keeper', 'Хранитель этажа'),
                    description: this.text('The floor keeper blocks the only passage down. You cannot go around it.', 'Хранитель этажа перекрывает единственный проход вниз. Обойти его нельзя.'),
                    intel: this.bossAccusation(),
                };
            case RoomType.ENEMY:
                return {
                    title: this.text('Blocked Path', 'Путь перекрыт'),
                    description:
                        tone === 'darkness'
                            ? this.text('Something moves beyond the weak lantern light and steps into the path.', 'За слабым светом фонаря что-то шевелится и выходит на дорогу.')
                            : this.text('The corridor narrows. An enemy stands between you and the next room.', 'Коридор сужается. Между тобой и следующей комнатой стоит враг.'),
                    intel: this.text('Its stance gives away the next move.', 'По стойке видно, что он собирается сделать.'),
                };
            case RoomType.START:
                return {
                    title: this.text('Camp', 'Лагерь'),
                    description: this.text('Your camp is above the first stair. Everything useful must be found below.', 'Лагерь стоит над первой лестницей. Все полезное придется искать внизу.'),
                    intel: this.text('The first steps are quiet. That never lasts.', 'Первые шаги тихие. Так бывает недолго.'),
                };
        }
    }

    combatIntro(kind: EncounterKind, enemyName: string): string {
        if (kind === 'boss') {
            return this.text(
                `${enemyName} bars the stair down.`,
                `${enemyName} закрывает путь к лестнице вниз.`
            );
        }

        if (kind === 'elite') {
            this.mark('violence');
            return this.text(
                `${enemyName} has seen explorers before. It moves first.`,
                `${enemyName} уже видел экспедиции. Он двигается первым.`
            );
        }

        return this.text(`${enemyName} blocks the corridor.`, `${enemyName} перекрывает коридор.`);
    }

    choiceLine(mark: NarrativeMark): string {
        this.mark(mark);

        switch (mark) {
            case 'greed':
                return this.text('You take more than you need. The pack grows heavier.', 'Ты берешь больше, чем нужно. Рюкзак становится тяжелее.');
            case 'caution':
                return this.text('You slow down and leave fewer mistakes behind.', 'Ты замедляешься и оставляешь меньше ошибок.');
            case 'faith':
                return this.text('The altar takes its price. The mark stays warm.', 'Алтарь берет цену. Метка остается теплой.');
            case 'violence':
                return this.text('The floor is quieter after the fight.', 'После боя этаж становится тише.');
            case 'darkness':
                return this.text('The light shrinks. The room feels larger.', 'Свет сжимается. Комната кажется больше.');
            case 'mercy':
                return this.text('You leave it untouched and save your strength.', 'Ты не трогаешь это и бережешь силы.');
            case 'craft':
                return this.text('You learn how this place is built to hurt people.', 'Ты понимаешь, как это место устроено, чтобы калечить людей.');
            case 'commerce':
                return this.text('The trader takes payment and says nothing else.', 'Торговец берет плату и больше ничего не говорит.');
        }
    }

    victoryLine(enemyName: string): string {
        if (this.memory.violence >= 4) {
            return this.text(
                `${enemyName} falls. Your hands stop shaking later than they should.`,
                `${enemyName} падает. Руки перестают дрожать не сразу.`
            );
        }

        if (this.memory.caution >= 3) {
            return this.text(`${enemyName} falls. You check the exits before the body stops moving.`, `${enemyName} падает. Ты проверяешь выходы раньше, чем тело затихает.`);
        }

        return this.text(`${enemyName} falls. The next room waits.`, `${enemyName} падает. Следующая комната ждет.`);
    }

    deathLine(): string {
        const tone = this.dominantTone();

        switch (tone) {
            case 'greed':
                return this.text('You carried too much out of rooms that wanted payment.', 'Ты вынес слишком много из комнат, которые требовали плату.');
            case 'faith':
                return this.text('The altar keeps the mark. The body stays below.', 'Алтарь сохраняет метку. Тело остается внизу.');
            case 'darkness':
                return this.text('The lantern dies first. After that, the map stops mattering.', 'Сначала гаснет фонарь. Потом карта уже не важна.');
            case 'caution':
                return this.text('You avoided many mistakes. Not the last one.', 'Ты избежал многих ошибок. Но не последней.');
            case 'commerce':
                return this.text('The trader will sell your gear to the next fool.', 'Торговец продаст твои вещи следующему глупцу.');
            default:
                return this.text(
                    `The run ends at depth ${this.deepestRoom}. Some lessons return with you.`,
                    `Забег заканчивается на глубине ${this.deepestRoom}. Часть уроков возвращается с тобой.`
                );
        }
    }

    private bossAccusation(): string {
        const tone = this.dominantTone();

        if (tone === 'greed') {
            return this.text('It has watched every chest you forced open.', 'Он видел каждый сундук, который ты вскрыл силой.');
        }
        if (tone === 'faith') {
            return this.text('The altar mark burns as it approaches.', 'Метка алтаря жжет кожу, пока он приближается.');
        }
        if (tone === 'darkness') {
            return this.text('Low light makes this fight more dangerous.', 'При слабом свете этот бой опаснее.');
        }
        if (tone === 'caution') {
            return this.text('You have survived by reading danger. Read this one fast.', 'Ты выжил, потому что читал опасность. Эту нужно прочитать быстро.');
        }

        return this.text('It tests everything you learned on this floor.', 'Он проверяет все, чему тебя научил этот этаж.');
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
