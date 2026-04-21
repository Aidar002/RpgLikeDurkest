import { PlayerManager } from './PlayerManager';
import { EventLog } from '../ui/EventLog';

export class CombatManager {
    private player: PlayerManager;
    private log: EventLog;
    private onCombatEnd: () => void;
    
    public enemy: { name: string, hp: number, maxHp: number, attack: number } | null = null;
    
    constructor(player: PlayerManager, log: EventLog, onCombatEnd: () => void) {
        this.player = player;
        this.log = log;
        this.onCombatEnd = onCombatEnd;
    }

    startCombat(enemyName: string, maxHp: number, attack: number) {
        this.enemy = { name: enemyName, hp: maxHp, maxHp, attack };
        this.log.addMessage(`Встречен враг: ${enemyName}`, '#ff5555');
    }

    processTurn(action: 'attack' | 'defend') {
        if (!this.enemy) return;

        // Player Turn
        if (action === 'attack') {
            const dmg = this.player.stats.attack;
            this.enemy.hp -= dmg;
            this.log.addMessage(`Вы атакуете ${this.enemy.name} на ${dmg} урона.`, '#aaaaaa');
        } else if (action === 'defend') {
            this.log.addMessage(`Вы защищаетесь (пока просто пропуск хода).`, '#55aaff');
        }

        // Check if enemy dead
        if (this.enemy.hp <= 0) {
            this.log.addMessage(`Вы победили ${this.enemy.name}!`, '#55ff55');
            this.player.gainXp(5);
            this.enemy = null;
            this.onCombatEnd();
            return;
        }

        // Enemy Turn
        const edmg = this.player.takeDamage(this.enemy.attack);
        this.log.addMessage(`${this.enemy.name} атакует вас на ${edmg} урона!`, '#ff5555');
        
        if (this.player.stats.hp <= 0) {
            this.log.addMessage(`Вы погибли...`, '#ff0000');
            // TODO: Restart game
        }
    }
}
