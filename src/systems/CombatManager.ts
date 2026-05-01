import { getBossForDepth, getEnemyForDepth } from '../data/Enemies';
import { COMBAT_CONFIG, ROOM_CONFIG, STRESS_CONFIG } from '../data/GameConfig';
import type { EnemyDef, EnemyProfile } from '../data/GameConfig';
import type { EventLog } from '../ui/EventLog';
import { narrate } from './Narrator';
import { Localization } from './Localization';
import { PlayerManager } from './PlayerManager';
import { SKILLS } from './Skills';
import type { SkillId } from './Skills';
import {
    applyBleed,
    applyFocus,
    applyGuard,
    applyMark,
    applyStun,
    applyWeaken,
    consumeGuardBlock,
    consumeMark,
    consumeStunForTurn,
    emptyStatusState,
    statusSummary,
    tickTurn,
} from './StatusEffects';
import type { StatusState } from './StatusEffects';
import type { StressManager } from './Stress';
import { defaultRng, randomInt, type Rng } from './Rng';

export type CombatAction =
    | 'attack'
    | 'defend'
    | 'skill'
    | 'potion'
    | { kind: 'skill'; id: SkillId };

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
    profile: EnemyProfile;
    enraged: boolean;
    charging: boolean;
    turnsAlive: number;
    status: StatusState;
    inflictBleed?: { stacks: number; turns: number; chance: number };
    stressAura?: number;
    firstHitEvaded?: boolean;
    firstStunResisted?: boolean;
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
    killedByBleed: boolean;
}

export class CombatManager {
    private player: PlayerManager;
    private log: EventLog;
    private stress: StressManager | null;
    private loc: Localization;
    private onCombatEnd: (payload: CombatEndPayload) => void;
    private onPlayerHit: (damage: number) => void;
    private rng: Rng;

    public enemy: ActiveEnemy | null = null;
    public lastActionResult: {
        critical: boolean;
        enemyCharged: boolean;
        enemyEnraged: boolean;
        enemyStunned: boolean;
        enemyEvaded: boolean;
    } = {
        critical: false,
        enemyCharged: false,
        enemyEnraged: false,
        enemyStunned: false,
        enemyEvaded: false,
    };
    public onEnemyUpdate: (
        hp: number,
        maxHp: number,
        color: number,
        name: string,
        icon: string
    ) => void = () => {};
    public onPlayerStatusChange: () => void = () => {};
    public onEnemyStatusChange: () => void = () => {};

    constructor(
        player: PlayerManager,
        log: EventLog,
        onCombatEnd: (payload: CombatEndPayload) => void,
        onPlayerHit: (damage: number) => void = () => {},
        stress: StressManager | null = null,
        loc: Localization = new Localization(),
        rng: Rng = defaultRng
    ) {
        this.player = player;
        this.log = log;
        this.onCombatEnd = onCombatEnd;
        this.onPlayerHit = onPlayerHit;
        this.stress = stress;
        this.loc = loc;
        this.rng = rng;
    }

    private tr(ru: string, en: string): string {
        return this.loc.language === 'ru' ? ru : en;
    }

    private skillName(id: SkillId): string {
        return this.loc.pick(SKILLS[id].name);
    }

    startCombat(depth: number, kind: EncounterKind) {
        const definition = kind === 'boss' ? getBossForDepth(depth) : getEnemyForDepth(depth);
        this.setupEnemy(depth, kind, definition);
    }

    private setupEnemy(depth: number, kind: EncounterKind, definition: EnemyDef) {
        const rewardMultiplier =
            kind === 'elite'
                ? COMBAT_CONFIG.eliteRewardMultiplier
                : kind === 'boss'
                  ? COMBAT_CONFIG.bossRewardMultiplier
                  : 1;

        const lowLightRewardMultiplier =
            kind !== 'normal' ? this.player.getRewardMultiplierFromLowLight() : 1;

        const baseHp = kind === 'elite'
            ? Math.round(definition.hp * COMBAT_CONFIG.eliteHpMultiplier)
            : definition.hp;
        const baseAtk = kind === 'elite'
            ? Math.round(definition.attack * COMBAT_CONFIG.eliteAttackMultiplier)
            : definition.attack;

        this.enemy = {
            kind,
            name: this.loc.enemyName(definition.name),
            description: this.loc.enemyDescription(definition.name, definition.description),
            icon: definition.icon,
            hp: baseHp,
            maxHp: baseHp,
            attack: baseAtk,
            color: definition.color,
            xp: Math.max(1, Math.round(definition.xp * rewardMultiplier * lowLightRewardMultiplier)),
            gold: Math.max(1, Math.round(definition.gold * rewardMultiplier * lowLightRewardMultiplier)),
            profile: definition.profile,
            enraged: false,
            charging: false,
            turnsAlive: 0,
            status: emptyStatusState(),
            inflictBleed: definition.inflictBleed,
            stressAura: definition.stressAura,
        };

        const header =
            kind === 'boss'
            ? this.tr('Босс держит проход.', 'Boss encounter.')
            : kind === 'elite'
              ? this.tr('Элитный враг.', 'Elite encounter.')
                  : this.tr('Контакт с врагом.', 'Hostile contact.');
        this.log.addMessage(`${header} ${this.enemy.name} ${definition.icon}`, '#ff6666');

        if (kind === 'boss') {
            this.log.addMessage(narrate('enter_boss', this.loc.language), '#c4a35a');
            this.stress?.add(STRESS_CONFIG.onBossStart, this.player.aggregate.stressReductionPct);
        } else if (kind === 'elite') {
            this.log.addMessage(narrate('enter_elite', this.loc.language), '#c4a35a');
            this.stress?.add(STRESS_CONFIG.onEliteStart, this.player.aggregate.stressReductionPct);
        } else if (depth > 0 && this.rng.next() < 0.25) {
            this.log.addMessage(narrate('enter_combat', this.loc.language), '#7a7a7a');
        }

        if (this.enemy.stressAura) {
            this.stress?.add(this.enemy.stressAura * 2, this.player.aggregate.stressReductionPct);
        }

        // Relics: start-of-combat setup.
        const agg = this.player.aggregate;
        if (agg.startCombatFocus > 0) {
            applyFocus(this.player.status, 1, agg.startCombatFocus);
            this.onPlayerStatusChange();
        }
        if (agg.evadeFirstHit) {
            this.enemy.firstHitEvaded = true;
        }
        if (agg.resistFirstStun) {
            this.enemy.firstStunResisted = true;
        }

        // Vigorous virtue resolve boost handled by StressManager.
        const virtueResolve = this.stress?.combatStartResolve() ?? 0;
        if (virtueResolve > 0) this.player.gainResolve(virtueResolve);

        this.onEnemyUpdate(
            this.enemy.hp,
            this.enemy.maxHp,
            this.enemy.color,
            this.enemy.name,
            this.enemy.icon
        );
        this.onPlayerStatusChange();
        this.onEnemyStatusChange();
    }

    processTurn(action: CombatAction) {
        if (!this.enemy) {
            return;
        }

        this.lastActionResult = {
            critical: false,
            enemyCharged: false,
            enemyEnraged: false,
            enemyStunned: false,
            enemyEvaded: false,
        };
        this.enemy.turnsAlive += 1;

        const actionName = typeof action === 'string' ? action : action.kind;

        if (actionName === 'attack') {
            this.handlePlayerAttack();
        } else if (actionName === 'defend') {
            this.handlePlayerDefend();
        } else if (actionName === 'skill') {
            const skillId = typeof action === 'object' && 'id' in action ? action.id : 'cleave';
            if (!this.handlePlayerSkill(skillId)) {
                return;
            }
        } else {
            if (!this.handlePlayerPotion()) {
                return;
            }
        }

        // End-of-player-turn: tick enemy statuses (bleed damage etc.).
        if (this.enemy) {
            const enemyTick = tickTurn(this.enemy.status);
            if (enemyTick.bleedDamage > 0) {
                this.enemy.hp = Math.max(0, this.enemy.hp - enemyTick.bleedDamage);
                this.log.addMessage(
                    this.tr(
                        `${this.enemy.name} теряет от кровотечения ${enemyTick.bleedDamage}.`,
                        `${this.enemy.name} bleeds for ${enemyTick.bleedDamage}.`
                    ),
                    '#c15a5a'
                );
                this.onEnemyUpdate(
                    this.enemy.hp,
                    this.enemy.maxHp,
                    this.enemy.color,
                    this.enemy.name,
                    this.enemy.icon
                );
            }
            this.onEnemyStatusChange();
        }

        if (this.enemy && this.enemy.hp <= 0) {
            const killedByBleed = actionName === 'defend' || actionName === 'potion';
            this.finishCombat(killedByBleed);
            return;
        }

        this.resolveEnemyTurn(actionName as Exclude<CombatAction, { kind: 'skill'; id: SkillId }>);

        // Tick player statuses (focus/regen/mark/weaken decay).
        const playerTick = tickTurn(this.player.status);
        if (playerTick.regenHeal > 0) {
            const healed = this.player.heal(playerTick.regenHeal);
            if (healed > 0) {
                this.log.addMessage(
                    this.tr(`Регенерация возвращает ${healed} ОЗ.`, `Regen restores ${healed} HP.`),
                    '#8be0a7'
                );
            }
        }
        this.onPlayerStatusChange();
    }

    private handlePlayerAttack() {
        if (!this.enemy) return;
        this.player.gainResolve(COMBAT_CONFIG.resolveFromAttack);
        const result = this.rollPlayerAttack();
        this.applyPlayerDamage(result.damage, result.critical);
        this.log.addMessage(
            result.critical
                ? this.loc.t('strikeCrit', { damage: result.damage })
                : this.loc.t('strike', { damage: result.damage }),
            result.critical ? '#ffe08a' : '#dddddd'
        );
        if (result.critical && this.rng.next() < 0.35) {
            this.log.addMessage(narrate('crit_landed', this.loc.language), '#c4a35a');
        }
        this.applyOnAttackRelics();
    }

    private handlePlayerDefend() {
        if (!this.enemy) return;
        this.player.gainResolve(COMBAT_CONFIG.resolveFromGuard);
        this.log.addMessage(this.loc.t('brace'), '#66aaff');
    }

    private handlePlayerSkill(skillId: SkillId): boolean {
        if (!this.enemy) return false;
        const skill = SKILLS[skillId];
        const stressMod = this.stress?.resolveCostMod() ?? 0;
        const cost = Math.max(1, skill.resolveCost + stressMod);
        if (!this.player.spendResolve(cost)) {
            this.log.addMessage(
                this.tr(
                    `Нужно ${cost} воли для навыка "${this.skillName(skillId)}".`,
                    `You need ${cost} resolve for ${this.skillName(skillId)}.`
                ),
                '#8899aa'
            );
            return false;
        }

        switch (skillId) {
            case 'cleave': {
                const dmg = Math.max(
                    1,
                    Math.ceil(this.player.getAttackPower() * 1.8) + 2 + this.effectiveDamageMod()
                );
                this.applyPlayerDamage(dmg, false);
                this.log.addMessage(this.tr(`Рубящий удар: ${dmg}.`, `Cleave lands for ${dmg}.`), '#b893ff');
                this.applyOnAttackRelics();
                break;
            }
            case 'bleed_strike': {
                const dmg = Math.max(
                    1,
                    Math.ceil(this.player.getAttackPower() * 1.1) + this.effectiveDamageMod()
                );
                this.applyPlayerDamage(dmg, false);
                const agg = this.player.aggregate;
                applyBleed(this.enemy.status, 2 + agg.bleedStackBonus, 3 + agg.bleedTurnBonus);
                this.log.addMessage(
                    this.tr(`Кровопускание: ${dmg}. Кровотечение наложено.`, `Bleed Strike for ${dmg}. Bleed applied.`),
                    '#d06060'
                );
                this.applyOnAttackRelics();
                break;
            }
            case 'parry_stance': {
                applyGuard(this.player.status, 2, 4);
                if (this.tryStun(1)) {
                    this.log.addMessage(this.tr('Парирование сбивает ритм врага.', 'Parry Stance breaks their rhythm.'), '#7fa9ff');
                    this.log.addMessage(narrate('stun_landed', this.loc.language), '#c4a35a');
                } else {
                    this.log.addMessage(this.tr('Парирование выравнивает твою стойку.', 'Parry Stance steadies you.'), '#7fa9ff');
                }
                this.player.gainResolve(1);
                break;
            }
            case 'focused_strike': {
                const dmg = Math.max(
                    1,
                    Math.ceil(this.player.getAttackPower() * 0.9) + this.effectiveDamageMod()
                );
                this.applyPlayerDamage(dmg, false);
                applyMark(this.enemy.status, 2);
                this.log.addMessage(
                    this.tr(`Точный удар: ${dmg}. Метка поставлена.`, `Focused Strike for ${dmg}. Next hit marked.`),
                    '#d6c260'
                );
                this.applyOnAttackRelics();
                break;
            }
            case 'rupture': {
                const pct = Math.ceil(this.enemy.maxHp * 0.22);
                const dmg = Math.max(this.player.getAttackPower(), pct) + this.effectiveDamageMod();
                this.applyPlayerDamage(dmg, false);
                this.log.addMessage(this.tr(`Разрыв: ${dmg}.`, `Rupture tears for ${dmg}.`), '#c048a0');
                this.applyOnAttackRelics();
                break;
            }
            case 'adrenaline': {
                const healed = this.player.heal(6);
                this.player.gainResolve(1);
                applyFocus(this.player.status, 1, 3);
                this.log.addMessage(
                    this.tr(
                        `Адреналин возвращает ${healed} ОЗ и собирает фокус.`,
                        `Rally restores ${healed} HP and sharpens focus.`
                    ),
                    '#66dd88'
                );
                break;
            }
            case 'crushing_blow': {
                const dmg = Math.max(
                    1,
                    Math.ceil(this.player.getAttackPower() * 2.4) + 3 + this.effectiveDamageMod()
                );
                this.applyPlayerDamage(dmg, false);
                this.player.takeDamage(3, 0, 'true');
                this.log.addMessage(
                    this.tr(
                        `Сокрушающий удар: ${dmg}; отдача бьёт тебя на 3.`,
                        `Crushing Blow for ${dmg} — the recoil bites you for 3.`
                    ),
                    '#e06040'
                );
                this.applyOnAttackRelics();
                break;
            }
        }
        return true;
    }

    private handlePlayerPotion(): boolean {
        if (!this.player.spendPotion()) {
            this.log.addMessage(this.loc.t('noPotions'), '#8899aa');
            return false;
        }
        const healAmount = COMBAT_CONFIG.potionHeal + this.player.aggregate.potionHealBonus;
        const healed = this.player.heal(healAmount);
        this.log.addMessage(this.loc.t('drinkPotion', { healed }), '#78e496');
        if (this.player.aggregate.potionRegenTurns > 0) {
            const regenAmount = 1;
            const turns = this.player.aggregate.potionRegenTurns;
            // apply via status state
            this.player.status.regen.amount = Math.max(this.player.status.regen.amount, regenAmount);
            this.player.status.regen.turns = Math.max(this.player.status.regen.turns, turns);
            this.onPlayerStatusChange();
        }
        return true;
    }

    private applyPlayerDamage(baseDamage: number, criticalIn: boolean) {
        if (!this.enemy) return;
        let critical = criticalIn;
        let damage = baseDamage;

        // Consume mark for guaranteed crit.
        if (!critical && consumeMark(this.enemy.status)) {
            critical = true;
            damage = Math.max(1, Math.round(damage * COMBAT_CONFIG.criticalMultiplier));
        }

        this.enemy.hp = Math.max(0, this.enemy.hp - damage);
        this.lastActionResult.critical = this.lastActionResult.critical || critical;
        this.onEnemyUpdate(
            this.enemy.hp,
            this.enemy.maxHp,
            this.enemy.color,
            this.enemy.name,
            this.enemy.icon
        );

        if (critical) {
            const agg = this.player.aggregate;
            if (agg.lifestealOnCrit > 0) this.player.heal(agg.lifestealOnCrit);
            if (agg.critResolveGain > 0) this.player.gainResolve(agg.critResolveGain);
        }
    }

    private applyOnAttackRelics() {
        if (!this.enemy) return;
        const agg = this.player.aggregate;
        if (agg.bleedOnAttackStacks > 0 && agg.bleedOnAttackTurns > 0) {
            applyBleed(
                this.enemy.status,
                agg.bleedOnAttackStacks + agg.bleedStackBonus,
                agg.bleedOnAttackTurns + agg.bleedTurnBonus
            );
        }
    }

    private tryStun(turns: number): boolean {
        if (!this.enemy) return false;
        // Bosses resist stun; halve duration, min 1.
        const effective = this.enemy.kind === 'boss' ? Math.max(1, Math.floor(turns / 2)) : turns;
        applyStun(this.enemy.status, effective);
        return true;
    }

    private effectiveDamageMod(): number {
        const stress = this.stress?.damageDealtMod() ?? 0;
        const focus = this.player.status.focus.turns > 0 ? this.player.status.focus.amount : 0;
        const lowHp =
            this.player.aggregate.lowHpDamageBonus > 0 &&
            this.player.stats.hp <= Math.ceil(this.player.stats.maxHp * this.player.aggregate.lowHpThreshold)
                ? Math.round(this.player.getAttackPower() * this.player.aggregate.lowHpDamageBonus)
                : 0;
        return stress + focus + lowHp;
    }

    private resolveEnemyTurn(playerAction: 'attack' | 'defend' | 'skill' | 'potion') {
        if (!this.enemy) return;

        // Stun check.
        if (consumeStunForTurn(this.enemy.status)) {
            this.log.addMessage(
                this.tr(`${this.enemy.name} оглушён и пропускает ход.`, `${this.enemy.name} is stunned and skips its turn.`),
                '#7aaaff'
            );
            this.onEnemyStatusChange();
            return;
        }

        // First-hit evasion from Shade Mask.
        if (this.enemy.firstHitEvaded) {
            this.enemy.firstHitEvaded = false;
            this.lastActionResult.enemyEvaded = true;
            this.log.addMessage(
                    this.tr(`Ты уходишь от первого удара ${this.enemy.name}.`, `You slip past ${this.enemy.name}'s first strike.`),
                '#9fb4c4'
            );
            return;
        }

        const flatBlockBase = playerAction === 'defend' ? COMBAT_CONFIG.defendBlock : 0;
        const wardenBlock =
            playerAction === 'defend' ? this.player.aggregate.defendExtraBlock : 0;
        let flatBlock = flatBlockBase + wardenBlock;

        const weakenReduction = this.enemy.status.weaken.turns > 0 ? this.enemy.status.weaken.amount : 0;
        let attackPower =
            this.enemy.attack +
            this.player.getEnemyAttackBonusFromLight() -
            weakenReduction;
        if (attackPower < 1) attackPower = 1;
        let extraMessage = '';
        let multiStrikeFirstDamage = 0;

        if (this.enemy.profile === 'brute') {
            if (!this.enemy.enraged && this.enemy.hp < this.enemy.maxHp * 0.4) {
                this.enemy.enraged = true;
                this.lastActionResult.enemyEnraged = true;
                this.enemy.attack += 2;
                attackPower += 2;
                this.log.addMessage(
                    this.tr(`${this.enemy.name} срывается в ярость!`, `${this.enemy.name} enters a frenzy!`),
                    '#ff9944'
                );
                this.stress?.add(STRESS_CONFIG.onEnemyEnrage, this.player.aggregate.stressReductionPct);
            }
        } else if (this.enemy.profile === 'stalker') {
            if (this.rng.next() < 0.3) {
                const firstHit = this.applyEnemyHitToPlayer(attackPower, flatBlock);
                multiStrikeFirstDamage = firstHit;
                if (firstHit > 0) {
                    this.log.addMessage(
                this.tr(`${this.enemy.name} бросается вперёд: ${firstHit}.`, `${this.enemy.name} lunges for ${firstHit}.`),
                        '#ff6666'
                    );
                }
                if (this.player.stats.hp <= 0) {
                    this.logDeath();
                    return;
                }
            extraMessage = this.tr(' Второй удар!', ' Double strike!');
                // After first hit, guard is partially used; refresh flatBlock for consistency.
                flatBlock = flatBlockBase + wardenBlock;
            }
        } else if (this.enemy.profile === 'mage') {
            if (this.enemy.turnsAlive > 0 && this.enemy.turnsAlive % 3 === 0) {
                this.enemy.charging = true;
                this.lastActionResult.enemyCharged = true;
                attackPower = Math.round(attackPower * 1.6);
                this.log.addMessage(
                this.tr(`${this.enemy.name} копит силу...`, `${this.enemy.name} channels dark energy...`),
                    '#9966cc'
                );
            } else {
                this.enemy.charging = false;
            }
        } else if (this.enemy.profile === 'bleeder') {
            if (this.enemy.inflictBleed && this.rng.next() < this.enemy.inflictBleed.chance) {
                applyBleed(
                    this.player.status,
                    this.enemy.inflictBleed.stacks,
                    this.enemy.inflictBleed.turns
                );
                this.log.addMessage(
                this.tr(`${this.enemy.name} раскрывает рваную рану.`, `${this.enemy.name} opens a ragged wound.`),
                    '#d06060'
                );
            }
        } else if (this.enemy.profile === 'disruptor') {
            // Disruptors apply weaken instead of raw damage sometimes.
            if (this.enemy.turnsAlive % 2 === 1 && this.enemy.status.weaken.turns <= 0) {
                applyWeaken(this.player.status, 1, 2);
                this.log.addMessage(
                    this.tr(`${this.enemy.name} вытягивает силы. (-1 атака на 2 хода)`, `${this.enemy.name} saps your strength. (-1 atk 2t)`),
                    '#8b5fc7'
                );
            }
            if (this.enemy.stressAura) {
                this.stress?.add(
                    this.enemy.stressAura,
                    this.player.aggregate.stressReductionPct
                );
            }
        }

        const takenDamage = this.applyEnemyHitToPlayer(attackPower, flatBlock);
        if (takenDamage > 0) {
            this.log.addMessage(
                this.tr(`${this.enemy.name} попадает по тебе: ${takenDamage}.${extraMessage}`, `${this.enemy.name} hits you for ${takenDamage}.${extraMessage}`),
                '#ff6666'
            );
        } else if (multiStrikeFirstDamage === 0) {
            this.log.addMessage(this.loc.t('absorb'), '#8fc6ff');
        }

        if (this.player.stats.hp <= 0) {
            this.logDeath();
            return;
        }

        if (this.player.stats.hp > 0 && this.player.stats.hp <= Math.ceil(this.player.stats.maxHp * 0.25)) {
            this.stress?.add(STRESS_CONFIG.onLowHp, this.player.aggregate.stressReductionPct);
            if (this.rng.next() < 0.25) this.log.addMessage(narrate('low_hp', this.loc.language), '#c4a35a');
        }

        this.onPlayerStatusChange();
    }

    private applyEnemyHitToPlayer(rawAttack: number, flatBlock: number): number {
        if (!this.enemy) return 0;
        const stressAdd = this.stress?.damageTakenMod() ?? 0;
        let amount = Math.max(1, rawAttack + stressAdd);

        // Guard (from Parry Stance etc.) also blocks damage.
        amount = consumeGuardBlock(this.player.status, amount);

        // Enemy crits: 8% flat.
        let crit = false;
        if (this.rng.next() < 0.08) {
            crit = true;
            amount = Math.max(1, Math.round(amount * 1.5));
        }

        const taken = this.player.takeDamage(amount, flatBlock, 'combat');
        if (taken > 0) {
            this.stress?.add(
                STRESS_CONFIG.onPlayerHit + (crit ? STRESS_CONFIG.onCritReceived : 0),
                this.player.aggregate.stressReductionPct
            );
            if (crit) this.log.addMessage(narrate('crit_received', this.loc.language), '#c4a35a');
            this.onPlayerHit(taken);

            // Thorns damage back at the attacker.
            const thorns = this.player.aggregate.thornsDamage;
            if (thorns > 0) {
                this.enemy.hp = Math.max(0, this.enemy.hp - thorns);
                this.log.addMessage(
                    this.tr(`Шипы отвечают: ${thorns}.`, `Thorns retaliate for ${thorns}.`),
                    '#88cc88'
                );
                this.onEnemyUpdate(
                    this.enemy.hp,
                    this.enemy.maxHp,
                    this.enemy.color,
                    this.enemy.name,
                    this.enemy.icon
                );
            }
        }
        return taken;
    }

    private finishCombat(killedByBleed: boolean) {
        if (!this.enemy) return;
        const payload = this.buildRewards(this.enemy, killedByBleed);
        this.log.addMessage(this.loc.t('enemyFalls', { name: this.enemy.name }), '#66ff88');
        if (killedByBleed) this.log.addMessage(narrate('bleed_finisher', this.loc.language), '#c4a35a');

        // Lifesteal on kill.
        const agg = this.player.aggregate;
        if (agg.lifestealOnKill > 0) this.player.heal(agg.lifestealOnKill);

        // Stress relief on elite/boss kill.
        if (this.enemy.kind === 'boss') this.stress?.relieve(STRESS_CONFIG.onBossKill * -1);
        else if (this.enemy.kind === 'elite') this.stress?.relieve(STRESS_CONFIG.onEliteKill * -1);

        this.enemy = null;
        this.onCombatEnd(payload);
    }

    private logDeath() {
        this.log.addMessage(narrate('death', this.loc.language), '#ff3333');
    }

    private rollPlayerAttack() {
        const variance =
            COMBAT_CONFIG.randomVariance > 0
                ? this.randomBetween(-COMBAT_CONFIG.randomVariance, COMBAT_CONFIG.randomVariance)
                : 0;
        const baseDamage = Math.max(1, this.player.getAttackPower() + variance + this.effectiveDamageMod());
        const critical = this.rng.next() < this.player.getCritChance();

        return {
            damage: critical
                ? Math.max(1, Math.round(baseDamage * COMBAT_CONFIG.criticalMultiplier))
                : baseDamage,
            critical,
        };
    }

    private buildRewards(enemy: ActiveEnemy, killedByBleed: boolean): CombatEndPayload {
        return {
            enemyName: enemy.name,
            kind: enemy.kind,
            killedByBleed,
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

    /** Returns a human-readable line of enemy statuses. */
    enemyStatusText(): string {
        return this.enemy ? statusSummary(this.enemy.status, this.loc.language) : '';
    }

    playerStatusText(): string {
        return statusSummary(this.player.status, this.loc.language);
    }

    private randomBetween(min: number, max: number): number {
        return randomInt(this.rng, min, max);
    }
}
