/**
 * Visual variants for room-choice buttons. Each maps to a sliced
 * sprite preloaded in BootScene (btn_default / btn_gold / btn_dark /
 * btn_silver / btn_positive / btn_danger). Callers that don't supply
 * a variant get 'default'.
 *
 * Lives in its own module (separate from `RoomButtons.ts`) so that
 * data-side call sites (`systems/rooms/*`, skill / NPC defs) can
 * import {@link variantFromFill} without dragging Phaser into the
 * dependency graph of headless tests.
 */
export type RoomButtonVariant = 'default' | 'gold' | 'dark' | 'silver' | 'positive' | 'danger';

/**
 * Map a legacy fill colour to the closest variant the new
 * spritesheet provides. Useful at call sites that still hold a
 * dynamic colour value (skill defs, NPC defs) and need to pick a
 * variant without enumerating every colour in the catalog.
 */
export function variantFromFill(fill: number | undefined): RoomButtonVariant {
    if (fill === undefined) return 'default';
    const r = (fill >> 16) & 0xff;
    const g = (fill >> 8) & 0xff;
    const b = fill & 0xff;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 20) return max < 80 ? 'dark' : 'silver';
    if (g === max && g > r + 16 && g > b + 16) return 'positive';
    if (b === max && r > g + 8) return 'danger';
    if (r === max && b > g + 16) return 'danger';
    if (r === max && g > b + 16) return 'gold';
    if (b === max) return 'silver';
    return 'default';
}
