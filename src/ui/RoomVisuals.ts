import type * as Phaser from 'phaser';
import type { Localization } from '../systems/Localization';
import { RoomType, type RoomType as RoomTypeValue } from '../data/MapTypes';
import type { EnemyProfile } from '../data/EnemyTypes';

// Pure visual lookups for map-node rendering. Extracted from GameScene so
// they're trivially testable and reusable by other UI helpers.

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
    [RoomType.MINI_BOSS]: 'b',
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
    [RoomType.MINI_BOSS]: 'BOSS',
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
    [RoomType.MINI_BOSS]: 1,
    [RoomType.TRAP]: 1,
    [RoomType.EMPTY]: 2,
};

export function roomFrameIndex(type: RoomTypeValue): 0 | 1 | 2 {
    return ROOM_FRAME_INDEX[type] ?? 2;
}

/**
 * Frame index in {@link hud_room_icons} (a 9-frame spritesheet) for each
 * room type. Frame layout (left → right):
 *   0 → campfire           (START, REST)
 *   1 → red skull crossbones (basic ENEMY)
 *   2 → stone "?"          (EMPTY / unknown)
 *   3 → red skull crossbones, darker (ELITE)
 *   4 → demon skull with crown (BOSS, MINI_BOSS)
 *   5 → treasure chest     (TREASURE)
 *   6 → occult sigil       (TRAP)
 *   7 → tombstone altar    (SHRINE)
 *   8 → coin pouch         (MERCHANT)
 */
const ROOM_ICON_FRAME: Record<RoomTypeValue, number> = {
    [RoomType.START]: 0,
    [RoomType.REST]: 0,
    [RoomType.ENEMY]: 1,
    [RoomType.EMPTY]: 2,
    [RoomType.ELITE]: 3,
    [RoomType.BOSS]: 4,
    [RoomType.MINI_BOSS]: 4,
    [RoomType.TREASURE]: 5,
    [RoomType.TRAP]: 6,
    [RoomType.SHRINE]: 7,
    [RoomType.MERCHANT]: 8,
};

export function roomIconFrame(type: RoomTypeValue): number {
    return ROOM_ICON_FRAME[type] ?? 2;
}

/**
 * Whether a map-node should emit ambient fire embers. Currently the
 * campfire-flavoured rooms (START / REST) and the altar (SHRINE) — the
 * pixel art for both contains a visible flame in the centre.
 */
export function hasFireEffect(type: RoomTypeValue): boolean {
    return type === RoomType.START || type === RoomType.REST || type === RoomType.SHRINE;
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
    [RoomType.MINI_BOSS]: 'roomBoss',
    [RoomType.EMPTY]: 'roomEmpty',
} as const satisfies Record<RoomTypeValue, string>;

export function roomIcon(type: RoomTypeValue): string {
    return ROOM_ICON[type];
}

export function roomSpriteKey(type: RoomTypeValue): string {
    return ROOM_SPRITE_KEY[type];
}

export function roomTypeName(type: RoomTypeValue, loc: Localization): string {
    return loc.t(ROOM_NAME_KEY[type]);
}

/**
 * Texture key for a per-mob enemy portrait. Canonical names are
 * lowercased and any space / hyphen is collapsed to an underscore
 * so the design roster's `name` field (e.g. "Bee-Butterfly",
 * "Death Knight") maps cleanly onto BootScene's preload list
 * (`enemy_bee_butterfly`, `enemy_death_knight`).
 *
 * Use {@link resolveEnemyTextureKey} to pick the per-mob texture
 * first and fall back to the profile portrait when the per-mob
 * art isn't shipped yet.
 */
export function enemyTextureKeyForName(canonicalName: string): string {
    return `enemy_${canonicalName.toLowerCase().replace(/[ -]+/g, '_')}`;
}

/**
 * Pick the best registered texture key for an enemy: prefer the
 * hand-authored per-mob portrait, fall back to the profile bucket.
 * Returns `null` when neither is registered so the caller can
 * render the procedural icon glyph instead.
 */
export function resolveEnemyTextureKey(
    scene: Phaser.Scene,
    canonicalName: string,
    profile: EnemyProfile
): string | null {
    const mobKey = enemyTextureKeyForName(canonicalName);
    if (scene.textures.exists(mobKey)) return mobKey;
    const profileKey = `enemy_${profile}`;
    if (scene.textures.exists(profileKey)) return profileKey;
    return null;
}

/** Target box for room sprites on the map — slightly inset from the node rect. */
const ROOM_SPRITE_MAX_DIM = 64;

/** Target box for enemy + room-card portraits in the right-hand
 *  panel. The portrait is rendered at exactly this size so the
 *  hand-authored 256×256 art reads as the panel's focal element
 *  (140 → 250 → 230 per successive design passes). The HP bar /
 *  name text Y positions in {@link GameRoomController} are anchored
 *  off this value. */
export const ENEMY_SPRITE_MAX_DIM = 230;

/**
 * Scale down high-resolution hand-authored room textures to fit the map node.
 * Procedural sprites from {@link PixelSprite} are already tiny (~24px) and are
 * left at their native size so nearest-neighbor rendering stays crisp.
 */
export function fitRoomSprite(
    sprite: Phaser.GameObjects.Image,
    maxDim = ROOM_SPRITE_MAX_DIM
): void {
    if (sprite.width > maxDim || sprite.height > maxDim) {
        sprite.setDisplaySize(maxDim, maxDim);
    }
}

/**
 * Force the enemy / room-card portrait into the standard
 * {@link ENEMY_SPRITE_MAX_DIM}×{@link ENEMY_SPRITE_MAX_DIM} box.
 *
 * Unlike {@link fitRoomSprite} this snaps every sprite to the cap
 * (instead of only shrinking oversized ones). The combat panel
 * picks the portrait as its visual anchor — having every mob, room
 * and procedural fallback render at exactly the same size keeps
 * the layout stable across encounters.
 */
export function fitEnemySprite(
    sprite: Phaser.GameObjects.Image,
    maxDim = ENEMY_SPRITE_MAX_DIM
): void {
    sprite.setDisplaySize(maxDim, maxDim);
}
