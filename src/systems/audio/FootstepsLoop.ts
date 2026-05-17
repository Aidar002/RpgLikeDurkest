/**
 * Looped footsteps SFX played while the camera-pan transition
 * between rooms is animating. The audio file is loaded lazily on the
 * first {@link FootstepsLoop.start} call and routed through the
 * master gain so it shares the SFX volume slider + mute toggle.
 *
 * Extracted from the original `SoundManager` so the file-based
 * footsteps system lives next to its single owner — the manager
 * keeps an instance and delegates the start/stop public API
 * unchanged.
 */

import type { AudioCore } from './AudioCore';

/**
 * Peak gain target for the footsteps loop. Web Audio gain nodes
 * accept values >1 (the master gain that follows the SFX slider
 * scales it back down), so a small boost here keeps the recording
 * audible above the rest of the SFX bed without distorting.
 */
const FOOTSTEPS_PEAK_GAIN = 3.0;

export class FootstepsLoop {
    private audio: HTMLAudioElement | null = null;
    private fadeGain: GainNode | null = null;
    private fadeRaf: number | null = null;
    private readonly core: AudioCore;

    constructor(core: AudioCore) {
        this.core = core;
    }

    /**
     * Start the footsteps loop, ramping the volume from 0 to
     * {@link FOOTSTEPS_PEAK_GAIN} over `fadeInMs` so the cue never
     * lurches into existence. The audio element is created once and
     * reused on subsequent calls.
     */
    start(fadeInMs = 600): void {
        const ctx = this.core.ensure();
        const master = this.core.master;
        if (!master) return;
        if (!this.audio || !this.fadeGain) {
            const audio = new Audio(`${import.meta.env.BASE_URL}audio/steps_sound1.ogg`);
            audio.loop = true;
            audio.preload = 'auto';
            audio.volume = 1;
            const source = ctx.createMediaElementSource(audio);
            const gain = ctx.createGain();
            gain.gain.value = 0;
            source.connect(gain);
            gain.connect(master);
            this.audio = audio;
            this.fadeGain = gain;
        }
        const audio = this.audio;
        try {
            audio.currentTime = 0;
        } catch {
            /* file may not be ready yet */
        }
        void audio.play().catch(() => {
            /* autoplay race; safe to ignore */
        });
        this.fade(FOOTSTEPS_PEAK_GAIN, fadeInMs);
    }

    /** Fade the loop to silence over `fadeOutMs` and pause playback. */
    stop(fadeOutMs = 600): void {
        if (!this.audio) return;
        const audio = this.audio;
        this.fade(0, fadeOutMs, () => {
            try {
                audio.pause();
            } catch {
                /* ignored */
            }
        });
    }

    private fade(target: number, durationMs: number, onComplete?: () => void): void {
        if (!this.fadeGain) return;
        const gain = this.fadeGain;
        const startValue = gain.gain.value;
        const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (this.fadeRaf != null && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(this.fadeRaf);
        }
        this.fadeRaf = null;
        const safeDuration = Math.max(1, durationMs);
        const tick = () => {
            if (!this.fadeGain) return;
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const t = Math.max(0, Math.min(1, (now - startTime) / safeDuration));
            this.fadeGain.gain.value = startValue + (target - startValue) * t;
            if (t < 1) {
                this.fadeRaf =
                    typeof requestAnimationFrame !== 'undefined'
                        ? requestAnimationFrame(tick)
                        : null;
                if (this.fadeRaf == null) {
                    this.fadeGain.gain.value = target;
                    onComplete?.();
                }
            } else {
                this.fadeGain.gain.value = target;
                this.fadeRaf = null;
                onComplete?.();
            }
        };
        tick();
    }
}
