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
    text: string;
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
    name: string;
    title: string;
    role: NpcRole;
    color: number;       // tint for portrait card
    glyph: string;       // single character used as portrait icon
    flavor: string;      // 1-line scene description shown above dialog
    backstoryHint: string; // short blurb shown after deep-bond
    voice: {
        // Used for combat/boss intros. Picked by hashing depth+id.
        bossIntro: string[];
        farewell: string[];
        lowHpRecall: string[];
    };
    beats: NpcDialogBeat[];
    // Pool of services/options the NPC offers. The Scene maps these to
    // concrete callbacks. We only describe the *menu*, not the effect.
    offers: NpcOfferTemplate[];
}

export interface NpcOfferTemplate {
    id: string;                 // stable id ("mira_lantern", "veth_challenge")
    label: string;              // button text, may include `{cost}` token
    flavor?: string;            // optional one-liner shown when chosen
    requiresAffinity?: number;  // hidden until met-count or affinity reached
    onlyAfterMet?: number;      // hidden until metCount >= n
}

// Voice palette helper for code-readability.
const v = (...lines: string[]) => lines;

export const NPCS: Record<NpcId, NpcProfile> = {
    mira: {
        id: 'mira',
        name: 'Mira',
        title: 'the Lantern-Bearer',
        role: 'merchant',
        color: 0xd9a14a,
        glyph: 'M',
        flavor: 'A woman in a soot-stained coat tends six lanterns, one for each name she still says at night.',
        backstoryHint: 'She lost her party at depth twelve. She kept the lanterns. They are why she came back.',
        voice: {
            bossIntro: v(
                'Mira: "Light it now. Don\'t make me read your name into a lantern."',
                'Mira: "I can hold the line for one breath. Use it well."'
            ),
            farewell: v(
                'Mira: "Go quietly. Loud light burns out faster."',
                'Mira: "Don\'t become another wick I have to keep burning."'
            ),
            lowHpRecall: v(
                'You remember Mira\'s hand on your shoulder: "Bleed slower. The dark has all night."'
            ),
        },
        beats: [
            {
                stage: 'first',
                text:
                    'Mira: "First descent? Sit a moment. I sell lantern oil and patience, in that order. ' +
                    'Don\'t buy the second; I haven\'t much left."',
            },
            {
                stage: 'first',
                tags: ['first-run'],
                text:
                    'Mira: "I knew six people who came in lighter than you. Don\'t be a seventh." ' +
                    'She nudges a small lantern toward you without naming a price.',
            },
            {
                stage: 'return',
                text:
                    'Mira: "You again. The dark spat you back. That happens — for a while." ' +
                    'She taps a lantern. "Cheaper this time. I keep tabs."',
            },
            {
                stage: 'return',
                tags: ['high-stress'],
                text:
                    'Mira: "You\'re humming at the edges. I\'ve seen that. Sit. Buy nothing. Just sit." ' +
                    'She doesn\'t look at you while you breathe.',
            },
            {
                stage: 'return',
                tags: ['low-hp'],
                text:
                    'Mira: "You\'re leaking. I\'m a lantern-keeper, not a surgeon — but I\'ll wrap that for what coin you have."',
            },
            {
                stage: 'return',
                tags: ['relic-rich'],
                text:
                    'Mira: "Things on you that hum. Be careful what they whisper when you\'re tired." ' +
                    'She touches her own coat over her sternum.',
            },
            {
                stage: 'deep',
                tags: ['liked'],
                text:
                    'Mira lifts the smallest lantern. "Bren\'s. He didn\'t make it past the third gate. ' +
                    'I light it when I see someone who reminds me of him." Her eyes don\'t leave yours.',
            },
            {
                stage: 'deep',
                tags: ['trusted'],
                text:
                    'Mira: "If you don\'t come back this time… I\'ll add a seventh wick. ' +
                    'I would rather not." She presses an oil-stained ring into your palm without explanation.',
            },
            {
                stage: 'deep',
                tags: ['wary'],
                text:
                    'Mira: "You spend like a man who plans to be missed. Don\'t expect me to remember the missing." ' +
                    'She turns three lanterns away from you.',
            },
            {
                stage: 'farewell',
                text: 'Mira: "Walk soft. The dungeon listens for hurry."',
            },
        ],
        offers: [
            { id: 'mira_potion', label: '[1] Buy potion ({cost}g)' },
            { id: 'mira_lantern', label: '[2] Refill lantern ({cost}g)' },
            { id: 'mira_armor', label: '[3] Buy armor ({cost}g)' },
            {
                id: 'mira_relic_oil',
                label: '[4] Relic oil ({cost} shards)',
                flavor: 'She watches you accept it like she\'s memorising your face.',
                requiresAffinity: 2,
            },
        ],
    },

    casimir: {
        id: 'casimir',
        name: 'Brother Casimir',
        title: 'the Defrocked',
        role: 'shrine',
        color: 0x7e6cb6,
        glyph: 'C',
        flavor: 'A man kneels before an altar with no god\'s name on it. He is praying anyway.',
        backstoryHint: 'They struck his name from the order for blessing what he found beneath the sanctuary. He stayed.',
        voice: {
            bossIntro: v(
                'Casimir: "I did not pray for you to win. I prayed for you to mean it."',
                'Casimir whispers a name that is not yours. The altar listens.'
            ),
            farewell: v(
                'Casimir: "Go in error, child. There is no other way."',
                'Casimir: "Confess later. Survive first."'
            ),
            lowHpRecall: v(
                'Casimir\'s voice, from a memory: "Grace is what you do bleeding."'
            ),
        },
        beats: [
            {
                stage: 'first',
                text:
                    'Brother Casimir does not look up. "There used to be a name carved here. They scraped it off. ' +
                    'I find I pray better to the gouge than I ever did to the name."',
            },
            {
                stage: 'first',
                tags: ['high-stress'],
                text:
                    'Casimir: "You arrive trembling. Good. Trembling is the only honest posture in this place." ' +
                    'He gestures you to kneel without ceremony.',
            },
            {
                stage: 'return',
                text:
                    'Casimir: "Back, then. The altar likes returners. They have *committed.*" ' +
                    'He smiles like a man who has lost the right to.',
            },
            {
                stage: 'return',
                tags: ['afflicted'],
                text:
                    'Casimir leans closer. "The crack has opened, hasn\'t it. Don\'t close it. ' +
                    'Closed cracks are how light is denied entry. Pray *into* the wound."',
            },
            {
                stage: 'return',
                tags: ['virtuous'],
                text:
                    'Casimir flinches almost imperceptibly. "You are radiant today. ' +
                    'I prefer you broken — it is more theologically honest. But: bless what you can."',
            },
            {
                stage: 'return',
                tags: ['bleeder'],
                text:
                    'Casimir: "The altar tastes you. Iron. Old iron. ' +
                    'You\'ve been generous with what runs through you. It will remember."',
            },
            {
                stage: 'deep',
                tags: ['liked'],
                text:
                    'Casimir: "I confess to you, since no one else asks. The blessing I gave the third gate? ' +
                    'It worked. That is the heresy. It *worked.*"',
            },
            {
                stage: 'deep',
                tags: ['trusted'],
                text:
                    'Casimir presses his thumb to your forehead. "When you fall — and you will — fall facing the altar. ' +
                    'I will know where to dig."',
            },
            {
                stage: 'deep',
                tags: ['wary'],
                text:
                    'Casimir: "You step lightly here. Light steps offend the floor. ' +
                    'The floor remembers." He does not bless you.',
            },
            {
                stage: 'farewell',
                text: 'Casimir: "Go. Doubt freely."',
            },
        ],
        offers: [
            { id: 'casimir_pray', label: '[1] Pray' },
            { id: 'casimir_offer', label: '[2] Offer ({cost}g)' },
            {
                id: 'casimir_rite',
                label: '[3] Rite of relic ({cost} shards)',
                flavor: 'The altar takes the shards. Something in the floor inhales.',
                requiresAffinity: 1,
            },
        ],
    },

    hollow: {
        id: 'hollow',
        name: 'The Hollow Trader',
        title: 'No-Face',
        role: 'merchant',
        color: 0x4a3a5a,
        glyph: '?',
        flavor: 'A stooped figure waits behind a low table. The cloth where its face should be is unbroken.',
        backstoryHint: 'They say it was a survivor once. Then it traded something it should have kept. Now it trades the rest.',
        voice: {
            bossIntro: v(
                'The Hollow Trader does not speak. The air, however, sells you something you did not choose.',
                'A whisper, not in your ear, not in the room: "The transaction has begun."'
            ),
            farewell: v(
                'The Hollow Trader marks something on a ledger you cannot read.',
                'The figure tilts where its face should tilt. The deal is closed.'
            ),
            lowHpRecall: v(
                'You feel the Hollow Trader\'s ledger, somewhere, gain a tally.'
            ),
        },
        beats: [
            {
                stage: 'first',
                text:
                    'The Hollow Trader inclines what serves as a head. ' +
                    'A voice that is not quite a voice: "Trades. Only trades. ' +
                    'Bring something you can spare. Leave with something you cannot."',
            },
            {
                stage: 'return',
                text:
                    'The Hollow Trader makes a small sound — almost a laugh. ' +
                    '"Returned. Few do. The price will adjust."',
            },
            {
                stage: 'return',
                tags: ['relic-rich'],
                text:
                    'The Hollow Trader lifts a hand. The relics on you settle, as if recognising a sibling. ' +
                    '"You carry. We can rearrange."',
            },
            {
                stage: 'return',
                tags: ['low-hp'],
                text:
                    'The Hollow Trader tilts. "You are nearly empty. We could buy the rest of you for very little. ' +
                    'A poor deal — for you. Acceptable — for us."',
            },
            {
                stage: 'deep',
                tags: ['trusted'],
                text:
                    'The Hollow Trader, for the first time, lifts the cloth. There is nothing under it but a question. ' +
                    'The question is your name. You feel it being filed.',
            },
            {
                stage: 'deep',
                tags: ['wary'],
                text:
                    'The Hollow Trader does not turn toward you. The table is empty. The table has always been empty.',
            },
            {
                stage: 'farewell',
                text: 'A faint sigh, like ledgers closing.',
            },
        ],
        offers: [
            {
                id: 'hollow_relic_for_hp',
                label: '[1] Trade {cost} HP for a relic',
                flavor: 'Something inside you answers: it is willing.',
            },
            {
                id: 'hollow_shards_for_relic',
                label: '[2] Trade {cost} shards for a unique relic',
                flavor: 'The shards do not click against the table. They *arrive.*',
                onlyAfterMet: 1,
            },
            {
                id: 'hollow_potion_for_gold',
                label: '[3] Sell potion → gain {cost}g',
                flavor: 'It does not look at the potion, only at the absence it leaves.',
            },
        ],
    },

    veth: {
        id: 'veth',
        name: 'Veth',
        title: 'the Bleeder',
        role: 'wanderer',
        color: 0xb74848,
        glyph: 'V',
        flavor: 'A grinning soldier strops a knife on a strip of leather older than your father.',
        backstoryHint: 'Veteran of a war whose name no living tongue still holds. She kept the war as a habit.',
        voice: {
            bossIntro: v(
                'Veth: "Bleed it before it bleeds you. Etiquette."',
                'Veth: "Show me a scar after. I\'ll trade you mine."'
            ),
            farewell: v(
                'Veth: "Try not to die clean. Clean is dull."',
                'Veth: "If you die, leave the knife. I want it back."'
            ),
            lowHpRecall: v(
                'Veth\'s voice, gleeful: "There it is! That\'s the colour of a veteran!"'
            ),
        },
        beats: [
            {
                stage: 'first',
                text:
                    'Veth, without looking up: "New blood. Literally. Want a contract? ' +
                    'You bleed for the next three rooms. I give you something the dungeon won\'t."',
            },
            {
                stage: 'first',
                tags: ['first-run'],
                text:
                    'Veth squints. "First time? Lovely. I prefer first-timers — the deal terrifies them. ' +
                    'You can say no, of course. Most do. The dungeon prefers most."',
            },
            {
                stage: 'return',
                text:
                    'Veth grins so wide it shows the gap. "Ah! The repeat customer. ' +
                    'I have a saying about repeat customers: they\'re running *toward* something."',
            },
            {
                stage: 'return',
                tags: ['bleeder'],
                text:
                    'Veth: "I can smell the iron on you from a corridor away. ' +
                    'You\'ve been *practicing.*" She is delighted.',
            },
            {
                stage: 'return',
                tags: ['low-hp'],
                text:
                    'Veth taps her own ribs. "You\'re running hollow. Patch up first, or we make a *real* contract."',
            },
            {
                stage: 'deep',
                tags: ['liked'],
                text:
                    'Veth pulls back her sleeve. A long, ribbed scar. ' +
                    '"Got this in a war whose flag is dust. The man who gave it to me — I miss him. ' +
                    'Who do you miss?" She waits like she means it.',
            },
            {
                stage: 'deep',
                tags: ['trusted'],
                text:
                    'Veth: "When you\'ve died enough times to lose count, come find me. ' +
                    'I\'ll teach you the third cut. The one the dungeon doesn\'t expect."',
            },
            {
                stage: 'deep',
                tags: ['wary'],
                text:
                    'Veth, sharp: "You walk like a man who plans to live forever. ' +
                    'I find that — *unsporting.*"',
            },
            {
                stage: 'farewell',
                text: 'Veth: "Off you go. Bleed creatively."',
            },
        ],
        offers: [
            {
                id: 'veth_challenge',
                label: '[1] Accept the bleed pact ({cost} HP)',
                flavor: 'Veth opens a small cut on your forearm with workmanlike care.',
            },
            {
                id: 'veth_lesson',
                label: '[2] Take her lesson ({cost} stress)',
                flavor: 'You learn the third cut. Your forearm itches for a week.',
                requiresAffinity: 2,
            },
            {
                id: 'veth_strop',
                label: '[3] Sharpen your weapon (free, once)',
                flavor: 'She takes your blade, returns it heavier with intent.',
            },
        ],
    },

    chorister: {
        id: 'chorister',
        name: 'The Chorister',
        title: 'who Sings the Hours',
        role: 'shrine',
        color: 0x6cb6a8,
        glyph: 'O',
        flavor: 'A figure in plain robes hums a tune that almost has words. The walls have gone quiet to listen.',
        backstoryHint: 'They sang for the dying in plague years. Now they sing for adventurers. The work, they say, is the same.',
        voice: {
            bossIntro: v(
                'The Chorister hums a low, steady note. The boss\'s pulse falters for half a measure.',
                'A line of song reaches you: "...and the long hall opened, and was not so long after all..."'
            ),
            farewell: v(
                'The Chorister: "Walk to a measure of three. The dungeon dances poorly to it."',
                'A sung blessing follows you, half a step out of the room.'
            ),
            lowHpRecall: v(
                'A scrap of song catches in your chest: "...the hour the wound forgets is not yet now..."'
            ),
        },
        beats: [
            {
                stage: 'first',
                text:
                    'The Chorister sings — not at you, near you. ' +
                    'When the verse ends, they say, "Songs cost. I sing what the listener needs. Pay what you can."',
            },
            {
                stage: 'first',
                tags: ['high-stress'],
                text:
                    'The Chorister stops mid-note. "Oh. *Oh.* You arrived loud. Sit. ' +
                    'I have a tune for that." They begin again, softer.',
            },
            {
                stage: 'return',
                text:
                    'The Chorister smiles. "I remember your weight in the air. ' +
                    'You\'ve come back lighter and heavier at once. The usual."',
            },
            {
                stage: 'return',
                tags: ['afflicted'],
                text:
                    'The Chorister hums sharply, and a held note settles on your shoulders. ' +
                    '"It can be loosened. It cannot be unmade. Sit anyway."',
            },
            {
                stage: 'return',
                tags: ['virtuous'],
                text:
                    'The Chorister lifts both hands. "You sing, today, even when silent. ' +
                    'I will only harmonise. It is cheaper that way."',
            },
            {
                stage: 'deep',
                tags: ['liked'],
                text:
                    'The Chorister: "I sang for my brother on the day he stopped breathing. ' +
                    'It is the same song I sing now, only with different rests. The rests are for you."',
            },
            {
                stage: 'deep',
                tags: ['trusted'],
                text:
                    'The Chorister: "When you fall, I will name you in the long verse. ' +
                    'Names sung last longer than names carved." They do not look afraid for you, only fond.',
            },
            {
                stage: 'farewell',
                text: 'The Chorister hums two notes that follow you out.',
            },
        ],
        offers: [
            { id: 'chorister_relieve', label: '[1] Be sung to ({cost}g) — relieve stress' },
            {
                id: 'chorister_resolve',
                label: '[2] Steady your hands ({cost}g) — gain resolve',
            },
            {
                id: 'chorister_unbind',
                label: '[3] Soothe the affliction ({cost} shards)',
                flavor: 'The song cradles the cracked thing in you. It does not heal. It carries.',
                requiresAffinity: 1,
            },
        ],
    },

    kessa: {
        id: 'kessa',
        name: 'Kessa',
        title: 'the Survivor',
        role: 'wanderer',
        color: 0x8a8aa0,
        glyph: 'K',
        flavor: 'A woman sits with her back to a wall, sharing a fire with no one. There are two cups by the coals.',
        backstoryHint: 'Her twin Sera fell on a run that should have been routine. She comes back to look for the body, or the day Sera died, or both.',
        voice: {
            bossIntro: v(
                'Kessa, from a memory: "Sera said this one would be easy. She said that twice."',
                'You hear Kessa\'s voice steady you: "Watch its left side. She always said: watch the left side."'
            ),
            farewell: v(
                'Kessa: "Don\'t leave a cup out for me. I won\'t come back tonight."',
                'Kessa nods once. It costs her something.'
            ),
            lowHpRecall: v(
                'Kessa, soft: "Sera died like this. Don\'t."'
            ),
        },
        beats: [
            {
                stage: 'first',
                text:
                    'The woman by the fire glances up. "Sit. Or don\'t. There\'s tea, or what passes for it." ' +
                    'She does not introduce herself. The second cup remains untouched.',
            },
            {
                stage: 'first',
                tags: ['first-run'],
                text:
                    'She watches you arrive. "First descent. I can tell. Your boots aren\'t scuffed in the right places yet." ' +
                    'She doesn\'t smile. "Mine were, once. Listen well. The third room of any depth is a liar."',
            },
            {
                stage: 'return',
                text:
                    'The woman tips the second cup over, empties old tea, refills it. ' +
                    '"You came back. So did I. We don\'t have to talk about it." She gestures to the cup.',
            },
            {
                stage: 'return',
                tags: ['deep-run'],
                text:
                    'She nods slowly. "Deep. Most don\'t make it this far on a second try. ' +
                    'Sera did. Sera also didn\'t come back. Don\'t take that as advice."',
            },
            {
                stage: 'return',
                tags: ['high-stress'],
                text:
                    'She sets her cup down. "You\'re unspooling. I know that look. ' +
                    'There\'s nothing to do for it but sit. Sit." She makes room.',
            },
            {
                stage: 'deep',
                tags: ['liked'],
                text:
                    'She finally says her name. "Kessa. The other cup is for my sister. Sera. ' +
                    'You don\'t need to drink from it. You can, if you want. She wouldn\'t mind."',
            },
            {
                stage: 'deep',
                tags: ['trusted'],
                text:
                    'Kessa: "If you find a body in the south wing — short hair, brass earring on the left — bring me the earring. ' +
                    'Just the earring. I don\'t want the rest." Her voice is level.',
            },
            {
                stage: 'deep',
                tags: ['wary'],
                text:
                    'She has not refilled the second cup. She does not look at you when you arrive.',
            },
            {
                stage: 'farewell',
                text: 'Kessa: "Walk careful. Or don\'t. Just walk."',
            },
        ],
        offers: [
            {
                id: 'kessa_tea',
                label: '[1] Share the tea (free)',
                flavor: 'Bitter, then warm. You feel steadier than you ought to.',
            },
            {
                id: 'kessa_warning',
                label: '[2] Ask about the road ahead',
                flavor: 'She sketches a route in the ash with a finger.',
            },
            {
                id: 'kessa_token',
                label: '[3] Accept Sera\'s token',
                flavor: 'A small brass thing. It hums faintly when held.',
                requiresAffinity: 3,
            },
        ],
    },
};

export const ALL_NPC_IDS: NpcId[] = ['mira', 'casimir', 'hollow', 'veth', 'chorister', 'kessa'];

export function npcRoleOf(id: NpcId): NpcRole {
    return NPCS[id].role;
}
