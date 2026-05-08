import type { LocalizedText } from './LocalizedText';
import { lt } from './LocalizedText';

// Cast of NPCs the player meets across runs. Only Sara and Gogi exist.

export type NpcId = 'sara' | 'gogi';

export type NpcRole = 'merchant' | 'wanderer';

export interface NpcDialogBeat {
    stage: 'first' | 'return' | 'deep' | 'farewell';
    tags?: NpcStateTag[];
    text: LocalizedText;
}

export type NpcStateTag =
    | 'liked'
    | 'trusted'
    | 'wary'
    | 'low-hp'
    | 'bleeder'
    | 'relic-rich'
    | 'deep-run'
    | 'first-run';

export interface NpcProfile {
    id: NpcId;
    name: LocalizedText;
    title: LocalizedText;
    role: NpcRole;
    color: number;
    glyph: string;
    flavor: LocalizedText;
    backstoryHint: LocalizedText;
    voice: {
        bossIntro: LocalizedText[];
        farewell: LocalizedText[];
        lowHpRecall: LocalizedText[];
    };
    beats: NpcDialogBeat[];
    offers: NpcOfferTemplate[];
}

export interface NpcOfferTemplate {
    id: string;
    label: LocalizedText;
    flavor?: LocalizedText;
    requiresAffinity?: number;
    onlyAfterMet?: number;
}

const v = (...lines: LocalizedText[]) => lines;

export const NPCS: Record<NpcId, NpcProfile> = {
    sara: {
        id: 'sara',
        name: lt('Сара', 'Sara'),
        title: lt('Незнакомка', 'the Stranger'),
        role: 'wanderer',
        color: 0x8a6cb6,
        glyph: 'S',
        flavor: lt(
            'Молчаливая фигура стоит у стены. Она не выглядит угрожающе.',
            'A quiet figure stands by the wall. She does not look threatening.'
        ),
        backstoryHint: lt(
            'Никто не знает, откуда она. Она просто всегда здесь.',
            'Nobody knows where she came from. She is just always here.'
        ),
        voice: {
            bossIntro: v(
                lt(
                    'Сара: "Удачи. Надеюсь, ты выживешь."',
                    'Sara: "Good luck. I hope you survive."'
                )
            ),
            farewell: v(
                lt(
                    'Сара: "Ступай осторожно."',
                    'Sara: "Tread carefully."'
                )
            ),
            lowHpRecall: v(
                lt(
                    'Голос Сары из памяти: "Надеюсь, ты выживешь."',
                    'Sara\'s voice, from a memory: "I hope you survive."'
                )
            ),
        },
        beats: [
            {
                stage: 'first',
                text: lt(
                    'Сара: "Здравствуй. Ты какой-то мрачноватый."',
                    'Sara: "Hello. You look rather grim."'
                ),
            },
            {
                stage: 'return',
                text: lt(
                    'Сара: "Снова ты. Рада видеть."',
                    'Sara: "You again. Glad to see you."'
                ),
            },
            {
                stage: 'deep',
                tags: ['liked'],
                text: lt(
                    'Сара: "Ты всё ещё здесь. Это хорошо."',
                    'Sara: "You are still here. That is good."'
                ),
            },
            {
                stage: 'farewell',
                text: lt(
                    'Сара: "Ступай осторожно."',
                    'Sara: "Tread carefully."'
                ),
            },
        ],
        offers: [
            {
                id: 'sara_where',
                label: lt('[{index}] Где я?', '[{index}] Where am I?'),
                flavor: lt(
                    'Сара: "Мне бы кто сказал."',
                    'Sara: "I wish someone would tell me."'
                ),
            },
            {
                id: 'sara_who',
                label: lt('[{index}] Кто ты?', '[{index}] Who are you?'),
                flavor: lt(
                    'Сара: "Я? Да никто."',
                    'Sara: "Me? Nobody."'
                ),
            },
            {
                id: 'sara_right',
                label: lt('[{index}] Ты права', '[{index}] You are right'),
                flavor: lt(
                    'Сара: "И хладнокровный. Надеюсь ты выживешь. Хочешь совет?"',
                    'Sara: "And cold-blooded. I hope you survive. Want some advice?"'
                ),
            },
        ],
    },

    gogi: {
        id: 'gogi',
        name: lt('Гоги', 'Gogi'),
        title: lt('Делец', 'the Dealer'),
        role: 'merchant',
        color: 0xb6a44a,
        glyph: 'G',
        flavor: lt(
            'Ухмыляющийся мужчина сидит у стены и считает монеты.',
            'A grinning man sits by the wall counting coins.'
        ),
        backstoryHint: lt(
            'Говорят, он продаёт что-то полезное. За цену.',
            'They say he sells something useful. For a price.'
        ),
        voice: {
            bossIntro: v(
                lt(
                    'Гоги: "Удачи, дружок. Ты мой любимый клиент."',
                    'Gogi: "Good luck, pal. You are my favourite customer."'
                )
            ),
            farewell: v(
                lt(
                    'Гоги: "Приходи ещё, ахах."',
                    'Gogi: "Come back again, haha."'
                )
            ),
            lowHpRecall: v(
                lt(
                    'Голос Гоги: "Надо было покупать, ахах."',
                    'Gogi\'s voice: "Should have bought it, haha."'
                )
            ),
        },
        beats: [
            {
                stage: 'first',
                text: lt(
                    'Гоги: "Еще один, ахах, сегодня час пик."',
                    'Gogi: "Another one, haha, rush hour today."'
                ),
            },
            {
                stage: 'return',
                text: lt(
                    'Гоги: "Ты опять? Ахах, добро пожаловать."',
                    'Gogi: "You again? Haha, welcome back."'
                ),
            },
            {
                stage: 'deep',
                tags: ['liked'],
                text: lt(
                    'Гоги: "Ты живучий. Мне нравится."',
                    'Gogi: "You are a survivor. I like that."'
                ),
            },
            {
                stage: 'farewell',
                text: lt(
                    'Гоги: "Удачи, клиент."',
                    'Gogi: "Good luck, customer."'
                ),
            },
        ],
        offers: [
            {
                id: 'gogi_what',
                label: lt('[{index}] Ты о чём?', '[{index}] What do you mean?'),
                flavor: lt(
                    'Гоги: "Неважно. Совет хочешь? Он стоит 10 монет."',
                    'Gogi: "Doesn\'t matter. Want advice? It costs 10 gold."'
                ),
            },
            {
                id: 'gogi_who',
                label: lt('[{index}] Кто ты?', '[{index}] Who are you?'),
                flavor: lt(
                    'Гоги: "Твой шанс прожить чуть подольше. 10 монет есть?"',
                    'Gogi: "Your chance to live a little longer. Got 10 gold?"'
                ),
            },
        ],
    },
};

export const ALL_NPC_IDS: NpcId[] = ['sara', 'gogi'];

export function npcRoleOf(id: NpcId): NpcRole {
    return NPCS[id].role;
}
