import type * as Phaser from 'phaser';
import type { Localization } from '../systems/Localization';
import { RoomType, type MapNode, type RoomType as RoomTypeValue } from '../systems/MapGenerator';

// Pure visual lookups for map-node rendering. Extracted from GameScene so
// they're trivially testable and reusable by other UI helpers.

const ROOM_COLOR: Record<RoomTypeValue, number> = {
    [RoomType.START]: 0x777777,
    [RoomType.ENEMY]: 0x903535,
    [RoomType.TREASURE]: 0x9b7a22,
    [RoomType.TRAP]: 0x7f4b96,
    [RoomType.REST]: 0x2f8f52,
    [RoomType.SHRINE]: 0x5f4e8a,
    [RoomType.MERCHANT]: 0x2e6c87,
    [RoomType.ELITE]: 0xb14545,
    [RoomType.BOSS]: 0xc83b3b,
    [RoomType.EMPTY]: 0x454545,
};

const ROOM_ICON: Record<RoomTypeValue, string> = {
    [RoomType.START]: '@',
    [RoomType.ENEMY]: 'X',
    [RoomType.TREASURE]: '$',
    [RoomType.TRAP]: '^',
    [RoomType.REST]: '+',
    [RoomType.SHRINE]: 'S',
    [RoomType.MERCHANT]: 'M',
    [RoomType.ELITE]: 'E',
    [RoomType.BOSS]: 'B',
    [RoomType.EMPTY]: '.',
};

const ROOM_SPRITE_KEY: Record<RoomTypeValue, string> = {
    [RoomType.START]: 'START',
    [RoomType.ENEMY]: 'ENEMY',
    [RoomType.TREASURE]: 'TREASURE',
    [RoomType.TRAP]: 'TRAP',
    [RoomType.REST]: 'REST',
    [RoomType.SHRINE]: 'SHRINE',
    [RoomType.MERCHANT]: 'MERCHANT',
    [RoomType.ELITE]: 'ELITE',
    [RoomType.BOSS]: 'BOSS',
    [RoomType.EMPTY]: 'EMPTY',
};

/** Localization key per room type, used by `roomTypeName`. */
const ROOM_NAME_KEY = {
    [RoomType.START]: 'roomCamp',
    [RoomType.ENEMY]: 'roomEnemy',
    [RoomType.TREASURE]: 'roomTreasure',
    [RoomType.TRAP]: 'roomTrap',
    [RoomType.REST]: 'roomRest',
    [RoomType.SHRINE]: 'roomShrine',
    [RoomType.MERCHANT]: 'roomMerchant',
    [RoomType.ELITE]: 'roomElite',
    [RoomType.BOSS]: 'roomBoss',
    [RoomType.EMPTY]: 'roomEmpty',
} as const satisfies Record<RoomTypeValue, string>;

export function roomColor(node: MapNode): number {
    return ROOM_COLOR[node.type];
}

export function roomIcon(type: RoomTypeValue): string {
    return ROOM_ICON[type];
}

export function roomSpriteKey(type: RoomTypeValue): string {
    return ROOM_SPRITE_KEY[type];
}

export function roomTypeName(type: RoomTypeValue, loc: Localization): string {
    return loc.t(ROOM_NAME_KEY[type]);
}

/** Target box for room sprites on the map — slightly inset from the node rect. */
export const ROOM_SPRITE_MAX_DIM = 34;

/** Target box for enemy portraits in the combat/room panel. */
export const ENEMY_SPRITE_MAX_DIM = 88;

/**
 * Scale down high-resolution hand-authored room textures to fit the map node.
 * Procedural sprites from {@link PixelSprite} are already tiny (~24px) and are
 * left at their native size so nearest-neighbor rendering stays crisp.
 */
export function fitRoomSprite(sprite: Phaser.GameObjects.Image, maxDim = ROOM_SPRITE_MAX_DIM): void {
    if (sprite.width > maxDim || sprite.height > maxDim) {
        sprite.setDisplaySize(maxDim, maxDim);
    }
}

/**
 * Scale down high-resolution hand-authored enemy portraits to fit the panel.
 * Procedural sprites (48px) are left at native size.
 */
export function fitEnemySprite(sprite: Phaser.GameObjects.Image, maxDim = ENEMY_SPRITE_MAX_DIM): void {
    if (sprite.width > maxDim || sprite.height > maxDim) {
        sprite.setDisplaySize(maxDim, maxDim);
    }
}
