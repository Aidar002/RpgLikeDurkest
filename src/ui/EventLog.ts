import * as Phaser from 'phaser';

interface LogEntry {
    container: Phaser.GameObjects.Container;
    rail: Phaser.GameObjects.Rectangle;
    marker: Phaser.GameObjects.Text;
    text: Phaser.GameObjects.Text;
    rule: Phaser.GameObjects.Rectangle;
    baseColor: string;
}

type LogTone = 'danger' | 'success' | 'reward' | 'mystic' | 'info' | 'neutral';

const LOG_FONT = 'Lucida Console, Consolas, monospace';

const TONE_META: Record<LogTone, { marker: string; rail: number; text: string }> = {
    danger: { marker: '!', rail: 0x9a3535, text: '#ff9a8f' },
    success: { marker: '+', rail: 0x2f8a4d, text: '#82e89b' },
    reward: { marker: '$', rail: 0xa58128, text: '#f7d46b' },
    mystic: { marker: '~', rail: 0x7556ad, text: '#c8a8ff' },
    info: { marker: '>', rail: 0x4f7fb5, text: '#a8cdfa' },
    neutral: { marker: '-', rail: 0x55606b, text: '#d0d3d6' },
};

export class EventLog {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private entries: LogEntry[] = [];
    private maxMessages = 9;
    private width: number;
    private height: number;
    private contentTop = 48;
    private contentPadding = 16;

    constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, title: string = 'EVENT LOG') {
        this.scene = scene;
        this.width = width;
        this.height = height;
        this.container = scene.add.container(x, y);

        const background = scene.add.rectangle(0, 0, width, height, 0x0a0b0d, 0.82).setOrigin(0);
        background.setStrokeStyle(2, 0x2b343d);

        const inner = scene.add.rectangle(12, 44, width - 24, height - 58, 0x050607, 0.26).setOrigin(0);
        inner.setStrokeStyle(1, 0x171d23);

        const header = scene.add.text(16, 12, title.toUpperCase(), {
            fontFamily: LOG_FONT,
            fontSize: '13px',
            color: '#c9d3dc',
            stroke: '#020304',
            strokeThickness: 2,
        });

        const divider = scene.add.rectangle(16, 36, width - 32, 1, 0x38424d).setOrigin(0, 0.5);

        this.container.add([background, inner, header, divider]);
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
        const entryContainer = this.scene.add.container(this.contentPadding, this.height - 16);
        const baseColor = this.normalizeColor(color, meta.text);

        const marker = this.scene.add.text(0, 1, meta.marker, {
            fontFamily: LOG_FONT,
            fontSize: '14px',
            color: meta.text,
            stroke: '#020304',
            strokeThickness: 2,
        });

        const body = this.scene.add.text(22, 0, cleanText, {
            fontFamily: LOG_FONT,
            fontSize: '13px',
            color: baseColor,
            wordWrap: { width: entryWidth - 26 },
            lineSpacing: 5,
            stroke: '#020304',
            strokeThickness: 2,
        });

        const entryHeight = Math.max(20, body.height + 2);
        const rail = this.scene.add.rectangle(-8, 2, 3, entryHeight, meta.rail, 0.9).setOrigin(0);
        const rule = this.scene.add.rectangle(22, entryHeight + 5, entryWidth - 26, 1, 0x1c242b, 0.55).setOrigin(0);

        entryContainer.add([rail, marker, body, rule]);
        entryContainer.setAlpha(0);
        this.container.add(entryContainer);

        this.entries.push({
            container: entryContainer,
            rail,
            marker,
            text: body,
            rule,
            baseColor,
        });

        this.scene.tweens.add({
            targets: entryContainer,
            alpha: 1,
            duration: 120,
            ease: 'Stepped',
        });

        this.recalculatePositions();
    }

    addDivider(label: string) {
        this.addMessage(`[ ${label} ]`, '#7f8994');
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

        let currentY = this.height - 20;
        for (let index = this.entries.length - 1; index >= 0; index--) {
            const entry = this.entries[index];
            const entryHeight = Math.max(entry.text.height, entry.rail.height) + 8;
            const targetY = currentY - entryHeight;
            const age = this.entries.length - 1 - index;
            const alpha = Math.max(0.42, 1 - age * 0.10);

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
                duration: 110,
                ease: 'Stepped',
            });

            entry.text.setColor(age === 0 ? entry.baseColor : this.dimColor(entry.baseColor, age));
            entry.marker.setAlpha(age === 0 ? 1 : 0.65);
            entry.rail.setAlpha(age === 0 ? 0.95 : 0.45);
            entry.rule.setAlpha(age === 0 ? 0.65 : 0.3);
            currentY = targetY - 5;
        }
    }

    private toneFromColor(color: string): LogTone {
        const numeric = Number.parseInt(color.replace('#', ''), 16);
        const r = (numeric >> 16) & 255;
        const g = (numeric >> 8) & 255;
        const b = numeric & 255;

        if (r > 210 && g < 150 && b < 150) return 'danger';
        if (g > 170 && r < 190) return 'success';
        if (r > 210 && g > 165 && b < 150) return 'reward';
        if (b > 170 && r > 110) return 'mystic';
        if (b > 145 || g > 150) return 'info';
        return 'neutral';
    }

    private normalizeColor(color: string, fallback: string): string {
        return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
    }

    private dimColor(color: string, age: number): string {
        const numeric = Number.parseInt(color.replace('#', ''), 16);
        const mix = Math.min(0.58, age * 0.13);
        const r = Math.round(((numeric >> 16) & 255) * (1 - mix) + 95 * mix);
        const g = Math.round(((numeric >> 8) & 255) * (1 - mix) + 104 * mix);
        const b = Math.round((numeric & 255) * (1 - mix) + 112 * mix);
        return `#${this.hex(r)}${this.hex(g)}${this.hex(b)}`;
    }

    private hex(value: number): string {
        return Phaser.Math.Clamp(value, 0, 255).toString(16).padStart(2, '0');
    }
}
