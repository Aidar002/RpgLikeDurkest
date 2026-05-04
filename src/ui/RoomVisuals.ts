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

/**
 * Decorative frame index for {@link hud_room_frames} (a 3-frame spritesheet).
 *   0 → gold (safe / friendly: camp, rest, shrine, merchant, treasure)
 *   1 → red  (combat threat: enemy, elite, boss, trap)
 *   2 → grey (unknown / empty)
 * Used for the bronze/iron border overlay around map-node thumbnails so that
 * room danger reads at a glance, matching the reference UI.
 */
const ROOM_FRAME_INDEX: Record<RoomTypeValue, 0 | 1 | 2> = {
    [RoomType.START]: 0,
    [RoomType.REST]: 0,
    [RoomType.SHRINE]: 0,
    [RoomType.MERCHANT]: 0,
    [RoomType.TREASURE]: 0,
    [RoomType.ENEMY]: 1,
    [RoomType.ELITE]: 1,
    [RoomType.BOSS]: 1,
    [RoomType.TRAP]: 1,
    [RoomType.EMPTY]: 2,
};

export function roomFrameIndex(type: RoomTypeValue): 0 | 1 | 2 {
    return ROOM_FRAME_INDEX[type] ?? 2;
}

/**
 * Frame index in {@link hud_room_icons} (an 8-frame spritesheet) for each
 * room type. Frame layout (left → right):
 *   0 → campfire           (START, REST)
 *   1 → red skull crossbones (basic ENEMY)
 *   2 → stone "?"          (EMPTY / unknown)
 *   3 → red skull crossbones, darker (ELITE)
 *   4 → demon skull with crown (BOSS)
 *   5 → treasure chest     (TREASURE, MERCHANT — merchants are gold-rimmed
 *                           and distinguished by frame color, not the icon)
 *   6 → occult sigil       (TRAP)
 *   7 → tombstone altar    (SHRINE)
 */
const ROOM_ICON_FRAME: Record<RoomTypeValue, number> = {
    [RoomType.START]: 0,
    [RoomType.REST]: 0,
    [RoomType.ENEMY]: 1,
    [RoomType.EMPTY]: 2,
    [RoomType.ELITE]: 3,
    [RoomType.BOSS]: 4,
    [RoomType.TREASURE]: 5,
    [RoomType.MERCHANT]: 5,
    [RoomType.TRAP]: 6,
    [RoomType.SHRINE]: 7,
};

export function roomIconFrame(type: RoomTypeValue): number {
    return ROOM_ICON_FRAME[type] ?? 2;
}

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
export const ROOM_SPRITE_MAX_DIM = 64;

/** Target box for enemy portraits in the combat/room panel. */
export const ENEMY_SPRITE_MAX_DIM = 120;

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
