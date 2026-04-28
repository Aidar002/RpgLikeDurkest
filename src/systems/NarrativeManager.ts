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
                    'The dark no longer feels empty. Something is learning your outline.',
                    'Тьма больше не кажется пустой. Кто-то в ней уже выучил твой силуэт.'
                );
            }
        }

        if (depth === 4) {
            return this.text(
                'The corridors begin repeating shapes you never learned, yet almost remember.',
                'Коридоры складываются в узоры, которых ты не учил, но почему-то узнаешь.'
            );
        }

        if (depth === 8) {
            return this.text(
                'Far below, something starts walking in time with you.',
                'Где-то внизу кто-то начинает идти в такт твоим шагам.'
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
                            ? this.text('The lock clicks like teeth. Whatever is inside wants to be wanted.', 'Замок щелкает, как зубы. То, что внутри, хочет, чтобы его захотели.')
                            : this.text('A cracked chest waits in the dust. It can be opened, forced, or left alone.', 'В пыли ждет треснувший сундук. Его можно открыть, взломать или оставить в покое.'),
                    intel: this.text('Careful is safe. Force is richer but risky. Leave restores nerve.', 'Осторожно - безопаснее. Взлом богаче, но опаснее. Уход возвращает волю.'),
                };
            case RoomType.TRAP:
                return {
                    title: tone === 'craft' ? this.text('Familiar Snare', 'Знакомый силок') : this.text('Old Mechanism', 'Старый механизм'),
                    description:
                        tone === 'craft'
                            ? this.text('The device is old, and your hands almost know its lie.', 'Механизм старый, и руки почти понимают, где он лжет.')
                            : this.text('A pressure plate sighs awake beneath your boot.', 'Нажимная плита вздыхает под твоим сапогом.'),
                    intel: this.text('Push through, disarm it, or spend resolve to study it.', 'Прорвись, разряди ловушку или потрать волю, чтобы изучить ее.'),
                };
            case RoomType.REST:
                return {
                    title: tone === 'violence' ? this.text('Quiet After Blood', 'Тишина после крови') : this.text('Low Fire', 'Тлеющий костер'),
                    description:
                        tone === 'violence'
                            ? this.text('The coals hiss softly, counting what you survived.', 'Угли тихо шипят, считая то, что ты пережил.')
                            : this.text('The fire is nearly dead, but still warm enough to matter.', 'Костер почти погас, но его тепла еще хватает, чтобы выжить.'),
                    intel: this.text('Heal your body or steady your mind.', 'Восстанови тело или собери мысли.'),
                };
            case RoomType.SHRINE:
                return {
                    title: tone === 'faith' ? this.text('Listening Altar', 'Слышащий алтарь') : this.text('Buried Altar', 'Погребенный алтарь'),
                    description:
                        tone === 'faith'
                            ? this.text('The altar turns toward you without moving.', 'Алтарь поворачивается к тебе, хотя камень не движется.')
                            : this.text('Something old waits beneath the stone and pretends to be patient.', 'Под камнем ждет что-то древнее и делает вид, что умеет терпеть.'),
                    intel: this.text('Pray, make an offering, or retreat.', 'Молись, принеси жертву или отступи.'),
                };
            case RoomType.MERCHANT:
                return {
                    title: this.text('Shadow Trader', 'Теневой торговец'),
                    description:
                        tone === 'commerce'
                            ? this.text('The trader names your usual price before you ask.', 'Торговец называет твою обычную цену еще до вопроса.')
                            : this.text('A hooded figure has already weighed your fear.', 'Фигура в капюшоне уже взвесила твой страх.'),
                    intel: this.text('Buy carefully. This room allows one choice.', 'Покупай осторожно. Здесь будет только один выбор.'),
                };
            case RoomType.EMPTY:
                return {
                    title: tone === 'caution' ? this.text('Listening Chamber', 'Слушающая комната') : this.text('Dusty Chamber', 'Пыльная комната'),
                    description:
                        tone === 'caution'
                            ? this.text('The room stays still for anyone patient enough to notice.', 'Комната замирает для того, кто умеет замечать.')
                            : this.text('Stillness can hide a cache, a lesson, or nothing at all.', 'Тишина может прятать тайник, урок или пустоту.'),
                    intel: this.text('Search the room or keep yourself steady.', 'Обыщи комнату или сохрани самообладание.'),
                };
            case RoomType.ELITE:
                return {
                    title: this.text('Marked Challenger', 'Меченый противник'),
                    description: this.text('A hardened enemy blocks the corridor. It has survived better plans than yours.', 'Закаленный враг перекрывает коридор. Он переживал планы и получше твоих.'),
                    intel: this.text('Victory here should hurt, but it should pay.', 'Победа здесь будет дорогой, но не пустой.'),
                };
            case RoomType.BOSS:
                return {
                    title: depth >= 16 ? this.text('The Old Sentence', 'Старый приговор') : this.text('Floor Tyrant', 'Хозяин этажа'),
                    description: this.text('The ruler of this floor rises like a verdict you delayed too long.', 'Хозяин этажа поднимается, как приговор, который ты слишком долго откладывал.'),
                    intel: this.bossAccusation(),
                };
            case RoomType.ENEMY:
                return {
                    title: this.text('Threat Nearby', 'Угроза рядом'),
                    description:
                        tone === 'darkness'
                            ? this.text('Something waits where the lantern refuses to reach.', 'Кто-то ждет там, куда фонарь уже не достает.')
                            : this.text('The corridor narrows. Something in the dark chooses you first.', 'Коридор сужается. Во тьме кто-то первым выбирает тебя.'),
                    intel: this.text('Read its intent before you spend blood.', 'Смотри на намерение врага, прежде чем платить кровью.'),
                };
            case RoomType.START:
                return {
                    title: this.text('Camp', 'Лагерь'),
                    description: this.text('The entrance is behind you. The only honest path now leads down.', 'Вход остался позади. Теперь честная дорога ведет только вниз.'),
                    intel: this.text('Move when you are ready.', 'Иди, когда будешь готов.'),
                };
        }
    }

    combatIntro(kind: EncounterKind, enemyName: string): string {
        if (kind === 'boss') {
            return this.text(
                `${enemyName} studies the shape your choices have made.`,
                `${enemyName} смотрит на след, который оставили твои решения.`
            );
        }

        if (kind === 'elite') {
            this.mark('violence');
            return this.text(
                `${enemyName} does not block the path. It claims it.`,
                `${enemyName} не преграждает путь. Он объявляет его своим.`
            );
        }

        return this.text(`${enemyName} brings a lesson with teeth.`, `${enemyName} приносит урок с зубами.`);
    }

    choiceLine(mark: NarrativeMark): string {
        this.mark(mark);

        switch (mark) {
            case 'greed':
                return this.text('The dungeon remembers what your hand reached for first.', 'Подземелье запоминает, к чему первой потянулась твоя рука.');
            case 'caution':
                return this.text('You leave slower, but harder to kill.', 'Ты уходишь медленнее, зато убить тебя становится сложнее.');
            case 'faith':
                return this.text('Something under the stone answers by remembering you.', 'Что-то под камнем отвечает тем, что запоминает тебя.');
            case 'violence':
                return this.text('The corridor accepts another red signature.', 'Коридор принимает еще одну красную подпись.');
            case 'darkness':
                return this.text('The lantern dims, and the dark leans closer.', 'Фонарь тускнеет, и тьма наклоняется ближе.');
            case 'mercy':
                return this.text('Not every victory needs a wound.', 'Не каждой победе нужна рана.');
            case 'craft':
                return this.text('Metal tells the truth when questioned carefully.', 'Металл говорит правду, если спрашивать осторожно.');
            case 'commerce':
                return this.text('The trader smiles, as if the bargain was made before you arrived.', 'Торговец улыбается так, будто сделка была заключена до твоего прихода.');
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
            return this.text(`${enemyName} falls. You are already counting exits.`, `${enemyName} падает. Ты уже считаешь выходы.`);
        }

        return this.text(`${enemyName} falls, and the floor keeps listening.`, `${enemyName} падает, а этаж продолжает слушать.`);
    }

    deathLine(): string {
        const tone = this.dominantTone();

        switch (tone) {
            case 'greed':
                return this.text('In the end, the dungeon keeps everything you reached for.', 'В конце подземелье забирает все, к чему ты тянулся.');
            case 'faith':
                return this.text('The last sound is not mercy. It is recognition.', 'Последний звук - не милость. Это узнавание.');
            case 'darkness':
                return this.text('The lantern goes out. Something gently finishes your name.', 'Фонарь гаснет. Кто-то мягко договаривает твое имя.');
            case 'caution':
                return this.text('You measured every risk except the final one.', 'Ты просчитал каждый риск, кроме последнего.');
            case 'commerce':
                return this.text('Somewhere below, a trader closes your account.', 'Где-то внизу торговец закрывает твой счет.');
            default:
                return this.text(
                    `The expedition ends at depth ${this.deepestRoom}. The dungeon remembers the route.`,
                    `Экспедиция заканчивается на глубине ${this.deepestRoom}. Подземелье запомнит маршрут.`
                );
        }
    }

    private bossAccusation(): string {
        const tone = this.dominantTone();

        if (tone === 'greed') {
            return this.text('It counted every lock you forced.', 'Он считал каждый замок, который ты вскрыл.');
        }
        if (tone === 'faith') {
            return this.text('It speaks with the voices that answered your prayers.', 'Он говорит голосами, которые отвечали на твои молитвы.');
        }
        if (tone === 'darkness') {
            return this.text('It knows how long you walked without light.', 'Он знает, как долго ты шел без света.');
        }
        if (tone === 'caution') {
            return this.text('It waited for the moment you stopped measuring risk.', 'Он ждал, когда ты перестанешь считать риски.');
        }

        return this.text('Everything you relied on is being tested at once.', 'Все, на что ты опирался, проверяется одновременно.');
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
