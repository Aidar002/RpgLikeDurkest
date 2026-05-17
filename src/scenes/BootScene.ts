import * as Phaser from 'phaser';
import { Localization } from '../systems/Localization';
import { MusicManager } from '../systems/MusicManager';
import { SoundManager } from '../systems/SoundManager';
import { parseDevSeedQuery } from '../systems/DevSeed';
import { CENTER_X, GAME_HEIGHT, GAME_WIDTH } from '../ui/Layout';
import { BOOT_TORCH_FRAME_SIZE, BOOT_TORCH_TEXTURE_KEY, createBootTorch } from '../ui/BootTorch';
import { createStoneBackdrop } from '../ui/StoneBackdrop';
import { drawUiButton } from '../ui/UiButton';
import { HUD_FONT } from '../ui/HudTheme';

/** Boot-screen door spritesheet binding. Two frames (closed / open)
 *  laid out horizontally; each frame is a square of this size. The
 *  source asset is 1774×887, so each cell is 887×887. */
const DOOR_TEXTURE_KEY = 'boot_door';
const DOOR_FRAME_SIZE = 887;
/** On-screen height used to scale the door inside the BootScene
 *  layout. Width matches because the source frames are square. */
const DOOR_DISPLAY_HEIGHT = 530;

/** Tint multiplier applied to the door so the lit stone arch + wood
 *  read as part of the dim torch-lit room behind it rather than
 *  floating brighter than its surroundings. Phaser's tint multiplies
 *  every channel by `tint/0xff`; 0x707078 ≈ 44 % brightness with a
 *  faint cool cast that matches the surrounding stonework. */
const DOOR_AMBIENT_TINT = 0x707078;

export class BootScene extends Phaser.Scene {
    /** Managers re-used across restarts. When the player wipes the
     *  run from the HUD escape menu, `GameHudController` passes the
     *  active `loc`/`sfx`/`music` instances back into BootScene so
     *  their state survives (preloaded SFX buffers, language choice,
     *  master volume) *and* — critically — so `music.stop()` below
     *  acts on the instance that is actually playing the dungeon
     *  track instead of a fresh empty one. Without this the dungeon
     *  music kept playing on the title screen after restart. */
    private bootLoc?: Localization;
    private bootSfx?: SoundManager;
    private bootMusic?: MusicManager;

    constructor() {
        super('BootScene');
    }

    init(data?: { loc?: Localization; sfx?: SoundManager; music?: MusicManager }) {
        this.bootLoc = data?.loc;
        this.bootSfx = data?.sfx;
        this.bootMusic = data?.music;
    }

    preload() {
        // Hand-authored assets. When a key is registered here,
        // `PixelSprite.registerAll` in GameScene skips it (via its
        // `scene.textures.exists(key)` guard), so the authored art
        // replaces the procedural fallback cleanly.
        //
        // Missing files are non-fatal: Phaser logs a console warn,
        // the procedural sprite takes over, and gameplay keeps working.
        // To add a new asset, drop a .webp file into the matching
        // `public/sprites/` subfolder and register it below.
        // See docs/ART_GUIDE.md for naming conventions and sizes.
        const base = import.meta.env.BASE_URL;

        // ── Room icons (map nodes) ──────────────────────────────
        // Texture key format: room_<ROOM_TYPE>
        // Recommended size: 128×128 WebP
        const rooms: [key: string, file: string][] = [
            ['room_START', 'camp.webp'],
            ['room_ENEMY', 'enemy.webp'],
            ['room_TREASURE', 'treasure.webp'],
            ['room_TRAP', 'trap.webp'],
            ['room_REST', 'rest.webp'],
            ['room_SHRINE', 'shrine.webp'],
            ['room_MERCHANT', 'merchant.webp'],
            ['room_ELITE', 'elite.webp'],
            ['room_BOSS', 'boss.webp'],
            ['room_EMPTY', 'empty.webp'],
        ];
        for (const [key, file] of rooms) {
            this.load.image(key, `${base}sprites/rooms/${file}`);
        }

        // ── Enemy portraits (combat panel) ──────────────────────
        // Texture key format: enemy_<profile>
        // Recommended size: 128×128 WebP
        const enemies: [key: string, file: string][] = [
            ['enemy_brute', 'brute.webp'],
            ['enemy_stalker', 'stalker.webp'],
            ['enemy_mage', 'mage.webp'],
            ['enemy_boss', 'boss.webp'],
            ['enemy_bleeder', 'bleeder.webp'],
            ['enemy_disruptor', 'disruptor.webp'],
        ];
        for (const [key, file] of enemies) {
            this.load.image(key, `${base}sprites/enemies/${file}`);
        }

        // ── Relic icons (HUD slots + swap modal) ────────────────
        // Texture key format: relic_<RelicId>. Each file is 128×128
        // WebP cut from the hand-authored relic atlas. Keys must
        // match the `RelicId` strings in `src/systems/Relics.ts`;
        // `RelicSlots` / `RelicSwapModal` fall back to the 1–2 letter
        // procedural icon when a key isn't registered (e.g. unit
        // tests, or before a future relic ships art).
        const relics: string[] = [
            'worn_ring',
            'cracked_shield',
            'tattered_cloak',
            'vampire_amulet',
            'dark_chestplate',
            'knight_sword',
            'knight_armor',
            'knight_helmet',
            'four_leaf_clover',
            'cursed_amulet',
            'cursed_ring',
            'lost_staff',
            'greed_crown',
            'book_of_lies',
            'longinus_shard',
        ];
        for (const id of relics) {
            this.load.image(`relic_${id}`, `${base}sprites/relics/${id}.webp`);
        }

        // ── HUD frames + textures (Darkest Dungeon-style overlay) ──
        // Each is optional; the HUD layer renders procedural fallbacks
        // when a file is missing. See public/assets/ui/README.md for
        // canonical sizes and the hud_icons.png frame order.
        // Title logo for the boot screen. Replaces the previous
        // text-based title so the brand reads as art rather than
        // typography. Locale-neutral.
        this.load.image('boot_title_logo', `${base}assets/ui/title_logo.png`);
        this.load.image('hud_top_bar', `${base}assets/ui/top_bar.png`);
        this.load.image('hud_bottom_bar', `${base}assets/ui/bottom_bar.png`);
        this.load.image('hud_stone_wall', `${base}assets/ui/stone_wall.png`);
        this.load.spritesheet('hud_icons', `${base}assets/ui/hud_icons.png`, {
            frameWidth: 64,
            frameHeight: 64,
        });
        this.load.spritesheet('hud_room_frames', `${base}assets/ui/room_frames.png`, {
            frameWidth: 64,
            frameHeight: 64,
        });
        this.load.spritesheet('hud_room_icons', `${base}assets/ui/room_icons.png`, {
            frameWidth: 64,
            frameHeight: 64,
        });

        // Room-choice button skins (one per visual variant). Used by
        // ActionButton via Phaser nineslice; ornate corners stay sharp
        // while the middle stretches to the button's render size.
        this.load.image('btn_default', `${base}assets/ui/buttons/btn_default.png`);
        this.load.image('btn_gold', `${base}assets/ui/buttons/btn_gold.png`);
        this.load.image('btn_dark', `${base}assets/ui/buttons/btn_dark.png`);
        this.load.image('btn_silver', `${base}assets/ui/buttons/btn_silver.png`);
        this.load.image('btn_positive', `${base}assets/ui/buttons/btn_positive.png`);
        this.load.image('btn_danger', `${base}assets/ui/buttons/btn_danger.png`);

        // Stylised small panel — used by upgrade-shop cards and the
        // skill-points pilule on the escape screen. Same nine-slice
        // pipeline as the button skins; ornate corners stay crisp
        // while the dark navy centre stretches to the panel size.
        this.load.image('panel_small', `${base}assets/ui/panel_small.png`);

        // Boot-screen door spritesheet — 2 frames laid out
        // horizontally: frame 0 is the closed door, frame 1 is the
        // door swung open into the dungeon. The source is square per
        // frame; we load it as a spritesheet so a single `Sprite` can
        // flip frames on click. If the file is missing, the boot scene
        // simply renders without the door (handled by the optional-
        // asset path below).
        this.load.spritesheet(DOOR_TEXTURE_KEY, `${base}assets/ui/door.png`, {
            frameWidth: DOOR_FRAME_SIZE,
            frameHeight: DOOR_FRAME_SIZE,
        });

        // Boot-screen torch spritesheet — square-cell grid laid out
        // row-major (frame 0 top-left, advancing left→right then
        // top→bottom). Loaded as a plain image first so we can inspect
        // the source in FILE_COMPLETE and re-register it as a
        // spritesheet with the canonical cell size. Phaser derives
        // the frame count from the resulting (imageWidth × imageHeight
        // / cellSize²), so the artist can ship 4 / 9 / 16 frames
        // without changes here.
        this.load.image(BOOT_TORCH_TEXTURE_KEY, `${base}assets/ui/torch.png`);

        // Suppress noisy warnings if any of the optional UI assets are
        // missing — the HUD already falls back gracefully.
        this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
            if (
                file.key.startsWith('hud_') ||
                file.key === BOOT_TORCH_TEXTURE_KEY ||
                file.key === DOOR_TEXTURE_KEY
            ) {
                console.info(
                    `[hud] optional asset missing: ${file.key} — using procedural fallback`
                );
            }
        });

        // Once the optional sheets are decoded, switch them to NEAREST so
        // pixel art stays crisp at any display size. Panel frames keep the
        // default LINEAR — they're carved-stone bitmaps that look better
        // anti-aliased.
        this.load.on(Phaser.Loader.Events.FILE_COMPLETE, (key: string) => {
            if (key === 'hud_icons' || key === 'hud_room_frames' || key === 'hud_room_icons') {
                const tex = this.textures.get(key);
                tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
            }
            if (key === BOOT_TORCH_TEXTURE_KEY) {
                this.upgradeBootTorchToSpritesheet();
            }
        });
    }

    /**
     * The boot-torch PNG is authored as a square-cell grid (row-major,
     * left→right, top→bottom). We load it as a plain image first,
     * then here we re-register it as a spritesheet with the canonical
     * cell size from {@link BOOT_TORCH_FRAME_SIZE}; Phaser computes
     * the frame count automatically from the texture dimensions.
     */
    private upgradeBootTorchToSpritesheet() {
        if (!this.textures.exists(BOOT_TORCH_TEXTURE_KEY)) return;
        const tex = this.textures.get(BOOT_TORCH_TEXTURE_KEY);
        const src = tex.getSourceImage();
        const w = (src as HTMLImageElement).width ?? 0;
        const h = (src as HTMLImageElement).height ?? 0;
        const cell = BOOT_TORCH_FRAME_SIZE;
        if (w < cell || h < cell || w % cell !== 0 || h % cell !== 0) {
            console.info(
                `[boot] torch.png is ${w}×${h}; expected multiple of ${cell}. Skipping spritesheet upgrade.`
            );
            return;
        }
        // Phaser's TextureManager lets us replace the entry; remove
        // the plain-image variant first so addSpriteSheet binds the
        // same key cleanly.
        this.textures.remove(BOOT_TORCH_TEXTURE_KEY);
        this.textures.addSpriteSheet(BOOT_TORCH_TEXTURE_KEY, src as HTMLImageElement, {
            frameWidth: cell,
            frameHeight: cell,
        });
        this.textures.get(BOOT_TORCH_TEXTURE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }

    create() {
        // Re-use managers handed in by a previous scene (e.g. a
        // GameScene → BootScene restart) so audio state, language,
        // and the SFX buffer cache survive. Falls back to fresh
        // instances on cold boot where `init` got no payload.
        const loc = this.bootLoc ?? new Localization();
        const sfx = this.bootSfx ?? new SoundManager();
        const music = this.bootMusic ?? new MusicManager();

        // Dev-only `?seed=...&inv=...&lang=...` cheat string. Picked up
        // *before* the title-screen widgets render so the language
        // override flows into `loc.t(...)` immediately. The seed and
        // inventory bumps travel into `GameScene` via the start payload.
        // Guarded by `import.meta.env.DEV` so production builds skip the
        // parse + URL read entirely.
        const devSeed = import.meta.env.DEV ? parseDevSeedQuery(window.location.search) : null;
        if (devSeed?.lang) {
            loc.language = devSeed.lang;
        }
        // Swap to the title-screen music loop. On a fresh boot the
        // manager has nothing playing and `fadeOut(0)` is a no-op; on
        // a restart (death / escape -> back to title) the inherited
        // dungeon track is cleared so the new playlist takes effect.
        // `start()` here fades the menu loop in via the manager's
        // built-in initial fade.
        const audioBase = `${import.meta.env.BASE_URL}audio`;
        music.fadeOut(0);
        music.setPlaylist([{ url: `${audioBase}/menu_sound2.ogg` }]);
        music.start();
        // Fetch + decode the UI hover/click + title-reveal samples in
        // the background so the first map-node hover, the first
        // button click, and the title cue all fire without a fetch
        // gap. Memoised inside SoundManager, so calling it on every
        // BootScene restart is a no-op after the first run.
        void sfx.preloadUiSfx().then(() => {
            // Guard against the scene shutting down between preload
            // start and resolution (e.g. instant restart through the
            // HUD menu) — only play the cue if BootScene is still the
            // active scene.
            if (this.scene.isActive('BootScene')) sfx.playShowName(800);
        });
        this.cameras.main.setBackgroundColor('#050505');

        // Procedural carved-stone backdrop sets the dungeon mood; the
        // faint blue/violet wash on top keeps the existing colour-graded
        // feel without losing the wall texture underneath.
        createStoneBackdrop(this, 0, 0, GAME_WIDTH, GAME_HEIGHT, {
            keySuffix: 'menu',
            seed: 0x4d2a,
            brightness: 0.85,
        }).setDepth(0);
        const bg = this.add.graphics();
        bg.fillGradientStyle(0x0a0a18, 0x0a0a18, 0x151520, 0x151520, 0.55, 0.55, 0.7, 0.7);
        bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        bg.setDepth(1);

        // Darkness overlay — sits above the backdrop / title / glow
        // but below the torch sprites and chrome. Starts at high alpha
        // so the room reads as pitch-black on first frame, then tweens
        // to zero as the torches ignite to mimic the wall lighting up.
        //
        // Boot-screen timeline (anchored on the camera fade-in):
        //   t=0       title starts fading in (~3 s long, alpha-only)
        //   t=2.0 s   torches ignite + dim overlay drops + door starts fading in
        //   t=3.0 s   burning loop starts (1 s after ignition)
        //   t=3.6 s   Start button fades in
        // The title sits *above* the dim overlay (see depth choices
        // below) so its visible brightness is just its own alpha
        // curve — we deliberately do NOT compound it with the dim-
        // overlay drop, otherwise the curve plateaus in the middle
        // (title.alpha saturates ~t=2 s before the dim layer starts
        // to lift) and then jumps when the dim overlay's Quad.out
        // drop kicks in. Everything else on screen (door, embers,
        // backdrop) is still dimmed and brightens with the room.
        // The 1-second gap between ignition and the burning loop lets
        // the sampled flint / whoosh cue land cleanly before the
        // continuous loop kicks in.
        const IGNITION_DELAY = 2000;
        const ROOM_BRIGHTEN_MS = 1500;
        const AMBIENT_AFTER_IGNITE_MS = 1000;
        // Door starts fading in on the same beat as the torch
        // ignition — the room "reveals" the closed door as the
        // flames catch, instead of the door arriving as a separate
        // later cue.
        const DOOR_AFTER_IGNITE_MS = 0;
        const START_BUTTON_DELAY = IGNITION_DELAY + 1600;
        const dimOverlay = this.add
            .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.82)
            .setOrigin(0, 0)
            .setDepth(5);

        // Two animated wall torches flanking the title. They ignite
        // ~250 ms apart so the sampled `torch_ignite` cue layers as
        // two distinct flint cracks instead of doubling its own
        // volume and the two flame loops are visibly out of phase
        // from frame one; the dim overlay then drops to zero so the
        // rest of the scene resolves to its normal colour. The
        // per-torch burning loops live inside `startTorchAmbient`
        // (which picks the sampled `torch_loop` when available) and
        // are mixed at different offsets + playback rates there, so
        // the two torches keep sounding independent without any
        // extra wiring here.
        const IGNITION_STAGGER = 250;
        // Anchor torches 105 px nearer the central door than the
        // original (170 / GAME_WIDTH - 170 -> 240 -> 275) so the lit
        // pair hugs the arch tightly on the title screen. `sfxLeadMs`
        // pre-rolls the flint/whoosh cue 500 ms before the visible
        // flame catches, and the sprite/glow fade-ins are shortened
        // (1200/1500 -> 500/500) so the room reads as lighting up
        // crisply instead of slowly brightening.
        const TORCH_SFX_LEAD_MS = 500;
        const TORCH_FADE_MS = 500;
        const TORCH_GLOW_FADE_MS = 500;
        createBootTorch(this, 275, 420, {
            sfx,
            delayMs: IGNITION_DELAY,
            displayHeight: 168,
            depth: 7,
            fadeDuration: TORCH_FADE_MS,
            glowFadeDuration: TORCH_GLOW_FADE_MS,
            sfxLeadMs: TORCH_SFX_LEAD_MS,
        });
        createBootTorch(this, GAME_WIDTH - 275, 420, {
            sfx,
            delayMs: IGNITION_DELAY + IGNITION_STAGGER,
            displayHeight: 168,
            depth: 7,
            fadeDuration: TORCH_FADE_MS,
            glowFadeDuration: TORCH_GLOW_FADE_MS,
            sfxLeadMs: TORCH_SFX_LEAD_MS,
        });
        this.time.delayedCall(IGNITION_DELAY, () => {
            this.tweens.add({
                targets: dimOverlay,
                alpha: { from: 0.82, to: 0 },
                duration: ROOM_BRIGHTEN_MS,
                ease: 'Quad.out',
            });
        });
        // Burning loop deliberately trails the ignition by a full
        // second so the sampled `torch_ignite` transient lands
        // cleanly before the continuous `torch_loop` cue (or the
        // procedural crackle fallback) takes over.
        this.time.delayedCall(IGNITION_DELAY + AMBIENT_AFTER_IGNITE_MS, () => {
            sfx.startTorchAmbient(700);
        });
        // Phaser fires `shutdown` whenever the scene stops — both on
        // the normal "click Start -> GameScene" transition (we also
        // explicitly call `stopTorchAmbient` in the click handler so
        // the fade-out begins *before* the camera fade) and on
        // unexpected teardowns (e.g. hot-reload in dev). Belt-and-
        // braces silence either way.
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => sfx.stopTorchAmbient(300));

        // Ambient embers on title
        for (let i = 0; i < 12; i++) {
            const x = 100 + Math.random() * (GAME_WIDTH - 200);
            const y = 150 + Math.random() * (GAME_HEIGHT - 350);
            const sz = Math.random() * 2 + 1;
            const col = Math.random() > 0.5 ? 0xffaa33 : 0x888888;
            const dot = this.add.rectangle(x, y + 30, sz, sz, col, 0.3).setDepth(2);
            this.tweens.add({
                targets: dot,
                y: y - 80 - Math.random() * 60,
                alpha: 0,
                duration: 3000 + Math.random() * 2000,
                ease: 'Quad.out',
                repeat: -1,
                repeatDelay: Math.random() * 800,
            });
        }

        // Title art (`title_logo.png`) replaces the previous two-line
        // text title so the brand renders as authored art. Sized to
        // ~350 x 197 px (preserves the source 1672 x 941 aspect) and
        // anchored at y=100 with origin centred. Depth 6 puts the
        // logo above the dim overlay (depth 5) and below the torch
        // sprites (depth 7), so its visible brightness is a clean
        // function of its own alpha alone — critical for the smooth
        // fade-in below (see the timeline comment near the
        // dim-overlay block). Falls back to the historical text
        // title when the texture is missing so the boot screen still
        // reads on a partial asset load.
        const titleNode: Phaser.GameObjects.Image | Phaser.GameObjects.Text = this.textures.exists(
            'boot_title_logo'
        )
            ? this.add
                  .image(CENTER_X, 100, 'boot_title_logo')
                  .setOrigin(0.5)
                  // Display size scaled up another ~36 % (455 -> 620 wide)
                  // so the brand reads at roughly the full width of the
                  // door arch + flanking torches below it. Source aspect
                  // (1672 x 941) preserved -> 620 x 349.
                  .setDisplaySize(620, 349)
                  .setDepth(6)
            : this.add
                  .text(CENTER_X, 110, 'WISHBOUND:\nETERNAL DUNGEON', {
                      fontFamily: HUD_FONT,
                      fontSize: '40px',
                      color: '#f1c75d',
                      align: 'center',
                      lineSpacing: 8,
                      stroke: '#000000',
                      strokeThickness: 4,
                  })
                  .setOrigin(0.5)
                  .setDepth(6);

        // Title fade is a single 3 s Sine.inOut alpha ramp — no
        // y-motion, no compounding with the dim overlay. The 3 s
        // duration lands the title at full brightness almost exactly
        // as the dim layer finishes lifting at t=3.5 s, so the whole
        // intro reads as one continuous dawn cue rather than a fade
        // followed by a flash. The `show_name.ogg` cue is scheduled
        // alongside the preload chain above and uses its own ~0.8 s
        // fade-in so it rises with the title rather than punching in.
        this.tweens.add({
            targets: titleNode,
            alpha: { from: 0, to: 1 },
            duration: 3000,
            ease: 'Sine.inOut',
        });

        // Stone-arched door between the torches. Sits below the dim
        // overlay (depth 3) so it brightens together with the rest of
        // the room as the torches ignite. Frame 0 is the closed door;
        // a second sprite stacked on top at frame 1 ("open") stays
        // invisible during the title screen and is cross-faded with
        // the closed door in the click handler below to play the
        // "opens into the dungeon" beat before transitioning out.
        // Door y-anchor moved down 20 px (was 410) to keep its arched
        // top clear of the title baseline now that the door is ~20 %
        // taller. The closed + open frames share this anchor so the
        // cross-fade stays pixel-aligned.
        const door = this.textures.exists(DOOR_TEXTURE_KEY)
            ? this.add
                  .sprite(CENTER_X, 430, DOOR_TEXTURE_KEY, 0)
                  .setOrigin(0.5, 0.5)
                  .setDisplaySize(DOOR_DISPLAY_HEIGHT, DOOR_DISPLAY_HEIGHT)
                  .setTint(DOOR_AMBIENT_TINT)
                  .setDepth(3)
                  .setAlpha(0)
            : null;
        const doorOpenSprite = door
            ? this.add
                  .sprite(CENTER_X, 430, DOOR_TEXTURE_KEY, 1)
                  .setOrigin(0.5, 0.5)
                  .setDisplaySize(DOOR_DISPLAY_HEIGHT, DOOR_DISPLAY_HEIGHT)
                  .setTint(DOOR_AMBIENT_TINT)
                  .setDepth(3)
                  .setAlpha(0)
            : null;
        if (door) {
            this.tweens.add({
                targets: door,
                alpha: { from: 0, to: 1 },
                delay: IGNITION_DELAY + DOOR_AFTER_IGNITE_MS,
                duration: 1000,
                ease: 'Quad.out',
            });
        }

        // Start button pulled even closer to the door (was 725 -> 695).
        // The door texture has padding inside its display rectangle,
        // so anchoring the button at the bottom of the door bbox
        // (y=695) still tucks it just under the visible foundation
        // stones instead of overlapping them.
        const startUi = drawUiButton(this, CENTER_X, 695, 260, 48, loc.t('bootStart'), {
            variant: 'gold',
            fontSize: '18px',
            color: '#ffffff',
            depth: 3,
            sfx,
        });
        const startBtn = startUi.background;
        const startText = startUi.label;
        startBtn.setAlpha(0);
        startText.setAlpha(0);

        this.tweens.add({
            targets: [startBtn, startText],
            alpha: 1,
            delay: START_BUTTON_DELAY,
            duration: 500,
        });

        let starting = false;
        startBtn.on('pointerdown', () => {
            if (starting) return;
            starting = true;
            // Begin fading the torch crackle now (before the camera
            // fades) so by the time GameScene takes over it has fully
            // cleared the master gain and the dungeon ambience +
            // music start in silence.
            sfx.stopTorchAmbient(500);
            // Fade the menu music out alongside the door swing so
            // the title loop tapers off cleanly before GameScene
            // starts the dungeon track. The fade duration matches
            // the door swing so the music ends at the same beat the
            // camera fade kicks in.
            music.fadeOut(3500);

            // Door-open beat: play creak SFX, then cross-fade the
            // closed door into the open-door sprite over 4 s so the
            // door visibly "swings open" through transparency
            // instead of snapping to the open frame. Camera fade-out
            // begins toward the end of the cross-fade so the dungeon
            // transition lands the moment the open door is fully
            // resolved. Door swing and camera fade are both 1 s
            // longer than the previous values so the transition to
            // the dungeon reads as a slower, weightier moment.
            const proceed = () => this.scene.start('GameScene', { loc, sfx, music, devSeed });
            const DOOR_OPEN_MS = 4000;
            const CAMERA_FADE_MS = 1400;
            if (door && doorOpenSprite) {
                sfx.play('doorOpen');
                this.tweens.add({
                    targets: door,
                    alpha: 0,
                    duration: DOOR_OPEN_MS,
                    ease: 'Sine.inOut',
                });
                this.tweens.add({
                    targets: doorOpenSprite,
                    alpha: 1,
                    duration: DOOR_OPEN_MS,
                    ease: 'Sine.inOut',
                });
                this.time.delayedCall(DOOR_OPEN_MS - CAMERA_FADE_MS, () =>
                    this.cameras.main.fadeOut(CAMERA_FADE_MS, 0, 0, 0)
                );
                this.time.delayedCall(DOOR_OPEN_MS, proceed);
            } else {
                this.cameras.main.fadeOut(CAMERA_FADE_MS, 0, 0, 0);
                this.time.delayedCall(CAMERA_FADE_MS, proceed);
            }
        });

        this.add
            .text(GAME_WIDTH - 20, GAME_HEIGHT - 20, 'v0.3', {
                fontFamily: HUD_FONT,
                fontSize: '11px',
                color: '#68717a',
            })
            .setOrigin(1, 1);

        // Language toggle button
        const langLabel = this.add
            .text(20, GAME_HEIGHT - 20, loc.language === 'ru' ? 'RU' : 'EN', {
                fontFamily: HUD_FONT,
                fontSize: '13px',
                color: '#aaaaaa',
            })
            .setOrigin(0, 1)
            .setDepth(11)
            .setInteractive({ useHandCursor: true });

        langLabel.on('pointerdown', () => {
            const next = loc.toggle();
            langLabel.setText(next === 'ru' ? 'RU' : 'EN');
            // Title art is locale-neutral; only the Start button
            // label needs refreshing on a language toggle.
            startText.setText(loc.t('bootStart'));
        });
        langLabel.on('pointerover', () => langLabel.setColor('#ffffff'));
        langLabel.on('pointerout', () => langLabel.setColor('#aaaaaa'));

        // Scanlines overlay
        const scanGfx = this.add.graphics().setDepth(10);
        scanGfx.lineStyle(1, 0x000000, 0.012);
        for (let y = 0; y < GAME_HEIGHT; y += 6) {
            scanGfx.beginPath();
            scanGfx.moveTo(0, y);
            scanGfx.lineTo(GAME_WIDTH, y);
            scanGfx.strokePath();
        }
    }
}
