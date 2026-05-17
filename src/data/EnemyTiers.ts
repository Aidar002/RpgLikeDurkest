/**
 * Per-depth enemy roster. The map's enemy picker draws from the
 * pool whose `minDepth` is the largest value <= the player's
 * current depth, so the roster widens monotonically as the run
 * progresses.
 *
 * Stats and passives mirror the design sheet directly; behaviour
 * for each `passive` / `prepare` kind is interpreted by
 * `systems/CombatManager`. See {@link EnemyTypes} for the shape
 * declarations.
 */
import type { EnemyDef } from './EnemyTypes';

// from the design table; passives and prepare blocks are interpreted
// by CombatManager.
// Stats per the design table:
//   1–5   → minDepth 0   (Rat, Slime, Bat, Bee-Butterfly, Giant Toad)
//   6–10  → minDepth 6   (Rat Matron, Skeleton, Ghoul, Gelatinous Cube,
//                          Earth Elemental)
//   11–15 → minDepth 11  (Steel Lynx, Vampire, Demon, Goblin Horde,
//                          Underground Ent)
//   16–20 → minDepth 16  (Skeleton Swordsman, Lich, Succubus,
//                          Lost Adventurer, Death Knight)
//   21–25 → minDepth 21  (Prophet, Mammon, Nimrod, Mime, Gilgamesh)
// New roster entries from the design sheet ship without passive /
// prepare blocks — those land in follow-up PRs, one ability per PR.
export const ENEMY_TIERS: { minDepth: number; pool: EnemyDef[] }[] = [
    {
        minDepth: 0,
        pool: [
            {
                name: 'Rat',
                description: 'test_desc_rat',
                icon: 'R',
                hp: 2,
                attack: 1,
                xp: 3,
                gold: 3,
                color: 0x5a5040,
                profile: 'stalker',
                dropMod: 5,
                passive: { kind: 'extraDamageOnHit', chance: 0.2, bonus: 1 },
            },
            {
                name: 'Slime',
                description: 'test_desc_slime',
                icon: 'S',
                hp: 2,
                attack: 1,
                xp: 3,
                gold: 3,
                color: 0x3e6636,
                profile: 'brute',
                dropMod: -5,
                passive: { kind: 'thornsOnTakeHit', chance: 0.3, damage: 1 },
            },
            {
                name: 'Bat',
                description: 'test_desc_bat',
                icon: 'B',
                hp: 2,
                attack: 1,
                xp: 3,
                gold: 4,
                color: 0x36463f,
                profile: 'stalker',
                dropMod: 0,
                // Bite: 1-turn windup, on resolve the bat snaps for 2
                // damage. Defending leaks 1 damage through the guard
                // (true damage, bypasses block) — matches the design
                // sheet's "если защита то 1 урон" wording.
                prepare: {
                    nameEn: 'Bite',
                    nameRu: 'Укус',
                    turns: 1,
                    damage: 2,
                    defenseRule: 'leakOnDefend',
                    defenseLeakDamage: 1,
                },
            },
            {
                name: 'Bee-Butterfly',
                description: 'test_desc_bee_butterfly',
                icon: 'Y',
                hp: 3,
                attack: 2,
                xp: 3,
                gold: 3,
                color: 0xc4a01e,
                profile: 'stalker',
                dropMod: 10,
                // Flutter and sting: 20% chance to dodge the player's
                // attack outright; on dodge the bee-butterfly counters
                // for 1 true damage.
                passive: { kind: 'evadeAndStingOnHit', chance: 0.2, damage: 1 },
            },
            {
                name: 'Giant Toad',
                description: 'test_desc_giant_toad',
                icon: 'T',
                hp: 3,
                attack: 2,
                xp: 3,
                gold: 3,
                color: 0x4a6b2a,
                profile: 'brute',
                dropMod: 5,
                // Tongue Lash: 1-turn windup, on resolve the toad ties
                // up the player's weapon arm for 1 turn — the player
                // forfeits their attack action but can still defend,
                // use skills, and drink potions (design sheet: "герой
                // не может атаковать, но может использовать способности
                // и защиту"). No direct damage. Defending on the resolve
                // turn cancels the ban outright.
                prepare: {
                    nameEn: 'Tongue Lash',
                    nameRu: 'Языковая хватка',
                    turns: 1,
                    damage: 0,
                    attackBan: { turns: 1 },
                    defenseRule: 'cancelRiders',
                },
            },
        ],
    },
    {
        minDepth: 6,
        pool: [
            {
                name: 'Rat Matron',
                description: 'test_desc_rat_matron',
                icon: 'M',
                hp: 8,
                attack: 2,
                xp: 5,
                gold: 5,
                color: 0x6b4530,
                profile: 'brute',
                dropMod: 15,
                // Litter: when the matron is killed, the encounter
                // doesn't end — it continues with a fresh Rat. The
                // spawned Rat carries its own (lighter) reward yield,
                // so killing both creatures gives you both bounties.
                passive: { kind: 'spawnOnDeath', spawnName: 'Rat' },
            },
            {
                name: 'Skeleton',
                description: 'test_desc_skeleton',
                icon: 'K',
                hp: 6,
                attack: 3,
                xp: 4,
                gold: 4,
                color: 0x888070,
                profile: 'brute',
                dropMod: 5,
                // Set the Bone: regenerates 1 HP at the start of every
                // enemy turn while alive. Per the design sheet replaces
                // the legacy 10% damage-reduction passive — the
                // skeleton is a sustain threat, not a soak threat.
                passive: { kind: 'regenPerTurn', amount: 1 },
            },
            {
                name: 'Ghoul',
                description: 'test_desc_ghoul',
                icon: 'G',
                hp: 7,
                attack: 2,
                xp: 5,
                gold: 5,
                color: 0x455544,
                profile: 'bleeder',
                dropMod: 0,
                // Decay cannot be fully blocked. Defense cancels the
                // poison rider, but the full 2 damage still seeps
                // through the guard (design sheet: "если защита, то
                // урон проходит без отравления").
                prepare: {
                    nameEn: 'Decay',
                    nameRu: 'Разложение',
                    turns: 1,
                    damage: 2,
                    poison: { damage: 1, turns: 3 },
                    defenseRule: 'leakOnDefend',
                    defenseLeakDamage: 2,
                },
            },
            {
                name: 'Gelatinous Cube',
                description: 'test_desc_gelatinous_cube',
                icon: 'C',
                hp: 9,
                attack: 2,
                xp: 5,
                gold: 5,
                color: 0x82c4d4,
                profile: 'brute',
                dropMod: 10,
                // Acid Vomit: 1-turn windup, on resolve roll 40% to
                // etch the player's armor — defense -1 for the rest of
                // the fight (turns=99 approximates "до конца боя либо
                // 2 комнаты" — the armorBreak timer ticks once per
                // combat turn so the curse follows the player out of
                // this fight and decays naturally afterwards). No HP
                // damage on the resolve. Defending on the resolve turn
                // cancels the armorBreak roll entirely.
                prepare: {
                    nameEn: 'Acid Vomit',
                    nameRu: 'Кислотная рвота',
                    turns: 1,
                    damage: 0,
                    armorBreak: { chance: 0.4, amount: 1, turns: 99 },
                    defenseRule: 'cancelRiders',
                },
            },
            {
                name: 'Earth Elemental',
                description: 'test_desc_earth_elemental',
                icon: 'E',
                hp: 9,
                attack: 2,
                xp: 5,
                gold: 5,
                color: 0x6e553b,
                profile: 'brute',
                dropMod: -10,
                // Stone Skin: 30% chance to shrug off 2 points of an
                // incoming player hit. Same damageReduction passive as
                // Skeleton, just thicker.
                passive: { kind: 'damageReduction', chance: 0.3, reduction: 2 },
            },
        ],
    },
    {
        minDepth: 11,
        pool: [
            {
                name: 'Steel Lynx',
                description: 'test_desc_steel_lynx',
                icon: 'L',
                hp: 12,
                attack: 3,
                xp: 10,
                gold: 10,
                color: 0x6a6a7a,
                profile: 'bleeder',
                dropMod: 10,
                // Predator's Instinct: 40% chance to swing twice on a
                // regular-attack turn. Replaces the legacy "Claws"
                // 1-turn windup with bleed rider — per the design
                // sheet the lynx is a burst-pressure mob, not a
                // bleed setup.
                passive: { kind: 'doubleAttackChance', chance: 0.4 },
            },
            {
                name: 'Vampire',
                description: 'test_desc_vampire',
                icon: 'V',
                hp: 9,
                attack: 4,
                xp: 8,
                gold: 8,
                color: 0x4a1a1a,
                profile: 'stalker',
                dropMod: 15,
                // Vampirism: heal 65% of any damage the regular attack
                // dealt to the player (clamped to maxHp, min 1 when the
                // hit landed). Sheet specifies ceil rounding so a 1-dmg
                // hit still heals 1; a 2-dmg hit heals 2 (ceil 1.3); a
                // 3-dmg hit heals 2 (ceil 1.95); a 5-dmg hit heals 4.
                passive: { kind: 'lifestealOnAttack', ratio: 0.65 },
            },
            {
                name: 'Demon',
                description: 'test_desc_demon',
                icon: 'D',
                hp: 13,
                attack: 5,
                xp: 10,
                gold: 10,
                color: 0x8a1a1a,
                profile: 'brute',
                dropMod: -15,
                // Hellfire: when killed, the demon detonates and the
                // player takes 1 true damage per relic they carry into
                // the encounter. Bypasses defense (terminal explosion
                // resolves in finishCombat). With MAX_RELICS=5 the
                // worst case is 5 damage — non-trivial but never
                // outright lethal at the depth tier where the demon
                // appears.
                passive: { kind: 'hellfireOnDeath', damagePerRelic: 1 },
            },
            {
                name: 'Goblin Horde',
                description: 'test_desc_goblin_horde',
                icon: 'O',
                hp: 13,
                attack: 9,
                xp: 10,
                gold: 10,
                color: 0x4d6a2a,
                profile: 'brute',
                dropMod: 20,
                // Thinning Horde: attack scales linearly with hp/maxHp.
                // The 9-damage swing is the *full-strength* horde; as
                // goblins fall the surviving few hit weaker.
                passive: { kind: 'attackScalesWithHp' },
            },
            {
                name: 'Underground Ent',
                description: 'test_desc_underground_ent',
                icon: 'N',
                hp: 14,
                attack: 4,
                xp: 10,
                gold: 10,
                color: 0x3a5532,
                profile: 'brute',
                dropMod: 10,
                // Strangling Roots: each enemy turn, refresh a weaken-1
                // for 2 turns on the player so the player's next swing
                // is chipped by 1 while the ent is alive. Decays
                // naturally after the ent dies.
                passive: { kind: 'weakenPlayerEachTurn', amount: 1, turns: 2 },
            },
        ],
    },
    {
        minDepth: 16,
        pool: [
            {
                name: 'Skeleton Swordsman',
                description: 'test_desc_skeleton_swordsman',
                icon: 'W',
                hp: 18,
                attack: 7,
                xp: 14,
                gold: 14,
                color: 0x888070,
                profile: 'brute',
                dropMod: 15,
                // Skilled Fencer: 40% chance to parry the next skill or
                // potion the player tries to use. The resolve / potion
                // cost is still spent (the gating cost is paid before
                // the parry roll), the effect is silenced, and the
                // player's turn still passes so the enemy still acts.
                passive: { kind: 'blocksSkillsAndPotions', chance: 0.4 },
            },
            {
                name: 'Lich',
                description: 'test_desc_lich',
                icon: 'I',
                hp: 17,
                attack: 4,
                xp: 14,
                gold: 14,
                color: 0x453d5a,
                profile: 'stalker',
                dropMod: 20,
                // Curse of Darkness: each enemy turn (until first
                // success) the lich rolls a 60% chance to apply
                // weaken -2 to the player. Long `weakenTurns` (99)
                // approximates the spec's "until end of fight"
                // semantics — natural decay still ticks once per
                // turn, so the curse follows the player for the
                // whole encounter. Triggers exactly once per fight.
                passive: {
                    kind: 'curseDarknessOnce',
                    chance: 0.6,
                    weakenAmount: 2,
                    weakenTurns: 99,
                },
            },
            {
                name: 'Succubus',
                description: 'test_desc_succubus',
                icon: 'U',
                hp: 22,
                attack: 1,
                xp: 18,
                gold: 18,
                color: 0x6a2a44,
                profile: 'stalker',
                dropMod: -15,
                // Exultation in Pain: +1 damage per 10% missing HP.
                // Base attack of 1 is *almost* pillow-soft at full HP;
                // the threat scales as the player chips her down.
                passive: { kind: 'painExultation', bonusPerStep: 0.1 },
            },
            {
                name: 'Lost Adventurer',
                description: 'test_desc_lost_adventurer',
                icon: 'A',
                hp: 20,
                attack: 4,
                xp: 16,
                gold: 16,
                color: 0x9a8a6a,
                profile: 'brute',
                dropMod: 25,
                // Healing Potions: when hp falls below 50% of maxHp,
                // the adventurer chugs a potion at the start of his
                // turn and recovers 50% of maxHp. Limited to two
                // potions per encounter (per the design sheet).
                passive: {
                    kind: 'selfHealOnLowHp',
                    threshold: 0.5,
                    healFraction: 0.5,
                    maxUses: 2,
                },
            },
            {
                name: 'Death Knight',
                description: 'test_desc_death_knight',
                icon: '\u2620',
                hp: 24,
                attack: 5,
                xp: 18,
                gold: 18,
                color: 0x2a0814,
                profile: 'brute',
                dropMod: 15,
                // Corrosion Strike: 40% chance per regular-attack turn
                // to swap the standard hit for a corrosion blow — 3
                // true damage (bypasses defense) AND apply armorBreak
                // -1 for the rest of the fight (turns=99 for the same
                // "until end of fight" semantics as Acid Vomit). Only
                // one or the other per turn; never stacks on top of
                // the regular attack.
                passive: {
                    kind: 'corrosionStrikeOnAttack',
                    chance: 0.4,
                    damage: 3,
                    armorBreak: { amount: 1, turns: 99 },
                },
            },
        ],
    },
    {
        minDepth: 21,
        pool: [
            {
                name: 'Prophet',
                description: 'test_desc_prophet',
                icon: 'P',
                hp: 45,
                attack: 7,
                xp: 35,
                gold: 35,
                color: 0xe6d680,
                profile: 'brute',
                dropMod: -20,
            },
            {
                name: 'Mammon',
                description: 'test_desc_mammon',
                icon: '$',
                hp: 37,
                attack: 8,
                xp: 30,
                gold: 30,
                color: 0xa67c00,
                profile: 'brute',
                dropMod: 30,
            },
            {
                name: 'Nimrod',
                description: 'test_desc_nimrod',
                icon: 'X',
                hp: 41,
                attack: 0,
                xp: 32,
                gold: 32,
                color: 0x483050,
                profile: 'stalker',
                dropMod: 25,
            },
            {
                name: 'Mime',
                description: 'test_desc_mime',
                icon: '?',
                hp: 34,
                attack: 6,
                xp: 28,
                gold: 28,
                color: 0xb0b0b0,
                profile: 'stalker',
                // Sheet says "-20%..+20%" — 0 picked as the mean per
                // the user's "sensible defaults" confirmation.
                dropMod: 0,
            },
            {
                name: 'Gilgamesh',
                description: 'test_desc_gilgamesh',
                icon: 'H',
                hp: 43,
                attack: 7,
                xp: 34,
                gold: 34,
                color: 0xb87333,
                profile: 'brute',
                dropMod: 20,
            },
        ],
    },
];
