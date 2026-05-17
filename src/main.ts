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
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, GameScene],
};

/**
 * Eagerly load the two self-hosted web fonts referenced by the canvas
 * Text objects throughout the game (`HUD_FONT` = JetBrains Mono,
 * `BODY_FONT` = EB Garamond — declared in `src/ui/HudTheme.ts`).
 *
 * Browsers normally lazy-load `@font-face` files only when a glyph
 * actually paints, but Phaser draws Text into an offscreen canvas and
 * the browser does NOT consider that a font use. Without forcing the
 * load, the first frames of BootScene fall back to the system
 * monospace and then snap to JetBrains Mono mid-fade-in.
 *
 * We use `FontFace.load()` for one regular weight of each family
 * (the bold cuts are pulled lazily — `fontStyle: 'bold'` is rare and
 * the swap there is barely noticeable). After both fonts resolve we
 * also wait on `document.fonts.ready` so any CSS-declared font in
 * `style.css` finishes registering before Phaser boots.
 */
async function preloadFonts(): Promise<void> {
    const base = import.meta.env.BASE_URL;
    const families: Array<{ family: string; url: string }> = [
        { family: 'JetBrains Mono', url: `${base}fonts/JetBrainsMono-Regular.woff2` },
        { family: 'EB Garamond', url: `${base}fonts/EBGaramond-Regular.woff2` },
    ];
    if (typeof FontFace === 'undefined' || !document.fonts) {
        // Very old engines without the Font Loading API; fall through and
        // let the CSS fallback stack take over.
        return;
    }
    await Promise.all(
        families.map(async ({ family, url }) => {
            const face = new FontFace(family, `url("${url}") format("woff2")`);
            try {
                await face.load();
                document.fonts.add(face);
            } catch (err) {
                // Don't block the game if a font file is missing in dev;
                // BootScene will simply render with the next item in the
                // fallback stack (`Lucida Console` / `Times New Roman`).
                console.warn(`[fonts] failed to load ${family}:`, err);
            }
        })
    );
    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
        await document.fonts.ready;
    }
}

let game: Phaser.Game | undefined;
preloadFonts().finally(() => {
    game = new Phaser.Game(config);
    if (import.meta.env.DEV) {
        // Dev-only escape hatch so devs/AI can inspect Phaser state from
        // the browser console (`window.__game.scene.scenes[0].textures…`).
        // Stripped from production builds by Vite's `import.meta.env.DEV`
        // tree-shake.
        (window as unknown as { __game?: Phaser.Game }).__game = game;
    }
});
