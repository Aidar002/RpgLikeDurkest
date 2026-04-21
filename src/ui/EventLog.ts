import * as Phaser from 'phaser';

export class EventLog {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container;
    private messages: Phaser.GameObjects.Text[] = [];
    private maxMessages = 15;
    private yStart = 400; // Start at the bottom of the log area

    constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number) {
        this.scene = scene;
        this.container = scene.add.container(x, y);

        // Background
        const bg = scene.add.rectangle(0, 0, width, height, 0x111111).setOrigin(0);
        bg.setStrokeStyle(2, 0x444444);
        this.container.add(bg);
    }

    public addMessage(text: string, color: string = '#ffffff') {
        const normalizedText = text.replace(/^\n+/, '');
        const msg = this.scene.add.text(10, this.yStart, normalizedText, {
            fontFamily: 'Courier New',
            fontSize: '14px',
            color: color,
            wordWrap: { width: 380 } // wrap at width-20
        });

        this.messages.push(msg);
        this.container.add(msg);

        this.recalculatePositions();
    }

    private recalculatePositions() {
        if (this.messages.length > this.maxMessages) {
            const removed = this.messages.shift();
            if (removed) {
                removed.destroy();
            }
        }

        let currentY = this.yStart;
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const msg = this.messages[i];
            msg.setY(currentY);
            currentY -= msg.height + 5; // Move up for older messages
        }
    }
    
    public setVisible(visible: boolean) {
        this.container.setVisible(visible);
    }
}
