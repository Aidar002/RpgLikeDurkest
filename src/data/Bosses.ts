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
export interface BossLine {
    en: string;
    ru: string;
}

export function pickLine(line: BossLine, lang: Language): string {
    return lang === 'ru' ? line.ru : line.en;
}

export type BossActionId =
    // Universal building blocks.
    | 'attack'
    | 'heavy'
    | 'guard'
    | 'recover'
    | 'expose_self'
    | 'self_heal_if_safe'
    | 'self_buff_atk'
    // Death Knight specifics.
    | 'death_shield'
    | 'death_touch';

export interface BossActionDef {
    id: BossActionId;
    /** Player-facing intent label shown before the boss's turn. */
    intent: BossLine;
    /** Optional flat damage bonus added to base attack on this action. */
    damageBonus?: number;
    /** True when this action does no attack damage (recover / guard / debuff-only). */
    noAttack?: boolean;
    /** Self-block gained at the end of the boss's turn. */
    selfBlock?: number;
    /** Self-heal gained at the end of the boss's turn. */
    selfHeal?: number;
    /** Heal only triggers if the player did NOT damage the boss this turn. */
    selfHealIfNoDamageTaken?: number;
    /** Boss takes +N extra damage from the next player hit (decays to 0 after). */
    exposedExtraDamage?: number;
    /** Light drained from the player on this action. */
    drainLight?: number;
    /** Player atk weaken (amount, turns). */
    weaken?: { amount: number; turns: number };
    /** Mark applied to player (turns). Boss next attack while marked deals heavy + bleed. */
    markPlayer?: number;
    /** Bleed inflicted on hit (only if Marked unless `bleedAlways`). */
    bleed?: { stacks: number; turns: number; alwaysIfHit?: boolean; onlyIfMarked?: boolean };
    /** Permanent +ATK self-buff applied this turn. */
    selfAtkBoost?: number;
}

export interface BossPhaseDef {
    /** HP ratio (0..1) at or below which this phase activates. Phases
     *  are evaluated top-down, so list them in descending order. */
    enterAtHpRatio: number;
    onEnter?: {
        atkBoost?: number;
        drainLight?: number;
        /** Cap the player's light to at most this value. */
        capLight?: number;
        markPlayer?: number;
    };
    actions: BossActionDef[];
    /** Optional name shown in the combat log on phase change. */
    label?: BossLine;
}

export interface BossBlueprint {
    /** Must match an EnemyDef.name in BOSSES. */
    name: string;
    phases: BossPhaseDef[];
    /** Special passive effects keyed by name (e.g. cinderlight). */
    passives?: BossPassiveId[];
    /** Bleed cap (for FIX-1 final boss). 0 = no cap (default behaviour). */
    bleedCap?: number;
}

export type BossPassiveId = 'cinderlight' | 'prophecy_crit' | 'maw_aura';

// ---------------------------------------------------------------------------
// Death Knight boss blueprint.
// ---------------------------------------------------------------------------

export const BOSS_BLUEPRINTS: BossBlueprint[] = [
    {
        name: 'Death Knight',
        phases: [
            {
                enterAtHpRatio: 1.0,
                actions: [
                    {
                        id: 'attack',
                        intent: { en: 'Dark Slash', ru: 'Тёмный удар' },
                    },
                    {
                        id: 'death_shield',
                        intent: { en: 'Death Shield', ru: 'Щит смерти' },
                        noAttack: true,
                        selfBlock: 15,
                    },
                    {
                        id: 'death_touch',
                        intent: { en: 'Death Touch', ru: 'Касание смерти' },
                        damageBonus: 0,
                    },
                ],
            },
            {
                enterAtHpRatio: 0.5,
                onEnter: { atkBoost: 2 },
                label: { en: 'The Death Knight raises his blade.', ru: 'Рыцарь смерти поднимает клинок.' },
                actions: [
                    {
                        id: 'heavy',
                        intent: { en: 'Grave Strike', ru: 'Могильный удар' },
                        damageBonus: 3,
                    },
                    {
                        id: 'death_shield',
                        intent: { en: 'Death Shield', ru: 'Щит смерти' },
                        noAttack: true,
                        selfBlock: 15,
                    },
                    {
                        id: 'death_touch',
                        intent: { en: 'Death Touch', ru: 'Касание смерти' },
                        damageBonus: 0,
                    },
                    {
                        id: 'attack',
                        intent: { en: 'Dark Slash', ru: 'Тёмный удар' },
                    },
                ],
            },
        ],
    },
];

export const BOSS_BLUEPRINT_BY_NAME: Record<string, BossBlueprint> = Object.fromEntries(
    BOSS_BLUEPRINTS.map((bp) => [bp.name, bp])
);
