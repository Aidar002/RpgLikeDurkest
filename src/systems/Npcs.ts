import type { LocalizedText } from './LocalizedText';
import { lt } from './LocalizedText';

// Cast of recurring NPCs the player meets across runs. Each entry holds:
//  - identity (id, name, title, color, glyph)
//  - a voice palette (small repertoire of barks)
//  - an arc of narrative beats keyed by `stage`. Stage advances with metCount.
//  - condition tags so the picker can react to player state (stress, virtue,
//    affliction, depth, has-bleed, low-hp, etc.).

export type NpcId =
    | 'mira'
    | 'casimir'
    | 'hollow'
    | 'veth'
    | 'chorister'
    | 'kessa';

export type NpcRole = 'merchant' | 'shrine' | 'wanderer';

export interface NpcDialogBeat {
    // 'first' fires only on metCount === 0; 'return' on >=1; 'deep' on >=3.
    // 'farewell' is the parting line. Tags are matched against player state.
    stage: 'first' | 'return' | 'deep' | 'farewell';
    tags?: NpcStateTag[];
    text: LocalizedText;
}

export type NpcStateTag =
    // affinity buckets
    | 'liked'        // affinity >= 2
    | 'trusted'      // affinity >= 4
    | 'wary'         // affinity <= -2
    // player condition
    | 'low-hp'       // hp <= 30%
    | 'high-stress'  // stress >= 60
    | 'afflicted'    // stress resolution = affliction
    | 'virtuous'     // stress resolution = virtue
    | 'bleeder'      // bleedDamageDealt >= 8 this run
    | 'relic-rich'   // relicsFound >= 3 this run
    | 'deep-run'     // depth >= 6
    | 'first-run';   // bossesKilledEver === 0

export interface NpcProfile {
    id: NpcId;
    name: LocalizedText;
    title: LocalizedText;
    role: NpcRole;
    color: number;       // tint for portrait card
    glyph: string;       // single character used as portrait icon
    flavor: LocalizedText;      // 1-line scene description shown above dialog
    backstoryHint: LocalizedText; // short blurb shown after deep-bond
    voice: {
        // Used for combat/boss intros. Picked by hashing depth+id.
        bossIntro: LocalizedText[];
        farewell: LocalizedText[];
        lowHpRecall: LocalizedText[];
    };
    beats: NpcDialogBeat[];
    // Pool of services/options the NPC offers. The Scene maps these to
    // concrete callbacks. We only describe the *menu*, not the effect.
    offers: NpcOfferTemplate[];
}

export interface NpcOfferTemplate {
    id: string;                 // stable id ("mira_lantern", "veth_challenge")
    label: LocalizedText;       // button text, may include {index} / {cost}
    flavor?: LocalizedText;     // optional one-liner shown when chosen
    requiresAffinity?: number;  // hidden until met-count or affinity reached
    onlyAfterMet?: number;      // hidden until metCount >= n
}

// Voice palette helper for code-readability.
const v = (...lines: LocalizedText[]) => lines;

export const NPCS: Record<NpcId, NpcProfile> = {
    mira: {
        id: 'mira',
        name: lt('Мира', 'Mira'),
        title: lt('Хранительница фонарей', 'the Lantern-Bearer'),
        role: 'merchant',
        color: 0xd9a14a,
        glyph: 'M',
        flavor: lt(
            'Женщина в закопчённом плаще держит шесть фонарей зажжёнными. У каждого своё имя.',
            'A woman in a soot-stained coat tends six lanterns, one for each name she still says at night.'
        ),
        backstoryHint: lt(
            'На двенадцатой глубине она потеряла отряд. Вынесла только фонари и с тех пор возвращается.',
            'She lost her party at depth twelve. She kept the lanterns. They are why she came back.'
        ),
        voice: {
            bossIntro: v(
                lt(
                    'Мира: "Зажигай сейчас. Не дай мне подписывать седьмой фонарь."',
                    'Mira: "Light it now. Don\'t make me read your name into a lantern."'
                ),
                lt(
                    'Мира: "Я удержу проход на один вдох. Не трать его впустую."',
                    'Mira: "I can hold the line for one breath. Use it well."'
                )
            ),
            farewell: v(
                lt(
                    'Мира: "Иди тише. Быстрый огонь быстрее ест масло."',
                    'Mira: "Go quietly. Loud light burns out faster."'
                ),
                lt(
                    'Мира: "Не становись тем, что мне придётся зажигать по ночам."',
                    'Mira: "Don\'t become another wick I have to keep burning."'
                )
            ),
            lowHpRecall: v(
                lt(
                    'Ты вспоминаешь руку Миры на плече: "Кровь теряй медленно. Ночь никуда не спешит."',
                    'You remember Mira\'s hand on your shoulder: "Bleed slower. The dark has all night."'
                )
            ),
        },
        beats: [
            {
                stage: 'first',
                text: lt(
                    'Мира: "Первый спуск? Сядь. Масло продаю, терпение — нет. Его у меня мало."',
                    'Mira: "First descent? Sit a moment. I sell lantern oil and patience, in that order. Don\'t buy the second; I haven\'t much left."'
                ),
            },
            {
                stage: 'first',
                tags: ['first-run'],
                text: lt(
                    'Мира: "Я знала шестерых, кто вошёл сюда легче тебя. Не будь седьмым." Она подвигает маленький фонарь и не называет цены.',
                    'Mira: "I knew six people who came in lighter than you. Don\'t be a seventh." She nudges a small lantern toward you without naming a price.'
                ),
            },
            {
                stage: 'return',
                text: lt(
                    'Мира: "Снова ты. Значит, выход ещё помнишь." Она стучит ногтем по фонарю. "Сегодня дешевле. Я веду счёт."',
                    'Mira: "You again. The dark spat you back. That happens - for a while." She taps a lantern. "Cheaper this time. I keep tabs."'
                ),
            },
            {
                stage: 'return',
                tags: ['high-stress'],
                text: lt(
                    'Мира: "Ты звенишь по краям. Я знаю этот звук. Сядь. Ничего не покупай." Она отворачивается, пока ты дышишь.',
                    'Mira: "You\'re humming at the edges. I\'ve seen that. Sit. Buy nothing. Just sit." She doesn\'t look at you while you breathe.'
                ),
            },
            {
                stage: 'return',
                tags: ['low-hp'],
                text: lt(
                    'Мира: "Ты течёшь. Я храню фонари, не людей, но перевязать смогу. За те монеты, что ещё звенят."',
                    'Mira: "You\'re leaking. I\'m a lantern-keeper, not a surgeon - but I\'ll wrap that for what coin you have."'
                ),
            },
            {
                stage: 'return',
                tags: ['relic-rich'],
                text: lt(
                    'Мира: "На тебе вещи, которые гудят. Когда устанешь, не слушай их первыми." Она касается груди под плащом.',
                    'Mira: "Things on you that hum. Be careful what they whisper when you\'re tired." She touches her own coat over her sternum.'
                ),
            },
            {
                stage: 'deep',
                tags: ['liked'],
                text: lt(
                    'Мира поднимает самый маленький фонарь. "Брена. Третьи врата. Я зажигаю его, когда кто-то слишком похож на него." Она не отводит глаз.',
                    'Mira lifts the smallest lantern. "Bren\'s. He didn\'t make it past the third gate. I light it when I see someone who reminds me of him." Her eyes don\'t leave yours.'
                ),
            },
            {
                stage: 'deep',
                tags: ['trusted'],
                text: lt(
                    'Мира: "Если не вернёшься, будет седьмой фитиль. Я не хочу его резать." Она кладёт тебе в ладонь кольцо, пахнущее маслом.',
                    'Mira: "If you don\'t come back this time... I\'ll add a seventh wick. I would rather not." She presses an oil-stained ring into your palm without explanation.'
                ),
            },
            {
                stage: 'deep',
                tags: ['wary'],
                text: lt(
                    'Мира: "Ты тратишь так, будто тебя будут ждать. Здесь ждут недолго." Она отворачивает от тебя три фонаря.',
                    'Mira: "You spend like a man who plans to be missed. Don\'t expect me to remember the missing." She turns three lanterns away from you.'
                ),
            },
            {
                stage: 'farewell',
                text: lt(
                    'Мира: "Ступай мягко. Быстрые шаги слышно дальше."',
                    'Mira: "Walk soft. The dungeon listens for hurry."'
                ),
            },
        ],
        offers: [
            { id: 'mira_potion', label: lt('[{index}] Купить эликсир ({cost}з)', '[{index}] Buy potion ({cost}g)') },
            { id: 'mira_lantern', label: lt('[{index}] Заправить фонарь ({cost}з)', '[{index}] Refill lantern ({cost}g)') },
            { id: 'mira_armor', label: lt('[{index}] Купить броню ({cost}з)', '[{index}] Buy armor ({cost}g)') },
            {
                id: 'mira_relic_oil',
                label: lt('[{index}] Реликтовое масло ({cost} оск.)', '[{index}] Relic oil ({cost} shards)'),
                flavor: lt(
            'Она смотрит на твоё лицо чуть дольше, чем нужно.',
                    'She watches you accept it like she\'s memorising your face.'
                ),
                requiresAffinity: 2,
            },
        ],
    },

    casimir: {
        id: 'casimir',
        name: lt('Брат Казимир', 'Brother Casimir'),
        title: lt('Расстриженный', 'the Defrocked'),
        role: 'shrine',
        color: 0x7e6cb6,
        glyph: 'C',
        flavor: lt(
            'Мужчина стоит на коленях перед алтарём без имени. Молится так, будто имя всё ещё есть.',
            'A man kneels before an altar with no god\'s name on it. He is praying anyway.'
        ),
        backstoryHint: lt(
            'Орден вычеркнул его за благословение того, что лежало под святилищем. Он остался при алтаре.',
            'They struck his name from the order for blessing what he found beneath the sanctuary. He stayed.'
        ),
        voice: {
            bossIntro: v(
                lt(
                    'Казимир: "Я молился не о победе. Я молился, чтобы твоя кровь не пропала зря."',
                    'Casimir: "I did not pray for you to win. I prayed for you to mean it."'
                ),
                lt(
                    'Казимир шепчет чужое имя. Алтарь слушает как своё.',
                    'Casimir whispers a name that is not yours. The altar listens.'
                )
            ),
            farewell: v(
                lt(
                    'Казимир: "Иди через ошибку, дитя. Здесь других дверей нет."',
                    'Casimir: "Go in error, child. There is no other way."'
                ),
                lt(
                    'Казимир: "Исповедь потом. Сначала выживи."',
                    'Casimir: "Confess later. Survive first."'
                )
            ),
            lowHpRecall: v(
                lt(
                    'Голос Казимира из памяти: "Благодать начинается там, где кровь уже пошла."',
                    'Casimir\'s voice, from a memory: "Grace is what you do bleeding."'
                )
            ),
        },
        beats: [
            {
                stage: 'first',
                text: lt(
                    'Брат Казимир не поднимает глаз. "Здесь было имя. Его соскоблили. Теперь я молюсь царапине. Она честнее."',
                    'Brother Casimir does not look up. "There used to be a name carved here. They scraped it off. I find I pray better to the gouge than I ever did to the name."'
                ),
            },
            {
                stage: 'first',
                tags: ['high-stress'],
                text: lt(
                    'Казимир: "Ты дрожишь. Хорошо. Это единственная честная поза здесь." Он велит тебе опуститься на колени.',
                    'Casimir: "You arrive trembling. Good. Trembling is the only honest posture in this place." He gestures you to kneel without ceremony.'
                ),
            },
            {
                stage: 'return',
                text: lt(
                    'Казимир: "Вернулся. Алтарь любит возвращающихся. Они уже знают цену." Его улыбка выглядит украденной.',
                    'Casimir: "Back, then. The altar likes returners. They have committed." He smiles like a man who has lost the right to.'
                ),
            },
            {
                stage: 'return',
                tags: ['afflicted'],
                text: lt(
                    'Казимир наклоняется ближе. "Трещина раскрылась? Не закрывай. Свет входит через плохие места."',
                    'Casimir leans closer. "The crack has opened, hasn\'t it. Don\'t close it. Closed cracks are how light is denied entry. Pray into the wound."'
                ),
            },
            {
                stage: 'return',
                tags: ['virtuous'],
                text: lt(
                    'Казимир вздрагивает. "Сегодня ты держишься. Сломленный ты честнее, но и это можно благословить."',
                    'Casimir flinches almost imperceptibly. "You are radiant today. I prefer you broken - it is more theologically honest. But: bless what you can."'
                ),
            },
            {
                stage: 'return',
                tags: ['bleeder'],
                text: lt(
                    'Казимир: "Алтарь знает твой вкус. Железо. Старое железо. Он запомнил."',
                    'Casimir: "The altar tastes you. Iron. Old iron. You\'ve been generous with what runs through you. It will remember."'
                ),
            },
            {
                stage: 'deep',
                tags: ['liked'],
                text: lt(
                    'Казимир: "Раз никто не спрашивает, скажу тебе. Благословение третьих врат сработало. Вот настоящая ересь."',
                    'Casimir: "I confess to you, since no one else asks. The blessing I gave the third gate? It worked. That is the heresy. It worked."'
                ),
            },
            {
                stage: 'deep',
                tags: ['trusted'],
                text: lt(
                    'Казимир ставит палец тебе на лоб. "Когда падёшь, падай лицом к алтарю. Так я пойму, где копать."',
                    'Casimir presses his thumb to your forehead. "When you fall - and you will - fall facing the altar. I will know where to dig."'
                ),
            },
            {
                stage: 'deep',
                tags: ['wary'],
                text: lt(
                    'Казимир: "Ты ступаешь слишком легко. Пол это помнит." Он не благословляет тебя.',
                    'Casimir: "You step lightly here. Light steps offend the floor. The floor remembers." He does not bless you.'
                ),
            },
            {
                stage: 'farewell',
                text: lt(
                    'Казимир: "Ступай. Сомнение здесь тоже молитва."',
                    'Casimir: "Go. Doubt freely."'
                ),
            },
        ],
        offers: [
            { id: 'casimir_pray', label: lt('[{index}] Молиться', '[{index}] Pray') },
            { id: 'casimir_offer', label: lt('[{index}] Подношение ({cost}з)', '[{index}] Offer ({cost}g)') },
            {
                id: 'casimir_rite',
                label: lt('[{index}] Обряд реликвии ({cost} оск.)', '[{index}] Rite of relic ({cost} shards)'),
                flavor: lt(
                    'Осколки исчезают в трещине. Пол тихо втягивает воздух.',
                    'The altar takes the shards. Something in the floor inhales.'
                ),
                requiresAffinity: 1,
            },
        ],
    },

    hollow: {
        id: 'hollow',
        name: lt('Полый торговец', 'The Hollow Trader'),
        title: lt('Безликий', 'No-Face'),
        role: 'merchant',
        color: 0x4a3a5a,
        glyph: '?',
        flavor: lt(
            'Сутулая фигура ждёт за низким столом. Там, где должно быть лицо, натянута гладкая ткань.',
            'A stooped figure waits behind a low table. The cloth where its face should be is unbroken.'
        ),
        backstoryHint: lt(
            'Говорят, он тоже был выжившим. Потом обменял то, что нельзя было менять. Теперь торгует всем остальным.',
            'They say it was a survivor once. Then it traded something it should have kept. Now it trades the rest.'
        ),
        voice: {
            bossIntro: v(
                lt(
                    'Полый торговец молчит. Воздух сам предлагает то, чего ты не выбирал.',
                    'The Hollow Trader does not speak. The air, however, sells you something you did not choose.'
                ),
                lt(
                    'Шёпот звучит не в ухе и не в комнате: "Сделка началась."',
                    'A whisper, not in your ear, not in the room: "The transaction has begun."'
                )
            ),
            farewell: v(
                lt(
                    'Полый торговец ставит пометку в книге, которую тебе не дадут прочесть.',
                    'The Hollow Trader marks something on a ledger you cannot read.'
                ),
                lt(
                    'Фигура едва склоняется. Сделка закрыта.',
                    'The figure tilts where its face should tilt. The deal is closed.'
                )
            ),
            lowHpRecall: v(
                lt(
                    'Где-то в книге Полого торговца появляется новая зарубка.',
                    'You feel the Hollow Trader\'s ledger, somewhere, gain a tally.'
                )
            ),
        },
        beats: [
            {
                stage: 'first',
                text: lt(
                    'Полый торговец склоняет то, что заменяет ему голову. Голос почти не голос: "Сделки. Только сделки. Принеси лишнее. Унесёшь необходимое."',
                    'The Hollow Trader inclines what serves as a head. A voice that is not quite a voice: "Trades. Only trades. Bring something you can spare. Leave with something you cannot."'
                ),
            },
            {
                stage: 'return',
                text: lt(
                    'Полый торговец издаёт звук, похожий на смех. "Вернулся. Значит, цена изменилась."',
                    'The Hollow Trader makes a small sound - almost a laugh. "Returned. Few do. The price will adjust."'
                ),
            },
            {
                stage: 'return',
                tags: ['relic-rich'],
                text: lt(
                    'Полый торговец поднимает руку. Реликвии на тебе замирают. "Ты несёшь. Мы переставим."',
                    'The Hollow Trader lifts a hand. The relics on you settle, as if recognising a sibling. "You carry. We can rearrange."'
                ),
            },
            {
                stage: 'return',
                tags: ['low-hp'],
                text: lt(
                    'Полый торговец наклоняется. "Ты почти пуст. Остаток стоит дёшево. Плохая сделка для тебя. Приемлемая для нас."',
                    'The Hollow Trader tilts. "You are nearly empty. We could buy the rest of you for very little. A poor deal - for you. Acceptable - for us."'
                ),
            },
            {
                stage: 'deep',
                tags: ['trusted'],
                text: lt(
                    'Полый торговец приподнимает ткань. Под ней вопрос в форме твоего имени. Его заносят в каталог.',
                    'The Hollow Trader, for the first time, lifts the cloth. There is nothing under it but a question. The question is your name. You feel it being filed.'
                ),
            },
            {
                stage: 'deep',
                tags: ['wary'],
                text: lt(
                    'Полый торговец не поворачивается. Стол пуст. Возможно, всегда был пуст.',
                    'The Hollow Trader does not turn toward you. The table is empty. The table has always been empty.'
                ),
            },
            {
                stage: 'farewell',
                text: lt(
                    'Едва слышный вздох. Как закрытая книга учёта.',
                    'A faint sigh, like ledgers closing.'
                ),
            },
        ],
        offers: [
            {
                id: 'hollow_relic_for_hp',
                label: lt('[{index}] Отдать {cost} ОЗ за реликвию', '[{index}] Trade {cost} HP for a relic'),
                flavor: lt(
                    'Что-то внутри тебя отзывается. И соглашается.',
                    'Something inside you answers: it is willing.'
                ),
            },
            {
                id: 'hollow_shards_for_relic',
                label: lt('[{index}] Обменять {cost} осколка на особую реликвию', '[{index}] Trade {cost} shards for a unique relic'),
                flavor: lt(
                    'Осколки не звенят. Они просто оказываются на столе.',
                    'The shards do not click against the table. They arrive.'
                ),
                onlyAfterMet: 1,
            },
            {
                id: 'hollow_potion_for_gold',
                label: lt('[{index}] Продать эликсир и получить {cost}з', '[{index}] Sell potion -> gain {cost}g'),
                flavor: lt(
                    'Он смотрит не на эликсир, а на место, которое тот оставит.',
                    'It does not look at the potion, only at the absence it leaves.'
                ),
            },
        ],
    },

    veth: {
        id: 'veth',
        name: lt('Вет', 'Veth'),
        title: lt('Кровопускательница', 'the Bleeder'),
        role: 'wanderer',
        color: 0xb74848,
        glyph: 'V',
        flavor: lt(
            'Ухмыляющаяся солдатка правит нож о кожаный ремень, потемневший от старой крови.',
            'A grinning soldier strops a knife on a strip of leather older than your father.'
        ),
        backstoryHint: lt(
            'Она пережила войну, чьё имя уже не произносят. Война осталась у неё в руках.',
            'Veteran of a war whose name no living tongue still holds. She kept the war as a habit.'
        ),
        voice: {
            bossIntro: v(
                lt(
                    'Вет: "Пусти ему кровь первым. Это вежливо."',
                    'Veth: "Bleed it before it bleeds you. Etiquette."'
                ),
                lt(
                    'Вет: "Потом покажешь мне шрам. Я покажу свой."',
                    'Veth: "Show me a scar after. I\'ll trade you mine."'
                )
            ),
            farewell: v(
                lt(
                    'Вет: "Не умирай чисто. Это невежливо к ножу."',
                    'Veth: "Try not to die clean. Clean is dull."'
                ),
                lt(
                    'Вет: "Если умрёшь, нож не прячь. Я найду."',
                    'Veth: "If you die, leave the knife. I want it back."'
                )
            ),
            lowHpRecall: v(
                lt(
                    'Голос Вет почти радостен: "Вот! Так и выглядит тот, кто выжил!"',
                    'Veth\'s voice, gleeful: "There it is! That\'s the colour of a veteran!"'
                )
            ),
        },
        beats: [
            {
                stage: 'first',
                text: lt(
                    'Вет, не поднимая глаз: "Свежая кровь. Буквально. Хочешь контракт? Ты платишь телом, я — пользой."',
                    'Veth, without looking up: "New blood. Literally. Want a contract? You bleed for the next three rooms. I give you something the dungeon won\'t."'
                ),
            },
            {
                stage: 'first',
                tags: ['first-run'],
                text: lt(
                    'Вет щурится. "Первый раз? Хорошо. Новички честно боятся. Большинство отказывается. Большинство здесь и остаётся."',
                    'Veth squints. "First time? Lovely. I prefer first-timers - the deal terrifies them. You can say no, of course. Most do. The dungeon prefers most."'
                ),
            },
            {
                stage: 'return',
                text: lt(
                    'Вет скалится. "Постоянный клиент. Такие бегут к чему-то, а не от чего-то. Опасная привычка."',
                    'Veth grins so wide it shows the gap. "Ah! The repeat customer. I have a saying about repeat customers: they\'re running toward something."'
                ),
            },
            {
                stage: 'return',
                tags: ['bleeder'],
                text: lt(
                    'Вет: "Железом пахнет с коридора. Значит, тренировался." Она довольна.',
                    'Veth: "I can smell the iron on you from a corridor away. You\'ve been practicing." She is delighted.'
                ),
            },
            {
                stage: 'return',
                tags: ['low-hp'],
                text: lt(
                    'Вет стучит себя по рёбрам. "Ты пустоват. Залатайся, иначе контракт выйдет слишком честным."',
                    'Veth taps her own ribs. "You\'re running hollow. Patch up first, or we make a real contract."'
                ),
            },
            {
                stage: 'deep',
                tags: ['liked'],
                text: lt(
                    'Вет закатывает рукав. На коже длинный рифлёный шрам. "Флаг той войны стал пылью. Человека, который это сделал, я помню. А ты кого помнишь?"',
                    'Veth pulls back her sleeve. A long, ribbed scar. "Got this in a war whose flag is dust. The man who gave it to me - I miss him. Who do you miss?" She waits like she means it.'
                ),
            },
            {
                stage: 'deep',
                tags: ['trusted'],
                text: lt(
                    'Вет: "Когда смерть перестанешь считать, найди меня. Покажу третий разрез. Его подземелье не ждёт."',
                    'Veth: "When you\'ve died enough times to lose count, come find me. I\'ll teach you the third cut. The one the dungeon doesn\'t expect."'
                ),
            },
            {
                stage: 'deep',
                tags: ['wary'],
                text: lt(
                    'Вет резко: "Ты ходишь так, будто жить собрался. Не люблю такую самоуверенность."',
                    'Veth, sharp: "You walk like a man who plans to live forever. I find that - unsporting."'
                ),
            },
            {
                stage: 'farewell',
                text: lt(
                    'Вет: "Ступай. Кровь теряй с пользой."',
                    'Veth: "Off you go. Bleed creatively."'
                ),
            },
        ],
        offers: [
            {
                id: 'veth_challenge',
                label: lt('[{index}] Принять кровавый договор ({cost} ОЗ)', '[{index}] Accept the bleed pact ({cost} HP)'),
                flavor: lt(
                    'Вет деловито проводит короткую линию по предплечью.',
                    'Veth opens a small cut on your forearm with workmanlike care.'
                ),
            },
            {
                id: 'veth_lesson',
                label: lt('[{index}] Взять её урок ({cost} стресса)', '[{index}] Take her lesson ({cost} stress)'),
                flavor: lt(
                    'Ты запоминаешь третий разрез. Предплечье зудит ещё неделю.',
                    'You learn the third cut. Your forearm itches for a week.'
                ),
                requiresAffinity: 2,
            },
            {
                id: 'veth_strop',
                label: lt('[{index}] Заточить оружие (бесплатно, один раз)', '[{index}] Sharpen your weapon (free, once)'),
                flavor: lt(
                    'Она возвращает клинок тяжелее, будто добавила в него намерение.',
                    'She takes your blade, returns it heavier with intent.'
                ),
            },
        ],
    },

    chorister: {
        id: 'chorister',
        name: lt('Хорист', 'The Chorister'),
        title: lt('Поющий часы', 'who Sings the Hours'),
        role: 'shrine',
        color: 0x6cb6a8,
        glyph: 'O',
        flavor: lt(
            'Фигура в простой рясе держит тихую мелодию. Слова почти различимы.',
            'A figure in plain robes hums a tune that almost has words. The walls have gone quiet to listen.'
        ),
        backstoryHint: lt(
            'Когда-то он пел умирающим в моровые годы. Теперь поёт искателям. Говорит, работа та же.',
            'They sang for the dying in plague years. Now they sing for adventurers. The work, they say, is the same.'
        ),
        voice: {
            bossIntro: v(
                lt(
                    'Хорист тянет низкую ноту. Пульс чудовища сбивается.',
                    'The Chorister hums a low, steady note. The boss\'s pulse falters for half a measure.'
                ),
                lt(
                    'До тебя долетает строка: "...и коридор стал короче на один страх..."',
                    'A line of song reaches you: "...and the long hall opened, and was not so long after all..."'
                )
            ),
            farewell: v(
                lt(
                    'Хорист: "Шагай на три счёта. Это место плохо держит такой ритм."',
                    'The Chorister: "Walk to a measure of three. The dungeon dances poorly to it."'
                ),
                lt(
                    'Две тихие ноты ещё полшага идут рядом с тобой.',
                    'A sung blessing follows you, half a step out of the room.'
                )
            ),
            lowHpRecall: v(
                lt(
                    'Обрывок песни застревает в груди: "...рана помнит, но рука идёт дальше..."',
                    'A scrap of song catches in your chest: "...the hour the wound forgets is not yet now..."'
                )
            ),
        },
        beats: [
            {
                stage: 'first',
                text: lt(
                    'Хорист поёт не тебе, а рядом с тобой. Потом говорит: "Я пою то, что слушатель выдержит. Плати, чем можешь."',
                    'The Chorister sings - not at you, near you. When the verse ends, they say, "Songs cost. I sing what the listener needs. Pay what you can."'
                ),
            },
            {
                stage: 'first',
                tags: ['high-stress'],
                text: lt(
                    'Хорист обрывает ноту. "Ты пришёл слишком громким. Сядь." Он начинает заново, тише.',
                    'The Chorister stops mid-note. "Oh. Oh. You arrived loud. Sit. I have a tune for that." They begin again, softer.'
                ),
            },
            {
                stage: 'return',
                text: lt(
                    'Хорист улыбается. "Ты вернулся легче и тяжелее сразу. Обычное дело."',
                    'The Chorister smiles. "I remember your weight in the air. You\'ve come back lighter and heavier at once. The usual."'
                ),
            },
            {
                stage: 'return',
                tags: ['afflicted'],
                text: lt(
                    'Хорист коротко гудит. Нота ложится тебе на плечи. "Ослабить можно. Убрать нельзя. Всё равно сядь."',
                    'The Chorister hums sharply, and a held note settles on your shoulders. "It can be loosened. It cannot be unmade. Sit anyway."'
                ),
            },
            {
                stage: 'return',
                tags: ['virtuous'],
                text: lt(
                    'Хорист поднимает руки. "Сегодня ты звучишь даже молча. Я только подстрою тон."',
                    'The Chorister lifts both hands. "You sing, today, even when silent. I will only harmonise. It is cheaper that way."'
                ),
            },
            {
                stage: 'deep',
                tags: ['liked'],
                text: lt(
                    'Хорист: "Я пел брату, когда он перестал дышать. Теперь пою ту же песню. Паузы в ней для тебя."',
                    'The Chorister: "I sang for my brother on the day he stopped breathing. It is the same song I sing now, only with different rests. The rests are for you."'
                ),
            },
            {
                stage: 'deep',
                tags: ['trusted'],
                text: lt(
                    'Хорист: "Если падёшь, я впою твоё имя в длинный куплет. Спетые имена держатся дольше высеченных."',
                    'The Chorister: "When you fall, I will name you in the long verse. Names sung last longer than names carved." They do not look afraid for you, only fond.'
                ),
            },
            {
                stage: 'farewell',
                text: lt(
                    'Хорист оставляет за тобой две тихие ноты.',
                    'The Chorister hums two notes that follow you out.'
                ),
            },
        ],
        offers: [
            { id: 'chorister_relieve', label: lt('[{index}] Послушать песнь ({cost}з) - снять стресс', '[{index}] Be sung to ({cost}g) - relieve stress') },
            {
                id: 'chorister_resolve',
                label: lt('[{index}] Укрепить руки ({cost}з) - получить волю', '[{index}] Steady your hands ({cost}g) - gain resolve'),
            },
            {
                id: 'chorister_unbind',
                label: lt('[{index}] Убаюкать порчу ({cost} оск.)', '[{index}] Soothe the affliction ({cost} shards)'),
                flavor: lt(
                    'Песня держит треснувшую часть тебя. Не лечит, но не даёт распасться.',
                    'The song cradles the cracked thing in you. It does not heal. It carries.'
                ),
                requiresAffinity: 1,
            },
        ],
    },

    kessa: {
        id: 'kessa',
        name: lt('Кесса', 'Kessa'),
        title: lt('Выжившая', 'the Survivor'),
        role: 'wanderer',
        color: 0x8a8aa0,
        glyph: 'K',
        flavor: lt(
            'Женщина сидит спиной к стене. У углей стоят две кружки, одна нетронута.',
            'A woman sits with her back to a wall, sharing a fire with no one. There are two cups by the coals.'
        ),
        backstoryHint: lt(
            'Её сестра-близнец Сера погибла в рядовой вылазке. Кесса возвращается за телом, за тем днём или за обоими.',
            'Her twin Sera fell on a run that should have been routine. She comes back to look for the body, or the day Sera died, or both.'
        ),
        voice: {
            bossIntro: v(
                lt(
                    'Кесса из памяти: "Сера сказала, что будет легко. Дважды. Значит, уже боялась."',
                    'Kessa, from a memory: "Sera said this one would be easy. She said that twice."'
                ),
                lt(
                    'Голос Кессы держит тебя: "Смотри на левую сторону. Сера всегда смотрела налево."',
                    'You hear Kessa\'s voice steady you: "Watch its left side. She always said: watch the left side."'
                )
            ),
            farewell: v(
                lt(
                    'Кесса: "Не оставляй мне кружку у огня. Сегодня я могу не вернуться."',
                    'Kessa: "Don\'t leave a cup out for me. I won\'t come back tonight."'
                ),
                lt(
                    'Кесса коротко кивает. Даже это стоит ей сил.',
                    'Kessa nods once. It costs her something.'
                )
            ),
            lowHpRecall: v(
                lt(
                    'Кесса тихо: "Сера умирала похоже. Не продолжай."',
                    'Kessa, soft: "Sera died like this. Don\'t."'
                )
            ),
        },
        beats: [
            {
                stage: 'first',
                text: lt(
                    'Женщина у огня поднимает взгляд. "Садись. Чай есть. Или то, что здесь зовут чаем." Имени она не называет. Вторая кружка нетронута.',
                    'The woman by the fire glances up. "Sit. Or don\'t. There\'s tea, or what passes for it." She does not introduce herself. The second cup remains untouched.'
                ),
            },
            {
                stage: 'first',
                tags: ['first-run'],
                text: lt(
                    'Она смотрит на твои сапоги. "Первый спуск. Подошвы ещё не стёрты где надо." Потом тише: "Третья комната на любой глубине врёт."',
                    'She watches you arrive. "First descent. I can tell. Your boots aren\'t scuffed in the right places yet." She doesn\'t smile. "Mine were, once. Listen well. The third room of any depth is a liar."'
                ),
            },
            {
                stage: 'return',
                text: lt(
                    'Женщина выливает остывший чай из второй кружки и наливает новый. "Ты вернулся. Я тоже. Этого достаточно."',
                    'The woman tips the second cup over, empties old tea, refills it. "You came back. So did I. We don\'t have to talk about it." She gestures to the cup.'
                ),
            },
            {
                stage: 'return',
                tags: ['deep-run'],
                text: lt(
                    'Она медленно кивает. "Глубоко зашёл. Сера тоже дошла далеко. Не считай это советом."',
                    'She nods slowly. "Deep. Most don\'t make it this far on a second try. Sera did. Sera also didn\'t come back. Don\'t take that as advice."'
                ),
            },
            {
                stage: 'return',
                tags: ['high-stress'],
                text: lt(
                    'Она ставит кружку на пол. "Ты распускаешься по нитям. Я знаю этот взгляд. Садись." Она освобождает место.',
                    'She sets her cup down. "You\'re unspooling. I know that look. There\'s nothing to do for it but sit. Sit." She makes room.'
                ),
            },
            {
                stage: 'deep',
                tags: ['liked'],
                text: lt(
                    'Наконец она называет имя. "Кесса. Вторая кружка для Серы, моей сестры. Можешь пить из неё. Она бы не спорила."',
                    'She finally says her name. "Kessa. The other cup is for my sister. Sera. You don\'t need to drink from it. You can, if you want. She wouldn\'t mind."'
                ),
            },
            {
                stage: 'deep',
                tags: ['trusted'],
                text: lt(
                    'Кесса: "Если найдёшь тело в южном крыле — короткие волосы, латунная серьга слева — принеси серьгу. Только её." Голос ровный.',
                    'Kessa: "If you find a body in the south wing - short hair, brass earring on the left - bring me the earring. Just the earring. I don\'t want the rest." Her voice is level.'
                ),
            },
            {
                stage: 'deep',
                tags: ['wary'],
                text: lt(
                    'Вторая кружка сегодня пустая. Кесса не смотрит на тебя.',
                    'She has not refilled the second cup. She does not look at you when you arrive.'
                ),
            },
            {
                stage: 'farewell',
                text: lt(
                    'Кесса: "Иди осторожно. Или как получится. Только иди."',
                    'Kessa: "Walk careful. Or don\'t. Just walk."'
                ),
            },
        ],
        offers: [
            {
                id: 'kessa_tea',
                label: lt('[{index}] Разделить чай (бесплатно)', '[{index}] Share the tea (free)'),
                flavor: lt(
                    'Сначала горько, потом тепло. Руки перестают дрожать.',
                    'Bitter, then warm. You feel steadier than you ought to.'
                ),
            },
            {
                id: 'kessa_warning',
                label: lt('[{index}] Спросить о дороге впереди', '[{index}] Ask about the road ahead'),
                flavor: lt(
                    'Она чертит маршрут в золе кончиком пальца.',
                    'She sketches a route in the ash with a finger.'
                ),
            },
            {
                id: 'kessa_token',
                label: lt('[{index}] Принять жетон Серы', '[{index}] Accept Sera\'s token'),
                flavor: lt(
                    'Маленькая латунная вещь. В ладони едва гудит.',
                    'A small brass thing. It hums faintly when held.'
                ),
                requiresAffinity: 3,
            },
        ],
    },
};

export const ALL_NPC_IDS: NpcId[] = ['mira', 'casimir', 'hollow', 'veth', 'chorister', 'kessa'];

export function npcRoleOf(id: NpcId): NpcRole {
    return NPCS[id].role;
}
