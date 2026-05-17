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
    | 'pulseBurst';

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
    const COUNT = 18;
    for (let i = 0; i < COUNT; i++) {
        const a = (i / COUNT) * Math.PI * 2;
        const startX = x + Math.cos(a) * reach;
        const startY = y + Math.sin(a) * reach;
        const dot = scene.add.circle(startX, startY, 2, color, 0.85).setDepth(depth);
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

/** Green pulse + 5 rising plus signs. Reads as a heal / regen
 *  trigger — useable on the player at rest sites. */
function healPulse(scene: Phaser.Scene, x: number, y: number, opts: EffectOptions): void {
    const depth = pickDepth(opts);
    const color = pickColor(opts, 0x9aff9a);
    const reach = 40 * pickScale(opts);
    // Single soft pulse.
    const ring = scene.add.circle(x, y, 4, 0x000000, 0).setDepth(depth);
    ring.setStrokeStyle(3, color, 0.9);
    scene.tweens.add({
        targets: ring,
        radius: reach + 20,
        alpha: 0,
        duration: 700,
        ease: 'Quad.out',
        onUpdate: () => ring.setStrokeStyle(3, color, ring.alpha),
        onComplete: () => ring.destroy(),
    });
    // 5 plus glyphs drifting upward.
    for (let i = 0; i < 5; i++) {
        const startX = x + (Math.random() - 0.5) * 30;
        const startY = y + (Math.random() - 0.5) * 6;
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
