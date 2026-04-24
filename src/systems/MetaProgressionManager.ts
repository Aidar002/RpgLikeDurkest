export const ALL_UNLOCK_IDS = [
    'room_enemy',
    'room_empty',
    'room_rest',
    'room_treasure',
    'action_attack',
    'action_defend',
    'hud_hp_bar',
    'ui_hp_numbers',
    'ui_depth',
    'ui_room_icons',
    'ui_level_panel',
    'currency_gold',
    'room_trap',
    'ui_player_stats',
    'room_merchant',
    'resource_potions',
    'action_potion',
    'resource_resolve',
    'action_skill',
    'room_shrine',
    'resource_light',
    'room_elite',
    'ui_enemy_hp',
    'ui_run_metrics',
    'ui_kill_counter',
    'currency_relic_shards',
    'merchant_premium',
    'shrine_premium',
    'ui_prestige_forecast',
] as const;

export type UnlockId = (typeof ALL_UNLOCK_IDS)[number];

export type UpgradeId =
    | 'vitality'
    | 'might'
    | 'wisdom'
    | 'recovery'
    | 'preparation'
    | 'lastStand';

export interface PlayerMetaBonuses {
    maxHp: number;
    attack: number;
    xpMultiplier: number;
    reviveCharges: number;
    startingLightBonus: number;
}

export interface RoomMetaBonuses {
    restHealBonus: number;
    trapDamageReduction: number;
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
    showLight: boolean;
    showEnemyHp: boolean;
    showRunMetrics: boolean;
    showKillCounter: boolean;
    showRelicShards: boolean;
    showPrestigeForecast: boolean;
}

export type ContentUnlockState = Record<UnlockId, boolean>;

export interface MetaProfile {
    prestigePoints: number;
    totalPrestigeEarned: number;
    highestDepthEver: number;
    bossesKilledEver: number;
    upgrades: Record<UpgradeId, number>;
    contentUnlocks: ContentUnlockState;
}

export interface UpgradeCardInfo {
    id: UpgradeId;
    title: string;
    description: string;
    level: number;
    maxLevel: number;
    cost: number | null;
    canPurchase: boolean;
}

export interface ContentUnlockMilestone {
    id: string;
    label: string;
    requirement: string;
    depth?: number;
    requiresFirstBossKill?: boolean;
    unlocks: UnlockId[];
}

interface MetaUpgradeDefinition {
    id: UpgradeId;
    title: string;
    maxLevel: number;
    costs: number[];
    description: (nextLevel: number) => string;
}

const STORAGE_KEY = 'rpglikedurkest-meta-v2';
const LEGACY_STORAGE_KEY = 'rpglikedurkest-meta-v1';

const DEFAULT_CONTENT_UNLOCKS: ContentUnlockState = {
    room_enemy: true,
    room_empty: true,
    room_rest: true,
    room_treasure: true,
    action_attack: true,
    action_defend: true,
    hud_hp_bar: true,
    ui_hp_numbers: false,
    ui_depth: false,
    ui_room_icons: false,
    ui_level_panel: false,
    currency_gold: false,
    room_trap: false,
    ui_player_stats: false,
    room_merchant: false,
    resource_potions: false,
    action_potion: false,
    resource_resolve: false,
    action_skill: false,
    room_shrine: false,
    resource_light: false,
    room_elite: false,
    ui_enemy_hp: false,
    ui_run_metrics: false,
    ui_kill_counter: false,
    currency_relic_shards: false,
    merchant_premium: false,
    shrine_premium: false,
    ui_prestige_forecast: false,
};

const DEFAULT_PROFILE: MetaProfile = {
    prestigePoints: 0,
    totalPrestigeEarned: 0,
    highestDepthEver: 0,
    bossesKilledEver: 0,
    upgrades: {
        vitality: 0,
        might: 0,
        wisdom: 0,
        recovery: 0,
        preparation: 0,
        lastStand: 0,
    },
    contentUnlocks: { ...DEFAULT_CONTENT_UNLOCKS },
};

const DEPTH_MILESTONES: ContentUnlockMilestone[] = [
    {
        id: 'depth-1',
        label: 'HP numbers and current depth',
        requirement: 'Reach depth 1',
        depth: 1,
        unlocks: ['ui_hp_numbers', 'ui_depth'],
    },
    {
        id: 'depth-2',
        label: 'Room icons, XP panel, and gold',
        requirement: 'Reach depth 2',
        depth: 2,
        unlocks: ['ui_room_icons', 'ui_level_panel', 'currency_gold'],
    },
    {
        id: 'depth-3',
        label: 'Traps and combat stat readouts',
        requirement: 'Reach depth 3',
        depth: 3,
        unlocks: ['room_trap', 'ui_player_stats'],
    },
    {
        id: 'depth-4',
        label: 'Merchants, potions, and combat healing',
        requirement: 'Reach depth 4',
        depth: 4,
        unlocks: ['room_merchant', 'resource_potions', 'action_potion'],
    },
    {
        id: 'depth-5',
        label: 'Resolve, shrines, and the skill strike',
        requirement: 'Reach depth 5',
        depth: 5,
        unlocks: ['resource_resolve', 'action_skill', 'room_shrine'],
    },
    {
        id: 'depth-6',
        label: 'Light, darkness, and lantern play',
        requirement: 'Reach depth 6',
        depth: 6,
        unlocks: ['resource_light'],
    },
    {
        id: 'depth-7',
        label: 'Elite rooms, enemy HP, and run metrics',
        requirement: 'Reach depth 7',
        depth: 7,
        unlocks: ['room_elite', 'ui_enemy_hp', 'ui_run_metrics', 'ui_kill_counter'],
    },
];

const FIRST_BOSS_MILESTONE: ContentUnlockMilestone = {
    id: 'first-boss',
    label: 'Relic shards, premium rites, and prestige forecast',
    requirement: 'Defeat your first boss',
    requiresFirstBossKill: true,
    unlocks: ['currency_relic_shards', 'merchant_premium', 'shrine_premium', 'ui_prestige_forecast'],
};

const ALL_MILESTONES: ContentUnlockMilestone[] = [...DEPTH_MILESTONES, FIRST_BOSS_MILESTONE];

const UPGRADE_DEFINITIONS: MetaUpgradeDefinition[] = [
    {
        id: 'vitality',
        title: 'Vitality',
        maxLevel: 5,
        costs: [2, 4, 7, 10, 14],
        description: (nextLevel) => `Start each run with +${nextLevel * 3} max HP.`,
    },
    {
        id: 'might',
        title: 'Might',
        maxLevel: 3,
        costs: [3, 6, 10],
        description: (nextLevel) => `Start each run with +${nextLevel} attack.`,
    },
    {
        id: 'wisdom',
        title: 'Wisdom',
        maxLevel: 4,
        costs: [2, 4, 7, 11],
        description: (nextLevel) => `Gain +${nextLevel * 15}% XP from every source.`,
    },
    {
        id: 'recovery',
        title: 'Recovery',
        maxLevel: 4,
        costs: [2, 4, 7, 10],
        description: (nextLevel) => `Rest heals +${nextLevel * 2}; traps deal -${nextLevel}.`,
    },
    {
        id: 'preparation',
        title: 'Preparation',
        maxLevel: 3,
        costs: [2, 5, 9],
        description: (nextLevel) => `When light is unlocked, start with +${nextLevel} light.`,
    },
    {
        id: 'lastStand',
        title: 'Last Stand',
        maxLevel: 1,
        costs: [10],
        description: () => 'Gain 1 revive charge per run.',
    },
];

export class MetaProgressionManager {
    private profile: MetaProfile;

    constructor() {
        this.profile = this.loadProfile();
    }

    get availablePrestige(): number {
        return this.profile.prestigePoints;
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
        const vitality = this.getUpgradeLevel('vitality');
        const might = this.getUpgradeLevel('might');
        const wisdom = this.getUpgradeLevel('wisdom');
        const recovery = this.getUpgradeLevel('recovery');
        const preparation = this.getUpgradeLevel('preparation');
        const lastStand = this.getUpgradeLevel('lastStand');

        return {
            player: {
                maxHp: vitality * 3,
                attack: might,
                xpMultiplier: 1 + wisdom * 0.15,
                reviveCharges: lastStand,
                startingLightBonus: preparation,
            } satisfies PlayerMetaBonuses,
            rooms: {
                restHealBonus: recovery * 2,
                trapDamageReduction: recovery,
            } satisfies RoomMetaBonuses,
        };
    }

    getUpgradeLevel(id: UpgradeId): number {
        return this.profile.upgrades[id];
    }

    isUnlocked(id: UnlockId): boolean {
        return this.profile.contentUnlocks[id];
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

        const unlockedMilestones: ContentUnlockMilestone[] = [];
        const shouldUnlockFirstBoss = FIRST_BOSS_MILESTONE.unlocks.some(
            (id) => !this.profile.contentUnlocks[id]
        );

        if (shouldUnlockFirstBoss) {
            FIRST_BOSS_MILESTONE.unlocks.forEach((id) => {
                this.profile.contentUnlocks[id] = true;
            });
            unlockedMilestones.push(FIRST_BOSS_MILESTONE);
        }

        this.saveProfile();
        return unlockedMilestones;
    }

    getNextContentUnlock(): ContentUnlockMilestone | null {
        return (
            ALL_MILESTONES.find((milestone) =>
                milestone.unlocks.some((unlockId) => !this.profile.contentUnlocks[unlockId])
            ) ?? null
        );
    }

    getUiUnlockState(): UiUnlockState {
        return {
            showHpNumbers: this.isUnlocked('ui_hp_numbers'),
            showDepthReadout: this.isUnlocked('ui_depth'),
            showRoomIcons: this.isUnlocked('ui_room_icons'),
            showLevelPanel: this.isUnlocked('ui_level_panel'),
            showPlayerStats: this.isUnlocked('ui_player_stats'),
            showGold: this.isUnlocked('currency_gold'),
            showPotions: this.isUnlocked('resource_potions'),
            showResolve: this.isUnlocked('resource_resolve'),
            showLight: this.isUnlocked('resource_light'),
            showEnemyHp: this.isUnlocked('ui_enemy_hp'),
            showRunMetrics: this.isUnlocked('ui_run_metrics'),
            showKillCounter: this.isUnlocked('ui_kill_counter'),
            showRelicShards: this.isUnlocked('currency_relic_shards'),
            showPrestigeForecast: this.isUnlocked('ui_prestige_forecast'),
        };
    }

    awardPrestigeForRun(runDepth: number, bossesKilled: number): number {
        const reward = Math.max(0, runDepth) + Math.max(0, bossesKilled) * 2;
        this.profile.prestigePoints += reward;
        this.profile.totalPrestigeEarned += reward;
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
        if (this.profile.prestigePoints < cost) {
            return false;
        }

        this.profile.prestigePoints -= cost;
        this.profile.upgrades[id] = level + 1;
        this.saveProfile();
        return true;
    }

    getUpgradeCards(): UpgradeCardInfo[] {
        return UPGRADE_DEFINITIONS.map((definition) => {
            const level = this.getUpgradeLevel(definition.id);
            const cost = level >= definition.maxLevel ? null : definition.costs[level];

            return {
                id: definition.id,
                title: definition.title,
                description: definition.description(level + 1),
                level,
                maxLevel: definition.maxLevel,
                cost,
                canPurchase: cost !== null && cost <= this.profile.prestigePoints,
            };
        });
    }

    resetProgress() {
        this.profile = this.cloneDefaultProfile();

        try {
            window.localStorage.removeItem(STORAGE_KEY);
            window.localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
            // Ignore storage failures and keep the reset flow responsive.
        }
    }

    private loadProfile(): MetaProfile {
        try {
            const currentRaw = window.localStorage.getItem(STORAGE_KEY);
            if (currentRaw) {
                return this.sanitizeProfile(JSON.parse(currentRaw) as Partial<MetaProfile>);
            }

            const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
            if (legacyRaw) {
                const migrated = this.migrateLegacyProfile(JSON.parse(legacyRaw) as Record<string, unknown>);
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
                return migrated;
            }
        } catch {
            // Fall through to a clean profile.
        }

        return this.cloneDefaultProfile();
    }

    private sanitizeProfile(profile: Partial<MetaProfile>): MetaProfile {
        return {
            prestigePoints: Math.max(0, profile.prestigePoints ?? DEFAULT_PROFILE.prestigePoints),
            totalPrestigeEarned: Math.max(
                0,
                profile.totalPrestigeEarned ?? DEFAULT_PROFILE.totalPrestigeEarned
            ),
            highestDepthEver: Math.max(0, profile.highestDepthEver ?? DEFAULT_PROFILE.highestDepthEver),
            bossesKilledEver: Math.max(0, profile.bossesKilledEver ?? DEFAULT_PROFILE.bossesKilledEver),
            upgrades: {
                vitality: Math.min(5, profile.upgrades?.vitality ?? DEFAULT_PROFILE.upgrades.vitality),
                might: Math.min(3, profile.upgrades?.might ?? DEFAULT_PROFILE.upgrades.might),
                wisdom: Math.min(4, profile.upgrades?.wisdom ?? DEFAULT_PROFILE.upgrades.wisdom),
                recovery: Math.min(4, profile.upgrades?.recovery ?? DEFAULT_PROFILE.upgrades.recovery),
                preparation: Math.min(
                    3,
                    profile.upgrades?.preparation ?? DEFAULT_PROFILE.upgrades.preparation
                ),
                lastStand: Math.min(1, profile.upgrades?.lastStand ?? DEFAULT_PROFILE.upgrades.lastStand),
            },
            contentUnlocks: {
                ...DEFAULT_CONTENT_UNLOCKS,
                ...profile.contentUnlocks,
            },
        };
    }

    private migrateLegacyProfile(legacy: Record<string, unknown>): MetaProfile {
        const highestDepthEver = Math.max(
            0,
            typeof legacy.highestDepthEver === 'number' ? legacy.highestDepthEver : 0
        );
        const bossesKilledEver = [8, 16, 24].filter((depth) => highestDepthEver > depth).length;
        const legacyUpgrades =
            typeof legacy.upgrades === 'object' && legacy.upgrades !== null
                ? (legacy.upgrades as Record<string, number>)
                : {};

        const migrated = this.sanitizeProfile({
            prestigePoints: typeof legacy.prestigePoints === 'number' ? legacy.prestigePoints : 0,
            totalPrestigeEarned:
                typeof legacy.totalPrestigeEarned === 'number' ? legacy.totalPrestigeEarned : 0,
            highestDepthEver,
            bossesKilledEver,
            upgrades: {
                vitality: legacyUpgrades.vitality ?? 0,
                might: legacyUpgrades.might ?? 0,
                wisdom: legacyUpgrades.wisdom ?? 0,
                recovery: legacyUpgrades.recovery ?? 0,
                preparation: legacyUpgrades.foresight ?? 0,
                lastStand: legacyUpgrades.lastStand ?? 0,
            },
        });

        DEPTH_MILESTONES.forEach((milestone) => {
            if (milestone.depth !== undefined && highestDepthEver >= milestone.depth) {
                milestone.unlocks.forEach((id) => {
                    migrated.contentUnlocks[id] = true;
                });
            }
        });

        if (bossesKilledEver > 0) {
            FIRST_BOSS_MILESTONE.unlocks.forEach((id) => {
                migrated.contentUnlocks[id] = true;
            });
        }

        return migrated;
    }

    private saveProfile() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profile));
        } catch {
            // Ignore storage failures and keep the run playable.
        }
    }

    private cloneDefaultProfile(): MetaProfile {
        return {
            ...DEFAULT_PROFILE,
            upgrades: { ...DEFAULT_PROFILE.upgrades },
            contentUnlocks: { ...DEFAULT_PROFILE.contentUnlocks },
        };
    }
}
