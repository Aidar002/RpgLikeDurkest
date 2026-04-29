/**
 * Procedural pixel-art sprite generator.
 * Draws sprites via OffscreenCanvas / Canvas 2D and registers them
 * as Phaser textures so they can be used with `this.add.image(...)`.
 */

import type * as Phaser from 'phaser';
import type { EnemyProfile } from '../data/GameConfig';

// ─── palette ───────────────────────────────────────────────────
const P = {
    transparent: 'rgba(0,0,0,0)',
    black: '#000000',
    outline: '#1a1a2e',
    shadow: '#2a2a3a',
    // enemy palettes
    bruteBody: '#7a6655',
    bruteDark: '#5a4a3a',
    bruteLight: '#9a8877',
    stalkerBody: '#4a6050',
    stalkerDark: '#354535',
    stalkerLight: '#6a8a6a',
    stalkerClaw: '#c0c0a0',
    mageBody: '#5a4a78',
    mageDark: '#3a2a58',
    mageLight: '#8070a0',
    mageGlow: '#aaccff',
    bossBody: '#6a2040',
    bossDark: '#4a1030',
    bossLight: '#9a4060',
    bossCrown: '#ffd040',
    bleederBody: '#6a4040',
    bleederDark: '#4a2828',
    bleederLight: '#8a5555',
    bleederDrip: '#cc3333',
    disruptorBody: '#504070',
    disruptorDark: '#352850',
    disruptorLight: '#7060a0',
    disruptorGlow: '#cc88ff',
    // room icons
    gold: '#f0c040',
    goldDark: '#b08020',
    fire: '#ff8833',
    fireTip: '#ffdd55',
    fireBase: '#993311',
    chest: '#8a6a30',
    chestDark: '#5a4420',
    chestLight: '#c0a050',
    trap: '#9050b0',
    trapSpike: '#c080e0',
    shrine: '#6688cc',
    shrineDark: '#445588',
    merchant: '#4090a0',
    merchantDark: '#286070',
    skull: '#ccbbaa',
    skullDark: '#998877',
    bone: '#e0d8c8',
    // resources
    potionGreen: '#44cc66',
    potionDark: '#228844',
    lanternYellow: '#ffcc44',
    lanternDark: '#cc9922',
    shardBlue: '#6699ff',
    shardDark: '#3366cc',
    fist: '#cc9977',
    fistDark: '#996644',
    // generic
    white: '#ffffff',
    red: '#cc3333',
};

type Grid = string[][];

function createGrid(w: number, h: number): Grid {
    return Array.from({ length: h }, () => Array(w).fill(P.transparent));
}

function setPixel(g: Grid, x: number, y: number, c: string) {
    if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = c;
}

function fillRect(g: Grid, x: number, y: number, w: number, h: number, c: string) {
    for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++)
            setPixel(g, x + dx, y + dy, c);
}

function mirrorH(g: Grid): Grid {
    const halfW = Math.floor(g[0].length / 2);
    return g.map(row => {
        const mirrored = [...row];
        for (let x = 0; x < halfW; x++) {
            mirrored[row.length - 1 - x] = mirrored[x];
        }
        return mirrored;
    });
}

function gridToCanvas(g: Grid, scale: number): HTMLCanvasElement {
    const h = g.length;
    const w = g[0].length;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (g[y][x] !== P.transparent) {
                ctx.fillStyle = g[y][x];
                ctx.fillRect(x * scale, y * scale, scale, scale);
            }
        }
    }
    return canvas;
}

// ─── enemy portrait generators (16x16, rendered at 3x = 48px) ──

function drawBrute(): Grid {
    const g = createGrid(16, 16);
    // head
    fillRect(g, 5, 1, 6, 4, P.bruteBody);
    fillRect(g, 6, 2, 4, 2, P.bruteLight);
    setPixel(g, 6, 2, P.white); setPixel(g, 9, 2, P.white);
    setPixel(g, 7, 3, P.bruteDark); setPixel(g, 8, 3, P.bruteDark);
    // neck
    fillRect(g, 6, 5, 4, 1, P.bruteDark);
    // body (wide)
    fillRect(g, 3, 6, 10, 5, P.bruteBody);
    fillRect(g, 4, 7, 8, 3, P.bruteLight);
    // arms
    fillRect(g, 1, 6, 2, 5, P.bruteDark);
    fillRect(g, 13, 6, 2, 5, P.bruteDark);
    // belt
    fillRect(g, 4, 11, 8, 1, P.goldDark);
    // legs
    fillRect(g, 4, 12, 3, 3, P.bruteDark);
    fillRect(g, 9, 12, 3, 3, P.bruteDark);
    // feet
    fillRect(g, 3, 15, 4, 1, P.outline);
    fillRect(g, 9, 15, 4, 1, P.outline);
    return mirrorH(g);
}

function drawStalker(): Grid {
    const g = createGrid(16, 16);
    // head (small, hunched)
    fillRect(g, 6, 2, 4, 3, P.stalkerBody);
    setPixel(g, 7, 3, P.stalkerLight); setPixel(g, 8, 3, P.stalkerLight);
    setPixel(g, 7, 3, P.red); setPixel(g, 8, 3, P.red);
    // ears
    setPixel(g, 5, 1, P.stalkerBody); setPixel(g, 10, 1, P.stalkerBody);
    // body (lean, hunched forward)
    fillRect(g, 5, 5, 6, 4, P.stalkerBody);
    fillRect(g, 6, 6, 4, 2, P.stalkerLight);
    // tail
    setPixel(g, 11, 8, P.stalkerDark); setPixel(g, 12, 7, P.stalkerDark);
    setPixel(g, 13, 6, P.stalkerDark);
    // arms with claws
    fillRect(g, 3, 5, 2, 3, P.stalkerDark);
    fillRect(g, 11, 5, 2, 3, P.stalkerDark);
    setPixel(g, 2, 7, P.stalkerClaw); setPixel(g, 3, 8, P.stalkerClaw);
    setPixel(g, 12, 7, P.stalkerClaw); setPixel(g, 13, 8, P.stalkerClaw);
    // legs (digitigrade)
    fillRect(g, 5, 9, 2, 4, P.stalkerDark);
    fillRect(g, 9, 9, 2, 4, P.stalkerDark);
    setPixel(g, 4, 13, P.stalkerClaw); setPixel(g, 5, 13, P.stalkerClaw);
    setPixel(g, 10, 13, P.stalkerClaw); setPixel(g, 11, 13, P.stalkerClaw);
    // feet
    fillRect(g, 4, 14, 3, 1, P.stalkerDark);
    fillRect(g, 9, 14, 3, 1, P.stalkerDark);
    return mirrorH(g);
}

function drawMage(): Grid {
    const g = createGrid(16, 16);
    // hood
    fillRect(g, 5, 0, 6, 3, P.mageDark);
    fillRect(g, 6, 1, 4, 2, P.mageBody);
    // face
    setPixel(g, 7, 2, P.mageGlow); setPixel(g, 8, 2, P.mageGlow);
    // robe body
    fillRect(g, 4, 3, 8, 8, P.mageBody);
    fillRect(g, 5, 4, 6, 6, P.mageLight);
    // robe flare at bottom
    fillRect(g, 3, 11, 10, 2, P.mageBody);
    fillRect(g, 2, 13, 12, 2, P.mageDark);
    // sleeves
    fillRect(g, 2, 4, 2, 4, P.mageBody);
    fillRect(g, 12, 4, 2, 4, P.mageBody);
    // hands with glow
    setPixel(g, 1, 8, P.mageGlow); setPixel(g, 2, 8, P.mageGlow);
    setPixel(g, 13, 8, P.mageGlow); setPixel(g, 14, 8, P.mageGlow);
    // staff
    fillRect(g, 14, 1, 1, 12, P.bone);
    setPixel(g, 14, 0, P.mageGlow);
    setPixel(g, 13, 0, P.mageGlow);
    setPixel(g, 15, 0, P.mageGlow);
    return g;
}

function drawBoss(): Grid {
    const g = createGrid(16, 16);
    // crown
    setPixel(g, 5, 0, P.bossCrown); setPixel(g, 7, 0, P.bossCrown);
    setPixel(g, 9, 0, P.bossCrown); setPixel(g, 11, 0, P.bossCrown);
    fillRect(g, 5, 1, 7, 1, P.bossCrown);
    // head (large)
    fillRect(g, 4, 2, 8, 4, P.bossBody);
    fillRect(g, 5, 3, 6, 2, P.bossLight);
    // eyes (menacing)
    setPixel(g, 6, 3, P.red); setPixel(g, 9, 3, P.red);
    setPixel(g, 7, 4, P.bossBody); setPixel(g, 8, 4, P.bossBody);
    // body (massive)
    fillRect(g, 2, 6, 12, 5, P.bossBody);
    fillRect(g, 3, 7, 10, 3, P.bossLight);
    // shoulder pauldrons
    fillRect(g, 1, 6, 2, 3, P.bossDark);
    fillRect(g, 13, 6, 2, 3, P.bossDark);
    setPixel(g, 0, 6, P.bossCrown); setPixel(g, 15, 6, P.bossCrown);
    // belt
    fillRect(g, 3, 11, 10, 1, P.bossCrown);
    // legs
    fillRect(g, 3, 12, 4, 3, P.bossDark);
    fillRect(g, 9, 12, 4, 3, P.bossDark);
    // feet
    fillRect(g, 2, 15, 5, 1, P.outline);
    fillRect(g, 9, 15, 5, 1, P.outline);
    return mirrorH(g);
}

function drawBleeder(): Grid {
    const g = createGrid(16, 16);
    // body (organic, hunched)
    fillRect(g, 5, 2, 6, 5, P.bleederBody);
    fillRect(g, 6, 3, 4, 3, P.bleederLight);
    // eyes
    setPixel(g, 6, 3, P.red); setPixel(g, 9, 3, P.red);
    // mouth
    setPixel(g, 7, 5, P.bleederDrip); setPixel(g, 8, 5, P.bleederDrip);
    // tendrils/arms
    fillRect(g, 3, 4, 2, 5, P.bleederBody);
    fillRect(g, 11, 4, 2, 5, P.bleederBody);
    setPixel(g, 2, 8, P.bleederDrip); setPixel(g, 3, 9, P.bleederDrip);
    setPixel(g, 12, 8, P.bleederDrip); setPixel(g, 13, 9, P.bleederDrip);
    // lower body
    fillRect(g, 4, 7, 8, 4, P.bleederBody);
    fillRect(g, 5, 8, 6, 2, P.bleederDark);
    // dripping
    setPixel(g, 5, 11, P.bleederDrip); setPixel(g, 8, 11, P.bleederDrip);
    setPixel(g, 10, 11, P.bleederDrip);
    setPixel(g, 6, 12, P.bleederDrip); setPixel(g, 9, 12, P.bleederDrip);
    // legs (short, stubby)
    fillRect(g, 4, 12, 3, 2, P.bleederDark);
    fillRect(g, 9, 12, 3, 2, P.bleederDark);
    fillRect(g, 4, 14, 3, 1, P.bleederDrip);
    fillRect(g, 9, 14, 3, 1, P.bleederDrip);
    return mirrorH(g);
}

function drawDisruptor(): Grid {
    const g = createGrid(16, 16);
    // ethereal floating body
    fillRect(g, 5, 1, 6, 4, P.disruptorBody);
    fillRect(g, 6, 2, 4, 2, P.disruptorLight);
    // glowing eyes
    setPixel(g, 6, 2, P.disruptorGlow); setPixel(g, 9, 2, P.disruptorGlow);
    // floating robe/body
    fillRect(g, 4, 5, 8, 5, P.disruptorBody);
    fillRect(g, 5, 6, 6, 3, P.disruptorLight);
    // arms (ethereal)
    fillRect(g, 2, 5, 2, 3, P.disruptorDark);
    fillRect(g, 12, 5, 2, 3, P.disruptorDark);
    setPixel(g, 1, 7, P.disruptorGlow);
    setPixel(g, 14, 7, P.disruptorGlow);
    // robe dissolving at bottom
    fillRect(g, 3, 10, 10, 2, P.disruptorDark);
    setPixel(g, 4, 12, P.disruptorDark); setPixel(g, 7, 12, P.disruptorDark);
    setPixel(g, 9, 12, P.disruptorDark); setPixel(g, 11, 12, P.disruptorDark);
    setPixel(g, 5, 13, P.disruptorDark); setPixel(g, 8, 13, P.disruptorDark);
    setPixel(g, 10, 13, P.disruptorDark);
    // glow aura particles
    setPixel(g, 3, 3, P.disruptorGlow); setPixel(g, 12, 1, P.disruptorGlow);
    setPixel(g, 2, 9, P.disruptorGlow); setPixel(g, 13, 4, P.disruptorGlow);
    return mirrorH(g);
}

// ─── room icon generators (12x12, rendered at scale) ────────────

function drawSkull(): Grid {
    const g = createGrid(12, 12);
    fillRect(g, 3, 1, 6, 5, P.skull);
    fillRect(g, 4, 2, 4, 3, P.bone);
    // eye sockets
    setPixel(g, 4, 3, P.outline); setPixel(g, 5, 3, P.outline);
    setPixel(g, 6, 3, P.outline); setPixel(g, 7, 3, P.outline);
    // nose
    setPixel(g, 5, 5, P.skullDark); setPixel(g, 6, 5, P.skullDark);
    // jaw
    fillRect(g, 4, 6, 4, 2, P.skull);
    setPixel(g, 4, 7, P.outline); setPixel(g, 5, 7, P.skullDark);
    setPixel(g, 6, 7, P.skullDark); setPixel(g, 7, 7, P.outline);
    // crossbones
    setPixel(g, 2, 8, P.bone); setPixel(g, 3, 9, P.bone);
    setPixel(g, 8, 9, P.bone); setPixel(g, 9, 8, P.bone);
    setPixel(g, 2, 10, P.bone); setPixel(g, 9, 10, P.bone);
    setPixel(g, 3, 9, P.bone); setPixel(g, 8, 9, P.bone);
    return mirrorH(g);
}

function drawChest(): Grid {
    const g = createGrid(12, 12);
    // lid
    fillRect(g, 1, 2, 10, 3, P.chest);
    fillRect(g, 2, 3, 8, 1, P.chestLight);
    // lock
    setPixel(g, 5, 4, P.gold); setPixel(g, 6, 4, P.gold);
    // body
    fillRect(g, 1, 5, 10, 5, P.chestDark);
    fillRect(g, 2, 6, 8, 3, P.chest);
    // clasp
    setPixel(g, 5, 5, P.gold); setPixel(g, 6, 5, P.gold);
    // bottom
    fillRect(g, 1, 10, 10, 1, P.outline);
    return g;
}

function drawCampfire(): Grid {
    const g = createGrid(12, 12);
    // flames
    setPixel(g, 5, 1, P.fireTip); setPixel(g, 6, 1, P.fireTip);
    setPixel(g, 4, 2, P.fireTip); setPixel(g, 7, 2, P.fireTip);
    fillRect(g, 4, 3, 4, 2, P.fire);
    setPixel(g, 5, 2, P.fire); setPixel(g, 6, 2, P.fire);
    fillRect(g, 3, 5, 6, 2, P.fireBase);
    // embers
    setPixel(g, 3, 3, P.fireTip); setPixel(g, 8, 4, P.fireTip);
    // logs
    fillRect(g, 2, 7, 8, 2, P.chest);
    setPixel(g, 1, 8, P.chestDark); setPixel(g, 10, 8, P.chestDark);
    // stones
    setPixel(g, 2, 9, P.shadow); setPixel(g, 4, 9, P.shadow);
    setPixel(g, 6, 9, P.shadow); setPixel(g, 8, 9, P.shadow);
    return g;
}

function drawTrapIcon(): Grid {
    const g = createGrid(12, 12);
    // spikes
    setPixel(g, 2, 2, P.trapSpike); setPixel(g, 2, 3, P.trapSpike);
    setPixel(g, 5, 1, P.trapSpike); setPixel(g, 5, 2, P.trapSpike); setPixel(g, 5, 3, P.trapSpike);
    setPixel(g, 6, 1, P.trapSpike); setPixel(g, 6, 2, P.trapSpike); setPixel(g, 6, 3, P.trapSpike);
    setPixel(g, 9, 2, P.trapSpike); setPixel(g, 9, 3, P.trapSpike);
    // base plate
    fillRect(g, 1, 4, 10, 2, P.trap);
    fillRect(g, 2, 6, 8, 1, P.shadow);
    // jaw teeth (bottom)
    setPixel(g, 3, 7, P.trapSpike); setPixel(g, 5, 7, P.trapSpike);
    setPixel(g, 7, 7, P.trapSpike); setPixel(g, 9, 7, P.trapSpike);
    fillRect(g, 1, 8, 10, 2, P.trap);
    return g;
}

function drawAltar(): Grid {
    const g = createGrid(12, 12);
    // cross/symbol at top
    setPixel(g, 5, 0, P.shrine); setPixel(g, 6, 0, P.shrine);
    fillRect(g, 4, 1, 4, 1, P.shrine);
    setPixel(g, 5, 2, P.shrine); setPixel(g, 6, 2, P.shrine);
    setPixel(g, 5, 3, P.shrineDark); setPixel(g, 6, 3, P.shrineDark);
    // glow
    setPixel(g, 3, 1, P.mageGlow); setPixel(g, 8, 1, P.mageGlow);
    // altar body
    fillRect(g, 2, 4, 8, 3, P.shrine);
    fillRect(g, 3, 5, 6, 1, P.shrineDark);
    // base
    fillRect(g, 1, 7, 10, 2, P.shrineDark);
    fillRect(g, 0, 9, 12, 1, P.shadow);
    return g;
}

function drawMerchantIcon(): Grid {
    const g = createGrid(12, 12);
    // awning
    fillRect(g, 1, 1, 10, 2, P.merchant);
    fillRect(g, 2, 2, 2, 1, P.merchantDark);
    fillRect(g, 6, 2, 2, 1, P.merchantDark);
    // counter
    fillRect(g, 1, 3, 10, 1, P.shadow);
    // goods (potions, coins)
    setPixel(g, 3, 4, P.potionGreen); setPixel(g, 3, 5, P.potionGreen);
    setPixel(g, 5, 5, P.gold); setPixel(g, 6, 5, P.gold);
    setPixel(g, 8, 4, P.shardBlue); setPixel(g, 8, 5, P.shardBlue);
    // counter body
    fillRect(g, 1, 6, 10, 3, P.merchantDark);
    fillRect(g, 2, 7, 8, 1, P.merchant);
    fillRect(g, 1, 9, 10, 1, P.shadow);
    return g;
}

function drawEliteSkull(): Grid {
    const g = drawSkull();
    // add horns
    setPixel(g, 2, 0, P.red); setPixel(g, 1, 1, P.red);
    setPixel(g, 9, 0, P.red); setPixel(g, 10, 1, P.red);
    // red eyes
    setPixel(g, 4, 3, P.red); setPixel(g, 7, 3, P.red);
    return g;
}

function drawBossSkull(): Grid {
    const g = drawSkull();
    // crown
    setPixel(g, 3, 0, P.bossCrown); setPixel(g, 5, 0, P.bossCrown);
    setPixel(g, 7, 0, P.bossCrown); setPixel(g, 9, 0, P.bossCrown);
    fillRect(g, 3, 1, 6, 1, P.bossCrown);
    // red eyes
    setPixel(g, 4, 3, P.red); setPixel(g, 7, 3, P.red);
    return g;
}

function drawDoor(): Grid {
    const g = createGrid(12, 12);
    // door frame
    fillRect(g, 2, 1, 8, 9, P.shadow);
    fillRect(g, 3, 2, 6, 7, P.outline);
    fillRect(g, 4, 3, 4, 5, P.shadow);
    // handle
    setPixel(g, 7, 5, P.gold);
    // arch
    fillRect(g, 3, 1, 6, 1, P.skull);
    // steps
    fillRect(g, 1, 10, 10, 1, P.skullDark);
    return g;
}

function drawEmpty(): Grid {
    const g = createGrid(12, 12);
    // footprints
    setPixel(g, 3, 3, P.shadow); setPixel(g, 4, 3, P.shadow);
    setPixel(g, 3, 4, P.shadow);
    setPixel(g, 7, 6, P.shadow); setPixel(g, 8, 6, P.shadow);
    setPixel(g, 7, 7, P.shadow);
    setPixel(g, 4, 9, P.shadow); setPixel(g, 5, 9, P.shadow);
    setPixel(g, 4, 10, P.shadow);
    return g;
}

// ─── resource icon generators (10x10) ──────────────────────────

function drawCoin(): Grid {
    const g = createGrid(10, 10);
    fillRect(g, 3, 1, 4, 8, P.gold);
    fillRect(g, 2, 2, 6, 6, P.gold);
    fillRect(g, 3, 3, 4, 4, P.goldDark);
    fillRect(g, 4, 4, 2, 2, P.gold);
    return g;
}

function drawPotion(): Grid {
    const g = createGrid(10, 10);
    // cork
    fillRect(g, 4, 0, 2, 2, P.chest);
    // neck
    fillRect(g, 4, 2, 2, 2, P.potionDark);
    // body
    fillRect(g, 2, 4, 6, 5, P.potionGreen);
    fillRect(g, 3, 5, 4, 3, P.potionDark);
    // highlight
    setPixel(g, 3, 5, P.white);
    // base
    fillRect(g, 2, 9, 6, 1, P.outline);
    return g;
}

function drawLantern(): Grid {
    const g = createGrid(10, 10);
    // handle
    fillRect(g, 4, 0, 2, 1, P.shadow);
    setPixel(g, 3, 1, P.shadow); setPixel(g, 6, 1, P.shadow);
    // top
    fillRect(g, 3, 2, 4, 1, P.lanternDark);
    // glass body
    fillRect(g, 2, 3, 6, 4, P.lanternYellow);
    fillRect(g, 3, 4, 4, 2, P.fireTip);
    // flame
    setPixel(g, 4, 4, P.fire); setPixel(g, 5, 4, P.fire);
    // base
    fillRect(g, 2, 7, 6, 1, P.lanternDark);
    fillRect(g, 3, 8, 4, 1, P.shadow);
    return g;
}

function drawShard(): Grid {
    const g = createGrid(10, 10);
    setPixel(g, 4, 0, P.shardBlue);
    fillRect(g, 3, 1, 4, 2, P.shardBlue);
    fillRect(g, 2, 3, 6, 3, P.shardDark);
    fillRect(g, 3, 3, 4, 2, P.shardBlue);
    fillRect(g, 3, 6, 4, 2, P.shardDark);
    setPixel(g, 4, 8, P.shardDark); setPixel(g, 5, 8, P.shardDark);
    // highlight
    setPixel(g, 4, 2, P.white);
    return g;
}

function drawResolve(): Grid {
    const g = createGrid(10, 10);
    // fist shape
    fillRect(g, 3, 1, 5, 3, P.fist);
    fillRect(g, 2, 2, 7, 4, P.fist);
    fillRect(g, 3, 4, 5, 3, P.fistDark);
    // thumb
    setPixel(g, 2, 5, P.fist); setPixel(g, 2, 6, P.fist);
    // wrist
    fillRect(g, 3, 7, 4, 2, P.fistDark);
    // knuckle highlights
    setPixel(g, 3, 2, P.white); setPixel(g, 5, 2, P.white); setPixel(g, 7, 2, P.white);
    return g;
}

// ─── public API ────────────────────────────────────────────────

const ENEMY_PROFILE_DRAWERS: Record<EnemyProfile, () => Grid> = {
    brute: drawBrute,
    stalker: drawStalker,
    mage: drawMage,
    boss: drawBoss,
    bleeder: drawBleeder,
    disruptor: drawDisruptor,
};

const ROOM_ICON_DRAWERS: Record<string, () => Grid> = {
    ENEMY: drawSkull,
    HOSTILE: drawSkull,
    TREASURE: drawChest,
    TRAP: drawTrapIcon,
    REST: drawCampfire,
    SHRINE: drawAltar,
    MERCHANT: drawMerchantIcon,
    ELITE: drawEliteSkull,
    BOSS: drawBossSkull,
    'ARTIFACT GUARDIAN': drawBossSkull,
    '\u0421\u0422\u0420\u0410\u0416 \u0410\u0420\u0422\u0415\u0424\u0410\u041a\u0422\u0410': drawBossSkull,
    EMPTY: drawEmpty,
    START: drawDoor,
};

const RESOURCE_ICON_DRAWERS: Record<string, () => Grid> = {
    gold: drawCoin,
    potion: drawPotion,
    lantern: drawLantern,
    shard: drawShard,
    resolve: drawResolve,
};

export class PixelSprite {
    /**
     * Register all sprite textures with a Phaser scene.
     * Call once during `create()`.
     */
    static registerAll(scene: Phaser.Scene) {
        // Enemy portraits: 16x16 grids rendered at 3x (48px)
        for (const [profile, drawer] of Object.entries(ENEMY_PROFILE_DRAWERS)) {
            const key = `enemy_${profile}`;
            if (scene.textures.exists(key)) continue;
            const canvas = gridToCanvas(drawer(), 3);
            scene.textures.addCanvas(key, canvas);
        }

        // Room icons: 12x12 grids rendered at 2x (24px)
        for (const [room, drawer] of Object.entries(ROOM_ICON_DRAWERS)) {
            const key = `room_${room}`;
            if (scene.textures.exists(key)) continue;
            const canvas = gridToCanvas(drawer(), 2);
            scene.textures.addCanvas(key, canvas);
        }

        // Resource icons: 10x10 grids rendered at 1x (10px)
        for (const [res, drawer] of Object.entries(RESOURCE_ICON_DRAWERS)) {
            const key = `res_${res}`;
            if (scene.textures.exists(key)) continue;
            const canvas = gridToCanvas(drawer(), 1);
            scene.textures.addCanvas(key, canvas);
        }
    }

    /** Get the texture key for an enemy profile. */
    static enemyKey(profile: EnemyProfile): string {
        return `enemy_${profile}`;
    }

    /** Get the texture key for a room type. */
    static roomKey(roomType: string): string {
        return `room_${roomType}`;
    }

    /** Get the texture key for a resource type. */
    static resourceKey(resource: string): string {
        return `res_${resource}`;
    }
}
