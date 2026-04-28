import * as Phaser from 'phaser';
import { Localization } from '../systems/Localization';

export class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        // Assets can be loaded here when the prototype moves beyond Phaser primitives.
    }

    create() {
        const loc = new Localization();
        this.cameras.main.setBackgroundColor('#050505');

        const bg = this.add.graphics();
        bg.fillGradientStyle(0x0a0a18, 0x0a0a18, 0x151520, 0x151520, 1, 1, 1, 1);
        bg.fillRect(0, 0, 800, 600);

        // Ambient embers on title
        for (let i = 0; i < 12; i++) {
            const x = 100 + Math.random() * 600;
            const y = 150 + Math.random() * 300;
            const sz = Math.random() * 2 + 1;
            const col = Math.random() > 0.5 ? 0xffaa33 : 0x888888;
            const dot = this.add.rectangle(x, y + 30, sz, sz, col, 0.3).setDepth(2);
            this.tweens.add({
                targets: dot, y: y - 80 - Math.random() * 60, alpha: 0,
                duration: 3000 + Math.random() * 2000, ease: 'Quad.out',
                repeat: -1, repeatDelay: Math.random() * 800,
            });
        }

        const title = this.add.text(400, 200, 'DARKEST\nDESCENT', {
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
            y: { from: 220, to: 200 },
            duration: 1200,
            ease: 'Quad.out',
        });

        const tagline = this.add.text(400, 300, loc.t('bootTagline'), {
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

        const startBtn = this.add.rectangle(400, 400, 240, 46, 0x1c1c1c)
            .setStrokeStyle(1, 0x5a5a5a).setInteractive({ useHandCursor: true }).setAlpha(0).setDepth(3);
        const startText = this.add.text(400, 400, loc.t('bootStart'), {
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

        startBtn.on('pointerover', () => startBtn.setStrokeStyle(2, 0xffffff));
        startBtn.on('pointerout', () => startBtn.setStrokeStyle(1, 0x5a5a5a));
        startBtn.on('pointerdown', () => {
            this.cameras.main.fadeOut(400, 0, 0, 0);
            this.time.delayedCall(400, () => this.scene.start('GameScene'));
        });

        this.add.text(780, 580, 'v0.3', {
            fontFamily: 'Lucida Console, Consolas, monospace',
            fontSize: '11px',
            color: '#68717a',
        }).setOrigin(1, 1);

        // Scanlines overlay
        const scanGfx = this.add.graphics().setDepth(10);
        scanGfx.lineStyle(1, 0x000000, 0.012);
        for (let y = 0; y < 600; y += 6) {
            scanGfx.beginPath(); scanGfx.moveTo(0, y); scanGfx.lineTo(800, y); scanGfx.strokePath();
        }
    }
}
