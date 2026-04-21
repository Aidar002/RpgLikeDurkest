import { PlayerManager } from './PlayerManager';
import { EventLog } from '../ui/EventLog';
import { getEnemyForDepth, getBossForDepth } from '../data/Enemies';

export interface ActiveEnemy {
    name: string;
    hp: number;
    maxHp: number;
    attack: number;
    color: number;
    xp: number;
}

export class CombatManager {
    private player: PlayerManager;
    private log: EventLog;
    private onCombatEnd: () => void;
    private onPlayerHit: (dmg: number) => void;

    public enemy: ActiveEnemy | null = null;

    // UI callback — update enemy portrait/HP bar
    public onEnemyUpdate: (hp: number, maxHp: number, color: number, name: string) => void = () => {};

    constructor(
        player: PlayerManager,
        log: EventLog,
        onCombatEnd: () => void,
        onPlayerHit: (dmg: number) => void = () => {}
    ) {
        this.player = player;
        this.log = log;
        this.onCombatEnd = onCombatEnd;
        this.onPlayerHit = onPlayerHit;
    }

    startCombat(depth: number, isBoss: boolean) {
        const def = isBoss ? getBossForDepth(depth) : getEnemyForDepth(depth);
        this.enemy = { name: def.name, hp: def.hp, maxHp: def.hp, attack: def.attack, color: def.color, xp: def.xp };
        this.log.addMessage(`\n⚔  ${def.name}`, '#ff6666');
        this.log.addMessage(`${def.description}`, '#666666');
        this.onEnemyUpdate(this.enemy.hp, this.enemy.maxHp, this.enemy.color, this.enemy.name);
    }

    processTurn(action: 'attack' | 'defend') {
        if (!this.enemy) return;

        // ── Player turn ──
        if (action === 'attack') {
            const dmg = this.player.stats.attack;
            this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
            this.log.addMessage(`Вы атакуете: -${dmg} HP`, '#cccccc');
            this.onEnemyUpdate(this.enemy.hp, this.enemy.maxHp, this.enemy.color, this.enemy.name);
        } else {
            this.log.addMessage(`Вы уходите в защиту.`, '#5599ff');
        }

        // ── Enemy dies ──
        if (this.enemy.hp <= 0) {
            this.log.addMessage(`${this.enemy.name} повержен!`, '#55ff55');
            this.player.gainXp(this.enemy.xp);
            this.player.killCount++;
            this.enemy = null;
            this.onCombatEnd();
            return;
        }

        // ── Enemy turn (defense reduces damage by 60%) ──
        const rawDmg = this.enemy.attack;
        const takenDmg = action === 'defend'
            ? this.player.takeDamage(Math.ceil(rawDmg * 0.4))
            : this.player.takeDamage(rawDmg);

        this.log.addMessage(`${this.enemy.name}: -${takenDmg} HP`, '#ff5555');
        if (takenDmg > 0) this.onPlayerHit(takenDmg);

        if (this.player.stats.hp <= 0) {
            this.log.addMessage(`Тьма поглощает вас...`, '#ff2222');
        }
    }
}
