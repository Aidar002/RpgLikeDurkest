import * as Phaser from 'phaser';

export class EventLog {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private messages: Phaser.GameObjects.Text[] = [];
    private maxMessages = 10;
    private yStart = 430;

    constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, title: string = 'EVENT LOG') {
        this.scene = scene;
        this.container = scene.add.container(x, y);

        const background = scene.add.rectangle(0, 0, width, height, 0x101010).setOrigin(0);
        background.setStrokeStyle(2, 0x353535);

        const header = scene.add.text(12, 12, title, {
            fontFamily: 'Courier New',
            fontSize: '14px',
            color: '#b7c7d9',
        });

        const divider = scene.add.rectangle(12, 36, width - 24, 1, 0x2a2a2a).setOrigin(0, 0.5);

        this.container.add([background, header, divider]);
    }

    get view(): Phaser.GameObjects.Container {
        return this.container;
    }

    addMessage(text: string, color: string = '#ffffff') {
        const message = this.scene.add.text(12, this.yStart, text.trim(), {
            fontFamily: 'Courier New',
            fontSize: '13px',
            color,
            wordWrap: { width: 384 },
            lineSpacing: 3,
        });

        message.setAlpha(0);
        this.scene.tweens.add({
            targets: message,
            alpha: 1,
            duration: 180,
            ease: 'Quad.out',
        });

        this.messages.push(message);
        this.container.add(message);
        this.recalculatePositions();
    }

    addDivider(label: string) {
        this.addMessage(`--- ${label} ---`, '#666666');
    }

    clear() {
        this.messages.forEach((message) => message.destroy());
        this.messages = [];
    }

    setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }

    private recalculatePositions() {
        while (this.messages.length > this.maxMessages) {
            const oldest = this.messages.shift();
            oldest?.destroy();
        }

        let currentY = this.yStart;
        for (let index = this.messages.length - 1; index >= 0; index--) {
            const message = this.messages[index];
            message.setY(currentY);
            currentY -= message.height + 6;
        }
    }
}
