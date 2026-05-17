/**
 * Pulsing gold halo + drifting perimeter sparks anchored to the HUD
 * escape button. Acts as a "you have enough banked + pending skill
 * points to afford a meta upgrade — escape now to spend them" cue.
 *
 * Lifecycle:
 *   - The owner (`GameHudController`) calls `update(want, visible)`
 *     from every `refresh()` cycle. `want` is the affordability
 *     predicate; `visible` mirrors the escape button's own
 *     `setVisible` state (so the glow rides along into rooms /
 *     death sequences without leaking out).
 *   - `start()` lazily builds two halo rings (cross-faded) and a
 *     drift-and-fade spark spawner; `stop()` tears them down and
 *     clears any in-flight particles so the next `start()` begins
 *     from a clean slate.
 *
 * Visual: warm gold (`#fff0a8` rims, `#ffd76a` sparks) tuned to match
 * `HudHex.accentGold` without exactly cloning it — slightly brighter
 * so the cue reads against the carved-stone HUD frame even when the
 * button itself is the `gold` variant.
 */
import * as Phaser from 'phaser';

const RING_COLOR = 0xfff0a8;
const SPARK_COLOR = 0xffd76a;
const RING_PAD = 5;
const SPARK_RATE_MS = 110;
const HINT_DEPTH = 219;

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
    private rings: Phaser.GameObjects.Rectangle[] = [];
    private tweens: Phaser.Tweens.Tween[] = [];
    private particles = new Set<Phaser.GameObjects.Arc>();
    private spawnTimer: Phaser.Time.TimerEvent | null = null;

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
        const { x, y, width, height } = this.anchor;
        const host = this.scene.add.container(0, 0).setDepth(HINT_DEPTH);
        this.parent.add(host);
        this.hostContainer = host;

        // Two halo rings, cross-faded so a fresh ring is always
        // emerging while the previous one finishes its outward push.
        // Stroke-only rectangles keep the button label readable.
        for (let i = 0; i < 2; i++) {
            const ring = this.scene.add
                .rectangle(x, y, width + RING_PAD * 2, height + RING_PAD * 2, 0x000000, 0)
                .setStrokeStyle(2, RING_COLOR, 1)
                .setAlpha(0);
            host.add(ring);
            this.rings.push(ring);
            const tween = this.scene.tweens.add({
                targets: ring,
                scaleX: { from: 0.9, to: 1.55 },
                scaleY: { from: 0.9, to: 2.0 },
                alpha: { from: 0.85, to: 0 },
                duration: 1300,
                ease: 'Sine.out',
                repeat: -1,
                delay: i * 650,
            });
            this.tweens.push(tween);
        }

        // Perimeter sparks. Each spawn lands on a random point of the
        // button's edge, then drifts outward (away from the centre)
        // while fading — gives the rim a continuous "wave" of fireflies
        // without competing with the ring pulses.
        const halfW = width / 2;
        const halfH = height / 2;
        const spawnSpark = () => {
            if (!this.active || !this.hostContainer) return;
            const side = Math.floor(Math.random() * 4);
            const t = Math.random();
            let px = x;
            let py = y;
            if (side === 0) {
                px = x - halfW + t * width;
                py = y - halfH;
            } else if (side === 1) {
                px = x + halfW;
                py = y - halfH + t * height;
            } else if (side === 2) {
                px = x - halfW + t * width;
                py = y + halfH;
            } else {
                px = x - halfW;
                py = y - halfH + t * height;
            }
            const radius = 0.8 + Math.random() * 1.2;
            const spark = this.scene.add.circle(px, py, radius, SPARK_COLOR, 0.95);
            this.hostContainer.add(spark);
            this.particles.add(spark);
            // Drift along the outward normal (px-x, py-y), scaled.
            const dx = px - x;
            const dy = py - y;
            const driftX = px + dx * 0.5 + (Math.random() - 0.5) * 3;
            const driftY = py + dy * 0.5 + (Math.random() - 0.5) * 3;
            const lifetime = 620 + Math.random() * 420;
            this.scene.tweens.add({
                targets: spark,
                x: driftX,
                y: driftY,
                alpha: 0,
                scale: 0.3,
                duration: lifetime,
                ease: 'Sine.out',
                onComplete: () => {
                    this.particles.delete(spark);
                    spark.destroy();
                },
            });
        };
        // Eagerly seed a few sparks so the cue reads as "on" the
        // moment the predicate flips true — without this the first
        // visual is a delayed ring pulse, which feels sluggish.
        for (let i = 0; i < 4; i++) {
            this.scene.time.delayedCall(i * 60, spawnSpark);
        }
        this.spawnTimer = this.scene.time.addEvent({
            delay: SPARK_RATE_MS,
            loop: true,
            callback: spawnSpark,
        });
    }

    private stop(): void {
        this.active = false;
        if (this.spawnTimer) {
            this.spawnTimer.remove(false);
            this.spawnTimer = null;
        }
        this.tweens.forEach((tween) => tween.stop());
        this.tweens = [];
        this.rings.forEach((ring) => ring.destroy());
        this.rings = [];
        this.particles.forEach((spark) => spark.destroy());
        this.particles.clear();
        if (this.hostContainer) {
            this.hostContainer.destroy();
            this.hostContainer = null;
        }
    }
}
