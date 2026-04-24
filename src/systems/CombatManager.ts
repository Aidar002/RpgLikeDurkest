import { getBossForDepth, getEnemyForDepth } from '../data/Enemies';
import { COMBAT_CONFIG, ROOM_CONFIG } from '../data/GameConfig';
import { EventLog } from '../ui/EventLog';
import { PlayerManager } from './PlayerManager';

export type CombatAction = 'attack' | 'defend' | 'skill' | 'potion';
export type EncounterKind = 'normal' | 'elite' | 'boss';

export interface ActiveEnemy {
    kind: EncounterKind;
    name: string;
    description: string;
    icon: string;
    hp: number;
    maxHp: number;
    attack: number;
    color: number;
    xp: number;
    gold: number;
}

export interface CombatRewards {
    xp: number;
    gold: number;
    potions: number;
    attackBonus: number;
    relicShards: number;
}

export interface CombatEndPayload {
    enemyName: string;
    kind: EncounterKind;
    rewards: CombatRewards;
}

export class CombatManager {
    private player: PlayerManager;
    private log: EventLog;
    private onCombatEnd: (payload: CombatEndPayload) => void;
    private onPlayerHit: (damage: number) => void;

    public enemy: ActiveEnemy | null = null;
    public onEnemyUpdate: (
        hp: number,
        maxHp: number,
        color: number,
        name: string,
        icon: string
    ) => void = () => {};

    constructor(
        player: PlayerManager,
        log: EventLog,
        onCombatEnd: (payload: CombatEndPayload) => void,
        onPlayerHit: (damage: number) => void = () => {}
    ) {
        this.player = player;
        this.log = log;
        this.onCombatEnd = onCombatEnd;
        this.onPlayerHit = onPlayerHit;
    }

    startCombat(depth: number, kind: EncounterKind) {
        const definition = kind === 'boss' ? getBossForDepth(depth) : getEnemyForDepth(depth);
        const rewardMultiplier =
            kind === 'elite'
                ? COMBAT_CONFIG.eliteRewardMultiplier
                : kind === 'boss'
                  ? COMBAT_CONFIG.bossRewardMultiplier
                  : 1;

        const lowLightRewardMultiplier =
            kind !== 'normal' ? this.player.getRewardMultiplierFromLowLight() : 1;

        this.enemy = {
            kind,
            name: definition.name,
            description: definition.description,
            icon: definition.icon,
            hp:
                kind === 'elite'
                    ? Math.round(definition.hp * COMBAT_CONFIG.eliteHpMultiplier)
                    : definition.hp,
            maxHp:
                kind === 'elite'
                    ? Math.round(definition.hp * COMBAT_CONFIG.eliteHpMultiplier)
                    : definition.hp,
            attack:
                kind === 'elite'
                    ? Math.round(definition.attack * COMBAT_CONFIG.eliteAttackMultiplier)
                    : definition.attack,
            color: definition.color,
            xp: Math.max(1, Math.round(definition.xp * rewardMultiplier * lowLightRewardMultiplier)),
            gold: Math.max(1, Math.round(definition.gold * rewardMultiplier * lowLightRewardMultiplier)),
        };

        const header =
            kind === 'boss' ? 'Boss encounter.' : kind === 'elite' ? 'Elite encounter.' : 'Hostile contact.';
        this.log.addMessage(`${header} ${definition.name} ${definition.icon}`, '#ff6666');
        this.onEnemyUpdate(
            this.enemy.hp,
            this.enemy.maxHp,
            this.enemy.color,
            this.enemy.name,
            this.enemy.icon
        );
    }

    processTurn(action: CombatAction) {
        if (!this.enemy) {
            return;
        }

        if (action === 'attack') {
            this.player.gainResolve(COMBAT_CONFIG.resolveFromAttack);
            const result = this.rollPlayerAttack();
            this.enemy.hp = Math.max(0, this.enemy.hp - result.damage);
            this.log.addMessage(
                result.critical
                    ? `Critical strike for ${result.damage} damage.`
                    : `You strike for ${result.damage} damage.`,
                result.critical ? '#ffe08a' : '#dddddd'
            );
            this.onEnemyUpdate(
                this.enemy.hp,
                this.enemy.maxHp,
                this.enemy.color,
                this.enemy.name,
                this.enemy.icon
            );
        } else if (action === 'defend') {
            this.player.gainResolve(COMBAT_CONFIG.resolveFromGuard);
            this.log.addMessage('You brace for the incoming blow.', '#66aaff');
        } else if (action === 'skill') {
            if (!this.player.spendResolve(COMBAT_CONFIG.skillCost)) {
                this.log.addMessage('You need more resolve to use your skill.', '#8899aa');
                return;
            }

            const damage = Math.max(
                1,
                Math.ceil(this.player.getAttackPower() * COMBAT_CONFIG.skillMultiplier) +
                    COMBAT_CONFIG.skillBonus
            );
            this.enemy.hp = Math.max(0, this.enemy.hp - damage);
            this.log.addMessage(`Your skill lands for ${damage} damage.`, '#b893ff');
            this.onEnemyUpdate(
                this.enemy.hp,
                this.enemy.maxHp,
                this.enemy.color,
                this.enemy.name,
                this.enemy.icon
            );
        } else {
            if (!this.player.spendPotion()) {
                this.log.addMessage('No potions remain.', '#8899aa');
                return;
            }

            const healed = this.player.heal(COMBAT_CONFIG.potionHeal);
            this.log.addMessage(`You drink a potion and recover ${healed} HP.`, '#78e496');
        }

        if (this.enemy.hp <= 0) {
            const payload = this.buildRewards(this.enemy);
            this.log.addMessage(`${this.enemy.name} falls.`, '#66ff88');
            this.enemy = null;
            this.onCombatEnd(payload);
            return;
        }

        const flatBlock = action === 'defend' ? COMBAT_CONFIG.defendBlock : 0;
        const enemyAttack = this.enemy.attack + this.player.getEnemyAttackBonusFromLight();
        const takenDamage = this.player.takeDamage(enemyAttack, flatBlock);

        this.log.addMessage(`${this.enemy.name} hits you for ${takenDamage}.`, '#ff6666');
        if (takenDamage > 0) {
            this.onPlayerHit(takenDamage);
        } else {
            this.log.addMessage('You absorb the whole impact.', '#8fc6ff');
        }

        if (this.player.stats.hp <= 0) {
            this.log.addMessage('Darkness closes over the expedition.', '#ff3333');
        }
    }

    private rollPlayerAttack() {
        const variance =
            COMBAT_CONFIG.randomVariance > 0
                ? this.randomBetween(-COMBAT_CONFIG.randomVariance, COMBAT_CONFIG.randomVariance)
                : 0;
        const baseDamage = Math.max(1, this.player.getAttackPower() + variance);
        const critical = Math.random() < this.player.getCritChance();

        return {
            damage: critical
                ? Math.max(1, Math.round(baseDamage * COMBAT_CONFIG.criticalMultiplier))
                : baseDamage,
            critical,
        };
    }

    private buildRewards(enemy: ActiveEnemy): CombatEndPayload {
        return {
            enemyName: enemy.name,
            kind: enemy.kind,
            rewards: {
                xp: enemy.xp,
                gold: enemy.gold + (enemy.kind === 'elite' ? ROOM_CONFIG.elite.bonusGold : 0),
                potions: enemy.kind === 'elite' ? ROOM_CONFIG.elite.bonusPotions : 0,
                attackBonus: enemy.kind === 'elite' ? ROOM_CONFIG.elite.bonusAttack : 0,
                relicShards:
                    enemy.kind === 'elite'
                        ? ROOM_CONFIG.elite.shardReward
                        : enemy.kind === 'boss'
                          ? ROOM_CONFIG.boss.shardReward
                          : 0,
            },
        };
    }

    private randomBetween(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}
