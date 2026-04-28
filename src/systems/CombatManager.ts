import { getBossForDepth, getEnemyForDepth } from '../data/Enemies';
import { COMBAT_CONFIG, ROOM_CONFIG } from '../data/GameConfig';
import type { EnemyProfile } from '../data/GameConfig';
import { EventLog } from '../ui/EventLog';
import { Localization } from './Localization';
import { PlayerManager } from './PlayerManager';

export type CombatAction = 'attack' | 'defend' | 'skill' | 'potion';
export type EncounterKind = 'normal' | 'elite' | 'boss';
export type EnemyIntent = 'attack' | 'heavy' | 'guard' | 'charge' | 'curse';

export interface IntentInfo {
    id: EnemyIntent;
    label: string;
    detail: string;
    color: string;
    interruptible: boolean;
}

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
    profile: EnemyProfile;
    turn: number;
    intent: EnemyIntent;
    shield: number;
    chargeBonus: number;
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
    private loc: Localization;
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

    get currentIntentInfo(): IntentInfo | null {
        return this.enemy ? this.describeIntent(this.enemy.intent) : null;
    }

    constructor(
        player: PlayerManager,
        log: EventLog,
        loc: Localization,
        onCombatEnd: (payload: CombatEndPayload) => void,
        onPlayerHit: (damage: number) => void = () => {}
    ) {
        this.player = player;
        this.log = log;
        this.loc = loc;
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

        const lowLightRewardMultiplier = this.player.getRewardMultiplierFromLowLight();

        this.enemy = {
            kind,
            name: this.loc.enemyName(definition.name),
            description: this.loc.enemyDescription(definition.name, definition.description),
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
            profile: definition.profile,
            turn: 1,
            intent: this.pickIntent(definition.profile, 1, kind),
            shield: 0,
            chargeBonus: 0,
        };

        const header =
            kind === 'boss'
                ? this.loc.t('combatBoss')
                : kind === 'elite'
                  ? this.loc.t('combatElite')
                  : this.loc.t('combatHostile');
        this.log.addMessage(`${header} ${this.enemy.name} ${definition.icon}`, '#ff6666');
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

        const intentInfo = this.describeIntent(this.enemy.intent);
        let interrupted = false;

        if (action === 'attack') {
            this.player.gainResolve(COMBAT_CONFIG.resolveFromAttack);
            const result = this.rollPlayerAttack();
            const damage = this.applyDamageToEnemy(result.damage);
            this.log.addMessage(
                result.critical
                    ? this.loc.t('strikeCrit', { damage })
                    : this.loc.t('strike', { damage }),
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
            this.log.addMessage(this.loc.t('brace'), '#66aaff');
        } else if (action === 'skill') {
            if (!this.player.spendResolve(COMBAT_CONFIG.skillCost)) {
                this.log.addMessage(this.loc.t('needResolve'), '#8899aa');
                return;
            }

            const damage = Math.max(
                1,
                Math.ceil(this.player.getAttackPower() * COMBAT_CONFIG.skillMultiplier) +
                    COMBAT_CONFIG.skillBonus
            );
            const actualDamage = this.applyDamageToEnemy(damage, true);
            interrupted = intentInfo.interruptible;
            this.log.addMessage(
                interrupted
                    ? this.loc.t('skillStagger', { intent: intentInfo.label.toLowerCase(), damage: actualDamage })
                    : this.loc.t('skillLand', { damage: actualDamage }),
                '#b893ff'
            );
            this.onEnemyUpdate(
                this.enemy.hp,
                this.enemy.maxHp,
                this.enemy.color,
                this.enemy.name,
                this.enemy.icon
            );
        } else {
            if (!this.player.spendPotion()) {
                this.log.addMessage(this.loc.t('noPotions'), '#8899aa');
                return;
            }

            const healed = this.player.heal(COMBAT_CONFIG.potionHeal);
            this.log.addMessage(this.loc.t('drinkPotion', { healed }), '#78e496');
        }

        if (this.enemy.hp <= 0) {
            const payload = this.buildRewards(this.enemy);
            this.log.addMessage(this.loc.t('enemyFalls', { name: this.enemy.name }), '#66ff88');
            this.enemy = null;
            this.onCombatEnd(payload);
            return;
        }

        if (interrupted) {
            this.log.addMessage(this.loc.t('planBreaks', { name: this.enemy.name }), '#b893ff');
        } else {
            this.resolveEnemyIntent(action === 'defend');
        }

        if (this.player.stats.hp <= 0) {
            this.log.addMessage(this.loc.t('darknessCloses'), '#ff3333');
            return;
        }

        this.enemy.turn++;
        this.enemy.intent = this.pickIntent(this.enemy.profile, this.enemy.turn, this.enemy.kind);
        this.onEnemyUpdate(
            this.enemy.hp,
            this.enemy.maxHp,
            this.enemy.color,
            this.enemy.name,
            this.enemy.icon
        );
    }

    private applyDamageToEnemy(amount: number, pierceGuard: boolean = false): number {
        if (!this.enemy) {
            return 0;
        }

        const blocked = pierceGuard ? 0 : Math.min(this.enemy.shield, Math.max(0, amount - 1));
        const damage = Math.max(1, amount - blocked);
        this.enemy.shield = Math.max(0, this.enemy.shield - blocked);
        this.enemy.hp = Math.max(0, this.enemy.hp - damage);

        if (blocked > 0) {
            this.log.addMessage(this.loc.t('guardAbsorbs', { name: this.enemy.name, blocked }), '#8fc6ff');
        }

        return damage;
    }

    private resolveEnemyIntent(defending: boolean) {
        if (!this.enemy) {
            return;
        }

        switch (this.enemy.intent) {
            case 'attack':
                this.hitPlayer(
                    this.enemy.attack + this.enemy.chargeBonus,
                    defending,
                    this.loc.t('enemyStrikes', { name: this.enemy.name })
                );
                this.enemy.chargeBonus = 0;
                return;
            case 'heavy':
                this.hitPlayer(
                    this.enemy.attack + COMBAT_CONFIG.heavyIntentBonus + this.enemy.chargeBonus,
                    defending,
                    this.loc.t('enemyHeavy', { name: this.enemy.name })
                );
                this.enemy.chargeBonus = 0;
                return;
            case 'guard': {
                const guard = this.enemy.kind === 'boss' ? 6 : this.enemy.kind === 'elite' ? 5 : 3;
                this.enemy.shield += guard;
                this.log.addMessage(this.loc.t('enemyGuard', { name: this.enemy.name, guard }), '#8fc6ff');
                return;
            }
            case 'charge':
                this.enemy.chargeBonus += COMBAT_CONFIG.chargeIntentBonus;
                this.log.addMessage(this.loc.t('enemyCharge', { name: this.enemy.name }), '#ffb86b');
                return;
            case 'curse': {
                const lightLost = this.player.spendLight(COMBAT_CONFIG.curseLightLoss);
                const damage = this.player.takeDamage(Math.max(1, Math.floor(this.enemy.attack / 2)));
                const suffix = lightLost > 0 ? this.loc.t('curseSuffix', { light: lightLost }) : '';
                this.log.addMessage(this.loc.t('enemyCurse', { name: this.enemy.name, damage, suffix }), '#c99cff');
                if (damage > 0) {
                    this.onPlayerHit(damage);
                }
                return;
            }
        }
    }

    private hitPlayer(amount: number, defending: boolean, label: string) {
        const flatBlock = defending ? COMBAT_CONFIG.defendBlock : 0;
        const enemyAttack = amount + this.player.getEnemyAttackBonusFromLight();
        const takenDamage = this.player.takeDamage(enemyAttack, flatBlock);

        this.log.addMessage(this.loc.t('enemyHits', { label, damage: takenDamage }), '#ff6666');
        if (takenDamage > 0) {
            this.onPlayerHit(takenDamage);
        } else {
            this.log.addMessage(this.loc.t('absorb'), '#8fc6ff');
        }
    }

    private pickIntent(profile: EnemyProfile, turn: number, kind: EncounterKind): EnemyIntent {
        if (profile === 'boss') {
            if (turn % 4 === 0) {
                return 'curse';
            }
            if (turn % 3 === 0) {
                return 'heavy';
            }
            return turn % 2 === 0 ? 'guard' : 'attack';
        }

        if (profile === 'brute') {
            return turn % 3 === 0 || kind === 'elite' && turn % 4 === 0 ? 'heavy' : turn % 2 === 0 ? 'guard' : 'attack';
        }

        if (profile === 'stalker') {
            return turn % 3 === 1 ? 'charge' : turn % 3 === 2 ? 'heavy' : 'attack';
        }

        return turn % 3 === 0 ? 'curse' : turn % 2 === 0 ? 'guard' : 'attack';
    }

    private describeIntent(intent: EnemyIntent): IntentInfo {
        switch (intent) {
            case 'attack':
                return {
                    id: intent,
                    label: this.loc.t('intentAttack'),
                    detail: this.loc.t('intentAttackDetail'),
                    color: '#ff9a76',
                    interruptible: false,
                };
            case 'heavy':
                return {
                    id: intent,
                    label: this.loc.t('intentHeavy'),
                    detail: this.loc.t('intentHeavyDetail'),
                    color: '#ff6666',
                    interruptible: true,
                };
            case 'guard':
                return {
                    id: intent,
                    label: this.loc.t('intentGuard'),
                    detail: this.loc.t('intentGuardDetail'),
                    color: '#8fc6ff',
                    interruptible: false,
                };
            case 'charge':
                return {
                    id: intent,
                    label: this.loc.t('intentCharge'),
                    detail: this.loc.t('intentChargeDetail'),
                    color: '#ffb86b',
                    interruptible: true,
                };
            case 'curse':
                return {
                    id: intent,
                    label: this.loc.t('intentCurse'),
                    detail: this.loc.t('intentCurseDetail'),
                    color: '#c99cff',
                    interruptible: true,
                };
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
