import './style.css';
import * as Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { getSavedLanguage } from './systems/Localization';
import { GAME_WIDTH, GAME_HEIGHT } from './ui/Layout';

// Sync the document language with the user's saved preference so screen
// readers and Lighthouse see the right value before any scene runs.
document.documentElement.lang = getSavedLanguage();

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: 'game-container',
    backgroundColor: '#0d0d0d',
    pixelArt: true,
    antialias: false,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [BootScene, GameScene]
};

new Phaser.Game(config);
