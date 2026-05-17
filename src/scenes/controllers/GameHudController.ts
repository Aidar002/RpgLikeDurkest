import * as Phaser from 'phaser';

import {
    BOTTOM_BAR_H,
    CENTER_X,
    CENTER_Y,
    Depths,
    GAME_HEIGHT,
    GAME_WIDTH,
    HUD_BOTTOM_OFFSET,
    HUD_PAD,
    HudLayout,
    TOP_BAR_H,
} from '../../ui/Layout';
import {
    HUD_FONT,
    HUD_STROKE,
    HudColors,
    HudHex,
    drawBarFrame,
    drawBarSegments,
} from '../../ui/HudTheme';
import { drawBottomFrame, drawStoneBackdrop, drawTopFrame } from '../../ui/HudFrame';
import { createTorchlightOverlay } from '../../ui/Torchlight';
import {
    createHudInlineSlot,
    createHudStackedSlot,
    type HudInlineSlotHandle,
    type HudStackedSlotHandle,
} from '../../ui/HudCell';
import { RelicSlots } from '../../ui/RelicSlots';
import { RelicSwapModal } from '../../ui/RelicSwapModal';
import { RestartConfirmModal } from '../../ui/RestartConfirmModal';
import { drawUiButton, type ButtonBackground } from '../../ui/UiButton';
import { EscapeHintGlow } from '../../ui/EscapeHintGlow';
import { VFX } from '../../ui/VFX';
import { playEffect } from '../../ui/EffectsLibrary';
import { showEffectsGallery, type EffectsGalleryHandle } from '../../ui/EffectsGalleryOverlay';
import { statusSummary } from '../../systems/StatusEffects';
import { MAX_RELICS } from '../../systems/PlayerManager';
import { RELICS } from '../../systems/Relics';
import type { RelicId } from '../../systems/Relics';
import type { GameScene } from '../GameScene';

/** Pixel size of the bold value text under each big resource /
 *  progress icon's label. Shrunk from 20 to 17 (-15 %) per player
 *  feedback so the trios stop bleeding into the right frame
 *  ornament. The icon pixel size and X anchors come from
 *  `HudLayout.topHud.*` so a "nudge the icon up 2px" tweak is a
 *  one-line edit in Layout.ts. */
const RESOURCE_VALUE_FONT_SIZE = '17px';
/** Pixel size of the ALL-CAPS label under each big icon. Shrunk
 *  from 12 to 10 (-15 %) in lockstep with the icon / value so the
 *  trios share the same compact rhythm. */
const RESOURCE_LABEL_FONT_SIZE = '10px';

/**
 * Owns the global HUD: top bar (HP/XP, ATK/DEF, gold/potion/resolve),
 * bottom bar (relic shards + depth/kills/bosses), below-bar text,
 * top-right chrome (escape + restart buttons + restart-confirm modal),
 * and the radial torchlight overlay.
 *
 * The controller holds every HUD widget reference and owns the
 * subscriptions to `PlayerManager` events (hp/stats/resources/level/death).
 * `GameScene` keeps a thin shim API (`refreshUI`) that forwards into
 * the controller so existing call sites in `RoomFlow` / `CombatHud`
 * keep compiling unchanged. The HUD controller's own methods
 * (`updatePlayerStatus`, `updateEnemyStatus`, …) are called directly
 * from the scene (e.g. from emitter listeners on
 * `CombatManager.playerStatusChange` / `enemyStatusChange`).
 */
export class GameHudController {
    private readonly scene: GameScene;

    // Bar dimensions cached so `refresh` can rescale fills without re-measuring.
    // Width tracks `HudLayout.topHud.vitalsBarWidth` so a "stretch the
    // bars" tweak is a one-line edit in Layout.ts.
    private readonly hpBarWidth = HudLayout.topHud.vitalsBarWidth;
    private readonly hpBarHeight = 14;
    private readonly xpBarWidth = HudLayout.topHud.vitalsBarWidth;
    private readonly xpBarHeight = 10;

    /** Horizontal slide each direction during a room transition (px). */
    public readonly torchlightSweepPx = 110;
    public torchlight: Phaser.GameObjects.Image | null = null;
    public torchlightHomeX = 0;
    public torchlightHomeY = 0;

    // Top vitals (HP bar + Level/XP bar).
    private hpBar!: Phaser.GameObjects.Rectangle;
    private hpValueText!: Phaser.GameObjects.Text;
    private xpBar!: Phaser.GameObjects.Rectangle;
    private xpBarBg!: Phaser.GameObjects.Rectangle;
    private xpBarFrame!: Phaser.GameObjects.Graphics;
    private levelText!: Phaser.GameObjects.Text;
    private xpValueText!: Phaser.GameObjects.Text;

    // Top combat stats and resources.
    private atkStat!: HudInlineSlotHandle;
    private defStat!: HudInlineSlotHandle;
    // Big icon-over-value resource trio (gold / potion / will) sitting
    // horizontally in the centre-right of the top bar.
    private goldStat!: HudStackedSlotHandle;
    private potionStat!: HudStackedSlotHandle;
    private resolveStat!: HudStackedSlotHandle;

    // Top-bar run-progress slots (depth / kills / bosses). Same big
    // icon-over-value style as the resource trio, pushed to the right
    // edge of the bar so the two trios balance visually.
    private depthStat!: HudStackedSlotHandle;
    private killsStat!: HudStackedSlotHandle;
    private bossStat!: HudStackedSlotHandle;

    /** Inline relic-icon row that lives in the bottom bar before the
     *  pillar divider. Hover-aware; tooltips are owned by the
     *  widget itself. */
    private relicSlots!: RelicSlots;

    /** Modal that pops on `player.relicOffer` (cap reached) so the
     *  player can drop one of the equipped five for the candidate
     *  or skip the candidate. */
    private relicSwapModal!: RelicSwapModal;

    // Below-bar floating text + chrome buttons.
    private hintText!: Phaser.GameObjects.Text;
    private playerStatusText!: Phaser.GameObjects.Text;
    private enemyStatusText!: Phaser.GameObjects.Text;
    private escapeButtonBg!: ButtonBackground;
    private escapeButtonLabel!: Phaser.GameObjects.Text;
    private restartButtonBg!: ButtonBackground;
    private restartButtonLabel!: Phaser.GameObjects.Text;
    /** Map-screen-only chrome button that opens the effects-and-particles
     *  gallery overlay. Same visibility rules as the escape/restart
     *  pair (`refresh()` updates them in lockstep). */
    private effectsButtonBg!: ButtonBackground;
    private effectsButtonLabel!: Phaser.GameObjects.Text;
    /** Live gallery handle while the overlay is up. We keep it so a
     *  second click on the button doesn't stack a duplicate overlay
     *  (and so the overlay can be force-dismissed from teardown). */
    private effectsGallery: EffectsGalleryHandle | null = null;

    /** Gold pulsing halo around the escape button. Driven from
     *  `refresh()` — visible when the player's pending + banked
     *  skill points can afford at least one meta upgrade. */
    private escapeHintGlow!: EscapeHintGlow;

    /** Restart-confirm modal. Built once in `build()` and toggled
     *  via `RestartConfirmModal.show` / `.hide()`. */
    private restartConfirmModal!: RestartConfirmModal;

    /** Two-step confirm timer for the HUD escape button. -1 == idle. */
    private escapeConfirmAt = -1;

    constructor(scene: GameScene) {
        this.scene = scene;
    }

    /**
     * Build every HUD widget and attach it to `scene.uiContainer` /
     * `scene.roomContainer`. Should be called once in
     * `GameScene.create()` *after* the containers are created and
     * *before* the room UI is set up.
     */
    public build(): void {
        const PAD = HUD_PAD;
        const TOP_H = TOP_BAR_H;
        const BOT_H = BOTTOM_BAR_H;
        const BOT_Y = GAME_HEIGHT - BOT_H - HUD_BOTTOM_OFFSET;

        const stoneWall = this.buildBackdrop(TOP_H, BOT_H);

        // ── TOP BAR ─────────────────────────────────────────────
        const topFrame = drawTopFrame(this.scene, GAME_WIDTH, TOP_H);
        const vitals = this.buildTopVitals(PAD);
        this.buildTopCombatStats(TOP_H);
        this.buildTopResources();
        this.buildTopProgress();

        // ── BOTTOM BAR ──────────────────────────────────────────
        const bottom = this.buildBottomBar(BOT_Y, BOT_H);
        this.buildRelicSlots(BOT_Y, BOT_H);
        this.buildBelowBarText(BOT_Y, PAD);
        this.buildRelicSwapModal();

        // ── CHROME BUTTONS + CONFIRM MODAL ──────────────────────
        this.buildHudButtons(TOP_H, PAD);
        this.buildRestartConfirmModal();

        const topWidgets: Phaser.GameObjects.GameObject[] = [
            topFrame,
            vitals.hpLabel,
            // bar frame must sit beneath the track so its rim hugs the bar
            vitals.hpBarFrame,
            vitals.hpBarBg,
            this.hpBar,
            vitals.hpSegments,
            this.hpValueText,
            this.levelText,
            this.xpBarFrame,
            this.xpBarBg,
            this.xpBar,
            this.xpValueText,
            this.atkStat.root,
            this.defStat.root,
            this.goldStat.root,
            this.potionStat.root,
            this.resolveStat.root,
            this.depthStat.root,
            this.killsStat.root,
            this.bossStat.root,
            this.playerStatusText,
        ];

        const bottomWidgets: Phaser.GameObjects.GameObject[] = [
            bottom.botFrame,
            ...this.relicSlots.widgets(),
            this.hintText,
            this.escapeButtonBg,
            this.escapeButtonLabel,
            this.restartButtonBg,
            this.restartButtonLabel,
            this.effectsButtonBg,
            this.effectsButtonLabel,
        ];

        // Stone wall must sit below the room content. Inside a Container
        // setDepth has no effect, so keep it scene-level and pin it under
        // every Depths.* tier (Background = 0).
        stoneWall.setDepth(Depths.Background - 1);
        this.scene.uiContainer.add([...topWidgets, ...bottomWidgets]);

        this.scene.roomContainer.add(this.enemyStatusText);
    }

    /**
     * Subscribe to player events so the HUD stays in sync with hp/stat
     * changes, level-ups grant pending skill points, and death triggers
     * the meta-progression wipe + death-screen handoff. Called from
     * `GameScene.create()` after `combat` is constructed (the
     * resourcesChange handler needs a live `combat` reference).
     */
    public wire(): void {
        const scene = this.scene;
        scene.player.hpChange.on(() => this.refresh());
        scene.player.statsChange.on(() => this.refresh());
        scene.player.resourcesChange.on(() => {
            this.refresh();
            if (scene.combat.enemy) {
                scene.combatHud.refreshButtons();
            }
        });
        scene.player.levelUp.on(({ level }) => {
            scene.tracker.trackMax('levelReached', level);
            // Each level-up grants a single pending skill point. The
            // bank only commits when the run ends in escape; on death
            // `meta.resetProgress()` wipes everything anyway.
            scene.runState.pendingSkillPoints += 1;
            scene.log.addMessage(scene.loc.t('levelUp', { level }), '#fff17a');
            scene.log.addMessage(scene.loc.t('levelUpSkillPoint'), '#a4d8ff');
            VFX.floatText(scene, 370, 20, `${scene.loc.t('level')} ${level}`, '#fff17a');
            scene.sfx.play('levelUp');
            const flash = scene.add
                .rectangle(CENTER_X, CENTER_Y, GAME_WIDTH, GAME_HEIGHT, 0xfff17a, 0.08)
                .setDepth(Depths.ScreenFlash);
            scene.tweens.add({
                targets: flash,
                alpha: 0,
                duration: 500,
                onComplete: () => flash.destroy(),
            });
            // Level-up VFX recipe: a fountain of gold stars at the
            // player's progression column (where the LEVEL/XP labels
            // live in the top bar). Anchored to the live `levelText`
            // so we don't drift if the HUD layout shifts. The recipe
            // self-destroys its game objects after ~1 s.
            const levelCenter = this.levelText.getCenter();
            playEffect(scene, 'starFountain', levelCenter.x, levelCenter.y, {
                depth: Depths.ScreenFlash + 1,
            });
            this.refresh();
        });

        // Pickup VFX — fires the moment a brand-new relic lands in
        // the inventory. `relicGained` is distinct from `relicsChange`
        // (the latter also fires on removes/swaps/recompute) so this
        // exclusively decorates acquisitions. We aim at the slot the
        // newly added relic just landed in (one frame after the
        // emit, by which point `RelicSlots.refresh()` has already
        // repainted the row).
        scene.player.relicGained.on(({ id }) => {
            const center = this.relicSlots.getSlotCenter(id);
            if (!center) return;
            playEffect(scene, 'sparkleConfetti', center.x, center.y, {
                depth: Depths.NotificationBanner,
            });
        });
        scene.player.death.on(() => {
            if (scene.deathSequenceStarted) {
                return;
            }

            scene.deathSequenceStarted = true;
            scene.dead = true;
            // Death wipes the entire profile — skill point bank AND
            // every purchased upgrade go back to first-time-player
            // defaults. Pending points are forgotten too since they
            // were never banked.
            scene.runState.pendingSkillPoints = 0;
            scene.runState.skillPointsBanked = 0;
            scene.runState.skillPointsBankedFlag = false;
            scene.meta.resetProgress();
            scene.sfx.play('death');
            scene.sfx.stopAmbient();
            scene.cameras.main.shake(650, 0.04);
            scene.time.delayedCall(320, () => scene.showDeathScreenInternal());
        });

        // When a relic drops with the inventory at the cap, the
        // manager fires `relicOffer` instead of mutating. The
        // swap-modal owns the resolution.
        scene.player.relicOffer.on(({ id }) => {
            this.relicSwapModal.show(id);
        });
    }

    /**
     * Re-pull every HUD widget from the player/meta managers. Public
     * because `GameScene.refreshUI()` forwards to it, and several
     * scene methods (`afterMove`, `enterRoom`, end-screen handlers)
     * also call it directly.
     */
    public refresh(): void {
        const scene = this.scene;
        const unlocks = scene.meta.getUiUnlockState();
        const stats = scene.player.stats;
        const resources = scene.player.resources;

        // Vitals: HP bar fill colour shifts as HP drops; numeric overlay tracks
        // exact values for the player.
        const hpRatio = Phaser.Math.Clamp(stats.hp / stats.maxHp, 0, 1);
        this.hpBar.setDisplaySize(this.hpBarWidth * hpRatio, this.hpBarHeight);
        this.hpBar.setFillStyle(
            hpRatio > 0.5
                ? HudColors.bloodFill
                : hpRatio > 0.25
                  ? HudColors.bloodFillMid
                  : HudColors.bloodFillLow
        );
        this.hpValueText.setText(`${stats.hp} / ${stats.maxHp}`);

        // Progression: XP bar + featured level number + caption.
        const xpRatio = Phaser.Math.Clamp(stats.xp / scene.player.xpToNextLevel, 0, 1);
        this.xpBar.setDisplaySize(this.xpBarWidth * xpRatio, this.xpBarHeight);
        this.levelText.setText(`${scene.loc.t('level')} ${stats.level}`);
        this.xpValueText.setText(`${scene.loc.t('xp')} ${stats.xp}/${scene.player.xpToNextLevel}`);

        // Combat stats: each stat has its own icon/value pair so colours can
        // differentiate at a glance.
        const showStats = unlocks.showPlayerStats;
        this.atkStat.setValue(`${scene.player.getAttackPower()}`);
        this.atkStat.setVisible(showStats);
        this.defStat.setValue(`${scene.player.getEffectiveDefense()}`);
        this.defStat.setVisible(showStats);

        // Resources: per-stat slots, each with their own accent colour.
        this.goldStat.setValue(`${resources.gold}`);
        this.goldStat.setVisible(unlocks.showGold);
        this.potionStat.setValue(`${resources.potions}`);
        this.potionStat.setVisible(unlocks.showPotions);
        this.resolveStat.setValue(`${resources.resolve}/${resources.maxResolve}`);
        this.resolveStat.setVisible(unlocks.showResolve);

        // Run progress cells (depth / kills / bosses). The legacy
        // PRESTIGE forecast cell was removed when the meta-progression
        // economy switched to skill-points-from-level-ups.
        const showProgress = unlocks.showRunMetrics || unlocks.showKillCounter;
        this.depthStat.setValue(`${scene.runState.runBestDepth}`);
        this.depthStat.setVisible(showProgress);
        this.killsStat.setValue(`${scene.player.killCount}`);
        this.killsStat.setVisible(showProgress && unlocks.showKillCounter);
        this.bossStat.setValue(`${scene.runState.runBossKills}`);
        this.bossStat.setVisible(showProgress && unlocks.showRunMetrics);

        // The "next unlock" milestone hint ("Дальше: Достигни глубины N")
        // is intentionally hidden from the in-game HUD per design — meta
        // unlocks still apply silently in the background; the player just
        // doesn't get a depth-goal nag in the play area.
        this.hintText.setText('');

        this.hpValueText.setVisible(unlocks.showHpNumbers);
        this.xpBarFrame.setVisible(unlocks.showLevelPanel);
        this.xpBarBg.setVisible(unlocks.showLevelPanel);
        this.xpBar.setVisible(unlocks.showLevelPanel);
        this.levelText.setVisible(unlocks.showLevelPanel);
        this.xpValueText.setVisible(unlocks.showLevelPanel);
        this.hintText.setVisible(false);

        this.relicSlots.refresh();
        this.updatePlayerStatus();

        // Escape and Restart buttons live on the map UI only. They
        // disappear inside any room (combat, treasure, NPC, …) so the
        // room's own action buttons (#1..#5) own the click area, and
        // they also hide while a death sequence / end screen is up.
        const hudButtonsVisible =
            scene.mapContainer.visible && !scene.dead && !scene.deathSequenceStarted;
        this.escapeButtonBg.setVisible(hudButtonsVisible);
        this.escapeButtonLabel.setVisible(hudButtonsVisible);
        this.restartButtonBg.setVisible(hudButtonsVisible);
        this.restartButtonLabel.setVisible(hudButtonsVisible);
        this.effectsButtonBg.setVisible(hudButtonsVisible);
        this.effectsButtonLabel.setVisible(hudButtonsVisible);
        // If the gallery is up but we just transitioned off the map
        // (e.g. into combat) force-dismiss the overlay so it doesn't
        // hang around painting on top of the room UI.
        if (this.effectsGallery && !hudButtonsVisible) {
            this.effectsGallery.destroy();
            this.effectsGallery = null;
        }

        // Escape-glow predicate: the player has earned at least one
        // skill point this run AND their pending + banked total
        // reaches the cheapest unbought meta upgrade. Banking-only
        // (available >= cost with no pending) does NOT glow — the
        // hint reads as "you accumulated something worth banking".
        const pending = scene.runState.pendingSkillPoints;
        const available = scene.meta.availableSkillPoints;
        const cheapest = scene.meta.getCheapestUnboughtUpgradeCost();
        const wantsEscapeHint = pending > 0 && pending + available >= cheapest;
        this.escapeHintGlow.update(wantsEscapeHint, hudButtonsVisible);
    }

    public updatePlayerStatus(): void {
        const txt = statusSummary(this.scene.player.status, this.scene.loc.language);
        this.playerStatusText.setText(txt);
    }

    public updateEnemyStatus(): void {
        if (!this.scene.combat.enemy) {
            this.enemyStatusText.setText('');
            return;
        }
        const txt = statusSummary(this.scene.combat.enemy.status, this.scene.loc.language);
        this.enemyStatusText.setText(txt);
    }

    /**
     * Backdrop layer for the play area: optional carved-stone wall
     * texture (drops out gracefully when the asset is missing) plus a
     * radial torchlight overlay that keeps the centre of the wall
     * readable and fades the edges to black so the dungeon feels lit
     * by a single lamp.
     */
    private buildBackdrop(topH: number, botH: number): Phaser.GameObjects.Image {
        const playAreaH = GAME_HEIGHT - topH - botH;
        const stoneWall = drawStoneBackdrop(this.scene, topH, GAME_WIDTH, playAreaH);
        // The torchlight texture is oversized by TORCH_MARGIN on every
        // side so the overlay can slide during room transitions
        // without exposing an un-dimmed strip of stone at the trailing
        // edge.
        const TORCH_MARGIN = 256;
        const torchW = GAME_WIDTH + TORCH_MARGIN * 2;
        const torchH = playAreaH + TORCH_MARGIN * 2;
        const torchlight = createTorchlightOverlay(this.scene, torchW, torchH, {
            innerRadius: 250,
            outerRadius: 400,
            centerAlpha: 0.45,
            edgeAlpha: 0.94,
        });
        this.torchlightHomeX = GAME_WIDTH / 2;
        this.torchlightHomeY = topH + playAreaH / 2;
        torchlight
            .setOrigin(0.5, 0.5)
            .setPosition(this.torchlightHomeX, this.torchlightHomeY)
            .setDepth(Depths.Background - 0.5);
        this.torchlight = torchlight;
        return stoneWall;
    }

    /**
     * Top-bar vitals column (Group A + B): HP bar with segment
     * markers and Level + XP stacked underneath. Returns the local
     * widgets the orchestrator needs for `uiContainer.add` ordering;
     * the bar fills (`hpBar`, `xpBar`, etc.) and the value labels
     * stay on `this` so `refresh` can scale them.
     */
    private buildTopVitals(pad: number): {
        hpLabel: Phaser.GameObjects.Text;
        hpBarFrame: Phaser.GameObjects.GameObject;
        hpBarBg: Phaser.GameObjects.Rectangle;
        hpSegments: Phaser.GameObjects.GameObject;
    } {
        // The 96px panel has a 52px interior (y=22..74 after the carved
        // gold rim). Every anchor below is shifted right by
        // `HudLayout.topHud.shiftX` so the HP/XP block sits in
        // lockstep with the ATK/DEF / resource / progress columns —
        // together they form a single visually-centred top bar
        // instead of a left-piled stack with a wide blank gutter on
        // the right edge. The heart glyph that used to anchor the
        // block on the left has been removed; the "ОЗ" / "УР"
        // labels now carry the column's identity on their own.
        const SHIFT = HudLayout.topHud.shiftX;
        const VITALS_LABEL_X = pad + 8 + SHIFT;
        const VITALS_BAR_X = pad + 8 + HudLayout.topHud.vitalsBarOffsetX + SHIFT;
        // The "ОЗ" / "УР" labels both anchor the HP/XP block visually,
        // so they use the same weight (bold) and size (13px) and the
        // primary text colour — the bar / value pair to the right
        // carries the row-specific styling (red track for HP, blue
        // for XP). Origin (0, 0.5) so y=36 / y=64 puts them on the
        // same vertical centre as their bar.
        const hpLabel = this.scene.add
            .text(VITALS_LABEL_X, 36, this.scene.loc.t('hp').toUpperCase(), {
                fontFamily: HUD_FONT,
                fontSize: '13px',
                fontStyle: 'bold',
                color: HudHex.textPrimary,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0, 0.5);
        const hpBarX = VITALS_BAR_X;
        const hpBarY = 36;
        const hpBarFrame = drawBarFrame(
            this.scene,
            hpBarX,
            hpBarY,
            this.hpBarWidth,
            this.hpBarHeight
        );
        const hpBarBg = this.scene.add
            .rectangle(hpBarX, hpBarY, this.hpBarWidth, this.hpBarHeight, HudColors.bloodTrack)
            .setOrigin(0, 0.5);
        this.hpBar = this.scene.add
            .rectangle(hpBarX, hpBarY, this.hpBarWidth, this.hpBarHeight, HudColors.bloodFill)
            .setOrigin(0, 0.5);
        const hpSegments = drawBarSegments(
            this.scene,
            hpBarX,
            hpBarY,
            this.hpBarWidth,
            this.hpBarHeight,
            5
        );
        this.hpValueText = this.scene.add.text(hpBarX + this.hpBarWidth + 10, hpBarY - 9, '', {
            fontFamily: HUD_FONT,
            fontSize: '14px',
            color: HudHex.textPrimary,
            stroke: HUD_STROKE,
            strokeThickness: 2,
        });

        // Group B — Level + XP, stacked directly under the HP bar so
        // the vitals/progression block reads as a single column on the
        // left third of the top bar. "УР N" sits at the bar's left
        // edge and "ОП X/Y" mirrors the HP value text on the right of
        // the bar — same x as `hpValueText` so both numeric overlays
        // line up vertically.
        this.levelText = this.scene.add
            .text(VITALS_LABEL_X, 64, '', {
                fontFamily: HUD_FONT,
                fontSize: '13px',
                fontStyle: 'bold',
                color: HudHex.textPrimary,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0, 0.5);
        this.xpValueText = this.scene.add
            .text(hpBarX + this.hpBarWidth + 10, 64, '', {
                fontFamily: HUD_FONT,
                fontSize: '12px',
                color: HudHex.textSecondary,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0, 0.5);
        const xpBarX = hpBarX;
        const xpBarY = 64;
        this.xpBarFrame = drawBarFrame(
            this.scene,
            xpBarX,
            xpBarY,
            this.xpBarWidth,
            this.xpBarHeight
        );
        this.xpBarBg = this.scene.add
            .rectangle(xpBarX, xpBarY, this.xpBarWidth, this.xpBarHeight, 0x14202c)
            .setOrigin(0, 0.5);
        // Fill at full width then scaled by ratio in refresh.
        this.xpBar = this.scene.add
            .rectangle(xpBarX, xpBarY, this.xpBarWidth, this.xpBarHeight, 0x6a8fc2)
            .setOrigin(0, 0.5);
        this.xpBar.setDisplaySize(0, this.xpBarHeight);

        return { hpLabel, hpBarFrame, hpBarBg, hpSegments };
    }

    /**
     * Top-bar combat stats (Group C): atk/def stacked column and the
     * centred "player status" floating text just below the bar.
     * valueOffsetX forces atk/def rows to share a numeric column so the
     * values line up vertically even though "АТАКА" is shorter than
     * "ЗАЩИТА".
     */
    private buildTopCombatStats(topH: number) {
        const { topHud } = HudLayout;
        this.atkStat = createHudInlineSlot(this.scene, topHud.statsX, topHud.atkY, {
            icon: 'sword',
            label: this.scene.loc.t('attackShort').toUpperCase(),
            valueColor: HudHex.textPrimary,
            valueFontSize: '17px',
            valueOffsetX: topHud.statsValueOffset,
        });
        this.defStat = createHudInlineSlot(this.scene, topHud.statsX, topHud.defY, {
            icon: 'shield',
            label: this.scene.loc.t('defenseShort').toUpperCase(),
            valueColor: HudHex.textPrimary,
            valueFontSize: '17px',
            valueOffsetX: topHud.statsValueOffset,
        });

        this.playerStatusText = this.scene.add
            .text(CENTER_X, topH + 14, '', {
                fontFamily: HUD_FONT,
                fontSize: '12px',
                color: HudHex.accentResolve,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0.5, 0);
    }

    /**
     * Top-bar resources (Group D): the gold / potion / resolve trio
     * sits as three large icon-over-label-over-value blocks in the
     * centre-right of the top bar. Each block centres a 32 px icon
     * over its localised label (МОНЕТЫ / ЗЕЛЬЕ / ВОЛЯ) and the bold
     * value below, so the trio reads as the visual centrepiece of
     * the bar. A carved pillar (`buildTopDivider`) separates this
     * trio from the run-progress trio on the right.
     */
    private buildTopResources() {
        const { topHud } = HudLayout;
        const iconTopY = topHud.resourceIconTopY;
        const iconSize = topHud.resourceIconSize;
        const step = topHud.resourcesStepX;
        const loc = this.scene.loc;
        this.goldStat = createHudStackedSlot(this.scene, topHud.resourcesX, iconTopY, {
            icon: 'coin',
            iconSize,
            label: loc.t('goldShort').toUpperCase(),
            labelFontSize: RESOURCE_LABEL_FONT_SIZE,
            valueColor: HudHex.accentGold,
            valueFontSize: RESOURCE_VALUE_FONT_SIZE,
        });
        this.potionStat = createHudStackedSlot(this.scene, topHud.resourcesX + step, iconTopY, {
            icon: 'potion',
            iconSize,
            label: loc.t('potionShort').toUpperCase(),
            labelFontSize: RESOURCE_LABEL_FONT_SIZE,
            valueColor: HudHex.accentPotion,
            valueFontSize: RESOURCE_VALUE_FONT_SIZE,
        });
        this.resolveStat = createHudStackedSlot(
            this.scene,
            topHud.resourcesX + step * 2,
            iconTopY,
            {
                icon: 'quill',
                iconSize,
                label: loc.t('resolveShort').toUpperCase(),
                labelFontSize: RESOURCE_LABEL_FONT_SIZE,
                valueColor: HudHex.accentResolve,
                valueFontSize: RESOURCE_VALUE_FONT_SIZE,
            }
        );
    }

    /**
     * Bottom carved bar: just the carved panel art now. The 3 progress
     * cells (depth / kills / bosses) used to live here next to the
     * relic-slot block but were promoted to the top bar so the bottom
     * panel reads as the player's inventory + chrome row. The relic
     * row is built separately in `buildRelicSlots` and the
     * audio/language icons in `setupSceneChrome` (called from the
     * scene); the bottom-bar PNG already carves its own corner
     * ornaments so no extra dividers are needed.
     */
    private buildBottomBar(
        botY: number,
        botH: number
    ): {
        botFrame: Phaser.GameObjects.GameObject;
    } {
        const botFrame = drawBottomFrame(this.scene, botY, GAME_WIDTH, botH);
        return { botFrame };
    }

    /**
     * Top-bar run-progress trio (Group E): depth / kills / bosses
     * rendered as three large icon-over-label-over-value blocks at
     * the right edge of the top bar, mirroring the gold/potion/will
     * trio on their left. A carved pillar between the two trios
     * (`buildTopDivider`) makes the run-progress block read as a
     * separate group. X anchors and the icon size come from
     * `HudLayout.topHud.*` so both trios share the same rhythm.
     */
    private buildTopProgress() {
        const { topHud } = HudLayout;
        const iconTopY = topHud.resourceIconTopY;
        const iconSize = topHud.resourceIconSize;
        const step = topHud.progressStepX;
        const loc = this.scene.loc;
        this.depthStat = createHudStackedSlot(this.scene, topHud.progressX, iconTopY, {
            icon: 'depth',
            iconSize,
            label: loc.t('depthShort').toUpperCase(),
            labelFontSize: RESOURCE_LABEL_FONT_SIZE,
            valueColor: HudHex.accentDepth,
            valueFontSize: RESOURCE_VALUE_FONT_SIZE,
        });
        this.killsStat = createHudStackedSlot(this.scene, topHud.progressX + step, iconTopY, {
            icon: 'kills',
            iconSize,
            label: loc.t('killShort').toUpperCase(),
            labelFontSize: RESOURCE_LABEL_FONT_SIZE,
            valueColor: HudHex.accentKills,
            valueFontSize: RESOURCE_VALUE_FONT_SIZE,
        });
        this.bossStat = createHudStackedSlot(this.scene, topHud.progressX + step * 2, iconTopY, {
            icon: 'boss',
            iconSize,
            label: loc.t('bossShort').toUpperCase(),
            labelFontSize: RESOURCE_LABEL_FONT_SIZE,
            valueColor: HudHex.accentBoss,
            valueFontSize: RESOURCE_VALUE_FONT_SIZE,
        });
    }

    /**
     * Build the inline relic-icon row that lives between the shard
     * cell and the pillar divider in the bottom bar. The widget owns
     * its own `relicsChange` subscription and tooltip; the HUD
     * controller only needs to flush it through `widgets()` so the
     * icons share the `uiContainer`.
     */
    private buildRelicSlots(botY: number, botH: number) {
        // Anchor the relic row to the left side of the bottom bar so
        // the player's collected items get a dedicated, prominent
        // slot block — mirroring the depth/kills/bosses block on the
        // right. Leftmost slot edge sits at the `resStart = 36`
        // safe-area inset. Slots are 60×60 with an 18 px gap
        // (1.5× the original 40/12), so the row spans
        // `MAX_RELICS * 60 + (MAX_RELICS - 1) * 18` = 372 px,
        // leaving plenty of room before the pillar at 600.
        const cellH = 110;
        const cellTop = botY + Math.round((botH - cellH) / 2);
        const SLOT_SIZE = 60;
        const SLOT_GAP = 18;
        const ROW_LEFT = 36;
        const totalW = MAX_RELICS * SLOT_SIZE + (MAX_RELICS - 1) * SLOT_GAP;
        const centerX = ROW_LEFT + Math.round(totalW / 2);
        const centerY = cellTop + Math.round(cellH / 2);
        const scene = this.scene;
        this.relicSlots = new RelicSlots(scene, scene.player, scene.loc, {
            centerX,
            centerY,
            capacity: MAX_RELICS,
            sfx: scene.sfx,
            // Click a filled relic slot → it arms with a red ✕ glyph,
            // second click within ~3s commits the drop. We mirror the
            // pickup log shape so the run-log reads as a paired
            // "obtained / discarded" stream, with the dimmer
            // `accentBloodLow` tint to signal a loss.
            onDiscard: (id: RelicId) => {
                const relic = RELICS[id];
                scene.player.removeRelic(id);
                scene.log.addMessage(
                    scene.loc.t('relicDiscarded', {
                        value: scene.loc.pick(relic.name),
                    }),
                    HudHex.accentBloodLow
                );
            },
        });
    }

    /** Build the cap-reached swap modal. The modal owns its own
     *  show/hide state; we just keep the handle here so the
     *  `relicOffer` listener in `wire()` can invoke `show(candidate)`. */
    private buildRelicSwapModal() {
        const scene = this.scene;
        this.relicSwapModal = new RelicSwapModal(scene, {
            loc: scene.loc,
            sfx: scene.sfx,
            player: scene.player,
            onSwap: (droppedId: RelicId, candidateId: RelicId) => {
                scene.player.removeRelic(droppedId);
                scene.player.addRelic(candidateId);
                const relic = RELICS[candidateId];
                scene.sfx.play('relicDrop');
                scene.tracker.record('relicsFound');
                scene.log.addMessage(
                    scene.loc.t('relicObtained', {
                        value: scene.loc.pick(relic.name),
                        value2: scene.loc.pick(relic.description),
                    }),
                    relic.rarity === 'unique'
                        ? '#f0a8ff'
                        : relic.rarity === 'rare'
                          ? '#ffd36e'
                          : '#ffcc99'
                );
            },
            onSkip: () => {
                // Intentional no-op: declined relics don't write to
                // the log so a busy combat tail doesn't get spammed
                // with "skipped X" lines on every enemy. The slot
                // row stays unchanged so the player has visual
                // confirmation that nothing was equipped.
            },
        });
    }

    /**
     * Floating text rows that sit *above* the bottom bar (milestone
     * hint centred) and the out-of-bar enemy status text used during
     * combat. Anchored to `botY − small offset` so a future change to
     * BOTTOM_BAR_H carries them along.
     */
    private buildBelowBarText(botY: number, pad: number) {
        const HINT_LINE_Y = botY - 8;
        // Relic display moved into the bottom bar itself (see
        // `buildRelicSlots`). The old `relicText` line was a
        // throwaway summary that didn't communicate rarity or let
        // the player inspect a relic's effect.
        void pad;
        this.hintText = this.scene.add
            .text(CENTER_X, HINT_LINE_Y, '', {
                fontFamily: HUD_FONT,
                fontSize: '12px',
                color: HudHex.textSecondary,
                stroke: HUD_STROKE,
                strokeThickness: 2,
                align: 'center',
            })
            .setOrigin(0.5, 1);

        this.enemyStatusText = this.scene.add
            .text(780, 356, '', {
                fontFamily: HUD_FONT,
                fontSize: '11px',
                color: HudHex.accentBloodLow,
                stroke: HUD_STROKE,
                strokeThickness: 2,
            })
            .setOrigin(0.5, 0);
    }

    /**
     * Top-right HUD chrome: ESCAPE button (out-of-combat run-end with
     * skill-point banking — first click arms, second click within
     * ~3s confirms via `handleEscapeClick`) and RESTART button
     * (instantly scraps the run via `handleRestartClick` →
     * confirmation modal → meta-progression wipe). The two share
     * visibility rules in `refresh`.
     */
    /**
     * Toggle the effects-and-particles gallery overlay. Idempotent:
     * a second click while the overlay is up dismisses it (the
     * overlay's own close button + Escape key also tear it down).
     */
    private toggleEffectsGallery(): void {
        if (this.effectsGallery) {
            this.effectsGallery.destroy();
            this.effectsGallery = null;
            return;
        }
        const scene = this.scene;
        this.effectsGallery = showEffectsGallery(scene, scene.loc, scene.sfx);
        // The overlay's `destroy` is wired to the close button +
        // Escape key. We can't intercept those here, so we drop our
        // handle when the overlay tells us it's gone by polling on
        // every refresh — see `refresh()` for the keep-alive check.
    }

    private buildHudButtons(topH: number, pad: number) {
        // Escape + Restart promoted from the top-right corner into the
        // carved bottom bar so they read as part of the bottom-panel
        // chrome row (relic slots ── ESCAPE ── RESTART ── music /
        // settings / language). Sitting in the bottom bar gives the
        // two primary run-management actions roomier hit targets —
        // 60 × 200 vs the old 38 × 147/173 — and pulls them out of
        // the crowded top bar where they competed with HP/XP and the
        // stat columns for the player's eye.
        //
        // Layout in the bottom panel:
        //   [ relic row ] ─36px─ [ ESCAPE ] ─26px─ [ RESTART ] ─36px─ [ chrome icons ]
        //
        // Vertical centring on `BOT_Y + BOT_H / 2` aligns the buttons
        // with the relic cells (same `cellH = 110` band) and the
        // music / settings / language icons (anchored to
        // `HudLayout.chrome.iconY = 688`), so the whole bottom panel
        // reads as one row of chrome.
        //
        // Variants are unchanged from the old top-right layout:
        //   - 'gold' for Escape — primary CTA, the run-ending bank.
        //   - 'danger' for Restart — destructive, full wipe.
        //
        // Escape sits LEFT (closer to the relic row, easier to hit
        // when the player just wants to bank skill points); Restart
        // sits RIGHT (further from the relic hot zone, more
        // protective against reflex misclicks).
        const BOT_Y = GAME_HEIGHT - BOTTOM_BAR_H - HUD_BOTTOM_OFFSET;
        const BTN_H = 60;
        const BTN_W = 200;
        const BTN_GAP = 26;
        const BTN_Y = BOT_Y + Math.round(BOTTOM_BAR_H / 2);

        // Centre the two-button pair in the space between the relic
        // row's right edge (~408 px — see `buildRelicSlots`) and the
        // music/settings/language chrome on the right (leftmost icon
        // sits at `HudLayout.chrome.iconRightX - 2 * iconStepX ≈ 903`,
        // ≈ x = 887 with the icon glyph's half-width factored in).
        const PAIR_W = BTN_W * 2 + BTN_GAP;
        const RELIC_ROW_RIGHT = 408;
        const CHROME_LEFT = 887;
        const PAIR_CENTER_X = Math.round((RELIC_ROW_RIGHT + CHROME_LEFT) / 2);
        const ESCAPE_BTN_X = PAIR_CENTER_X - PAIR_W / 2 + BTN_W / 2;
        const RESTART_BTN_X = PAIR_CENTER_X + PAIR_W / 2 - BTN_W / 2;

        const escapeUi = drawUiButton(
            this.scene,
            ESCAPE_BTN_X,
            BTN_Y,
            BTN_W,
            BTN_H,
            this.scene.loc.t('escapeButton'),
            {
                variant: 'gold',
                fontSize: '18px',
                color: HudHex.textPrimary,
                depth: 220,
                sfx: this.scene.sfx,
            }
        );
        this.escapeButtonBg = escapeUi.background;
        this.escapeButtonLabel = escapeUi.label;
        this.escapeButtonLabel.setY(BTN_Y - 1);
        this.escapeButtonBg.on('pointerdown', () => this.handleEscapeClick());

        const restartUi = drawUiButton(
            this.scene,
            RESTART_BTN_X,
            BTN_Y,
            BTN_W,
            BTN_H,
            this.scene.loc.t('restartButton'),
            {
                variant: 'danger',
                fontSize: '18px',
                color: HudHex.textPrimary,
                depth: 220,
                sfx: this.scene.sfx,
            }
        );
        this.restartButtonBg = restartUi.background;
        this.restartButtonLabel = restartUi.label;
        this.restartButtonLabel.setY(BTN_Y - 1);
        this.restartButtonBg.on('pointerdown', () => this.handleRestartClick());

        this.escapeHintGlow = new EscapeHintGlow(
            this.scene,
            {
                x: ESCAPE_BTN_X,
                y: BTN_Y,
                width: BTN_W,
                height: BTN_H,
            },
            this.scene.uiContainer
        );

        // Effects-and-particles button — kept in the top-right
        // corner where the Escape/Restart row used to live, now that
        // those two have been promoted to the bottom panel. The
        // button retains its 'silver' variant for understated
        // chrome (this is a debug-ish utility, not a primary CTA)
        // and is sized to roughly fill the horizontal slot the
        // old run-management row used to occupy so the top-right
        // corner doesn't read as an empty void.
        const EFFECTS_BTN_H = 32;
        const EFFECTS_BTN_W = 328;
        const EFFECTS_BTN_X = GAME_WIDTH - pad - EFFECTS_BTN_W / 2;
        const EFFECTS_BTN_Y = topH + 23;
        const effectsUi = drawUiButton(
            this.scene,
            EFFECTS_BTN_X,
            EFFECTS_BTN_Y,
            EFFECTS_BTN_W,
            EFFECTS_BTN_H,
            this.scene.loc.t('effectsButton'),
            {
                variant: 'silver',
                fontSize: '13px',
                color: HudHex.textPrimary,
                depth: 220,
                sfx: this.scene.sfx,
            }
        );
        this.effectsButtonBg = effectsUi.background;
        this.effectsButtonLabel = effectsUi.label;
        this.effectsButtonBg.on('pointerdown', () => this.toggleEffectsGallery());
    }

    /**
     * Build the restart-confirm modal once and stash the handle on
     * `restartConfirmModal` so it can be toggled from
     * `handleRestartClick`. Mirrors the look of the death-screen
     * reset modal but commits to a full meta-progression wipe +
     * return to the boot scene rather than just restarting the
     * current run.
     */
    private buildRestartConfirmModal() {
        this.restartConfirmModal = new RestartConfirmModal(this.scene, {
            loc: this.scene.loc,
            sfx: this.scene.sfx,
            onConfirm: () => this.confirmRestart(),
        });
    }

    /**
     * HUD restart button. Opens a confirmation modal — the player must
     * accept before the run is wiped. Guarded the same way as Escape
     * (no-op during combat / death sequence) so the visibility logic
     * in `refresh` and this guard stay in sync.
     */
    private handleRestartClick() {
        if (this.scene.combat?.enemy || this.scene.dead || this.scene.deathSequenceStarted) {
            return;
        }
        this.restartConfirmModal.show();
    }

    /**
     * Apply the restart confirmation: wipe meta progression to
     * defaults and return to the boot/title scene so the next run
     * starts from a fresh profile. Carries the existing
     * locale/audio managers across so language and volume settings
     * survive.
     */
    private confirmRestart() {
        const scene = this.scene;
        scene.meta.resetProgress();
        scene.tweens.killAll();
        scene.time.removeAllEvents();
        scene.input.removeAllListeners();
        scene.scene.start('BootScene', { loc: scene.loc, sfx: scene.sfx, music: scene.music });
    }

    /**
     * HUD escape button. First click arms a confirm window; second
     * click within `ESCAPE_CONFIRM_MS` commits the escape and hands
     * off to the meta-progression end screen (which awards prestige
     * and lets the player spend it before starting the next run).
     * Pressing the button while combat is active or while the player
     * is dead is a no-op — the visibility logic in `refresh` also
     * hides it in those cases, this guard is belt-and-braces.
     */
    private handleEscapeClick() {
        const scene = this.scene;
        if (scene.combat?.enemy || scene.dead || scene.deathSequenceStarted) {
            return;
        }
        const now = scene.time.now;
        const ESCAPE_CONFIRM_MS = 3000;
        if (this.escapeConfirmAt > 0 && now - this.escapeConfirmAt <= ESCAPE_CONFIRM_MS) {
            // Confirmed — commit the escape.
            this.escapeConfirmAt = -1;
            scene.runState.escaped = true;
            scene.dead = true;
            scene.showDeathScreenInternal();
            return;
        }
        // First click — arm the confirm window and update the label.
        this.escapeConfirmAt = now;
        this.escapeButtonLabel.setText(scene.loc.t('escapeButtonConfirm'));
        this.escapeButtonLabel.setColor(HudHex.accentBloodLow);
        scene.time.delayedCall(ESCAPE_CONFIRM_MS, () => {
            // Window expired without a confirm — revert label.
            if (
                this.escapeConfirmAt > 0 &&
                scene.time.now - this.escapeConfirmAt >= ESCAPE_CONFIRM_MS
            ) {
                this.escapeConfirmAt = -1;
                this.escapeButtonLabel.setText(scene.loc.t('escapeButton'));
                this.escapeButtonLabel.setColor(HudHex.textPrimary);
            }
        });
    }
}
