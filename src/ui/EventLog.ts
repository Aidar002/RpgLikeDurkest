import * as Phaser from 'phaser';

interface LogEntry {
    container: Phaser.GameObjects.Container;
    background: Phaser.GameObjects.Rectangle;
    accent: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Text;
    text: Phaser.GameObjects.Text;
}

type LogTone = 'danger' | 'success' | 'reward' | 'mystic' | 'info' | 'neutral';

const TONE_META: Record<LogTone, { icon: string; fill: number; stroke: number }> = {
    danger: { icon: '!', fill: 0x201213, stroke: 0x8a3434 },
    success: { icon: '+', fill: 0x112016, stroke: 0x3a8a52 },
    reward: { icon: '*', fill: 0x211d10, stroke: 0x9b7a22 },
    mystic: { icon: '~', fill: 0x171426, stroke: 0x6e55a4 },
    info: { icon: 'i', fill: 0x111a24, stroke: 0x4f7fb5 },
    neutral: { icon: '-', fill: 0x15171a, stroke: 0x3b444e },
};

export class EventLog {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private entries: LogEntry[] = [];
    private maxMessages = 7;
    private width: number;
    private height: number;
    private contentTop = 50;
    private contentPadding = 12;

    constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, title: string = 'EVENT LOG') {
        this.scene = scene;
        this.width = width;
        this.height = height;
        this.container = scene.add.container(x, y);

        const background = scene.add.rectangle(0, 0, width, height, 0x0f1216).setOrigin(0);
        background.setStrokeStyle(2, 0x34404a);

        const header = scene.add.text(14, 12, title, {
            fontFamily: 'Trebuchet MS, Arial, sans-serif',
            fontSize: '13px',
            color: '#d5e2ee',
        });

        const subHeader = scene.add.text(width - 14, 14, 'RECENT', {
            fontFamily: 'Trebuchet MS, Arial, sans-serif',
            fontSize: '10px',
            color: '#657483',
        }).setOrigin(1, 0);

        const divider = scene.add.rectangle(14, 38, width - 28, 1, 0x2c3742).setOrigin(0, 0.5);

        this.container.add([background, header, subHeader, divider]);
    }

    get view(): Phaser.GameObjects.Container {
        return this.container;
    }

    addMessage(text: string, color: string = '#ffffff') {
        const cleanText = text.trim();
        if (!cleanText) {
            return;
        }

        const tone = this.toneFromColor(color);
        const meta = TONE_META[tone];
        const entryWidth = this.width - this.contentPadding * 2;
        const textWidth = entryWidth - 54;

        const entryContainer = this.scene.add.container(this.contentPadding, this.height - 16);
        const body = this.scene.add.text(42, 9, cleanText, {
            fontFamily: 'Trebuchet MS, Arial, sans-serif',
            fontSize: '13px',
            color,
            wordWrap: { width: textWidth },
            lineSpacing: 4,
        });
        const entryHeight = Math.max(38, body.height + 18);
        const background = this.scene.add.rectangle(0, 0, entryWidth, entryHeight, meta.fill, 0.92).setOrigin(0);
        background.setStrokeStyle(1, meta.stroke, 0.7);
        const accent = this.scene.add.rectangle(0, 0, 4, entryHeight, meta.stroke).setOrigin(0);
        const iconBg = this.scene.add.circle(22, 19, 10, 0x0c0f13).setStrokeStyle(1, meta.stroke, 0.9);
        const icon = this.scene.add.text(22, 19, meta.icon, {
            fontFamily: 'Trebuchet MS, Arial, sans-serif',
            fontSize: '12px',
            color: '#d9e6f2',
        }).setOrigin(0.5);

        entryContainer.add([background, accent, iconBg, icon, body]);
        entryContainer.setAlpha(0);
        this.container.add(entryContainer);

        this.entries.push({
            container: entryContainer,
            background,
            accent,
            icon,
            text: body,
        });

        this.scene.tweens.add({
            targets: entryContainer,
            alpha: 1,
            duration: 160,
            ease: 'Quad.out',
        });

        this.recalculatePositions();
    }

    addDivider(label: string) {
        this.addMessage(label, '#657483');
    }

    clear() {
        this.entries.forEach((entry) => entry.container.destroy());
        this.entries = [];
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    private recalculatePositions() {
        while (this.entries.length > this.maxMessages) {
            const oldest = this.entries.shift();
            oldest?.container.destroy();
        }

        let currentY = this.height - 16;
        for (let index = this.entries.length - 1; index >= 0; index--) {
            const entry = this.entries[index];
            const targetY = currentY - entry.background.height;
            const age = this.entries.length - 1 - index;
            const alpha = Math.max(0.38, 1 - age * 0.11);

            if (targetY < this.contentTop && index > 0) {
                const removed = this.entries.shift();
                removed?.container.destroy();
                this.recalculatePositions();
                return;
            }

            this.scene.tweens.add({
                targets: entry.container,
                y: targetY,
                alpha,
                duration: 180,
                ease: 'Quad.out',
            });

            entry.text.setColor(age === 0 ? entry.text.style.color as string : this.dimColor(entry.text.style.color as string, age));
            currentY = targetY - 8;
        }
    }

    private toneFromColor(color: string): LogTone {
        const numeric = Number.parseInt(color.replace('#', ''), 16);
        const r = (numeric >> 16) & 255;
        const g = (numeric >> 8) & 255;
        const b = numeric & 255;

        if (r > 210 && g < 150 && b < 150) return 'danger';
        if (g > 170 && r < 180) return 'success';
        if (r > 210 && g > 170 && b < 150) return 'reward';
        if (b > 170 && r > 120) return 'mystic';
        if (b > 150 || g > 150) return 'info';
        return 'neutral';
    }

    private dimColor(color: string, age: number): string {
        const numeric = Number.parseInt(color.replace('#', ''), 16);
        const mix = Math.min(0.55, age * 0.12);
        const r = Math.round(((numeric >> 16) & 255) * (1 - mix) + 120 * mix);
        const g = Math.round(((numeric >> 8) & 255) * (1 - mix) + 128 * mix);
        const b = Math.round((numeric & 255) * (1 - mix) + 136 * mix);
        return `#${this.hex(r)}${this.hex(g)}${this.hex(b)}`;
    }

    private hex(value: number): string {
        return Phaser.Math.Clamp(value, 0, 255).toString(16).padStart(2, '0');
    }
}
