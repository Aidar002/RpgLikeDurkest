import * as Phaser from 'phaser';
import { Localization } from '../systems/Localization';
import { SoundManager } from '../systems/SoundManager';
import { CENTER_X, GAME_HEIGHT, GAME_WIDTH } from '../ui/Layout';

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

        // Suppress noisy warnings if any of the optional UI assets are
        // missing — the HUD already falls back gracefully.
        this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
            if (file.key.startsWith('hud_')) {
                console.info(`[hud] optional asset missing: ${file.key} — using procedural fallback`);
            }
        });

        // Once the optional sheets are decoded, switch them to NEAREST so
        // pixel art stays crisp at any display size. Panel frames keep the
        // default LINEAR — they're carved-stone bitmaps that look better
        // anti-aliased.
        this.load.on(Phaser.Loader.Events.FILE_COMPLETE, (key: string) => {
            if (
                key === 'hud_icons' ||
                key === 'hud_room_frames' ||
                key === 'hud_room_icons'
            ) {
                const tex = this.textures.get(key);
                tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
            }
        });
    }

    create() {
        const loc = new Localization();
        const sfx = new SoundManager();
        this.cameras.main.setBackgroundColor('#050505');
        const titleText = () => (loc.language === 'ru' ? 'НИЖНИЙ\nСПУСК' : 'DARKEST\nDESCENT');

        const bg = this.add.graphics();
        bg.fillGradientStyle(0x0a0a18, 0x0a0a18, 0x151520, 0x151520, 1, 1, 1, 1);
        bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

        // Ambient embers on title
        for (let i = 0; i < 12; i++) {
            const x = 100 + Math.random() * (GAME_WIDTH - 200);
            const y = 150 + Math.random() * (GAME_HEIGHT - 350);
            const sz = Math.random() * 2 + 1;
            const col = Math.random() > 0.5 ? 0xffaa33 : 0x888888;
            const dot = this.add.rectangle(x, y + 30, sz, sz, col, 0.3).setDepth(2);
            this.tweens.add({
                targets: dot, y: y - 80 - Math.random() * 60, alpha: 0,
                duration: 3000 + Math.random() * 2000, ease: 'Quad.out',
                repeat: -1, repeatDelay: Math.random() * 800,
            });
        }

        const title = this.add.text(CENTER_X, 260, titleText(), {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '48px',
            color: '#f1c75d',
            align: 'center',
            lineSpacing: 8,
            stroke: '#000000',
            strokeThickness: 4,
        }).setOrigin(0.5).setDepth(3);

        this.tweens.add({
            targets: title,
            alpha: { from: 0, to: 1 },
            y: { from: 280, to: 260 },
            duration: 1200,
            ease: 'Quad.out',
        });

        const tagline = this.add.text(CENTER_X, 380, loc.t('bootTagline'), {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '14px',
            color: '#c8cdd2',
            stroke: '#030507',
            strokeThickness: 2,
        }).setOrigin(0.5).setAlpha(0).setDepth(3);

        this.tweens.add({
            targets: tagline,
            alpha: 1,
            delay: 800,
            duration: 600,
        });

        const startBtn = this.add.rectangle(CENTER_X, 480, 260, 48, 0x1c1c1c)
            .setStrokeStyle(1, 0x5a5a5a).setInteractive({ useHandCursor: true }).setAlpha(0).setDepth(3);
        const startText = this.add.text(CENTER_X, 480, loc.t('bootStart'), {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '18px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2,
        }).setOrigin(0.5).setAlpha(0).setDepth(4);

        this.tweens.add({
            targets: [startBtn, startText],
            alpha: 1,
            delay: 1300,
            duration: 500,
        });

        startBtn.on('pointerover', () => {
            startBtn.setStrokeStyle(2, 0xffffff);
            sfx.play('buttonHover');
        });
        startBtn.on('pointerout', () => startBtn.setStrokeStyle(1, 0x5a5a5a));
        startBtn.on('pointerdown', () => {
            sfx.play('buttonClick');
            this.cameras.main.fadeOut(400, 0, 0, 0);
            this.time.delayedCall(400, () => this.scene.start('GameScene', { loc, sfx }));
        });

        this.add.text(GAME_WIDTH - 20, GAME_HEIGHT - 20, 'v0.3', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '11px',
            color: '#68717a',
        }).setOrigin(1, 1);

        // Language toggle button
        const langLabel = this.add.text(20, GAME_HEIGHT - 20, loc.language === 'ru' ? 'RU' : 'EN', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '13px',
            color: '#aaaaaa',
        }).setOrigin(0, 1).setDepth(11).setInteractive({ useHandCursor: true });

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
            scanGfx.beginPath(); scanGfx.moveTo(0, y); scanGfx.lineTo(GAME_WIDTH, y); scanGfx.strokePath();
        }
    }
}
