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
         *  around x=300 with the value text rendered at the same
         *  14 px primary-text style as the HP readout; 310 leaves a
         *  ~10 px gap before the ATK icon. */
        statsX: 310,
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
        /** Horizontal offset between the HP/XP label ("ОЗ" / "УР")
         *  and the start of the bar it anchors. Bumped from 30 to 40
         *  so the bar no longer crowds the bold 13 px label — the
         *  filled HP track was visually clipping the "З" / "Р"
         *  letters of the labels on dense backgrounds. 40 px leaves
         *  ~16 px of breathing room. */
        vitalsBarOffsetX: 40,
        /** Pixel width of the HP and XP bar tracks. Tightened from
         *  200 to 150 so the vitals column doesn't dominate the top
         *  bar — the freed 50 px gives the resource/progress trios
         *  on the right room to grow without bumping the margins. */
        vitalsBarWidth: 150,
        /** X anchor (icon centre of the leftmost slot — coin) for
         *  the big ЗОЛОТО / ЭЛИК. / ВОЛЯ resource trio. Each slot
         *  renders as icon-on-top, label below, value below — three
         *  blocks side-by-side read as the visual centrepiece of
         *  the top bar.
         *
         *  ATK/DEF value column ends ~533 (statsX + statsValueOffset
         *  + value width). 580 leaves a comfortable ~25 px gap from
         *  the leftmost label edge of the resource trio ("МОНЕТЫ"
         *  half-width ≈ 18 px at 10 px font) so the values don't
         *  butt up against ATK/DEF. */
        resourcesX: 580,
        /** X step between adjacent stacked slots in the resource
         *  trio. Tightened from 72 to 61 (-15 %) so the icon + label
         *  + value column packs without bleeding into the right
         *  frame ornament. */
        resourcesStepX: 61,
        /** Y of the icon top edge for the big resource and progress
         *  stacked slots. The top bar is 96 px tall with a carved
         *  rim of ~14 px, so y=13 lets a 34 px icon centre at
         *  y=30 — clear of the rim — with the label landing around
         *  y=49 and the bold value at y=61, leaving ~7 px of
         *  headroom before the bar's bottom edge. */
        resourceIconTopY: 13,
        /** Icon side length for the big resource / progress stacked
         *  slots. Shrunk from 40 to 34 (-15 %) per player feedback —
         *  at 40 px the trios were bleeding into the right frame
         *  ornament and felt cramped. */
        resourceIconSize: 34,
        /** X anchor (icon centre of the leftmost slot — depth) for
         *  the big ГЛУБИНА / УБИТО / БОССЫ run-progress trio. Mirrors
         *  the resource trio's `icon + label + value` style on the
         *  right of the top bar. The three centres land at
         *  798, 859, 920 — the rightmost block ends ~942 inside
         *  the 1024 px canvas (~80 px right margin so the carved
         *  frame ornament still has room to breathe). */
        progressX: 798,
        /** X step between adjacent stacked slots in the progress
         *  trio. Matches `resourcesStepX` so the two trios share
         *  the same rhythm. */
        progressStepX: 61,
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
