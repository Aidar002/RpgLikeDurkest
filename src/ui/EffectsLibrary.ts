/**
 * Reusable, fire-and-forget VFX recipe registry.
 *
 * Each entry in {@link EFFECT_RECIPES} is a self-contained procedural
 * particle effect — it spawns ephemeral Phaser GameObjects (circles,
 * rectangles, lines, polygons), animates them through {@link Phaser.Tweens.TweenManager},
 * and destroys them when the tween completes. No spritesheet
 * dependency, no external state, no per-frame ticker — drop a recipe
 * anywhere in the scene graph by calling
 * {@link playEffect}`(scene, kind, x, y)`.
 *
 * Recipes intentionally live alongside the persistent ambient effects
 * in {@link VFX} (fire pits, ambient embers, vignette). VFX hosts
 * looping atmosphere; this module hosts one-shot bursts wired to
 * gameplay beats (level-up, pickup, meta purchase) or to the
 * gallery overlay in {@link EffectsGalleryOverlay}.
 *
 * Adding a recipe:
 *   1. Append an entry to {@link EFFECT_RECIPES} with a new {@link EffectKind}
 *      and a label key.
 *   2. Add the matching key to `src/systems/locale/en.ts` and
 *      `src/systems/locale/ru.ts` (the gallery resolves the label
 *      via `loc.t(recipe.labelKey)`).
 *   3. Add a `case` to the switch in {@link playEffect}.
 *
 * The gallery overlay discovers recipes by iterating
 * {@link EFFECT_RECIPES}, so a new entry is visible in the gallery
 * automatically once the three steps above are done.
 */
import * as Phaser from 'phaser';

import type { LocaleKey } from '../systems/locale/en';

/** All recipe ids. Discriminated string union so the switch in
 *  {@link playEffect} is exhaustive at compile time. */
export type EffectKind =
    | 'radialBurst'
    | 'ringShock'
    | 'starFountain'
    | 'goldShower'
    | 'sparkleConfetti'
    | 'shockwaveTriple'
    | 'dustImplosion'
    | 'emberFloat'
    | 'lightningArc'
    | 'cometSweep'
    | 'magicSigil'
    | 'healPulse'
    | 'runicCircle'
    | 'critFlashRing'
    | 'pulseBurst'
    // ── Combat hits ──────────────────────────────────────────────
    | 'bloodSplatter'
    | 'slashArc'
    | 'iceShatter'
    | 'fireballImpact'
    | 'poisonCloud'
    // ── Spells / abilities ───────────────────────────────────────
    | 'arcaneOrbit'
    | 'shadowVortex'
    | 'thunderclap'
    | 'soulDrain'
    | 'windSlash'
    // ── Upgrades / progression ───────────────────────────────────
    | 'levelUpHalo'
    | 'xpAbsorb'
    | 'shieldBubble'
    | 'swordSharpen'
    | 'phoenixRise';

/** Per-call overrides. Recipes pick sensible defaults so callers
 *  pass only what they need; the gallery and the gameplay sites
 *  both rely on the recipe defaults. */
export interface EffectOptions {
    /** Render depth for every spawned game object. Defaults to 200
     *  (above gameplay, below HUD tooltips). The gallery sets a
     *  higher depth so its previews paint over the overlay panel. */
    depth?: number;
    /** Accent colour. Overrides per-recipe palette default. */
    color?: number;
    /** Linear scale on the radius / reach (1 = recipe default). */
    scale?: number;
    /** Half-width of a rectangular spawn area centred on (x, y).
     *  Currently honoured by {@link EffectKind} `'healPulse'` so
     *  the effect can paint across the full width of a UI button
     *  rather than a single point. Defaults to the recipe's own
     *  spawn radius. */
    spreadX?: number;
    /** Half-height of the rectangular spawn area. See
     *  {@link EffectOptions.spreadX}. */
    spreadY?: number;
    /** Linear multiplier on the recipe's default particle count
     *  (e.g. 4 → 4× the glyph density). Defaults to 1. */
    countScale?: number;
}

/** A recipe entry that the gallery can display. Pure data — the
 *  `kind` is dispatched to a function in {@link playEffect}. */
export interface EffectRecipe {
    kind: EffectKind;
    labelKey: LocaleKey;
}

/** The full registry. Order is the gallery's display order. */
export const EFFECT_RECIPES: readonly EffectRecipe[] = [
    { kind: 'radialBurst', labelKey: 'effectRadialBurst' },
    { kind: 'ringShock', labelKey: 'effectRingShock' },
    { kind: 'starFountain', labelKey: 'effectStarFountain' },
    { kind: 'goldShower', labelKey: 'effectGoldShower' },
    { kind: 'sparkleConfetti', labelKey: 'effectSparkleConfetti' },
    { kind: 'shockwaveTriple', labelKey: 'effectShockwaveTriple' },
    { kind: 'dustImplosion', labelKey: 'effectDustImplosion' },
    { kind: 'emberFloat', labelKey: 'effectEmberFloat' },
    { kind: 'lightningArc', labelKey: 'effectLightningArc' },
    { kind: 'cometSweep', labelKey: 'effectCometSweep' },
    { kind: 'magicSigil', labelKey: 'effectMagicSigil' },
    { kind: 'healPulse', labelKey: 'effectHealPulse' },
    { kind: 'runicCircle', labelKey: 'effectRunicCircle' },
    { kind: 'critFlashRing', labelKey: 'effectCritFlashRing' },
    { kind: 'pulseBurst', labelKey: 'effectPulseBurst' },
    // ── Combat-hit themed recipes ───────────────────────────────
    { kind: 'bloodSplatter', labelKey: 'effectBloodSplatter' },
    { kind: 'slashArc', labelKey: 'effectSlashArc' },
    { kind: 'iceShatter', labelKey: 'effectIceShatter' },
    { kind: 'fireballImpact', labelKey: 'effectFireballImpact' },
    { kind: 'poisonCloud', labelKey: 'effectPoisonCloud' },
    // ── Spell / ability themed recipes ──────────────────────────
    { kind: 'arcaneOrbit', labelKey: 'effectArcaneOrbit' },
    { kind: 'shadowVortex', labelKey: 'effectShadowVortex' },
    { kind: 'thunderclap', labelKey: 'effectThunderclap' },
    { kind: 'soulDrain', labelKey: 'effectSoulDrain' },
    { kind: 'windSlash', labelKey: 'effectWindSlash' },
    // ── Upgrade / progression themed recipes ────────────────────
    { kind: 'levelUpHalo', labelKey: 'effectLevelUpHalo' },
    { kind: 'xpAbsorb', labelKey: 'effectXpAbsorb' },
    { kind: 'shieldBubble', labelKey: 'effectShieldBubble' },
    { kind: 'swordSharpen', labelKey: 'effectSwordSharpen' },
    { kind: 'phoenixRise', labelKey: 'effectPhoenixRise' },
] as const;

const DEFAULT_DEPTH = 200;

/**
 * Dispatcher. Resolves the `kind` to its recipe and fires it at
 * `(x, y)`. Fire-and-forget — every recipe self-cleans on tween
 * completion, so the caller never has to track returned handles.
 */
export function playEffect(
    scene: Phaser.Scene,
    kind: EffectKind,
    x: number,
    y: number,
    opts: EffectOptions = {}
): void {
    switch (kind) {
        case 'radialBurst':
            radialBurst(scene, x, y, opts);
            return;
        case 'ringShock':
            ringShock(scene, x, y, opts);
            return;
        case 'starFountain':
            starFountain(scene, x, y, opts);
            return;
        case 'goldShower':
            goldShower(scene, x, y, opts);
            return;
        case 'sparkleConfetti':
            sparkleConfetti(scene, x, y, opts);
            return;
        case 'shockwaveTriple':
            shockwaveTriple(scene, x, y, opts);
            return;
        case 'dustImplosion':
            dustImplosion(scene, x, y, opts);
            return;
        case 'emberFloat':
            emberFloat(scene, x, y, opts);
            return;
        case 'lightningArc':
            lightningArc(scene, x, y, opts);
            return;
        case 'cometSweep':
            cometSweep(scene, x, y, opts);
            return;
        case 'magicSigil':
            magicSigil(scene, x, y, opts);
            return;
        case 'healPulse':
            healPulse(scene, x, y, opts);
            return;
        case 'runicCircle':
            runicCircle(scene, x, y, opts);
            return;
        case 'critFlashRing':
            critFlashRing(scene, x, y, opts);
            return;
        case 'pulseBurst':
            pulseBurst(scene, x, y, opts);
            return;
        case 'bloodSplatter':
            bloodSplatter(scene, x, y, opts);
            return;
        case 'slashArc':
            slashArc(scene, x, y, opts);
            return;
        case 'iceShatter':
            iceShatter(scene, x, y, opts);
            return;
        case 'fireballImpact':
            fireballImpact(scene, x, y, opts);
            return;
        case 'poisonCloud':
            poisonCloud(scene, x, y, opts);
            return;
        case 'arcaneOrbit':
            arcaneOrbit(scene, x, y, opts);
            return;
        case 'shadowVortex':
            shadowVortex(scene, x, y, opts);
            return;
        case 'thunderclap':
            thunderclap(scene, x, y, opts);
            return;
        case 'soulDrain':
            soulDrain(scene, x, y, opts);
            return;
        case 'windSlash':
            windSlash(scene, x, y, opts);
            return;
        case 'levelUpHalo':
            levelUpHalo(scene, x, y, opts);
            return;
        case 'xpAbsorb':
            xpAbsorb(scene, x, y, opts);
            return;
        case 'shieldBubble':
            shieldBubble(scene, x, y, opts);
            return;
        case 'swordSharpen':
            swordSharpen(scene, x, y, opts);
            return;
        case 'phoenixRise':
            phoenixRise(scene, x, y, opts);
            return;
    }
}

// ─── Recipes ──────────────────────────────────────────────────────────
// Every recipe takes the same signature so they can be uniformly
// indexed by `kind`. Each one consumes `opts` via the local helpers
// `pickDepth` / `pickColor` / `pickScale` so the per-recipe palette
// stays grep-able at the top of the function body.

function pickDepth(o: EffectOptions): number {
    return o.depth ?? DEFAULT_DEPTH;
}
function pickScale(o: EffectOptions): number {
    return o.scale ?? 1;
}
function pickColor(o: EffectOptions, fallback: number): number {
    return o.color ?? fallback;
}

/** 12 outward-flying dots. Reads as a "burst" — good for generic
 *  positive feedback (buff applied, point banked). */
function radialBurst(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xfff17a);
    const reach = 64 * pickScale(opts);
    const RAYS = 12;
    for (let i = 0; i < RAYS; i++) {
        const a = (i / RAYS) * Math.PI * 2;
        const dot = scene.add.circle(x, y, 3, color, 0.95).setDepth(depth);
        scene.tweens.add({
            targets: dot,
            x: x + Math.cos(a) * reach,
            y: y + Math.sin(a) * reach,
            scale: 0.2,
            alpha: 0,
            duration: 540,
            ease: 'Quad.out',
            onComplete: () => dot.destroy(),
        });
    }
}

/** Single expanding ring that fades. Clean, fast — the "tap"
 *  baseline of the library, also a sub-component of bigger recipes. */
function ringShock(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0x9ad7ff);
    const reach = 70 * pickScale(opts);
    const ring = scene.add.circle(x, y, 8, 0x000000, 0).setDepth(depth);
    ring.setStrokeStyle(3, color, 0.9);
    scene.tweens.add({
        targets: ring,
        radius: reach,
        alpha: 0,
        duration: 540,
        ease: 'Quad.out',
        onUpdate: () => ring.setStrokeStyle(3, color, ring.alpha),
        onComplete: () => ring.destroy(),
    });
}

/** 10 ★ glyphs erupting upward with gravity-like fall — the
 *  level-up signature. Stars peak around 70 px above the spawn,
 *  then drift back down while fading. */
function starFountain(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xfff17a);
    const reach = 80 * pickScale(opts);
    const STARS = 10;
    for (let i = 0; i < STARS; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
        const speed = reach * (0.6 + Math.random() * 0.6);
        const dx = Math.cos(angle) * speed;
        const dy = Math.sin(angle) * speed;
        const star = scene.add
            .star(x, y, 5, 4, 8, color, 1)
            .setDepth(depth)
            .setAngle(Math.random() * 360);
        scene.tweens.add({
            targets: star,
            x: x + dx,
            y: y + dy + 40, // gravity-like sag
            angle: star.angle + 180,
            alpha: 0,
            scale: 0.4,
            duration: 900 + Math.random() * 200,
            ease: 'Quad.out',
            onComplete: () => star.destroy(),
        });
    }
}

/** 14 small rectangles raining from above the spawn point. Reads as
 *  a quick gold/loot pour — the meta-upgrade signature. */
function goldShower(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xffd36e);
    const COUNT = 14;
    const spread = 90 * pickScale(opts);
    for (let i = 0; i < COUNT; i++) {
        const startX = x + (Math.random() - 0.5) * spread;
        const startY = y - 70 - Math.random() * 30;
        const piece = scene.add
            .rectangle(startX, startY, 3, 8, color, 0.95)
            .setDepth(depth)
            .setAngle(Math.random() * 360);
        scene.tweens.add({
            targets: piece,
            y: y + 30 + Math.random() * 20,
            angle: piece.angle + 360,
            alpha: 0,
            duration: 700 + Math.random() * 300,
            ease: 'Quad.in',
            onComplete: () => piece.destroy(),
        });
    }
}

/** Multi-colour sparkles drifting upward with horizontal sway. The
 *  celebration / "pickup" signature. */
function sparkleConfetti(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const palette = [0xff9ad9, 0x9adfff, 0xfff17a, 0x9aff9a, 0xff9a9a];
    const COUNT = 16;
    const reach = 60 * pickScale(opts);
    for (let i = 0; i < COUNT; i++) {
        const col = pickColor(opts, palette[i % palette.length]);
        const startX = x + (Math.random() - 0.5) * 14;
        const startY = y + (Math.random() - 0.5) * 6;
        const dot = scene.add.circle(startX, startY, 3, col, 0.95).setDepth(depth);
        scene.tweens.add({
            targets: dot,
            x: startX + (Math.random() - 0.5) * 80,
            y: startY - reach - Math.random() * 30,
            alpha: 0,
            scale: 0.4,
            duration: 900 + Math.random() * 200,
            ease: 'Quad.out',
            onComplete: () => dot.destroy(),
        });
    }
}

/** Three concentric rings expanding at staggered offsets. Pairs well
 *  with hit feedback — three "thuds" of expanding outline. */
function shockwaveTriple(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xff9a9a);
    const reach = 80 * pickScale(opts);
    for (let i = 0; i < 3; i++) {
        scene.time.delayedCall(i * 120, () => {
            const ring = scene.add.circle(x, y, 6, 0x000000, 0).setDepth(depth);
            ring.setStrokeStyle(2, color, 0.9);
            scene.tweens.add({
                targets: ring,
                radius: reach,
                alpha: 0,
                duration: 540,
                ease: 'Quad.out',
                onUpdate: () => ring.setStrokeStyle(2, color, ring.alpha),
                onComplete: () => ring.destroy(),
            });
        });
    }
}

/** 18 dots collapsing inward from the periphery, then exploding
 *  back outward. Reads as a "trigger" / "charge" moment. */
function dustImplosion(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xc7b58a);
    const reach = 70 * pickScale(opts);
    // `countScale` doubles as a brightness control here: it raises the
    // ring density AND fattens each particle proportionally, so callers
    // can pass `countScale: 2` to get a punchier "set complete" burst
    // out of the same recipe the gallery uses for the muted preview.
    const density = Math.max(0.5, opts.countScale ?? 1);
    const COUNT = Math.max(6, Math.round(18 * density));
    const dotRadius = 2 * Math.max(1, Math.sqrt(density));
    const dotAlpha = Math.min(1, 0.85 + 0.15 * (density - 1));
    for (let i = 0; i < COUNT; i++) {
        const a = (i / COUNT) * Math.PI * 2;
        const startX = x + Math.cos(a) * reach;
        const startY = y + Math.sin(a) * reach;
        const dot = scene.add.circle(startX, startY, dotRadius, color, dotAlpha).setDepth(depth);
        scene.tweens.add({
            targets: dot,
            x,
            y,
            duration: 360,
            ease: 'Quad.in',
            onComplete: () => {
                scene.tweens.add({
                    targets: dot,
                    x: x + Math.cos(a + Math.PI) * reach * 0.6,
                    y: y + Math.sin(a + Math.PI) * reach * 0.6,
                    alpha: 0,
                    duration: 360,
                    ease: 'Quad.out',
                    onComplete: () => dot.destroy(),
                });
            },
        });
    }
}

/** 12 ember circles slow-rising. One-shot variant of the looping
 *  fire effect in VFX — short trail, no respawn. */
function emberFloat(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xffa040);
    const reach = 70 * pickScale(opts);
    const COUNT = 12;
    for (let i = 0; i < COUNT; i++) {
        const startX = x + (Math.random() - 0.5) * 24;
        const startY = y + (Math.random() - 0.5) * 6;
        const ember = scene.add
            .circle(startX, startY, 2 + Math.random() * 2, color, 0.9)
            .setDepth(depth);
        scene.tweens.add({
            targets: ember,
            x: startX + (Math.random() - 0.5) * 20,
            y: startY - reach - Math.random() * 20,
            alpha: 0,
            scale: 0.4,
            duration: 1000 + Math.random() * 300,
            ease: 'Quad.out',
            onComplete: () => ember.destroy(),
        });
    }
}

/** A jagged polyline drawn through a Graphics buffer that flashes
 *  three times. Reads as a single lightning strike at the position
 *  (vertical bolt from `y - reach` to `y + reach` with horizontal
 *  jitter on every segment). */
function lightningArc(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xc8e0ff);
    const reach = 80 * pickScale(opts);
    const g = scene.add.graphics().setDepth(depth);
    const drawBolt = () => {
        g.clear();
        g.lineStyle(2, color, 1);
        g.beginPath();
        const segments = 7;
        const top = y - reach;
        g.moveTo(x, top);
        for (let i = 1; i <= segments; i++) {
            const px = x + (Math.random() - 0.5) * 14;
            const py = top + (i / segments) * reach * 2;
            g.lineTo(px, py);
        }
        g.strokePath();
    };
    drawBolt();
    // 5 quick repaint cycles: even ticks draw a fresh jagged bolt,
    // odd ticks blank the buffer so the effect reads as flickering.
    let ticks = 0;
    const evt = scene.time.addEvent({
        delay: 90,
        repeat: 4,
        callback: () => {
            ticks++;
            if (ticks % 2 === 1) g.clear();
            else drawBolt();
        },
    });
    // Fade-out tail. The timer runs to ~450 ms; the fade starts at
    // 350 ms so the final flicker overlaps with the alpha decay.
    scene.tweens.add({
        targets: g,
        alpha: 0,
        duration: 250,
        delay: 350,
        onComplete: () => {
            evt.remove(false);
            g.destroy();
        },
    });
}

/** A bright head with a fading tail sweeping diagonally across the
 *  spawn point. Reads as a "comet" or "trail" element — used by the
 *  HUD's escape-hint glow loops too. */
function cometSweep(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0x9adfff);
    const reach = 120 * pickScale(opts);
    const head = scene.add.circle(x - reach, y + reach, 5, color, 1).setDepth(depth);
    head.setStrokeStyle(2, 0xffffff, 0.8);
    // Tail: a column of fading dots that follow at decreasing
    // alpha. We tween the head and re-position the tail in onUpdate
    // so the whole thing reads as a single trail.
    const TAIL = 8;
    const tail: Phaser.GameObjects.Arc[] = [];
    for (let i = 0; i < TAIL; i++) {
        tail.push(
            scene.add.circle(head.x, head.y, 3, color, 0.6 * (1 - i / TAIL)).setDepth(depth - 1)
        );
    }
    scene.tweens.add({
        targets: head,
        x: x + reach,
        y: y - reach,
        duration: 700,
        ease: 'Quad.inOut',
        onUpdate: () => {
            for (let i = 0; i < TAIL; i++) {
                const t = (i + 1) / (TAIL + 1);
                tail[i].setPosition(
                    head.x - (head.x - (x - reach)) * t,
                    head.y - (head.y - (y + reach)) * t
                );
            }
        },
        onComplete: () => {
            scene.tweens.add({
                targets: [head, ...tail],
                alpha: 0,
                duration: 200,
                onComplete: () => {
                    head.destroy();
                    tail.forEach((t) => t.destroy());
                },
            });
        },
    });
}

/** A hexagonal rune outline plus an inscribed two-triangle star and
 *  6 vertex dots that drift outward. Pulses outward and rotates as
 *  it fades — reads as a magic glyph briefly inscribed at the
 *  position. */
function magicSigil(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xc97ad9);
    const reach = 50 * pickScale(opts);
    const SIDES = 6;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < SIDES; i++) {
        const a = (i / SIDES) * Math.PI * 2 - Math.PI / 2;
        pts.push({ x: Math.cos(a) * reach, y: Math.sin(a) * reach });
    }
    // Outer hexagon outline.
    const hex = scene.add.graphics().setDepth(depth);
    hex.lineStyle(2, color, 0.95);
    hex.beginPath();
    hex.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < SIDES; i++) hex.lineTo(pts[i].x, pts[i].y);
    hex.lineTo(pts[0].x, pts[0].y);
    hex.strokePath();
    hex.setPosition(x, y);
    // Inner star (two interleaved triangles).
    const star = scene.add.graphics().setDepth(depth);
    star.lineStyle(1, color, 0.75);
    for (const offset of [0, 1] as const) {
        star.beginPath();
        const a0 = (offset / SIDES) * Math.PI * 2 - Math.PI / 2;
        const a1 = ((offset + 2) / SIDES) * Math.PI * 2 - Math.PI / 2;
        const a2 = ((offset + 4) / SIDES) * Math.PI * 2 - Math.PI / 2;
        star.moveTo(Math.cos(a0) * reach, Math.sin(a0) * reach);
        star.lineTo(Math.cos(a1) * reach, Math.sin(a1) * reach);
        star.lineTo(Math.cos(a2) * reach, Math.sin(a2) * reach);
        star.lineTo(Math.cos(a0) * reach, Math.sin(a0) * reach);
        star.strokePath();
    }
    star.setPosition(x, y);
    // Outer dots at every vertex; drift outward as the sigil fades.
    const dots = pts.map((p) => scene.add.circle(x + p.x, y + p.y, 3, color, 1).setDepth(depth));
    scene.tweens.add({
        targets: [hex, star],
        alpha: 0,
        scale: 1.4,
        rotation: Math.PI / 2,
        duration: 700,
        ease: 'Quad.out',
        onComplete: () => {
            hex.destroy();
            star.destroy();
        },
    });
    dots.forEach((dot, i) => {
        const p = pts[i];
        scene.tweens.add({
            targets: dot,
            x: x + p.x * 1.6,
            y: y + p.y * 1.6,
            alpha: 0,
            scale: 0.4,
            duration: 700,
            ease: 'Quad.out',
            onComplete: () => dot.destroy(),
        });
    });
}

/** Green pulse + drifting plus signs. Reads as a heal / regen
 *  trigger — usable on the player at rest sites, on the altar
 *  "prayer" action, and on the combat heal-potion button. The
 *  spawn rectangle is controlled by `opts.spreadX` / `opts.spreadY`
 *  so the same recipe can paint across an entire button frame
 *  instead of a single point; `opts.countScale` multiplies the
 *  glyph count so the wider spawn area doesn't read as sparse. */
function healPulse(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0x9aff9a);
    const scaleMul = pickScale(opts);
    const reach = 40 * scaleMul;
    // Half-width / half-height of the rectangular spawn area. The
    // defaults reproduce the original ±15 / ±3 spawn band when
    // callers don't override them, so the gallery preview and other
    // non-button call sites keep their existing look.
    const spreadX = opts.spreadX ?? 15 * scaleMul;
    const spreadY = opts.spreadY ?? 3 * scaleMul;
    const ringTarget = Math.max(reach + 20, spreadX + 12);
    const count = Math.max(1, Math.round(5 * (opts.countScale ?? 1)));
    // Single soft pulse.
    const ring = scene.add.circle(x, y, 4, 0x000000, 0).setDepth(depth);
    ring.setStrokeStyle(3, color, 0.9);
    scene.tweens.add({
        targets: ring,
        radius: ringTarget,
        alpha: 0,
        duration: 700,
        ease: 'Quad.out',
        onUpdate: () => ring.setStrokeStyle(3, color, ring.alpha),
        onComplete: () => ring.destroy(),
    });
    // Plus glyphs drifting upward, scattered across the spawn rect.
    for (let i = 0; i < count; i++) {
        const startX = x + (Math.random() - 0.5) * 2 * spreadX;
        const startY = y + (Math.random() - 0.5) * 2 * spreadY;
        const t = scene.add
            .text(startX, startY, '+', {
                fontFamily: 'monospace',
                fontSize: '18px',
                color: '#9aff9a',
            })
            .setOrigin(0.5)
            .setDepth(depth);
        scene.tweens.add({
            targets: t,
            y: startY - 50 - Math.random() * 20,
            alpha: 0,
            duration: 800 + Math.random() * 200,
            ease: 'Quad.out',
            onComplete: () => t.destroy(),
        });
    }
}

/** A rotating dashed ring with a centre flash. Reads as a "ritual"
 *  glyph briefly active at the position. */
function runicCircle(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xffa040);
    const reach = 50 * pickScale(opts);
    const g = scene.add.graphics().setDepth(depth);
    g.setPosition(x, y);
    const SEGMENTS = 14;
    const drawRing = () => {
        g.clear();
        g.lineStyle(3, color, 0.95);
        for (let i = 0; i < SEGMENTS; i++) {
            const a0 = (i / SEGMENTS) * Math.PI * 2;
            const a1 = a0 + Math.PI / SEGMENTS;
            g.beginPath();
            g.arc(0, 0, reach, a0, a1);
            g.strokePath();
        }
    };
    drawRing();
    // Centre flash.
    const centre = scene.add.circle(x, y, 4, color, 0.9).setDepth(depth);
    scene.tweens.add({
        targets: g,
        rotation: Math.PI / 2,
        alpha: 0,
        scale: 1.2,
        duration: 700,
        ease: 'Quad.out',
        onComplete: () => g.destroy(),
    });
    scene.tweens.add({
        targets: centre,
        radius: reach * 0.6,
        alpha: 0,
        duration: 500,
        ease: 'Quad.out',
        onComplete: () => centre.destroy(),
    });
}

/** Pulsing gold ring + 6 outward "spike" triangles. Reads as a
 *  critical-hit / spotlight moment. */
function critFlashRing(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xfff17a);
    const reach = 60 * pickScale(opts);
    // Ring.
    const ring = scene.add.circle(x, y, 6, 0x000000, 0).setDepth(depth);
    ring.setStrokeStyle(4, color, 1);
    scene.tweens.add({
        targets: ring,
        radius: reach,
        alpha: 0,
        duration: 600,
        ease: 'Quad.out',
        onUpdate: () => ring.setStrokeStyle(4, color, ring.alpha),
        onComplete: () => ring.destroy(),
    });
    // 6 spikes (small triangles) pointing outward.
    const SPIKES = 6;
    for (let i = 0; i < SPIKES; i++) {
        const a = (i / SPIKES) * Math.PI * 2;
        const spike = scene.add
            .triangle(x + Math.cos(a) * 14, y + Math.sin(a) * 14, 0, -6, 4, 4, -4, 4, color, 1)
            .setDepth(depth);
        spike.setRotation(a + Math.PI / 2);
        scene.tweens.add({
            targets: spike,
            x: x + Math.cos(a) * (reach + 4),
            y: y + Math.sin(a) * (reach + 4),
            scale: 0.4,
            alpha: 0,
            duration: 540,
            ease: 'Quad.out',
            onComplete: () => spike.destroy(),
        });
    }
}

/** Three concentric pulse rings + a centre flash. Larger / heavier
 *  cousin of {@link shockwaveTriple}: every ring is filled and
 *  fades, reading as a soft pulse rather than three hard shockwaves. */
function pulseBurst(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0x9adfff);
    const reach = 80 * pickScale(opts);
    for (let i = 0; i < 3; i++) {
        scene.time.delayedCall(i * 100, () => {
            const ring = scene.add.circle(x, y, 6, color, 0.5).setDepth(depth - 1);
            scene.tweens.add({
                targets: ring,
                radius: reach,
                alpha: 0,
                duration: 700,
                ease: 'Quad.out',
                onComplete: () => ring.destroy(),
            });
        });
    }
    const centre = scene.add.circle(x, y, 6, 0xffffff, 1).setDepth(depth);
    scene.tweens.add({
        targets: centre,
        radius: 20,
        alpha: 0,
        duration: 500,
        ease: 'Quad.out',
        onComplete: () => centre.destroy(),
    });
}

// ─── Combat hits ──────────────────────────────────────────────────────

/** Crimson droplets exploding outward and falling with gravity. Reads
 *  as a melee hit / bleed splash — paired well with weapon swings and
 *  bleed-rider apply moments. */
function bloodSplatter(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xc02828);
    const scaleMul = pickScale(opts);
    const reach = 70 * scaleMul;
    // Honour a rectangular spawn band so callers (e.g. the
    // bleed-strike skill firing this across the enemy portrait)
    // can spread the droplets across the whole sprite rather than
    // having them all originate from one pixel. Falls back to a
    // single-point spawn when neither spread axis is set, which
    // keeps the gallery preview / generic hit usage unchanged.
    const spreadX = opts.spreadX ?? 0;
    const spreadY = opts.spreadY ?? 0;
    // Bumped from 14 → 40 so the base recipe reads as a meaty
    // splash even at the default spawn radius. `countScale` lets
    // the caller multiply on top of that (bleed-strike asks for
    // 3-4× to paint the enemy portrait).
    const baseCount = 40;
    const count = Math.max(1, Math.round(baseCount * (opts.countScale ?? 1)));
    for (let i = 0; i < count; i++) {
        const ox = (Math.random() - 0.5) * 2 * spreadX;
        const oy = (Math.random() - 0.5) * 2 * spreadY;
        const sx = x + ox;
        const sy = y + oy;
        const a = -Math.PI + Math.random() * Math.PI; // upper hemisphere bias
        const speed = reach * (0.4 + Math.random() * 0.8);
        const dx = Math.cos(a) * speed;
        const dy = Math.sin(a) * speed;
        const r = 2 + Math.random() * 2;
        const drop = scene.add.circle(sx, sy, r, color, 0.95).setDepth(depth);
        scene.tweens.add({
            targets: drop,
            x: sx + dx,
            y: sy + dy + 50, // gravity sag
            scaleX: 0.5,
            scaleY: 0.8,
            alpha: 0,
            duration: 700 + Math.random() * 200,
            ease: 'Quad.in',
            onComplete: () => drop.destroy(),
        });
    }
    // Central splat that pops then shrinks.
    const splat = scene.add.circle(x, y, 6, color, 1).setDepth(depth);
    scene.tweens.add({
        targets: splat,
        scale: 1.6,
        alpha: 0,
        duration: 320,
        ease: 'Quad.out',
        onComplete: () => splat.destroy(),
    });
}

/** A bright crescent slash drawn as a thick arc that sweeps and fades,
 *  trailed by a few sparks. Reads as a sword cleave / heavy attack. */
function slashArc(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xffffff);
    const reach = 70 * pickScale(opts);
    const g = scene.add.graphics().setDepth(depth).setPosition(x, y);
    // Slash crescent: a 90° arc tilted 30° off horizontal. We rotate
    // and fade the Graphics object over the tween's lifetime.
    const drawArc = (alpha: number, thickness: number) => {
        g.clear();
        g.lineStyle(thickness, color, alpha);
        g.beginPath();
        g.arc(0, 0, reach, -Math.PI * 0.6, -Math.PI * 0.1);
        g.strokePath();
    };
    drawArc(1, 5);
    g.setRotation(-Math.PI / 5);
    scene.tweens.add({
        targets: g,
        rotation: Math.PI / 5,
        duration: 220,
        ease: 'Quad.out',
    });
    scene.tweens.add({
        targets: g,
        alpha: 0,
        duration: 320,
        delay: 120,
        ease: 'Quad.in',
        onUpdate: () => drawArc(g.alpha, 5),
        onComplete: () => g.destroy(),
    });
    // Spark trail along the arc.
    for (let i = 0; i < 8; i++) {
        const t = i / 8;
        const a = -Math.PI * 0.6 + t * Math.PI * 0.5;
        const sx = x + Math.cos(a) * reach * 0.9;
        const sy = y + Math.sin(a) * reach * 0.9;
        const spark = scene.add.circle(sx, sy, 2, color, 1).setDepth(depth + 1);
        scene.tweens.add({
            targets: spark,
            x: sx + Math.cos(a) * 18,
            y: sy + Math.sin(a) * 18 + 8,
            alpha: 0,
            scale: 0.4,
            duration: 360 + Math.random() * 120,
            ease: 'Quad.out',
            delay: i * 18,
            onComplete: () => spark.destroy(),
        });
    }
}

/** Cyan diamond shards exploding outward with rotation. Reads as a
 *  frost / ice critical or freeze proc. */
function iceShatter(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0x9adfff);
    const reach = 70 * pickScale(opts);
    const SHARDS = 10;
    for (let i = 0; i < SHARDS; i++) {
        const a = (i / SHARDS) * Math.PI * 2 + Math.random() * 0.25;
        // Diamond = 4-sided polygon shaped via Phaser star (4 points).
        const shard = scene.add
            .star(x, y, 4, 2, 7, color, 1)
            .setDepth(depth)
            .setAngle(Math.random() * 360);
        shard.setStrokeStyle(1, 0xffffff, 0.85);
        scene.tweens.add({
            targets: shard,
            x: x + Math.cos(a) * reach,
            y: y + Math.sin(a) * reach,
            angle: shard.angle + 240,
            scale: 0.3,
            alpha: 0,
            duration: 700 + Math.random() * 200,
            ease: 'Quad.out',
            onComplete: () => shard.destroy(),
        });
    }
    // Frost ring at impact.
    const ring = scene.add.circle(x, y, 6, 0x000000, 0).setDepth(depth - 1);
    ring.setStrokeStyle(2, 0xddf3ff, 0.9);
    scene.tweens.add({
        targets: ring,
        radius: reach * 0.9,
        alpha: 0,
        duration: 480,
        ease: 'Quad.out',
        onUpdate: () => ring.setStrokeStyle(2, 0xddf3ff, ring.alpha),
        onComplete: () => ring.destroy(),
    });
}

/** Orange flame ring + curling tongue particles. Reads as a fire
 *  spell impact / explosion. */
function fireballImpact(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xff8c40);
    const reach = 70 * pickScale(opts);
    // Bright filled core that flashes and shrinks.
    const core = scene.add.circle(x, y, 8, 0xfff0c8, 1).setDepth(depth + 1);
    scene.tweens.add({
        targets: core,
        radius: reach * 0.35,
        alpha: 0,
        duration: 320,
        ease: 'Quad.out',
        onComplete: () => core.destroy(),
    });
    // Outer ring sweep.
    const ring = scene.add.circle(x, y, 10, 0x000000, 0).setDepth(depth);
    ring.setStrokeStyle(3, color, 1);
    scene.tweens.add({
        targets: ring,
        radius: reach,
        alpha: 0,
        duration: 520,
        ease: 'Quad.out',
        onUpdate: () => ring.setStrokeStyle(3, color, ring.alpha),
        onComplete: () => ring.destroy(),
    });
    // 12 curling flame tongues using triangles that tumble outward.
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + Math.random() * 0.2;
        const tongue = scene.add
            .triangle(x, y, 0, -8, 5, 6, -5, 6, color, 1)
            .setDepth(depth)
            .setRotation(a + Math.PI / 2);
        scene.tweens.add({
            targets: tongue,
            x: x + Math.cos(a) * reach * 0.85,
            y: y + Math.sin(a) * reach * 0.85 - 10,
            rotation: tongue.rotation + Math.PI,
            scale: 0.5,
            alpha: 0,
            duration: 600 + Math.random() * 200,
            ease: 'Quad.out',
            onComplete: () => tongue.destroy(),
        });
    }
}

/** Green bubbles drifting upward with a horizontal sway. Reads as a
 *  poison cloud / toxic status applied. */
function poisonCloud(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0x6dd35a);
    const reach = 70 * pickScale(opts);
    const COUNT = 14;
    for (let i = 0; i < COUNT; i++) {
        const startX = x + (Math.random() - 0.5) * 30;
        const startY = y + (Math.random() - 0.5) * 8;
        const radius = 3 + Math.random() * 4;
        const bubble = scene.add
            .circle(startX, startY, radius, color, 0.7 + Math.random() * 0.2)
            .setDepth(depth);
        bubble.setStrokeStyle(1, 0xc5ffb0, 0.85);
        // Horizontal sway via a second tween on x — uses scene.tweens
        // yoyo so the bubble wobbles as it rises.
        scene.tweens.add({
            targets: bubble,
            x: startX + (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 14),
            duration: 600 + Math.random() * 200,
            ease: 'Sine.inOut',
            yoyo: true,
            repeat: 0,
        });
        scene.tweens.add({
            targets: bubble,
            y: startY - reach - Math.random() * 20,
            scale: 1.3,
            alpha: 0,
            duration: 1100 + Math.random() * 300,
            ease: 'Quad.out',
            onComplete: () => bubble.destroy(),
        });
    }
}

// ─── Spells / abilities ───────────────────────────────────────────────

/** 6 purple particles orbiting a centre point, then collapsing inward
 *  in a quick flash. Reads as a mana surge / spell cast. */
function arcaneOrbit(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xc97ad9);
    const reach = 50 * pickScale(opts);
    const COUNT = 6;
    const orbit: Phaser.GameObjects.Arc[] = [];
    for (let i = 0; i < COUNT; i++) {
        const a = (i / COUNT) * Math.PI * 2;
        const dot = scene.add
            .circle(x + Math.cos(a) * reach, y + Math.sin(a) * reach, 4, color, 1)
            .setDepth(depth);
        dot.setStrokeStyle(1, 0xffffff, 0.9);
        orbit.push(dot);
    }
    // Rotate the orbit around (x, y) for ~600 ms, then collapse.
    const phase = { angle: 0 };
    scene.tweens.add({
        targets: phase,
        angle: Math.PI * 1.5,
        duration: 600,
        ease: 'Quad.out',
        onUpdate: () => {
            orbit.forEach((dot, i) => {
                const a = (i / COUNT) * Math.PI * 2 + phase.angle;
                dot.setPosition(x + Math.cos(a) * reach, y + Math.sin(a) * reach);
            });
        },
        onComplete: () => {
            // Collapse to centre + flash.
            const flash = scene.add.circle(x, y, 4, 0xffffff, 1).setDepth(depth + 1);
            scene.tweens.add({
                targets: flash,
                radius: reach * 0.45,
                alpha: 0,
                duration: 300,
                ease: 'Quad.out',
                onComplete: () => flash.destroy(),
            });
            orbit.forEach((dot) => {
                scene.tweens.add({
                    targets: dot,
                    x,
                    y,
                    scale: 0.3,
                    alpha: 0,
                    duration: 260,
                    ease: 'Quad.in',
                    onComplete: () => dot.destroy(),
                });
            });
        },
    });
}

/** Dark wisps spiraling inward into a singularity. Reads as a curse /
 *  debuff applied — the inverse of {@link arcaneOrbit}. */
function shadowVortex(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0x5a3a78);
    const reach = 70 * pickScale(opts);
    const COUNT = 18;
    // Vortex base ring that pulses then fades.
    const ring = scene.add.circle(x, y, 6, 0x000000, 0).setDepth(depth - 1);
    ring.setStrokeStyle(2, color, 0.9);
    scene.tweens.add({
        targets: ring,
        radius: reach * 0.6,
        alpha: 0,
        duration: 700,
        ease: 'Quad.in',
        onUpdate: () => ring.setStrokeStyle(2, color, ring.alpha),
        onComplete: () => ring.destroy(),
    });
    for (let i = 0; i < COUNT; i++) {
        const a0 = (i / COUNT) * Math.PI * 2;
        const startX = x + Math.cos(a0) * reach;
        const startY = y + Math.sin(a0) * reach;
        const wisp = scene.add.circle(startX, startY, 3, color, 1).setDepth(depth);
        // Spiral inward by interpolating the polar (radius, angle).
        const phase = { r: reach, a: a0 };
        scene.tweens.add({
            targets: phase,
            r: 0,
            a: a0 + Math.PI * 1.4,
            duration: 700 + Math.random() * 200,
            ease: 'Quad.in',
            onUpdate: () => {
                wisp.setPosition(x + Math.cos(phase.a) * phase.r, y + Math.sin(phase.a) * phase.r);
                wisp.setAlpha(Math.max(0, phase.r / reach));
            },
            onComplete: () => wisp.destroy(),
        });
    }
    // Singularity flash at the end.
    scene.time.delayedCall(700, () => {
        const sing = scene.add.circle(x, y, 4, 0x2a1a3a, 1).setDepth(depth + 1);
        sing.setStrokeStyle(2, color, 1);
        scene.tweens.add({
            targets: sing,
            radius: 14,
            alpha: 0,
            duration: 300,
            ease: 'Quad.out',
            onUpdate: () => sing.setStrokeStyle(2, color, sing.alpha),
            onComplete: () => sing.destroy(),
        });
    });
}

/** Quick white flash + a double cross-shaped shockwave. Reads as a
 *  thunderclap / smite. */
function thunderclap(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xe9ecff);
    const reach = 80 * pickScale(opts);
    // Two perpendicular lines that elongate from the centre.
    for (const angle of [0, Math.PI / 2] as const) {
        const line = scene.add
            .rectangle(x, y, 4, 6, color, 1)
            .setDepth(depth + 1)
            .setRotation(angle);
        scene.tweens.add({
            targets: line,
            scaleY: (reach * 2) / 6,
            scaleX: 0.4,
            alpha: 0,
            duration: 320,
            ease: 'Quad.out',
            onComplete: () => line.destroy(),
        });
    }
    // Centre flash.
    const flash = scene.add.circle(x, y, 6, 0xffffff, 1).setDepth(depth + 2);
    scene.tweens.add({
        targets: flash,
        radius: reach * 0.4,
        alpha: 0,
        duration: 240,
        ease: 'Quad.out',
        onComplete: () => flash.destroy(),
    });
    // Shockwave ring.
    const ring = scene.add.circle(x, y, 8, 0x000000, 0).setDepth(depth);
    ring.setStrokeStyle(3, color, 0.95);
    scene.tweens.add({
        targets: ring,
        radius: reach,
        alpha: 0,
        duration: 540,
        ease: 'Quad.out',
        onUpdate: () => ring.setStrokeStyle(3, color, ring.alpha),
        onComplete: () => ring.destroy(),
    });
}

/** Red wisps spiraling from edges into the centre + a small heart
 *  flash. Reads as a life-steal / soul drain. */
function soulDrain(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xd05050);
    const reach = 60 * pickScale(opts);
    const COUNT = 10;
    for (let i = 0; i < COUNT; i++) {
        const a = (i / COUNT) * Math.PI * 2;
        const startX = x + Math.cos(a) * reach;
        const startY = y + Math.sin(a) * reach;
        const wisp = scene.add.circle(startX, startY, 3, color, 1).setDepth(depth);
        wisp.setStrokeStyle(1, 0xffd0d0, 0.85);
        // Curve toward the centre via an offset midpoint waypoint.
        const midX = x + Math.cos(a + Math.PI / 3) * reach * 0.4;
        const midY = y + Math.sin(a + Math.PI / 3) * reach * 0.4;
        scene.tweens.chain({
            targets: wisp,
            tweens: [
                {
                    x: midX,
                    y: midY,
                    duration: 280 + Math.random() * 100,
                    ease: 'Quad.in',
                },
                {
                    x,
                    y,
                    scale: 0.4,
                    alpha: 0,
                    duration: 280,
                    ease: 'Quad.in',
                    onComplete: () => wisp.destroy(),
                },
            ],
        });
    }
    // Centre heart-shaped flash (small star with 4 points reads as a pulse).
    scene.time.delayedCall(450, () => {
        const heart = scene.add.star(x, y, 4, 4, 8, color, 1).setDepth(depth + 1);
        scene.tweens.add({
            targets: heart,
            scale: 1.6,
            alpha: 0,
            duration: 360,
            ease: 'Quad.out',
            onComplete: () => heart.destroy(),
        });
    });
}

/** Three parallel diagonal wind streaks sweeping across the position.
 *  Reads as a wind slash / gust attack. */
function windSlash(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xc6f5ec);
    const reach = 100 * pickScale(opts);
    for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 18;
        const streak = scene.add
            .rectangle(x - reach, y + off, reach * 0.6, 3, color, 0.95)
            .setDepth(depth)
            .setOrigin(0.5);
        streak.setRotation(-Math.PI / 12);
        scene.tweens.add({
            targets: streak,
            x: x + reach,
            scaleX: 1.2,
            alpha: 0,
            duration: 420,
            ease: 'Quad.out',
            delay: i * 60,
            onComplete: () => streak.destroy(),
        });
    }
    // Trailing dust dots.
    for (let i = 0; i < 8; i++) {
        const startX = x - reach + Math.random() * reach * 2;
        const startY = y + (Math.random() - 0.5) * 50;
        const dot = scene.add.circle(startX, startY, 2, color, 0.85).setDepth(depth - 1);
        scene.tweens.add({
            targets: dot,
            x: startX + 30,
            y: startY - 4,
            alpha: 0,
            duration: 500,
            ease: 'Quad.out',
            delay: i * 30,
            onComplete: () => dot.destroy(),
        });
    }
}

// ─── Upgrades / progression ───────────────────────────────────────────

/** Gold expanding halo + vertical beam + rising stars. Reads as the
 *  meta level-up celebration — heavier sibling of {@link starFountain}. */
function levelUpHalo(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xfff17a);
    const reach = 80 * pickScale(opts);
    // Vertical beam.
    const beam = scene.add.rectangle(x, y, 14, 4, color, 0.85).setDepth(depth).setOrigin(0.5);
    beam.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
        targets: beam,
        scaleX: 0.6,
        scaleY: (reach * 2.4) / 4,
        alpha: 0,
        duration: 800,
        ease: 'Quad.out',
        onComplete: () => beam.destroy(),
    });
    // Two staggered halos.
    for (let i = 0; i < 2; i++) {
        scene.time.delayedCall(i * 180, () => {
            const halo = scene.add.circle(x, y, 8, 0x000000, 0).setDepth(depth);
            halo.setStrokeStyle(3, color, 0.95);
            scene.tweens.add({
                targets: halo,
                radius: reach,
                alpha: 0,
                duration: 700,
                ease: 'Quad.out',
                onUpdate: () => halo.setStrokeStyle(3, color, halo.alpha),
                onComplete: () => halo.destroy(),
            });
        });
    }
    // Rising star confetti.
    for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
        const speed = reach * (0.4 + Math.random() * 0.5);
        const star = scene.add
            .star(x, y, 5, 3, 6, color, 1)
            .setDepth(depth + 1)
            .setAngle(Math.random() * 360);
        scene.tweens.add({
            targets: star,
            x: x + Math.cos(a) * speed,
            y: y + Math.sin(a) * speed,
            angle: star.angle + 220,
            scale: 0.4,
            alpha: 0,
            duration: 900 + Math.random() * 150,
            ease: 'Quad.out',
            onComplete: () => star.destroy(),
        });
    }
}

/** 16 blue dots streaming inward from the periphery into a centre
 *  flash. Reads as XP absorbed / fragment pickup. */
function xpAbsorb(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0x6ec1ff);
    const reach = 80 * pickScale(opts);
    const COUNT = 16;
    for (let i = 0; i < COUNT; i++) {
        const a = (i / COUNT) * Math.PI * 2 + Math.random() * 0.2;
        const startX = x + Math.cos(a) * reach;
        const startY = y + Math.sin(a) * reach;
        const dot = scene.add.circle(startX, startY, 3, color, 1).setDepth(depth);
        dot.setStrokeStyle(1, 0xffffff, 0.7);
        scene.tweens.add({
            targets: dot,
            x,
            y,
            scale: 0.2,
            alpha: 0,
            duration: 520 + Math.random() * 200,
            ease: 'Quad.in',
            delay: Math.random() * 120,
            onComplete: () => dot.destroy(),
        });
    }
    scene.time.delayedCall(600, () => {
        const flash = scene.add.circle(x, y, 6, 0xffffff, 1).setDepth(depth + 1);
        flash.setStrokeStyle(2, color, 1);
        scene.tweens.add({
            targets: flash,
            radius: 22,
            alpha: 0,
            duration: 360,
            ease: 'Quad.out',
            onUpdate: () => flash.setStrokeStyle(2, color, flash.alpha),
            onComplete: () => flash.destroy(),
        });
    });
}

/** Cyan dome forming with a soft ripple. Reads as a shield / guard
 *  buff applied. */
function shieldBubble(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0x9adfff);
    const reach = 50 * pickScale(opts);
    // Filled dome that grows in then fades.
    const dome = scene.add.circle(x, y, 4, color, 0.18).setDepth(depth);
    dome.setStrokeStyle(3, color, 1);
    scene.tweens.add({
        targets: dome,
        radius: reach,
        duration: 320,
        ease: 'Back.out',
        onUpdate: () => dome.setStrokeStyle(3, color, 1),
    });
    scene.tweens.add({
        targets: dome,
        alpha: 0,
        duration: 700,
        delay: 300,
        ease: 'Quad.in',
        onUpdate: () => dome.setStrokeStyle(3, color, dome.alpha),
        onComplete: () => dome.destroy(),
    });
    // Two thin ripples expanding past the dome's edge.
    for (let i = 0; i < 2; i++) {
        scene.time.delayedCall(160 + i * 140, () => {
            const ripple = scene.add.circle(x, y, reach, 0x000000, 0).setDepth(depth - 1);
            ripple.setStrokeStyle(2, color, 0.7);
            scene.tweens.add({
                targets: ripple,
                radius: reach * 1.4,
                alpha: 0,
                duration: 520,
                ease: 'Quad.out',
                onUpdate: () => ripple.setStrokeStyle(2, color, ripple.alpha),
                onComplete: () => ripple.destroy(),
            });
        });
    }
    // 6 sheen specks orbiting briefly on the dome edge.
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const speck = scene.add
            .circle(x + Math.cos(a) * reach, y + Math.sin(a) * reach, 2, 0xffffff, 1)
            .setDepth(depth);
        scene.tweens.add({
            targets: speck,
            alpha: 0,
            scale: 0.4,
            duration: 600,
            delay: 200,
            ease: 'Quad.in',
            onComplete: () => speck.destroy(),
        });
    }
}

/** Vertical white sparks sheeting along an imagined blade. Reads as
 *  a weapon-sharpen / attack-up buff. */
function swordSharpen(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xffffff);
    const reach = 70 * pickScale(opts);
    // Faint metal sheen line behind the sparks (the "blade").
    const blade = scene.add
        .rectangle(x, y, 6, reach * 1.6, 0xb8c0c8, 0.35)
        .setDepth(depth - 1)
        .setOrigin(0.5);
    blade.setStrokeStyle(1, 0xe8ecf0, 0.6);
    scene.tweens.add({
        targets: blade,
        alpha: 0,
        duration: 700,
        ease: 'Quad.out',
        onComplete: () => blade.destroy(),
    });
    // 14 sparks travelling along the blade from bottom to top.
    for (let i = 0; i < 14; i++) {
        const startY = y + reach;
        const startX = x + (Math.random() - 0.5) * 8;
        const spark = scene.add.circle(startX, startY, 2, color, 1).setDepth(depth);
        scene.tweens.add({
            targets: spark,
            y: y - reach - Math.random() * 10,
            x: startX + (Math.random() - 0.5) * 14,
            alpha: 0,
            scale: 0.4,
            duration: 500 + Math.random() * 200,
            ease: 'Quad.out',
            delay: i * 28,
            onComplete: () => spark.destroy(),
        });
    }
    // Cross-flash near the hilt (top) on impact.
    const hilt = scene.add.circle(x, y - reach, 4, 0xfff17a, 1).setDepth(depth + 1);
    scene.tweens.add({
        targets: hilt,
        scale: 2.2,
        alpha: 0,
        duration: 320,
        delay: 120,
        ease: 'Quad.out',
        onComplete: () => hilt.destroy(),
    });
}

/** Golden feathers ascending in a fan + a wide gold halo. Reads as
 *  a phoenix-rise / revive / unlock signature — the heaviest
 *  celebration in the library. */
function phoenixRise(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0xffba5a);
    const reach = 100 * pickScale(opts);
    // Wide halo behind the rising fan.
    const halo = scene.add.circle(x, y + 20, 8, 0x000000, 0).setDepth(depth - 1);
    halo.setStrokeStyle(4, color, 1);
    scene.tweens.add({
        targets: halo,
        radius: reach * 0.9,
        alpha: 0,
        duration: 900,
        ease: 'Quad.out',
        onUpdate: () => halo.setStrokeStyle(4, color, halo.alpha),
        onComplete: () => halo.destroy(),
    });
    // 9 feather-shaped triangles fanning upward.
    for (let i = 0; i < 9; i++) {
        const t = (i / 8) * 2 - 1; // -1..1
        const a = -Math.PI / 2 + t * 1.0;
        const feather = scene.add
            .triangle(x, y + 10, 0, -10, 4, 8, -4, 8, color, 1)
            .setDepth(depth)
            .setRotation(a + Math.PI / 2);
        feather.setStrokeStyle(1, 0xfff0c8, 1);
        scene.tweens.add({
            targets: feather,
            x: x + Math.cos(a) * reach,
            y: y + Math.sin(a) * reach + 4,
            rotation: feather.rotation + 0.6,
            scale: 0.6,
            alpha: 0,
            duration: 950 + Math.random() * 120,
            ease: 'Quad.out',
            onComplete: () => feather.destroy(),
        });
    }
    // Bright core flash.
    const core = scene.add.circle(x, y, 6, 0xfff0c8, 1).setDepth(depth + 1);
    scene.tweens.add({
        targets: core,
        radius: 22,
        alpha: 0,
        duration: 540,
        ease: 'Quad.out',
        onComplete: () => core.destroy(),
    });
    // Trailing embers.
    for (let i = 0; i < 8; i++) {
        const startX = x + (Math.random() - 0.5) * 30;
        const ember = scene.add
            .circle(startX, y + 10, 2 + Math.random() * 2, color, 0.95)
            .setDepth(depth);
        scene.tweens.add({
            targets: ember,
            x: startX + (Math.random() - 0.5) * 30,
            y: y - reach - Math.random() * 30,
            alpha: 0,
            scale: 0.4,
            duration: 1100 + Math.random() * 200,
            ease: 'Quad.out',
            delay: i * 30,
            onComplete: () => ember.destroy(),
        });
    }
}
