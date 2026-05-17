/**
 * Enemy / mob type system. Pure data-side declarations:
 *  - {@link EnemyProfile}: visual category for sprite/colour selection.
 *  - {@link EnemyPrepareDef}: telegraphed mid-combat windup descriptor.
 *  - {@link EnemyDef}: per-mob stat block + drop modifier + optional
 *    passive / prepare hooks.
 *  - {@link EnemyPassive}: discriminated union of all on-trigger
 *    passive abilities the combat manager understands.
 *
 * Behaviour for these types is implemented by `systems/CombatManager`,
 * not here. This file purely declares the shape of the data the
 * tier roster (and the boss list) supplies.
 */
// Enemy profile is purely a visual / sprite category. Mob behaviour
// comes from per-mob `passive` and `prepare` blocks below — there is no
// extra mechanic attached to the profile field.
export type EnemyProfile = 'brute' | 'stalker' | 'bleeder' | 'boss';

/**
 * "Prepare" mechanic: enemy telegraphs an action for `turns` turns,
 * then resolves it on the matching player turn. If the player chose
 * Defend on the resolution turn, the special instead either does
 * `defenseBackDamage` (rebound), leaks a small fixed amount through
 * the guard, or just lets the raw damage through with no rider
 * effect, depending on `defenseRule`.
 *
 * Spec mapping (per `Справочник врагов` sheet):
 *  - bat:    1-turn windup -> 2 dmg, Defense -> 1 dmg leaks through
 *  - ghoul:  1-turn windup -> 2 dmg + poison, Defense -> full 2 dmg
 *            still lands but the poison is cancelled
 *  - lynx:   1-turn windup -> 3 dmg + bleed, Defense -> the damage
 *            still lands but the bleed is cancelled
 *  - cube:   1-turn windup, 40% on resolve to apply -1 armorBreak
 *            for the rest of the fight (no HP damage)
 *  - toad:   1-turn windup -> no damage, ties up the player's weapon
 *            arm for 1 turn (attack action only is gated; defense
 *            and skills/potions still work)
 */
export interface EnemyPrepareDef {
    /** Localisation key used to look up the windup intent line. */
    nameEn: string;
    nameRu: string;
    /** Turns the enemy spends winding up (1 = next turn, 2 = +2 turns). */
    turns: number;
    /** Damage delivered on resolution. */
    damage: number;
    /** Bleed rider added when not defended. */
    bleed?: { stacks: number; turns: number };
    /** Poison rider added when not defended. */
    poison?: { damage: number; turns: number };
    /**
     * Full-stun rider added when not defended. The player skips their
     * next `turns` turns. (Currently unused in the production roster
     * after the giant toad switched to the narrower `attackBan` rider,
     * but kept on the type so future windup designs can still apply a
     * full skip.)
     */
    stun?: { turns: number };
    /**
     * Attack-only ban rider added when not defended. For the duration
     * the player can still defend / use skills / drink potions but the
     * attack action is forfeit. Used by the giant toad's Tongue Lash.
     */
    attackBan?: { turns: number };
    /**
     * Armor-break rider applied on resolve with optional chance gate.
     * If `chance` is set and the roll fails the rider does nothing —
     * the cube's Acid Vomit uses this for its 40% spec. Cancelled by
     * Defense regardless of `defenseRule`.
     */
    armorBreak?: { chance?: number; amount: number; turns: number };
    /** What the player's Defend action does to this prepared hit. */
    defenseRule: 'damageBack' | 'cancelRiders' | 'leakOnDefend';
    /** Damage the enemy takes when defenseRule === 'damageBack'. */
    defenseBackDamage?: number;
    /**
     * Damage the player takes (true damage, bypasses block / defense)
     * when defenseRule === 'leakOnDefend'. Riders are still cancelled.
     */
    defenseLeakDamage?: number;
}

export interface EnemyDef {
    name: string;
    description: string;
    icon: string;
    hp: number;
    attack: number;
    xp: number;
    gold: number;
    color: number;
    profile: EnemyProfile;
    /**
     * Per-enemy contribution to the Stage [4] relic drop formula
     * (Z term). Integer percent, e.g. `+15` = +15% drop chance,
     * `-10` = -10%. Missing = 0.
     *
     * The formula `X + Y*depth + Z + K*owned + relicMod` is rolled
     * once per kill in `RelicDrops.maybeDropRelic`; the per-relic
     * `RELICS[id].drops[*].chance` is then used purely as a WEIGHT
     * for the weighted-random pick (with `chance >= 1.0` reserved
     * for guaranteed drops, e.g. Crown of Greed on Mammon).
     *
     * See {@link DROP_FORMULA} for the X / Y / K knobs.
     */
    dropMod?: number;
    /**
     * Optional per-turn passive trigger.
     *  - kind: 'extraDamageOnHit'    (rat — 20% deal +1 dmg)
     *  - kind: 'thornsOnTakeHit'     (slime — 30% deal 1 dmg back when hit)
     *  - kind: 'damageReduction'     (skeleton — 10% take −1 incoming dmg;
     *                                  earth-elemental — 30% take −2)
     *  - kind: 'evadeAndStingOnHit'  (bee-butterfly — 20% dodge the player's
     *    incoming attack entirely and counter for a small fixed amount of
     *    true damage)
     *  - kind: 'lifestealOnAttack'   (vampire — heal a ratio of the damage
     *    dealt by a successful regular attack)
     *  - kind: 'attackScalesWithHp'  (goblin-horde — the "thinning horde":
     *    regular-attack damage is reduced by 1 per missing HP, so a
     *    9-attack horde at 6/13 HP hits for `9 - (13-6) = 2` instead
     *    of the full 9. Floors at 1.)
     *  - kind: 'painExultation'      (succubus — "exultation in pain":
     *    +1 regular-attack damage per `bonusPerStep` fraction of missing
     *    HP (default 0.1 → +1 per 10% missing))
     *  - kind: 'weakenPlayerEachTurn' (underground-ent — "strangling
     *    roots": applies/refreshes weaken `amount` for `turns` turns to
     *    the player at the start of every enemy turn while the enemy
     *    is alive)
     *  - kind: 'spawnOnDeath'        (rat-matron — "litter": on the
     *    turn the enemy's hp drops to 0, instead of ending combat the
     *    encounter respawns as the enemy named `spawnName` (canonical
     *    English name). The spawned enemy keeps its own passive/
     *    prepare from the roster so chained spawns are possible only
     *    if explicitly modelled in data)
     *  - kind: 'hellfireOnDeath'     (demon — "hellfire": on the
     *    turn the enemy's hp drops to 0, deal `damagePerRelic` true
     *    damage per relic in the player's inventory before combat
     *    ends. Resolves in `finishCombat` so it is a terminal proc —
     *    rewards still pay out as normal afterwards)
     *  - kind: 'regenPerTurn'        (skeleton — "set the bone":
     *    heals `amount` HP at the start of every enemy turn while
     *    alive, capped at maxHp. Logs only on a successful heal)
     *  - kind: 'doubleAttackChance'  (steel lynx — "predator's
     *    instinct": chance to swing twice on a regular-attack turn.
     *    The second swing reuses the same scaled damage path so all
     *    other passive riders apply to it too)
     *  - kind: 'curseDarknessOnce'   (lich — "curse of darkness":
     *    `chance` per enemy turn to apply weaken `weakenAmount` for
     *    `weakenTurns` turns to the player. Triggers AT MOST ONCE per
     *    encounter — once a curse lands the lich never tries again.
     *    Use a long `weakenTurns` (e.g. 99) for spec's "until end of
     *    fight" semantics)
     *  - kind: 'blocksSkillsAndPotions' (skeleton swordsman — "skilled
     *    fencer": when the player tries to use a skill or potion, the
     *    enemy has a `chance` to parry the attempt; the resolve / potion
     *    cost is still spent, the skill effect is silenced, but the
     *    player still occupies their turn so the enemy still acts)
     *  - kind: 'corrosionStrikeOnAttack' (death knight — "corrosion
     *    strike": on each regular-attack turn, `chance` to swap the
     *    standard hit for a corrosion blow that deals `damage` (true
     *    damage that bypasses defense) AND applies armorBreak for the
     *    rest of the fight. Picks one or the other per turn — never
     *    stacks on top of the regular attack)
     *  - kind: 'selfHealOnLowHp'     (lost-adventurer — "healing
     *    potions": when the enemy's hp/maxHp ratio drops below
     *    `threshold`, the enemy heals `healFraction` of maxHp at the
     *    start of its turn. Limited to `maxUses` heals per encounter,
     *    tracked on `ActiveEnemy.selfHealsUsed`)
     */
    passive?: EnemyPassive;
    /** Mid-combat windup ability the enemy resolves after N turns. */
    prepare?: EnemyPrepareDef;
}

export type EnemyPassive =
    | { kind: 'extraDamageOnHit'; chance: number; bonus: number }
    | { kind: 'thornsOnTakeHit'; chance: number; damage: number }
    | { kind: 'damageReduction'; chance: number; reduction: number }
    | { kind: 'evadeAndStingOnHit'; chance: number; damage: number }
    | { kind: 'lifestealOnAttack'; ratio: number }
    | { kind: 'attackScalesWithHp' }
    | { kind: 'painExultation'; bonusPerStep: number }
    | { kind: 'weakenPlayerEachTurn'; amount: number; turns: number }
    | { kind: 'spawnOnDeath'; spawnName: string }
    | { kind: 'hellfireOnDeath'; damagePerRelic: number }
    | { kind: 'regenPerTurn'; amount: number }
    | { kind: 'doubleAttackChance'; chance: number }
    | { kind: 'curseDarknessOnce'; chance: number; weakenAmount: number; weakenTurns: number }
    | { kind: 'blocksSkillsAndPotions'; chance: number }
    | {
          kind: 'corrosionStrikeOnAttack';
          chance: number;
          damage: number;
          armorBreak: { amount: number; turns: number };
      }
    | {
          kind: 'selfHealOnLowHp';
          threshold: number;
          healFraction: number;
          maxUses: number;
      };
