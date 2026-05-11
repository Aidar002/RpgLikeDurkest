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
const DOOR_DISPLAY_HEIGHT = 442;

/** Tint multiplier applied to the door so the lit stone arch + wood
 *  read as part of the dim torch-lit room behind it rather than
 *  floating brighter than its surroundings. Phaser's tint multiplies
 *  every channel by `tint/0xff`; 0x707078 ≈ 44 % brightness with a
 *  faint cool cast that matches the surrounding stonework. */
const DOOR_AMBIENT_TINT = 0x707078;

export class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
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

        // ── HUD frames + textures (Darkest Dungeon-style overlay) ──
        // Each is optional; the HUD layer renders procedural fallbacks
        // when a file is missing. See public/assets/ui/README.md for
        // canonical sizes and the hud_icons.png frame order.
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
        const loc = new Localization();
        const sfx = new SoundManager();
        const music = new MusicManager();

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
        const audioBase = `${import.meta.env.BASE_URL}audio`;
        music.setPlaylist([{ url: `${audioBase}/dungeon_sound_2.mp3` }]);
        music.start();
        this.cameras.main.setBackgroundColor('#050505');
        const titleText = () => (loc.language === 'ru' ? 'НИЖНИЙ\nСПУСК' : 'DARKEST\nDESCENT');

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
        const IGNITION_DELAY = 800;
        const ROOM_BRIGHTEN_MS = 1500;
        const dimOverlay = this.add
            .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.82)
            .setOrigin(0, 0)
            .setDepth(5);

        // Two animated wall torches flanking the title. Both ignite
        // simultaneously after `IGNITION_DELAY` with a slow fade and
        // matching procedural fwoom; the dim overlay then drops to
        // zero so the rest of the scene resolves to its normal colour.
        createBootTorch(this, 170, 420, {
            sfx,
            delayMs: IGNITION_DELAY,
            displayHeight: 168,
            depth: 7,
            fadeDuration: 1200,
            glowFadeDuration: 1500,
        });
        createBootTorch(this, GAME_WIDTH - 170, 420, {
            sfx,
            delayMs: IGNITION_DELAY,
            displayHeight: 168,
            depth: 7,
            fadeDuration: 1200,
            glowFadeDuration: 1500,
        });
        this.time.delayedCall(IGNITION_DELAY, () => {
            this.tweens.add({
                targets: dimOverlay,
                alpha: { from: 0.82, to: 0 },
                duration: ROOM_BRIGHTEN_MS,
                ease: 'Quad.out',
            });
        });

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

        const title = this.add
            .text(CENTER_X, 110, titleText(), {
                fontFamily: HUD_FONT,
                fontSize: '48px',
                color: '#f1c75d',
                align: 'center',
                lineSpacing: 8,
                stroke: '#000000',
                strokeThickness: 4,
            })
            .setOrigin(0.5)
            .setDepth(3);

        this.tweens.add({
            targets: title,
            alpha: { from: 0, to: 1 },
            y: { from: 130, to: 110 },
            duration: 1200,
            ease: 'Quad.out',
        });

        // Tagline anchor moved up (was 215) so the +30 % door below
        // can extend its arch upward without colliding with the
        // single-line tagline.
        const tagline = this.add
            .text(CENTER_X, 175, loc.t('bootTagline'), {
                fontFamily: HUD_FONT,
                fontSize: '14px',
                color: '#c8cdd2',
                stroke: '#030507',
                strokeThickness: 2,
            })
            .setOrigin(0.5)
            .setAlpha(0)
            .setDepth(3);

        // Stone-arched door between the torches. Sits below the dim
        // overlay (depth 3) so it brightens together with the rest of
        // the room as the torches ignite. Frame 0 is the closed door;
        // we flip to frame 1 in the click handler below to play the
        // "opens into the dungeon" beat before transitioning out.
        const door = this.textures.exists(DOOR_TEXTURE_KEY)
            ? this.add
                  .sprite(CENTER_X, 410, DOOR_TEXTURE_KEY, 0)
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
                delay: 600,
                duration: 1000,
                ease: 'Quad.out',
            });
        }

        this.tweens.add({
            targets: tagline,
            alpha: 1,
            delay: 800,
            duration: 600,
        });

        // Start button anchor moved down (was 660) so the taller
        // door above has clearance to its lower foundation stones
        // without overlapping the gold button frame.
        const startUi = drawUiButton(this, CENTER_X, 705, 260, 48, loc.t('bootStart'), {
            variant: 'gold',
            fontSize: '18px',
            color: '#ffffff',
            depth: 3,
        });
        const startBtn = startUi.background;
        const startText = startUi.label;
        startBtn.setAlpha(0);
        startText.setAlpha(0);

        this.tweens.add({
            targets: [startBtn, startText],
            alpha: 1,
            delay: 1300,
            duration: 500,
        });

        let starting = false;
        startBtn.on('pointerover', () => sfx.play('buttonHover'));
        startBtn.on('pointerdown', () => {
            if (starting) return;
            starting = true;
            sfx.play('buttonClick');
            // The first reliable user gesture — kick music off here so audio
            // playback starts even on browsers with strict autoplay policy.
            music.kick();

            // Door-open beat: play creak SFX, swing the door to frame 1
            // partway through the creak so visual and audio land together,
            // then fade to GameScene once the thud has settled.
            const proceed = () => this.scene.start('GameScene', { loc, sfx, music, devSeed });
            if (door) {
                sfx.play('doorOpen');
                this.time.delayedCall(300, () => door.setFrame(1));
                this.time.delayedCall(900, () => this.cameras.main.fadeOut(400, 0, 0, 0));
                this.time.delayedCall(1300, proceed);
            } else {
                this.cameras.main.fadeOut(400, 0, 0, 0);
                this.time.delayedCall(400, proceed);
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
            title.setText(titleText());
            tagline.setText(loc.t('bootTagline'));
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
