/**
 * [FIX-1, FIX-10] Boss phase blueprints.
 *
 * Each boss has 1+ phases; a phase becomes active when the boss's HP
 * fraction first drops to or below `enterAtHpRatio`. On entry the
 * `onEnter` block applies (atk bonus, light cap, etc.).
 * During the phase the boss cycles through `actions` in order;
 * the next action's `intent` is shown to the player BEFORE the boss's
 * turn so the player can adapt.
 *
 * The action effects below are interpreted by
 * `CombatManager.runBossAction` — adding a new action `id` here
 * requires extending the switch in CombatManager.
 */
import type { Language } from '../systems/Localization';

/** Locale-aware label. Mirrors LocalizedText but stays free of import
 *  cycles; CombatManager picks the right one from the Localization
 *  object's language. */
interface BossLine {
    en: string;
    ru: string;
}

export function pickLine(line: BossLine, lang: Language): string {
    return lang === 'ru' ? line.ru : line.en;
}

type BossActionId =
    | 'attack'
    | 'death_shield'
    | 'death_touch'
    | 'nimrod_godkiller'
    | 'hero_call'
    | 'mime_chaos';

export interface BossActionDef {
    id: BossActionId;
    /** Player-facing intent label shown before the boss's turn. */
    intent: BossLine;
    /** Optional flat damage bonus added to base attack on this action. */
    damageBonus?: number;
    /** True when this action does no attack damage on resolution. */
    noAttack?: boolean;
    /**
     * Number of full boss turns the action spends "winding up" before
     * its effect resolves. While the windup ticks down, the boss takes
     * no other action; the player sees a "{action} (Nt)" intent badge
     * and can react accordingly.
     */
    windupTurns?: number;
    /** Block pool granted to the boss when the action resolves (Death Shield). */
    pendingBlock?: number;
    /** How many boss turns the granted block stays up unless knocked off. */
    pendingBlockTurns?: number;
    /** True when resolution is a one-shot kill (Death Touch). */
    oneShot?: boolean;
    /** Damage dealt instead of the OHKO when the player Defends on resolution. */
    oneShotDefendDamage?: number;
    /**
     * Gilgamesh's "Hero's Cry": chance per turn to also drain
     * `heroCryDrain.attack` weaken / `heroCryDrain.defense` armorBreak
     * for the rest of the fight (turns: 99) and 1 resolve from the
     * player. The boss still does its regular attack on top —
     * `id: 'hero_call'` actions roll the cry, then fall through to
     * the normal attack pipeline.
     */
    heroCryChance?: number;
    heroCryDrain?: {
        attackWeaken: number;
        defenseArmorBreak: number;
        resolveDrain: number;
        turns: number;
    };
    /**
     * Mime's "Chaos Lord's Laughter": every turn the boss applies one
     * random status from `randomStatus.pool` to the player. The same
     * status cannot fire twice in a row (anti-repeat tracked via
     * `BossPhaseState.lastRandomStatus`). Each status uses
     * `randomStatus.amount` / `randomStatus.turns` for its parameters.
     */
    randomStatus?: {
        pool: Array<'bleed' | 'poison' | 'stun' | 'weaken' | 'armorBreak' | 'mark'>;
        amount: number;
        turns: number;
    };
    /** Mime's swings bypass defense entirely (true damage). */
    ignoreArmor?: boolean;
    /** Mime heals a flat amount whenever a regular attack lands damage. */
    lifestealFlat?: number;
}

interface BossPhaseDef {
    /** HP ratio (0..1) at or below which this phase activates. Phases
     *  are evaluated top-down, so list them in descending order. */
    enterAtHpRatio: number;
    actions: BossActionDef[];
    /** Optional name shown in the combat log on phase change. */
    label?: BossLine;
    /** Mammon's "Greed Lord" once-per-fight relic theft. When this
     *  flag is set on a phase entry, the boss steals one random relic
     *  from the player's inventory; the stolen id is preserved on
     *  `ActiveEnemy.stolenRelicId` and returned on death. */
    onEnterStealRelic?: boolean;
    /** Optional flat attack bonus applied on phase entry (Prophet's
     *  fury bonus uses {@link BossBlueprint.resurrectOnDeath} instead,
     *  but other bosses can layer flat buffs here). */
    onEnterAttackBonus?: number;
}

export interface BossBlueprint {
    /** Must match an EnemyDef.name in BOSSES. */
    name: string;
    phases: BossPhaseDef[];
    /**
     * Prophet's "Furious Resurrection": once per encounter, the first
     * time the boss's HP drops to 0, restore HP to
     * `maxHp * hpFraction` and multiply current attack by
     * `attackMultiplier`. Resolves in `processTurn` BEFORE
     * finishCombat. After the resurrection the boss continues from
     * phase 1 onwards (the resurrection consumes the boss's death
     * trigger; subsequent kills go through the normal finishCombat
     * pipeline).
     */
    resurrectOnDeath?: {
        hpFraction: number;
        attackMultiplier: number;
    };
}

// ---------------------------------------------------------------------------
// Boss blueprints.
// ---------------------------------------------------------------------------

const BOSS_BLUEPRINTS: BossBlueprint[] = [
    {
        name: 'Death Knight',
        phases: [
            {
                enterAtHpRatio: 1.0,
                // Single-phase rotation per spec: a basic strike, then a
                // 1-turn windup `death_shield` (block 15 for 3 turns,
                // breakable by Will-skill damage), another basic strike,
                // and finally a 3-turn windup `death_touch` OHKO that
                // softens to 8 dmg if the player Defends on the resolution
                // turn. CombatManager.runBossTurn interprets these.
                actions: [
                    {
                        id: 'attack',
                        intent: { en: 'test_intent_dark_slash', ru: 'тест_намерение_тёмный_удар' },
                    },
                    {
                        id: 'death_shield',
                        intent: { en: 'test_intent_death_shield', ru: 'тест_намерение_щит_смерти' },
                        noAttack: true,
                        windupTurns: 1,
                        pendingBlock: 15,
                        pendingBlockTurns: 3,
                    },
                    {
                        id: 'attack',
                        intent: { en: 'test_intent_dark_slash', ru: 'тест_намерение_тёмный_удар' },
                    },
                    {
                        id: 'death_touch',
                        intent: {
                            en: 'test_intent_death_touch',
                            ru: 'тест_намерение_касание_смерти',
                        },
                        noAttack: true,
                        windupTurns: 3,
                        oneShot: true,
                        oneShotDefendDamage: 8,
                    },
                ],
            },
        ],
    },
    {
        // Nimrod, "the God-Killer": single-phase rotation that opens
        // with a 5-turn `nimrod_godkiller` windup and resolves into an
        // unconditional one-shot kill. Defend does NOT soften it (no
        // `oneShotDefendDamage` set) — the only counterplay is to
        // burst Nimrod down before the windup ticks out. His regular
        // attack stat is 0 (per the design sheet) so the `attack`
        // padding actions in the rotation are a no-damage filler that
        // exist only so the windup can re-arm if the player burns him
        // through 5 turns and continues the fight somehow.
        name: 'Nimrod',
        phases: [
            {
                enterAtHpRatio: 1.0,
                actions: [
                    {
                        id: 'nimrod_godkiller',
                        intent: { en: 'God-Killer', ru: 'Убийца богов' },
                        noAttack: true,
                        windupTurns: 5,
                        oneShot: true,
                        // No oneShotDefendDamage on purpose: Defend
                        // does not soften the kill.
                    },
                ],
            },
        ],
    },
    {
        // Gilgamesh, "the First Hero": every turn rolls a 10% chance
        // to bellow a Hero's Cry alongside his swing. The cry stacks
        // weaken -1 (attack), armorBreak -1 (defense) for the rest of
        // the fight (turns: 99 → natural one-per-turn decay) AND
        // drains 1 resolve from the player. He still hits for his
        // base attack on the same turn — `hero_call` is a rider, not
        // a windup.
        name: 'Gilgamesh',
        phases: [
            {
                enterAtHpRatio: 1.0,
                actions: [
                    {
                        id: 'hero_call',
                        intent: { en: "Hero's Cry", ru: 'Клич героя' },
                        heroCryChance: 0.1,
                        heroCryDrain: {
                            attackWeaken: 1,
                            defenseArmorBreak: 1,
                            resolveDrain: 1,
                            turns: 99,
                        },
                    },
                ],
            },
        ],
    },
    {
        // Prophet, "Furious Resurrection": single-phase rotation of
        // basic attacks. The first time HP drops to 0, blueprint-level
        // `resurrectOnDeath` restores HP to 40% maxHp and multiplies
        // the boss's current attack by 1.5 (per the design sheet:
        // "hp = 40%, urgon +50%"). Resolution lives in
        // CombatManager.processTurn before finishCombat — by that
        // point the resurrection already wrote the new hp/attack so
        // the next enemy turn just hits with the buffed values.
        name: 'Prophet',
        resurrectOnDeath: { hpFraction: 0.4, attackMultiplier: 1.5 },
        phases: [
            {
                enterAtHpRatio: 1.0,
                actions: [
                    {
                        id: 'attack',
                        intent: { en: 'Prophet Strike', ru: 'Удар пророка' },
                    },
                ],
            },
        ],
    },
    {
        // Mammon, "Greed Lord": once per fight, when HP first drops
        // below 50% of maxHp the boss steals a random relic from the
        // player's inventory. The relic is preserved on
        // `ActiveEnemy.stolenRelicId` and returned to the player when
        // Mammon dies (via finishCombat hook). Subsequent phase 2
        // turns are normal attacks.
        name: 'Mammon',
        phases: [
            {
                enterAtHpRatio: 1.0,
                actions: [
                    {
                        id: 'attack',
                        intent: { en: 'Greed Strike', ru: 'Удар жадности' },
                    },
                ],
            },
            {
                enterAtHpRatio: 0.5,
                onEnterStealRelic: true,
                label: { en: 'Mammon takes what he wants.', ru: 'Маммон берёт своё.' },
                actions: [
                    {
                        id: 'attack',
                        intent: { en: 'Greed Strike', ru: 'Удар жадности' },
                    },
                ],
            },
        ],
    },
    {
        // Mime, "the First Reveler": single-phase rotation that hits
        // for true damage (ignoreArmor), heals 5 HP whenever a regular
        // hit lands (lifestealFlat), and applies one random status
        // from the pool every turn. The same status cannot fire twice
        // in a row — anti-repeat lives on
        // `BossPhaseState.lastRandomStatus`.
        name: 'Mime',
        phases: [
            {
                enterAtHpRatio: 1.0,
                actions: [
                    {
                        id: 'mime_chaos',
                        intent: { en: "Chaos Lord's Laughter", ru: 'Смех владыки Хаоса' },
                        ignoreArmor: true,
                        lifestealFlat: 5,
                        randomStatus: {
                            pool: ['bleed', 'poison', 'stun', 'weaken', 'armorBreak', 'mark'],
                            amount: 1,
                            turns: 1,
                        },
                    },
                ],
            },
        ],
    },
];

export const BOSS_BLUEPRINT_BY_NAME: Record<string, BossBlueprint> = Object.fromEntries(
    BOSS_BLUEPRINTS.map((bp) => [bp.name, bp])
);
