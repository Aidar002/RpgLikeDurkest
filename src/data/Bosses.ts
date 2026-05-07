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
    // Resource pressure.
    | 'wish_tax'
    | 'dim_flame'
    | 'dread_pulse'
    | 'dread_silence'
    | 'grave_chill'
    // Effects.
    | 'cinder_curse'
    | 'prophecy_mark'
    | 'surgical_cut'
    | 'splinter_vision';

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
// Action shorthands
// ---------------------------------------------------------------------------

const A = {
    hollowStrike: {
        id: 'attack' as const,
        intent: { en: 'Hollow Strike', ru: 'Полый удар' },
    },
    breakVow: {
        id: 'heavy' as const,
        intent: { en: 'Break Vow', ru: 'Разбитый обет' },
        damageBonus: 3,
    },
    finalHunger: {
        id: 'heavy' as const,
        intent: { en: 'Final Hunger', ru: 'Последний голод' },
        damageBonus: 4,
    },
    wishTax4: {
        id: 'wish_tax' as const,
        intent: { en: 'Wish Tax', ru: 'Налог желания' },
        noAttack: true,
        drainLight: 1,
    },
    wishTax5: {
        id: 'wish_tax' as const,
        intent: { en: 'Wish Tax', ru: 'Налог желания' },
        noAttack: true,
        drainLight: 1,
    },
    exposedDream2: {
        id: 'expose_self' as const,
        intent: { en: 'Exposed Dream', ru: 'Обнажённый сон' },
        noAttack: true,
        exposedExtraDamage: 2,
    },
    exposedDream3: {
        id: 'expose_self' as const,
        intent: { en: 'Exposed Dream', ru: 'Обнажённый сон' },
        noAttack: true,
        exposedExtraDamage: 3,
    },
    falseMercy: {
        id: 'self_heal_if_safe' as const,
        intent: { en: 'False Mercy', ru: 'Ложная милость' },
        noAttack: true,
        selfHealIfNoDamageTaken: 6,
    },
    dreadSilence: {
        id: 'dread_silence' as const,
        intent: { en: 'Dread Silence', ru: 'Гнетущая тишина' },
        noAttack: true,
        selfBlock: 2,
    },
} as const;

// ---------------------------------------------------------------------------
// FIX-10: Boss blueprints for depth 5 / 10 / 15 / 20.
// FIX-1:  Boss blueprint for depth 25 (final boss).
// ---------------------------------------------------------------------------

export const BOSS_BLUEPRINTS: BossBlueprint[] = [
    {
        name: 'Necromancer Regent',
        phases: [
            {
                enterAtHpRatio: 1.0,
                actions: [
                    {
                        id: 'attack',
                        intent: { en: 'Bone Command', ru: 'Костяной приказ' },
                    },
                    {
                        id: 'grave_chill',
                        intent: { en: 'Grave Chill', ru: 'Могильный холод' },
                        noAttack: true,
                        weaken: { amount: 1, turns: 2 },
                    },
                    {
                        id: 'expose_self',
                        intent: { en: 'Exposed', ru: 'Обнажённый' },
                        noAttack: true,
                        exposedExtraDamage: 1,
                    },
                ],
            },
            {
                enterAtHpRatio: 0.5,
                onEnter: { atkBoost: 1 },
                label: { en: 'The Regent rises in fury.', ru: 'Регент поднимается в ярости.' },
                actions: [
                    {
                        id: 'heavy',
                        intent: { en: 'Royal Decree', ru: 'Королевский указ' },
                        damageBonus: 2,
                    },
                    {
                        id: 'guard',
                        intent: { en: 'Bone Shield', ru: 'Костяной щит' },
                        noAttack: true,
                        selfBlock: 3,
                    },
                    {
                        id: 'grave_chill',
                        intent: { en: 'Grave Chill', ru: 'Могильный холод' },
                        noAttack: true,
                        weaken: { amount: 1, turns: 3 },
                    },
                    {
                        id: 'expose_self',
                        intent: { en: 'Exposed', ru: 'Обнажённый' },
                        noAttack: true,
                        exposedExtraDamage: 1,
                    },
                ],
            },
        ],
    },
    {
        name: 'The Lich of Cinders',
        passives: ['cinderlight'],
        phases: [
            {
                enterAtHpRatio: 1.0,
                actions: [
                    {
                        id: 'attack',
                        intent: { en: 'Ash Bolt', ru: 'Пепельная стрела' },
                    },
                    {
                        id: 'dim_flame',
                        intent: { en: 'Dim Flame', ru: 'Тушит пламя' },
                        noAttack: true,
                        drainLight: 1,
                    },
                    {
                        id: 'cinder_curse',
                        intent: { en: 'Cinder Curse', ru: 'Пепельное проклятие' },
                        noAttack: true,
                        weaken: { amount: 1, turns: 2 },
                    },
                ],
            },
            {
                enterAtHpRatio: 0.5,
                onEnter: { drainLight: 1 },
                label: { en: 'Embers rise — the Lich draws on the dark.', ru: 'Угли вспыхивают — Лич черпает из тьмы.' },
                actions: [
                    {
                        id: 'attack',
                        intent: { en: 'Ash Bolt', ru: 'Пепельная стрела' },
                    },
                    {
                        id: 'heavy',
                        intent: { en: 'Cinderstorm', ru: 'Пепельная буря' },
                        damageBonus: 2,
                    },
                    {
                        id: 'dim_flame',
                        intent: { en: 'Dim Flame', ru: 'Тушит пламя' },
                        noAttack: true,
                        drainLight: 1,
                    },
                    {
                        id: 'recover',
                        intent: { en: 'Recover', ru: 'Восстанавливается' },
                        noAttack: true,
                        exposedExtraDamage: 2,
                    },
                ],
            },
        ],
    },
    {
        name: 'Splintered Oracle',
        passives: ['prophecy_crit'],
        phases: [
            {
                enterAtHpRatio: 1.0,
                actions: [
                    {
                        id: 'prophecy_mark',
                        intent: { en: 'Prophecy Mark', ru: 'Метка пророчества' },
                        noAttack: true,
                        markPlayer: 2,
                    },
                    {
                        id: 'surgical_cut',
                        intent: { en: 'Surgical Cut', ru: 'Точный разрез' },
                        bleed: { stacks: 2, turns: 3, onlyIfMarked: true },
                    },
                    {
                        id: 'attack',
                        intent: { en: 'Whispered Future', ru: 'Шёпот будущего' },
                        damageBonus: 1,
                    },
                ],
            },
            {
                enterAtHpRatio: 0.5,
                onEnter: { markPlayer: 2 },
                label: { en: 'The Oracle foresees your fall.', ru: 'Оракул видит твоё падение.' },
                actions: [
                    {
                        id: 'surgical_cut',
                        intent: { en: 'Surgical Cut', ru: 'Точный разрез' },
                        bleed: { stacks: 3, turns: 3, alwaysIfHit: true },
                    },
                    {
                        id: 'prophecy_mark',
                        intent: { en: 'Prophecy Mark', ru: 'Метка пророчества' },
                        noAttack: true,
                        markPlayer: 2,
                    },
                    {
                        id: 'splinter_vision',
                        intent: { en: 'Splinter Vision', ru: 'Расщеплённое зрение' },
                        damageBonus: 3,
                    },
                    {
                        id: 'recover',
                        intent: { en: 'Recover', ru: 'Восстанавливается' },
                        noAttack: true,
                        exposedExtraDamage: 1,
                    },
                ],
            },
        ],
    },
    {
        name: 'Nameless Maw',
        passives: ['maw_aura'],
        phases: [
            {
                enterAtHpRatio: 1.0,
                actions: [
                    {
                        id: 'attack',
                        intent: { en: 'Gnaw', ru: 'Грызёт' },
                    },
                    {
                        id: 'dread_pulse',
                        intent: { en: 'Dread Pulse', ru: 'Импульс ужаса' },
                        noAttack: true,
                        weaken: { amount: 1, turns: 2 },
                    },
                    {
                        id: 'heavy',
                        intent: { en: 'Hunger', ru: 'Голод' },
                        damageBonus: 2,
                    },
                ],
            },
            {
                enterAtHpRatio: 0.5,
                onEnter: { atkBoost: 1 },
                label: { en: 'The Maw widens.', ru: 'Пасть распахивается шире.' },
                actions: [
                    {
                        id: 'heavy',
                        intent: { en: 'Devour Hope', ru: 'Пожирает надежду' },
                        damageBonus: 3,
                    },
                    {
                        id: 'dread_pulse',
                        intent: { en: 'Dread Pulse', ru: 'Импульс ужаса' },
                        noAttack: true,
                        weaken: { amount: 1, turns: 3 },
                    },
                    {
                        id: 'attack',
                        intent: { en: 'Gnaw', ru: 'Грызёт' },
                    },
                    {
                        id: 'expose_self',
                        intent: { en: 'Exposed Maw', ru: 'Открытая пасть' },
                        noAttack: true,
                        exposedExtraDamage: 2,
                    },
                ],
            },
        ],
    },
    {
        name: 'The Undying Wound',
        bleedCap: 4,
        phases: [
            {
                enterAtHpRatio: 1.0,
                actions: [A.hollowStrike, A.wishTax4, A.exposedDream2],
            },
            {
                enterAtHpRatio: 0.66,
                onEnter: { atkBoost: 1 },
                label: { en: 'The Wound refuses to close.', ru: 'Рана отказывается закрыться.' },
                actions: [A.hollowStrike, A.breakVow, A.wishTax5, A.falseMercy],
            },
            {
                enterAtHpRatio: 0.34,
                onEnter: { atkBoost: 1, capLight: 3 },
                label: { en: 'The wish takes everything.', ru: 'Желание забирает всё.' },
                actions: [A.finalHunger, A.dreadSilence, A.exposedDream3, A.hollowStrike],
            },
        ],
    },
];

export const BOSS_BLUEPRINT_BY_NAME: Record<string, BossBlueprint> = Object.fromEntries(
    BOSS_BLUEPRINTS.map((bp) => [bp.name, bp])
);
