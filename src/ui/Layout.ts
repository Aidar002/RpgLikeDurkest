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
 *   torch column, resource column, run-progress column).
 * - `chrome.*`: audio/language toggle row anchored to the bottom-right
 *   corner of the bottom bar.
 *
 * Add new groups here as you split rendering out of `GameScene`.
 */
export const HudLayout = {
    topHud: {
        /** Horizontal shift applied to the HP/XP block in
         *  `buildTopVitals`. Set to 0 so the block hugs the left
         *  canvas edge (label at `pad + 8 = 32`, bar at `108`),
         *  freeing the right two thirds of the bar for the ATK/DEF,
         *  resources, and run-progress columns. */
        shiftX: 0,
        /** X anchor (icon left edge) for the АТАКА/ЗАЩИТА stat
         *  column. HP/XP block right edge (XP value "ОП X/Y") sits
         *  around x=370 for typical values; 420 leaves a ~50 px
         *  gap before the ATK icon. */
        statsX: 420,
        /** Horizontal offset between an inline slot's icon and value.
         *  Tightened from 96 to 88 so the "1" / "0" values sit
         *  closer to their АТАКА / ЗАЩИТА labels instead of floating
         *  in a wide gap. "АТАКА" at 13 px occupies ~55 px from
         *  `statsX + 24`, so a value column at `statsX + 88` keeps
         *  ~9 px of breathing room. */
        statsValueOffset: 88,
        /** Y of the АТАКА row in the carved top bar. */
        atkY: 26,
        /** Y of the ЗАЩИТА row, sits one row below `atkY`. */
        defY: 54,
        /** Y of the high/low-light icon (sun/moon glyph). */
        torchIconY: 56,
        /** X offset (from `statsX`) of the second column. */
        secondColumnDx: 130,
        /** X anchor for the ЗОЛОТО / ЭЛИК. / ВОЛЯ resource column.
         *  ATK/DEF value column ends ~530 (statsX + 88 + value
         *  width); 565 leaves a ~35 px gap to the larger resource
         *  icon (24 px instead of 18 px — see `buildTopResources`). */
        resourcesX: 565,
        /** Y of the topmost resource row (ЗОЛОТО). Shifted up from
         *  14 to 8 to make room for the larger 24 px resource /
         *  progress icons; the icon top edge now sits at row Y so
         *  the icon clears the carved top rim without overflowing
         *  the bar. */
        resourceRow1Y: 8,
        /** Y of the middle resource row (ЭЛИК.). */
        resourceRow2Y: 32,
        /** Y of the bottom resource row (ВОЛЯ). */
        resourceRow3Y: 56,
        /** Horizontal offset between a resource slot's icon and
         *  value. Tightened from 124 to 110 so the value column
         *  sits closer to the (bigger) label, mirroring the
         *  tighter ATK value offset. */
        resourceValueOffset: 110,
        /** X anchor for the ГЛУБИНА / УБИТО / БОССЫ run-progress
         *  column. Pushed from 770 to 800 so the column hugs the
         *  right edge of the canvas (per design feedback — the
         *  right-pointing red arrow in the player's reference mock).
         *  Reuses the same three row Ys as the resources column so
         *  the two columns align vertically. */
        progressX: 800,
        /** Horizontal offset between a progress slot's icon and
         *  value. Slightly wider than `resourceValueOffset` (118
         *  vs 110) because "ГЛУБИНА" at 14 px is a few pixels
         *  wider than "ЗОЛОТО"; the extra gap keeps the value
         *  column clear of the label. */
        progressValueOffset: 118,
    },
    chrome: {
        /** Y of the music/settings/language icon row. Sits in the
         *  vertical centre of the carved bottom bar so the icons
         *  read as anchored to the bottom panel rather than the
         *  top bar. The bottom bar spans
         *  `GAME_HEIGHT - BOTTOM_BAR_H - HUD_BOTTOM_OFFSET` to
         *  `GAME_HEIGHT - HUD_BOTTOM_OFFSET` (618..758 with the
         *  current constants), so 688 ≈ the visual centre. */
        iconY: 688,
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
 * Horizontal split of the in-room play area. The left panel hosts the
 * event log; the right panel hosts the enemy portrait, name, HP bar,
 * intent label, contextual flavour text, and action buttons.
 *
 * Ratio (per design): left ≈ 35 % / right ≈ 65 % of the panel area,
 * with a 22 px gap between them and small outer margins so the
 * carved frames around each panel breathe against the canvas edges.
 *
 *   |←18→|‖ LOG (340) ‖|←22→|‖   COMBAT / ROOM (624)   ‖|←20→|
 *
 * Consumers (EventLog construction in GameScene, panel rectangle in
 * GameRoomController, button column anchors in RoomButtons) read
 * these values so the split stays in lockstep across files.
 */
export const RoomLayout = {
    /** Left edge of the event-log panel. */
    logX: 18,
    /** Width of the event-log panel. */
    logWidth: 340,
    /** Left edge of the right combat / room panel. */
    panelX: 380,
    /** Width of the right combat / room panel. */
    panelWidth: 624,
    /** Horizontal centre of the right panel — used to anchor the
     *  portrait, name text, HP bar, intent, flavour, and the wide
     *  button. Equals `panelX + panelWidth / 2`. */
    panelCenterX: 692,
} as const;

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
