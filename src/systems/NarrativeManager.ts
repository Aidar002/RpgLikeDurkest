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
                    'The dark has stopped feeling empty. It has started feeling occupied.',
                    'Тьма перестала казаться пустой. Теперь кажется, что в ней кто-то есть.'
                );
            }
        }

        if (depth === 4) {
            return this.text(
                'The dungeon begins repeating shapes you do not remember learning.',
                'Подземелье повторяет узоры, которые ты не помнишь, но почему-то узнаешь.'
            );
        }

        if (depth === 8) {
            return this.text(
                'Something below recognizes the rhythm of your steps.',
                'Что-то внизу узнает ритм твоих шагов.'
            );
        }

        return null;
    }

    roomCard(type: RoomTypeValue, depth: number): NarrativeCard {
        const tone = this.dominantTone();

        switch (type) {
            case RoomType.TREASURE:
                return {
                    title: tone === 'greed' ? this.text('Hungry Cache', 'Голодный тайник') : this.text('Forgotten Cache', 'Забытый тайник'),
                    description:
                        tone === 'greed'
                            ? this.text('The chest ticks like a second heart. It beats faster when you look away.', 'Сундук тикает, как второе сердце. Когда ты отворачиваешься, оно бьется чаще.')
                            : this.text('A cracked chest hums softly. It can be opened carefully, forced, or left breathing.', 'Треснувший сундук тихо гудит. Его можно открыть осторожно, взломать или оставить дышать.'),
                    intel: this.text('Careful is safe. Force is richer but may bite. Leave restores nerve.', 'Осторожно - безопасно. Взлом богаче, но кусается. Уход возвращает выдержку.'),
                };
            case RoomType.TRAP:
                return {
                    title: tone === 'craft' ? this.text('Familiar Snare', 'Знакомый силок') : this.text('Mechanical Snare', 'Механическая ловушка'),
                    description:
                        tone === 'craft'
                            ? this.text('The mechanism is old, but your hands already know where it wants blood.', 'Механизм старый, но руки уже знают, где он хочет крови.')
                            : this.text('A pressure plate snaps awake under your boot.', 'Нажимная плита просыпается под твоим сапогом.'),
                    intel: this.text('Rush, risk a disarm, or spend resolve to read the machine.', 'Прорвись, рискни обезвредить или потрать волю, чтобы прочитать механизм.'),
                };
            case RoomType.REST:
                return {
                    title: tone === 'violence' ? this.text('Quiet After Harm', 'Тишина после ран') : this.text('Campfire', 'Костер'),
                    description:
                        tone === 'violence'
                            ? this.text('The coals spit softly, as if counting the things you left behind.', 'Угли тихо шипят, будто считают то, что ты оставил позади.')
                            : this.text('The coals are low, but still warm enough to matter.', 'Угли почти погасли, но их тепла еще хватает, чтобы выжить.'),
                    intel: this.text('Recover your body or focus your mind.', 'Восстанови тело или собери мысли.'),
                };
            case RoomType.SHRINE:
                return {
                    title: tone === 'faith' ? this.text('Listening Altar', 'Слышащий алтарь') : this.text('Forgotten Altar', 'Забытый алтарь'),
                    description:
                        tone === 'faith'
                            ? this.text('The altar turns toward you without moving.', 'Алтарь поворачивается к тебе, не двигаясь.')
                            : this.text('Something old still listens from beneath the stone.', 'Что-то древнее все еще слушает из-под камня.'),
                    intel: this.text('A prayer, an offering, or a careful retreat.', 'Молитва, жертва или осторожный отход.'),
                };
            case RoomType.MERCHANT:
                return {
                    title: this.text('Shadow Trader', 'Теневой торговец'),
                    description:
                        tone === 'commerce'
                            ? this.text('The trader has your usual price ready before you ask.', 'Торговец уже приготовил твою обычную цену.')
                            : this.text('A hooded figure has already decided what your fear is worth.', 'Фигура в капюшоне уже решила, сколько стоит твой страх.'),
                    intel: this.text('Spend carefully. This room lasts one choice.', 'Трать осторожно. Эта комната дает один выбор.'),
                };
            case RoomType.EMPTY:
                return {
                    title: tone === 'caution' ? this.text('Listening Chamber', 'Вслушивающаяся комната') : this.text('Dusty Chamber', 'Пыльная комната'),
                    description:
                        tone === 'caution'
                            ? this.text('The empty room holds still, rewarding anyone patient enough to notice.', 'Пустая комната замирает, награждая тех, кто умеет замечать.')
                            : this.text('Stillness can hide a cache or steady a shaking hand.', 'Тишина может скрывать тайник или успокоить дрожащую руку.'),
                    intel: this.text('Search the room or keep your footing.', 'Обыщи комнату или сохрани равновесие.'),
                };
            case RoomType.ELITE:
                return {
                    title: this.text('Marked Challenger', 'Меченый противник'),
                    description: this.text('A hardened threat bars the corridor. It has survived better plans than yours.', 'Закаленная угроза перекрывает коридор. Она пережила планы и получше твоих.'),
                    intel: this.text('Winning here should feel costly and worth it.', 'Победа здесь должна быть дорогой и ценной.'),
                };
            case RoomType.BOSS:
                return {
                    title: depth >= 16 ? this.text('The Old Sentence', 'Старый приговор') : this.text('Floor Tyrant', 'Тиран этажа'),
                    description: this.text('The ruler of this floor rises like a verdict you have been postponing.', 'Властитель этажа поднимается, как приговор, который ты откладывал.'),
                    intel: this.bossAccusation(),
                };
            case RoomType.ENEMY:
                return {
                    title: this.text('Threat Detected', 'Угроза рядом'),
                    description:
                        tone === 'darkness'
                            ? this.text('Something waits where the lantern refuses to reach.', 'Что-то ждет там, куда фонарь отказывается светить.')
                            : this.text('The corridor narrows. Something waits in the dark.', 'Коридор сужается. Во тьме кто-то ждет.'),
                    intel: this.text('Read its intent before you spend blood.', 'Прочитай намерение врага, прежде чем платить кровью.'),
                };
            case RoomType.START:
                return {
                    title: this.text('Camp', 'Лагерь'),
                    description: this.text('The entry is behind you. The only path now is deeper.', 'Вход остался позади. Теперь путь ведет только глубже.'),
                    intel: this.text('Continue when you are ready.', 'Продолжай, когда будешь готов.'),
                };
        }
    }

    combatIntro(kind: EncounterKind, enemyName: string): string {
        if (kind === 'boss') {
            return this.text(
                `${enemyName} studies the shape your choices have made.`,
                `${enemyName} изучает форму, которую приняли твои решения.`
            );
        }

        if (kind === 'elite') {
            this.mark('violence');
            return this.text(
                `${enemyName} does not block the path. It claims it.`,
                `${enemyName} не перекрывает путь. Он объявляет его своим.`
            );
        }

        return this.text(`${enemyName} arrives with a lesson and teeth.`, `${enemyName} приносит урок и зубы.`);
    }

    choiceLine(mark: NarrativeMark): string {
        this.mark(mark);

        switch (mark) {
            case 'greed':
                return this.text('The dungeon learns what you reach for first.', 'Подземелье запоминает, к чему ты тянешься первым.');
            case 'caution':
                return this.text('You leave a little slower, and a little harder to kill.', 'Ты уходишь чуть медленнее, зато тебя чуть труднее убить.');
            case 'faith':
                return this.text('Something beneath the stone answers by remembering you.', 'Что-то под камнем отвечает тем, что запоминает тебя.');
            case 'violence':
                return this.text('The corridor accepts another red signature.', 'Коридор принимает еще одну красную подпись.');
            case 'darkness':
                return this.text('The lantern dims, and the dark leans closer.', 'Фонарь тускнеет, и тьма наклоняется ближе.');
            case 'mercy':
                return this.text('Not every victory needs a wound.', 'Не каждой победе нужна рана.');
            case 'craft':
                return this.text('Metal confesses when questioned carefully.', 'Металл признается, если спрашивать осторожно.');
            case 'commerce':
                return this.text('The trader smiles as if this was agreed before you arrived.', 'Торговец улыбается так, будто вы договорились еще до твоего прихода.');
        }
    }

    victoryLine(enemyName: string): string {
        if (this.memory.violence >= 4) {
            return this.text(
                `${enemyName} falls into a silence that already knows your name.`,
                `${enemyName} падает в тишину, которая уже знает твое имя.`
            );
        }

        if (this.memory.caution >= 3) {
            return this.text(`${enemyName} falls. You are still counting exits.`, `${enemyName} падает. Ты все еще считаешь выходы.`);
        }

        return this.text(`${enemyName} falls, and the floor keeps listening.`, `${enemyName} падает, а этаж продолжает слушать.`);
    }

    deathLine(): string {
        const tone = this.dominantTone();

        switch (tone) {
            case 'greed':
                return this.text('In the end, the dungeon keeps everything you reached for.', 'В конце подземелье забирает все, к чему ты тянулся.');
            case 'faith':
                return this.text('The last thing you hear is not mercy, but recognition.', 'Последнее, что ты слышишь, не милость, а узнавание.');
            case 'darkness':
                return this.text('The lantern goes out. Something gently finishes your name.', 'Фонарь гаснет. Что-то мягко договаривает твое имя.');
            case 'caution':
                return this.text('You measured every risk except the final one.', 'Ты просчитал каждый риск, кроме последнего.');
            case 'commerce':
                return this.text('Somewhere below, a trader closes your account.', 'Где-то внизу торговец закрывает твой счет.');
            default:
                return this.text(
                    `The expedition ends at depth ${this.deepestRoom}. The dungeon remembers the route.`,
                    `Экспедиция заканчивается на глубине ${this.deepestRoom}. Подземелье помнит маршрут.`
                );
        }
    }

    private bossAccusation(): string {
        const tone = this.dominantTone();

        if (tone === 'greed') {
            return this.text('It has counted every lock you forced.', 'Он считал каждый замок, который ты взломал.');
        }
        if (tone === 'faith') {
            return this.text('It speaks with the voices that answered your prayers.', 'Он говорит голосами, которые отвечали на твои молитвы.');
        }
        if (tone === 'darkness') {
            return this.text('It knows how long you walked without light.', 'Он знает, как долго ты шел без света.');
        }
        if (tone === 'caution') {
            return this.text('It has waited for you to stop measuring risk.', 'Он ждал, когда ты перестанешь считать риски.');
        }

        return this.text('Every system you leaned on is being tested at once.', 'Все, на что ты опирался, проверяется одновременно.');
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
