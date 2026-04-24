import * as Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        // Загрузка ассетов (иконки для карты, шрифты)
        // Пока используем графические примитивы Phaser
    }

    create() {
        this.scene.start('GameScene');
    }
}
