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
        'The door closes behind you. The darkness is patient.',
        'Forward, then. The dungeon notices.',
        'Another expedition, another wound on this place.',
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
        'The dungeon rises to meet you. Stand fast.',
        'Everything you learned is being tested at once.',
        'A ruler claims this floor. Claim it back.',
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
        'The dungeon adds another name to its walls.',
        'Ruin arrives on time, as it always does.',
    ],
};

export function narrate(event: NarrationEvent): string {
    const pool = LINES[event];
    if (!pool || pool.length === 0) return '';
    return pool[Math.floor(Math.random() * pool.length)];
}
