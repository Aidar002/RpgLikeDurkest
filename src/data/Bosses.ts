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

export type BossActionId = 'attack' | 'death_shield' | 'death_touch';

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
}

export interface BossPhaseDef {
    /** HP ratio (0..1) at or below which this phase activates. Phases
     *  are evaluated top-down, so list them in descending order. */
    enterAtHpRatio: number;
    actions: BossActionDef[];
    /** Optional name shown in the combat log on phase change. */
    label?: BossLine;
}

export interface BossBlueprint {
    /** Must match an EnemyDef.name in BOSSES. */
    name: string;
    phases: BossPhaseDef[];
}

// ---------------------------------------------------------------------------
// Death Knight boss blueprint.
// ---------------------------------------------------------------------------

export const BOSS_BLUEPRINTS: BossBlueprint[] = [
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
                        intent: { en: 'Dark Slash', ru: 'Тёмный удар' },
                    },
                    {
                        id: 'death_shield',
                        intent: { en: 'Death Shield', ru: 'Щит смерти' },
                        noAttack: true,
                        windupTurns: 1,
                        pendingBlock: 15,
                        pendingBlockTurns: 3,
                    },
                    {
                        id: 'attack',
                        intent: { en: 'Dark Slash', ru: 'Тёмный удар' },
                    },
                    {
                        id: 'death_touch',
                        intent: { en: 'Death Touch', ru: 'Касание смерти' },
                        noAttack: true,
                        windupTurns: 3,
                        oneShot: true,
                        oneShotDefendDamage: 8,
                    },
                ],
            },
        ],
    },
];

export const BOSS_BLUEPRINT_BY_NAME: Record<string, BossBlueprint> = Object.fromEntries(
    BOSS_BLUEPRINTS.map((bp) => [bp.name, bp])
);
