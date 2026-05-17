import { lt, pickLocalized } from './LocalizedText';
import type { LocalizedText } from './LocalizedText';
import type { Language } from './Localization';
import type { SkillId } from './Skills';
import {
    NpcManager,
    makeDefaultNpcMemoryMap,
    sanitizeNpcMemoryMap,
    type NpcMemoryMap,
} from './NpcManager';

// Historical unlock ids kept for backward compatibility with older saves.
// The game no longer gates the base HUD or base resources on these - they
// all exist from run 1. New installs keep them `true` by default. Meta
// unlocks now meaningfully gate *new* skills and relic-tier quality.
type UnlockId =
    | 'room_enemy'
    | 'room_empty'
    | 'room_rest'
    | 'room_treasure'
    | 'action_attack'
    | 'action_defend'
    | 'hud_hp_bar'
    | 'ui_hp_numbers'
    | 'ui_depth'
    | 'ui_room_icons'
    | 'ui_level_panel'
    | 'currency_gold'
    | 'room_trap'
    | 'ui_player_stats'
    | 'room_merchant'
    | 'resource_potions'
    | 'action_potion'
    | 'resource_resolve'
    | 'action_skill'
    | 'room_shrine'
    | 'room_elite'
    | 'ui_enemy_hp'
    | 'ui_run_metrics'
    | 'ui_kill_counter'
    | 'skill_cleave'
    | 'skill_bleed_strike'
    | 'skill_preparation'
    | 'relic_pool_rare'
    | 'relic_pool_unique';

export type UpgradeId = 'damage' | 'hp' | 'defense' | 'goldGain';

export interface PlayerMetaBonuses {
    maxHp: number;
    attack: number;
    defenseBonus: number;
    goldGainMult: number;
}

export interface UiUnlockState {
    showHpNumbers: boolean;
    showDepthReadout: boolean;
    showRoomIcons: boolean;
    showLevelPanel: boolean;
    showPlayerStats: boolean;
    showGold: boolean;
    showPotions: boolean;
    showResolve: boolean;
    showEnemyHp: boolean;
    showRunMetrics: boolean;
    showKillCounter: boolean;
}

export type ContentUnlockState = Record<UnlockId, boolean>;

interface MetaProfile {
    skillPoints: number;
    totalSkillPointsBanked: number;
    highestDepthEver: number;
    bossesKilledEver: number;
    upgrades: Record<UpgradeId, number>;
    contentUnlocks: ContentUnlockState;
    npcMemory: NpcMemoryMap;
}

interface UpgradeCardInfo {
    id: UpgradeId;
    title: string;
    description: string;
    level: number;
    maxLevel: number;
    cost: number | null;
    canPurchase: boolean;
}

/**
 * Localised snapshot of one content-unlock milestone for the
 * end-screen 'discovery progress' block. `current` and `target`
 * live in the milestone's natural unit (depth, boss kills, ...).
 */
export interface MilestoneProgressEntry {
    id: string;
    label: string;
    requirement: string;
    current: number;
    target: number;
    unlocked: boolean;
}

export interface ContentUnlockMilestone {
    id: string;
    label: LocalizedText;
    requirement: LocalizedText;
    depth?: number;
    requiresFirstBossKill?: boolean;
    unlocks: UnlockId[];
}

interface MetaUpgradeDefinition {
    id: UpgradeId;
    title: LocalizedText;
    maxLevel: number;
    costs: number[];
    description: (nextLevel: number) => LocalizedText;
}

const STORAGE_KEY = 'rpglikedurkest-meta-v4';
const LEGACY_STORAGE_KEYS = [
    'rpglikedurkest-meta-v3',
    'rpglikedurkest-meta-v2',
    'rpglikedurkest-meta-v1',
];

const DEFAULT_CONTENT_UNLOCKS: ContentUnlockState = {
    room_enemy: true,
    room_empty: true,
    room_rest: true,
    room_treasure: true,
    action_attack: true,
    action_defend: true,
    hud_hp_bar: true,
    ui_hp_numbers: true,
    ui_depth: true,
    ui_room_icons: true,
    ui_level_panel: true,
    currency_gold: true,
    room_trap: true,
    ui_player_stats: true,
    room_merchant: true,
    resource_potions: true,
    action_potion: true,
    resource_resolve: true,
    action_skill: true,
    room_shrine: true,
    room_elite: true,
    ui_enemy_hp: true,
    ui_run_metrics: true,
    ui_kill_counter: true,
    skill_cleave: false,
    skill_bleed_strike: false,
    skill_preparation: false,
    relic_pool_rare: false,
    relic_pool_unique: false,
};

const DEFAULT_PROFILE: MetaProfile = {
    skillPoints: 0,
    totalSkillPointsBanked: 0,
    highestDepthEver: 0,
    bossesKilledEver: 0,
    upgrades: {
        damage: 0,
        hp: 0,
        defense: 0,
        goldGain: 0,
    },
    contentUnlocks: { ...DEFAULT_CONTENT_UNLOCKS },
    npcMemory: makeDefaultNpcMemoryMap(),
};

const DEPTH_MILESTONES: ContentUnlockMilestone[] = [
    {
        id: 'depth-5',
        label: lt('Навык: Рубка', 'Skill: Cleave'),
        requirement: lt('Достигни глубины 5', 'Reach depth 5'),
        depth: 5,
        unlocks: ['skill_cleave'],
    },
    {
        id: 'depth-15',
        label: lt('Навык: Кровавый разрез', 'Skill: Bleed Strike'),
        requirement: lt('Достигни глубины 15', 'Reach depth 15'),
        depth: 15,
        unlocks: ['skill_bleed_strike'],
    },
    {
        id: 'depth-25',
        label: lt('Редкие реликвии в добыче', 'Rare relic rolls'),
        requirement: lt('Достигни глубины 25', 'Reach depth 25'),
        depth: 25,
        unlocks: ['relic_pool_rare'],
    },
];

const FIRST_BOSS_MILESTONE: ContentUnlockMilestone = {
    id: 'first-boss',
    label: lt('Навык: Подготовка и уникальные реликвии', 'Skill: Preparation + unique relics'),
    requirement: lt('Победи первого босса', 'Defeat your first boss'),
    requiresFirstBossKill: true,
    unlocks: ['skill_preparation', 'relic_pool_unique'],
};

const ALL_MILESTONES: ContentUnlockMilestone[] = [...DEPTH_MILESTONES, FIRST_BOSS_MILESTONE];

// Canonical meta-upgrade table (per design doc):
//   damage:   7 levels, costs 1/2/4/8/16/32/64       (geometric x2)
//   hp:       8 levels, costs 1/2/4/5/8/9/16/17      (paired steps)
//   defense:  4 levels, costs 5/10/20/40             (geometric x2)
//   goldGain: 4 levels, costs 5/10/20/40, +5%/level
// `sanitizeProfile` clamps any pre-existing save above maxLevel down
// to the new ceiling, so older v4 profiles with damage=10 / hp=10
// will simply land on the new caps next launch.
const UPGRADE_DEFINITIONS: MetaUpgradeDefinition[] = [
    {
        id: 'damage',
        title: lt('Урон', 'Damage'),
        maxLevel: 7,
        costs: [1, 2, 4, 8, 16, 32, 64],
        description: (nextLevel) =>
            lt(
                `Каждый забег начинается с +${nextLevel} к атаке.`,
                `Start each run with +${nextLevel} attack.`
            ),
    },
    {
        id: 'hp',
        title: lt('ОЗ', 'Max HP'),
        maxLevel: 8,
        costs: [1, 2, 4, 5, 8, 9, 16, 17],
        description: (nextLevel) =>
            lt(
                `Каждый забег начинается с +${nextLevel} к максимуму ОЗ.`,
                `Start each run with +${nextLevel} max HP.`
            ),
    },
    {
        id: 'defense',
        title: lt('Защита', 'Defense'),
        maxLevel: 4,
        costs: [5, 10, 20, 40],
        description: (nextLevel) =>
            lt(
                `Каждый забег начинается с +${nextLevel} к защите.`,
                `Start each run with +${nextLevel} defense.`
            ),
    },
    {
        id: 'goldGain',
        title: lt('Получаемое золото', 'Gold gain'),
        maxLevel: 4,
        costs: [5, 10, 20, 40],
        description: (nextLevel) =>
            lt(
                `Получаемое золото увеличено на +${nextLevel * 5}%.`,
                `Gold gained from any source increased by +${nextLevel * 5}%.`
            ),
    },
];

export class MetaProgressionManager {
    private profile: MetaProfile;
    private npcManager: NpcManager;

    constructor() {
        this.profile = this.loadProfile();
        this.npcManager = new NpcManager(this.profile.npcMemory, () => this.saveProfile());
    }

    getNpcManager(): NpcManager {
        return this.npcManager;
    }

    get availableSkillPoints(): number {
        return this.profile.skillPoints;
    }

    get totalSkillPointsBanked(): number {
        return this.profile.totalSkillPointsBanked;
    }

    get highestDepthEver(): number {
        return this.profile.highestDepthEver;
    }

    get bossesKilledEver(): number {
        return this.profile.bossesKilledEver;
    }

    getProfile(): MetaProfile {
        return {
            ...this.profile,
            upgrades: { ...this.profile.upgrades },
            contentUnlocks: { ...this.profile.contentUnlocks },
        };
    }

    getBonuses() {
        const damage = this.getUpgradeLevel('damage');
        const hp = this.getUpgradeLevel('hp');
        const defense = this.getUpgradeLevel('defense');
        const goldGain = this.getUpgradeLevel('goldGain');

        return {
            player: {
                maxHp: hp,
                attack: damage,
                defenseBonus: defense,
                goldGainMult: 1 + goldGain * 0.05,
            } satisfies PlayerMetaBonuses,
        };
    }

    getUpgradeLevel(id: UpgradeId): number {
        return this.profile.upgrades[id];
    }

    isUnlocked(id: UnlockId): boolean {
        return !!this.profile.contentUnlocks[id];
    }

    getUnlockedExtraSkills(): SkillId[] {
        const unlocked: SkillId[] = [];
        if (this.isUnlocked('skill_cleave')) unlocked.push('cleave');
        if (this.isUnlocked('skill_bleed_strike')) unlocked.push('bleed_strike');
        if (this.isUnlocked('skill_preparation')) unlocked.push('preparation');
        return unlocked;
    }

    getRelicRarityPool(): Array<'common' | 'rare' | 'unique'> {
        const pool: Array<'common' | 'rare' | 'unique'> = ['common'];
        if (this.isUnlocked('relic_pool_rare')) pool.push('rare');
        if (this.isUnlocked('relic_pool_unique')) pool.push('unique');
        return pool;
    }

    unlockContent(id: UnlockId): boolean {
        if (this.profile.contentUnlocks[id]) {
            return false;
        }

        this.profile.contentUnlocks[id] = true;
        this.saveProfile();
        return true;
    }

    getUnlockedContent(): ContentUnlockState {
        return { ...this.profile.contentUnlocks };
    }

    getProjectedUnlocks(depth: number): ContentUnlockState {
        const projected = { ...this.profile.contentUnlocks };

        DEPTH_MILESTONES.forEach((milestone) => {
            if (milestone.depth !== undefined && depth >= milestone.depth) {
                milestone.unlocks.forEach((id) => {
                    projected[id] = true;
                });
            }
        });

        return projected;
    }

    unlockDepthMilestones(depth: number): ContentUnlockMilestone[] {
        const unlockedMilestones: ContentUnlockMilestone[] = [];

        DEPTH_MILESTONES.forEach((milestone) => {
            if (milestone.depth === undefined || depth < milestone.depth) {
                return;
            }

            const newlyUnlocked = milestone.unlocks.some((id) => !this.profile.contentUnlocks[id]);
            if (!newlyUnlocked) {
                return;
            }

            milestone.unlocks.forEach((id) => {
                this.profile.contentUnlocks[id] = true;
            });
            unlockedMilestones.push(milestone);
        });

        if (unlockedMilestones.length > 0) {
            this.saveProfile();
        }

        return unlockedMilestones;
    }

    registerBossKill(): ContentUnlockMilestone[] {
        this.profile.bossesKilledEver += 1;

        const unlocked: ContentUnlockMilestone[] = [];
        const maybeApply = (m: ContentUnlockMilestone) => {
            const newlyUnlocked = m.unlocks.some((id) => !this.profile.contentUnlocks[id]);
            if (!newlyUnlocked) return;
            m.unlocks.forEach((id) => {
                this.profile.contentUnlocks[id] = true;
            });
            unlocked.push(m);
        };

        maybeApply(FIRST_BOSS_MILESTONE);

        this.saveProfile();
        return unlocked;
    }

    /**
     * Snapshot of every content-unlock milestone for end-screen
     * rendering. The list is stable across runs (one entry per
     * milestone, in display order); each entry carries the localised
     * label, the natural-unit progress (`current`/`target`) and the
     * unlocked flag. `resetProgress` zeroes the source counters so a
     * post-wipe snapshot reports every entry at `0/target` again.
     */
    getMilestoneProgressList(language: Language): MilestoneProgressEntry[] {
        return ALL_MILESTONES.map((milestone) => {
            const unlocked = milestone.unlocks.every((id) => this.profile.contentUnlocks[id]);

            let current: number;
            let target: number;
            if (milestone.depth !== undefined) {
                target = milestone.depth;
                current = Math.min(this.profile.highestDepthEver, target);
            } else if (milestone.requiresFirstBossKill) {
                target = 1;
                current = Math.min(this.profile.bossesKilledEver, target);
            } else {
                target = 1;
                current = unlocked ? 1 : 0;
            }

            return {
                id: milestone.id,
                label: pickLocalized(language, milestone.label),
                requirement: pickLocalized(language, milestone.requirement),
                current,
                target,
                unlocked,
            };
        });
    }

    getUiUnlockState(): UiUnlockState {
        return {
            showHpNumbers: true,
            showDepthReadout: true,
            showRoomIcons: true,
            showLevelPanel: true,
            showPlayerStats: true,
            showGold: true,
            showPotions: true,
            showResolve: true,
            showEnemyHp: true,
            showRunMetrics: true,
            showKillCounter: true,
        };
    }

    /**
     * Bank skill points earned during a successful escape. Each level-up
     * during a run grants one pending skill point; on escape, the
     * pending total is added to the persistent bank. Death never banks
     * — `resetProgress` wipes the entire profile instead.
     */
    bankSkillPoints(points: number, runDepth: number = 0): number {
        const reward = Math.max(0, Math.floor(points));
        this.profile.skillPoints += reward;
        this.profile.totalSkillPointsBanked += reward;
        this.profile.highestDepthEver = Math.max(this.profile.highestDepthEver, runDepth);
        this.saveProfile();
        return reward;
    }

    purchaseUpgrade(id: UpgradeId): boolean {
        const definition = UPGRADE_DEFINITIONS.find((upgrade) => upgrade.id === id);
        if (!definition) {
            return false;
        }

        const level = this.getUpgradeLevel(id);
        if (level >= definition.maxLevel) {
            return false;
        }

        const cost = definition.costs[level];
        if (this.profile.skillPoints < cost) {
            return false;
        }

        this.profile.skillPoints -= cost;
        this.profile.upgrades[id] = level + 1;
        this.saveProfile();
        return true;
    }

    getUpgradeCards(language: 'ru' | 'en' = 'ru'): UpgradeCardInfo[] {
        return UPGRADE_DEFINITIONS.map((definition) => {
            const level = this.getUpgradeLevel(definition.id);
            const cost = level >= definition.maxLevel ? null : definition.costs[level];

            return {
                id: definition.id,
                title: pickLocalized(language, definition.title),
                description: pickLocalized(language, definition.description(level + 1)),
                level,
                maxLevel: definition.maxLevel,
                cost,
                canPurchase: cost !== null && cost <= this.profile.skillPoints,
            };
        });
    }

    /**
     * Wipe the entire profile back to defaults. Triggered on death (so
     * the bank + every purchased upgrade is lost) and from the HUD
     * "Restart from scratch" confirmation. Also nukes any legacy
     * localStorage entries so the next save uses the v4 schema.
     */
    resetProgress() {
        this.profile = this.cloneDefaultProfile();
        this.npcManager = new NpcManager(this.profile.npcMemory, () => this.saveProfile());

        try {
            window.localStorage.removeItem(STORAGE_KEY);
            LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
        } catch {
            // ignore
        }
    }

    /**
     * Reset NPC memory back to defaults at the start of every run.
     * Wipes metCount / affinity / lastDepthMet / flags for every NPC
     * so the player always sees the `first` dialog beat on the first
     * encounter of a fresh run. Upgrades, unlocks, skill points and
     * depth records are intentionally left alone — only the per-NPC
     * memory map is touched.
     */
    resetNpcMemoryForNewRun() {
        this.profile.npcMemory = makeDefaultNpcMemoryMap();
        this.npcManager = new NpcManager(this.profile.npcMemory, () => this.saveProfile());
        this.saveProfile();
    }

    private loadProfile(): MetaProfile {
        try {
            const currentRaw = window.localStorage.getItem(STORAGE_KEY);
            if (currentRaw) {
                return this.sanitizeProfile(JSON.parse(currentRaw) as Partial<MetaProfile>);
            }

            // First launch under the v4 schema (or migrating from any
            // earlier version): drop legacy snapshots without
            // converting them. The user explicitly wants pre-v4
            // saves zeroed out so the new economy starts clean.
            let hadLegacy = false;
            for (const key of LEGACY_STORAGE_KEYS) {
                if (window.localStorage.getItem(key) !== null) {
                    hadLegacy = true;
                    window.localStorage.removeItem(key);
                }
            }
            if (hadLegacy) {
                const fresh = cloneDefaultProfile();
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
                return fresh;
            }
        } catch {
            // fall through
        }

        return this.cloneDefaultProfile();
    }

    private sanitizeProfile(profile: Partial<MetaProfile>): MetaProfile {
        return sanitizeProfile(profile);
    }

    private saveProfile() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profile));
        } catch {
            // ignore
        }
    }

    private cloneDefaultProfile(): MetaProfile {
        return cloneDefaultProfile();
    }
}

// Exported pure helpers so tests can exercise sanitization without
// touching the singleton / localStorage.
export function cloneDefaultProfile(): MetaProfile {
    return {
        ...DEFAULT_PROFILE,
        upgrades: { ...DEFAULT_PROFILE.upgrades },
        contentUnlocks: { ...DEFAULT_CONTENT_UNLOCKS },
        npcMemory: makeDefaultNpcMemoryMap(),
    };
}

export function sanitizeProfile(profile: Partial<MetaProfile>): MetaProfile {
    const sanitizedUpgrades = {} as Record<UpgradeId, number>;
    for (const definition of UPGRADE_DEFINITIONS) {
        const incoming =
            profile.upgrades?.[definition.id] ?? DEFAULT_PROFILE.upgrades[definition.id];
        sanitizedUpgrades[definition.id] = Math.max(0, Math.min(definition.maxLevel, incoming));
    }

    return {
        skillPoints: Math.max(0, profile.skillPoints ?? DEFAULT_PROFILE.skillPoints),
        totalSkillPointsBanked: Math.max(
            0,
            profile.totalSkillPointsBanked ?? DEFAULT_PROFILE.totalSkillPointsBanked
        ),
        highestDepthEver: Math.max(0, profile.highestDepthEver ?? DEFAULT_PROFILE.highestDepthEver),
        bossesKilledEver: Math.max(0, profile.bossesKilledEver ?? DEFAULT_PROFILE.bossesKilledEver),
        upgrades: sanitizedUpgrades,
        contentUnlocks: {
            ...DEFAULT_CONTENT_UNLOCKS,
            ...profile.contentUnlocks,
        },
        npcMemory: sanitizeNpcMemoryMap(profile.npcMemory),
    };
}
