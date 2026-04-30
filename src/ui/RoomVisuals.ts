import type { Localization } from '../systems/Localization';
import { RoomType, type MapNode, type RoomType as RoomTypeValue } from '../systems/MapGenerator';

// Pure visual lookups for map-node rendering. Extracted from GameScene so
// they're trivially testable and reusable by other UI helpers.

export function roomColor(node: MapNode): number {
    switch (node.type) {
        case RoomType.START:
            return 0x777777;
        case RoomType.ENEMY:
            return 0x903535;
        case RoomType.TREASURE:
            return 0x9b7a22;
        case RoomType.TRAP:
            return 0x7f4b96;
        case RoomType.REST:
            return 0x2f8f52;
        case RoomType.SHRINE:
            return 0x5f4e8a;
        case RoomType.MERCHANT:
            return 0x2e6c87;
        case RoomType.ELITE:
            return 0xb14545;
        case RoomType.BOSS:
            return 0xc83b3b;
        case RoomType.EMPTY:
            return 0x454545;
    }
}

export function roomIcon(type: RoomTypeValue): string {
    switch (type) {
        case RoomType.START:
            return '@';
        case RoomType.ENEMY:
            return 'X';
        case RoomType.TREASURE:
            return '$';
        case RoomType.TRAP:
            return '^';
        case RoomType.REST:
            return '+';
        case RoomType.SHRINE:
            return 'S';
        case RoomType.MERCHANT:
            return 'M';
        case RoomType.ELITE:
            return 'E';
        case RoomType.BOSS:
            return 'B';
        case RoomType.EMPTY:
            return '.';
    }
}

export function roomSpriteKey(type: RoomTypeValue): string {
    switch (type) {
        case RoomType.START: return 'START';
        case RoomType.ENEMY: return 'ENEMY';
        case RoomType.TREASURE: return 'TREASURE';
        case RoomType.TRAP: return 'TRAP';
        case RoomType.REST: return 'REST';
        case RoomType.SHRINE: return 'SHRINE';
        case RoomType.MERCHANT: return 'MERCHANT';
        case RoomType.ELITE: return 'ELITE';
        case RoomType.BOSS: return 'BOSS';
        case RoomType.EMPTY: return 'EMPTY';
    }
}

export function roomTypeName(type: RoomTypeValue, loc: Localization): string {
    switch (type) {
        case RoomType.START: return loc.t('roomCamp');
        case RoomType.ENEMY: return loc.t('roomEnemy');
        case RoomType.TREASURE: return loc.t('roomTreasure');
        case RoomType.TRAP: return loc.t('roomTrap');
        case RoomType.REST: return loc.t('roomRest');
        case RoomType.SHRINE: return loc.t('roomShrine');
        case RoomType.MERCHANT: return loc.t('roomMerchant');
        case RoomType.ELITE: return loc.t('roomElite');
        case RoomType.BOSS: return loc.t('roomBoss');
        case RoomType.EMPTY: return loc.t('roomEmpty');
    }
}
