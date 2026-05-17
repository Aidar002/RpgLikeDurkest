/**
 * Slow perimeter comet anchored to the HUD escape button. Acts as a
 * "you have enough banked + pending skill points to afford a meta
 * upgrade — escape now to spend them" cue.
 *
 * Lifecycle:
 *   - The owner (`GameHudController`) calls `update(want, visible)`
 *     from every `refresh()` cycle. `want` is the affordability
 *     predicate; `visible` mirrors the escape button's own
 *     `setVisible` state (so the glow rides along into rooms /
 *     death sequences without leaking out).
 *   - `start()` lazily builds two head dots (180° apart) that walk
 *     clockwise around the button's perimeter, each leaving a
 *     short fading trail behind. `stop()` tears them down and
 *     clears any in-flight tail dots so the next `start()` begins
 *     from a clean slate.
 *
 * Visual: warm gold heads (`#fff8c8`) with a slightly cooler gold
 * trail (`#ffd76a`) that fades and shrinks. The path is offset
 * outward by {@link PERIMETER_PAD} so the comet appears to glide
 * along the *outside* of the button border without being clipped by
 * the button background.
 */
import * as Phaser from 'phaser';

/** Color of the leading dot — bright cream-gold, brighter than
 *  `HudHex.accentGold` so the comet reads against the button's own
 *  gold variant. */
const HEAD_COLOR = 0xfff8c8;
/** Color of the trailing dots — warmer / slightly dimmer than the
 *  head so the tail feels like an after-image rather than a series
 *  of separate dots. */
const TAIL_COLOR = 0xffd76a;
/** Outward inset for the comet path relative to the button rect.
 *  Keeps the head visible against the button background and gives
 *  the cue a "frame-around-the-button" silhouette. */
const PERIMETER_PAD = 2;
/** How long a single full lap of the perimeter takes. ~9s reads as
 *  "deliberate, slow" — fast enough that the eye picks up motion
 *  even on the wider half of the rect, slow enough that it never
 *  competes with combat or room VFX. */
const LAP_MS = 9000;
/** Number of evenly-spaced heads on the path. Two reads as
 *  "watch this" without becoming a swarm. */
const HEAD_COUNT = 2;
const HEAD_RADIUS = 3.5;
/** Rate at which each head drops a trail dot. ~28ms ≈ every other
 *  frame at 60fps; tight enough to look continuous. */
const TAIL_INTERVAL_MS = 28;
/** Lifetime of an individual trail dot. Combined with the lap
 *  duration above, the tail covers ~7% of the perimeter behind
 *  each head — short enough to read as a comet, long enough to be
 *  visible against the carved-stone HUD frame. */
const TAIL_LIFETIME_MS = 650;
const TAIL_RADIUS = 2;
/** Depth just above the button (220) so the comet is never clipped
 *  by the button background even where the path crosses the rect
 *  edge due to anti-aliasing. Dots are tiny (2–3px) and ride the
 *  outset path so they don't visually obscure the button label. */
const HINT_DEPTH = 221;

interface Anchor {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class EscapeHintGlow {
    private readonly scene: Phaser.Scene;
    private readonly anchor: Anchor;
    private readonly parent: Phaser.GameObjects.Container;

    private active = false;
    private hostContainer: Phaser.GameObjects.Container | null = null;
    private heads: Phaser.GameObjects.Arc[] = [];
    private trail = new Set<Phaser.GameObjects.Arc>();
    private lapProxy = { t: 0 };
    private lapTween: Phaser.Tweens.Tween | null = null;
    private trailTimer: Phaser.Time.TimerEvent | null = null;

    constructor(scene: Phaser.Scene, anchor: Anchor, parent: Phaser.GameObjects.Container) {
        this.scene = scene;
        this.anchor = anchor;
        this.parent = parent;
    }

    /**
     * Call from `GameHudController.refresh()` with the latest
     * predicate values. Idempotent — repeated identical calls
     * neither restart tweens nor leak objects.
     */
    update(want: boolean, visible: boolean): void {
        const shouldAnimate = want && visible;
        if (shouldAnimate && !this.active) {
            this.start();
        } else if (!shouldAnimate && this.active) {
            this.stop();
        }
    }

    /** Tear down the glow permanently (e.g. scene shutdown). */
    destroy(): void {
        this.stop();
    }

    private start(): void {
        this.active = true;
        const host = this.scene.add.container(0, 0).setDepth(HINT_DEPTH);
        this.parent.add(host);
        this.hostContainer = host;

        // Build heads. They get repositioned every onUpdate tick from
        // `lapProxy.t`, so the initial (0,0) placement is overwritten
        // before the first frame is drawn.
        for (let i = 0; i < HEAD_COUNT; i++) {
            const head = this.scene.add.circle(0, 0, HEAD_RADIUS, HEAD_COLOR, 1);
            host.add(head);
            this.heads.push(head);
        }

        // Drive the comet path off a single tween proxy that linearly
        // walks t = 0 → 1 over LAP_MS and repeats forever. Each
        // head's position derives from `(t + i / HEAD_COUNT) % 1` so
        // they stay evenly spaced as the lap advances.
        this.lapProxy = { t: 0 };
        this.lapTween = this.scene.tweens.add({
            targets: this.lapProxy,
            t: 1,
            duration: LAP_MS,
            repeat: -1,
            ease: 'Linear',
            onUpdate: () => this.repositionHeads(),
        });

        // Trail spawner: every TAIL_INTERVAL_MS, drop a fading dot at
        // each head's current screen position. Decoupling the spawn
        // from the head tween's onUpdate avoids spawning multiple
        // dots per frame when the host's render rate exceeds the
        // intended spawn cadence.
        this.trailTimer = this.scene.time.addEvent({
            delay: TAIL_INTERVAL_MS,
            loop: true,
            callback: () => this.emitTrail(),
        });

        // Paint frame 0 so the heads aren't visibly at (0,0) for the
        // first render tick before the tween's first onUpdate fires.
        this.repositionHeads();
    }

    private repositionHeads(): void {
        if (!this.hostContainer) return;
        const { x, y, width, height } = this.anchor;
        const outerW = width + PERIMETER_PAD * 2;
        const outerH = height + PERIMETER_PAD * 2;
        const perimeter = 2 * (outerW + outerH);
        for (let i = 0; i < this.heads.length; i++) {
            const t = (this.lapProxy.t + i / HEAD_COUNT) % 1;
            const d = t * perimeter;
            const point = perimeterPoint(x, y, outerW, outerH, d);
            this.heads[i].setPosition(point.x, point.y);
        }
    }

    private emitTrail(): void {
        if (!this.active || !this.hostContainer) return;
        for (const head of this.heads) {
            const dot = this.scene.add.circle(head.x, head.y, TAIL_RADIUS, TAIL_COLOR, 0.9);
            this.hostContainer.add(dot);
            this.trail.add(dot);
            this.scene.tweens.add({
                targets: dot,
                alpha: 0,
                scale: 0.3,
                duration: TAIL_LIFETIME_MS,
                ease: 'Sine.out',
                onComplete: () => {
                    this.trail.delete(dot);
                    dot.destroy();
                },
            });
        }
    }

    private stop(): void {
        this.active = false;
        if (this.lapTween) {
            this.lapTween.stop();
            this.lapTween = null;
        }
        if (this.trailTimer) {
            this.trailTimer.remove(false);
            this.trailTimer = null;
        }
        this.heads.forEach((h) => h.destroy());
        this.heads = [];
        this.trail.forEach((d) => d.destroy());
        this.trail.clear();
        if (this.hostContainer) {
            this.hostContainer.destroy();
            this.hostContainer = null;
        }
    }
}

/**
 * Walk a rectangular perimeter clockwise starting at the top-left
 * corner and return the screen-space point at signed distance
 * `d` ∈ [0, perimeter). The rect is centred on (cx, cy) with full
 * width `w` and height `h`. Used to drive {@link EscapeHintGlow}'s
 * heads along the button's outset frame.
 */
function perimeterPoint(
    cx: number,
    cy: number,
    w: number,
    h: number,
    d: number
): { x: number; y: number } {
    const halfW = w / 2;
    const halfH = h / 2;
    let remaining = d;
    if (remaining < w) {
        // Top edge: walk left → right along y = cy - halfH.
        return { x: cx - halfW + remaining, y: cy - halfH };
    }
    remaining -= w;
    if (remaining < h) {
        // Right edge: walk top → bottom along x = cx + halfW.
        return { x: cx + halfW, y: cy - halfH + remaining };
    }
    remaining -= h;
    if (remaining < w) {
        // Bottom edge: walk right → left along y = cy + halfH.
        return { x: cx + halfW - remaining, y: cy + halfH };
    }
    remaining -= w;
    // Left edge: walk bottom → top along x = cx - halfW.
    return { x: cx - halfW, y: cy + halfH - remaining };
}
