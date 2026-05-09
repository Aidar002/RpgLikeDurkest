// Canvas / layout constants and named depth tiers shared across scenes and UI
// modules. Centralised here so that overlays, banners, and HUD widgets stay in
// agreement about z-ordering without scattering magic numbers.

export const GAME_WIDTH = 1024;
export const GAME_HEIGHT = 768;
export const CENTER_X = GAME_WIDTH / 2;
export const CENTER_Y = GAME_HEIGHT / 2;

/**
 * Per-section HUD coordinates. Centralised so a "move icon up 7 px"
 * tweak is a one-line edit here, not a hunt for `y=36` scattered across
 * `GameScene.ts`/`SceneChrome.ts`. Section groups:
 *
 * - `topHud.*`: stat slots in the carved top bar (АТАКА/ЗАЩИТА column,
 *   torch column).
 * - `chrome.*`: bottom-left audio/language toggle row anchored to the
 *   top-right corner of the canvas.
 *
 * Add new groups here as you split rendering out of `GameScene`.
 */
export const HudLayout = {
    topHud: {
        /** X anchor for the АТАКА/ЗАЩИТА stat column. Anchored just
         *  left of the canvas midline so the combat stat block reads
         *  as the centre group of the top bar (left = HP+XP, centre =
         *  ATK/DEF, right = resource cells). */
        statsX: 408,
        /** Horizontal offset between an inline slot's icon and value. */
        statsValueOffset: 96,
        /** Y of the АТАКА row in the carved top bar. */
        atkY: 26,
        /** Y of the ЗАЩИТА row, sits one row below `atkY`. */
        defY: 54,
        /** Y of the high/low-light icon (sun/moon glyph). */
        torchIconY: 56,
        /** X offset (from `statsX`) of the second column. */
        secondColumnDx: 130,
        /** X anchor for the ЗОЛОТО / ЭЛИК. / ВОЛЯ resource column.
         *  Sits ~20 px to the right of the ATK/DEF value column so
         *  the two stat blocks read as one unit. The ATK/DEF value
         *  text starts at `statsX + statsValueOffset = 504` and
         *  takes up ~30 px even for a 3-digit value, so 540 keeps a
         *  visible 20 px gap in the typical 1- or 2-digit case
         *  without crowding the high-roll edge. */
        resourcesX: 540,
        /** Y of the topmost resource row (ЗОЛОТО). */
        resourceRow1Y: 14,
        /** Y of the middle resource row (ЭЛИК.). */
        resourceRow2Y: 38,
        /** Y of the bottom resource row (ВОЛЯ). */
        resourceRow3Y: 62,
        /** Horizontal offset between a resource slot's icon and value. */
        resourceValueOffset: 124,
    },
    chrome: {
        /** Y of the music/settings/language icon row. */
        iconY: 32,
        /** X of the rightmost icon (language toggle). Other icons sit
         *  to the left at -32 / -64 px from this anchor. */
        iconRightX: GAME_WIDTH - 57,
        /** Horizontal step between adjacent chrome icons. */
        iconStepX: 32,
    },
} as const;

/** HUD panel heights and shared padding. The middle play area sits between
 *  `TOP_BAR_H` and `GAME_HEIGHT - BOTTOM_BAR_H - HUD_BOTTOM_OFFSET`. The
 *  bottom offset lifts the lower frame off the screen edge so the carved
 *  artwork breathes instead of slamming against the canvas. */
export const TOP_BAR_H = 96;
// 140 ≈ 90 % of the bottom-bar PNG's native 155 px so the carved
// stone rim renders at roughly its authored thickness. The bottom
// of the bar is anchored at GAME_HEIGHT − HUD_BOTTOM_OFFSET, so
// growing this just lifts the bar's TOP edge upward (the play area
// below the top bar shrinks accordingly).
export const BOTTOM_BAR_H = 140;
export const HUD_PAD = 24;
export const HUD_BOTTOM_OFFSET = 10;

/**
 * Named depth tiers for UI overlays. Keep gaps between groups so individual
 * widgets can sit at +1/+2 without colliding with the next group.
 */
export const Depths = {
    /** Map edges and base background art. */
    Background: 0,
    /** Room cards, shop tiles, and other in-flow UI. */
    UiBase: 10,
    /** Tooltip-like helpers above main UI. */
    UiHint: 50,
    /** Screen-wide combat/feedback flashes. */
    ScreenFlash: 88,
    /** Room tint overlays applied after combat or at depth transitions. */
    RoomTint: 90,
    /** Backdrop dimming for the death/victory screens. */
    EndScreenOverlay: 100,
    /** Frame panel above the end-screen overlay. */
    EndScreenPanel: 101,
    /** Text/buttons inside the end-screen panel. */
    EndScreenContent: 102,
    /** Foreground labels above end-screen content (top tier). */
    EndScreenForeground: 103,
    /** Reset-progress confirm modal backdrop. */
    ConfirmOverlay: 110,
    /** Reset-progress confirm modal panel. */
    ConfirmPanel: 111,
    /** Reset-progress confirm modal text. */
    ConfirmContent: 112,
    /** Reset-progress confirm modal buttons. */
    ConfirmForeground: 113,
    /** Notification banner that animates in and fades out. */
    NotificationBanner: 160,
    /** Tooltip text rendered above all gameplay UI. */
    Tooltip: 220,
} as const;
