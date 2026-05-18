/**
 * Sampled (file-based) SFX bank used as a layer / fallback inside
 * the procedural cue functions in `audio/ProceduralSfx.ts`.
 *
 * Each call to {@link SamplePlayback.play} creates a fresh
 * `AudioBufferSourceNode`, so rapid repeat plays (e.g. mouse darting
 * across map nodes) overlap cleanly without cutting each other off.
 * Returns `true` when a source was scheduled — callers use the
 * boolean to decide whether to run a synth fallback on top.
 */

import type { AudioCore } from './AudioCore';

/**
 * Keys for the small set of sampled SFX preloaded from
 * `public/audio/`.
 *
 * - `uiHover` / `uiClick` — short one-shot UI feedback.
 * - `torchIgnite` — one-shot ignition transient played by
 *   the torch-ignite procedural cue.
 * - `torchLoop` — long-form burning loop played by the torch
 *   ambience when the sample is available.
 * - `doorOpen` — sampled "door swinging open" cue layered on top
 *   of the procedural creak/thud by the door-open cue.
 * - `showName` — one-shot title-reveal cue played by `playShowName`
 *   on the boot screen.
 * - `combatHit` / `mobHit` / `shieldBlock` — hand-authored combat
 *   sample triple, preferred over the procedural synth cues when
 *   the buffers are decoded.
 * - `potionUse` / `levelUp` / `playerDeath` — hand-authored
 *   progression cue triple (heal gulp, ascending fanfare, descent).
 * - `chestRing` — chest-puzzle ring snap; preferred over the
 *   `lockpickClick` synth tick.
 * - `bleedStrike` / `cleaveSwing` — skill-specific samples played
 *   from {@link CombatHudController.performAction} in place of the
 *   generic `skillUse` cue for `bleed_strike` and `cleave`.
 */
export type SampleKey =
    | 'uiHover'
    | 'uiClick'
    | 'torchIgnite'
    | 'torchLoop'
    | 'doorOpen'
    | 'showName'
    | 'combatHit'
    | 'mobHit'
    | 'shieldBlock'
    | 'potionUse'
    | 'levelUp'
    | 'playerDeath'
    | 'chestRing'
    | 'bleedStrike'
    | 'cleaveSwing';

export class SamplePlayback {
    /**
     * Decoded AudioBuffers for the sampled UI SFX (hover / click) and
     * the larger boot-screen cues. Populated by {@link preload};
     * missing entries make the corresponding `play(...)` call return
     * `false` so the caller can run a synth fallback.
     */
    private readonly buffers: Map<SampleKey, AudioBuffer> = new Map();
    /**
     * Tracks an in-flight {@link preload} call so repeat invocations
     * (e.g. BootScene's create + a future scene-restart) share the
     * same fetch instead of re-downloading the OGG files.
     */
    private preloadPromise: Promise<void> | null = null;
    private readonly core: AudioCore;

    constructor(core: AudioCore) {
        this.core = core;
    }

    /**
     * Eagerly load the OGG / MP3 SFX samples so the first hover /
     * click after boot fires without a fetch-latency gap. Safe to
     * call multiple times — the underlying fetch + decode is
     * memoised by {@link preloadPromise}.
     *
     * Resolves even if individual files 404 — missing buffers stay
     * out of the cache and the corresponding `play(...)` call falls
     * back to the synth (or stays silent for `roomHover`).
     */
    preload(): Promise<void> {
        if (this.preloadPromise) return this.preloadPromise;
        const base = import.meta.env.BASE_URL;
        const ctx = this.core.ensure();
        const samples: Array<{ key: SampleKey; url: string }> = [
            { key: 'uiHover', url: `${base}audio/ui_hover.ogg` },
            { key: 'uiClick', url: `${base}audio/ui_click.ogg` },
            { key: 'torchIgnite', url: `${base}audio/torch_ignite.mp3` },
            { key: 'torchLoop', url: `${base}audio/torch_loop.mp3` },
            { key: 'doorOpen', url: `${base}audio/door_in_dungeon2.mp3` },
            { key: 'showName', url: `${base}audio/show_name.ogg` },
            { key: 'combatHit', url: `${base}audio/hit_sound.ogg` },
            { key: 'mobHit', url: `${base}audio/mob_hit.ogg` },
            { key: 'shieldBlock', url: `${base}audio/shield_sound.ogg` },
            { key: 'potionUse', url: `${base}audio/potion_use_sound.ogg` },
            { key: 'levelUp', url: `${base}audio/level_up_sound.ogg` },
            { key: 'playerDeath', url: `${base}audio/death_sound.ogg` },
            { key: 'chestRing', url: `${base}audio/good_open_chest_sound.ogg` },
            { key: 'bleedStrike', url: `${base}audio/blood_hit_sound.ogg` },
            { key: 'cleaveSwing', url: `${base}audio/rubka_sound.ogg` },
        ];
        this.preloadPromise = Promise.all(
            samples.map(async ({ key, url }) => {
                try {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const arrayBuffer = await res.arrayBuffer();
                    const buffer = await ctx.decodeAudioData(arrayBuffer);
                    this.buffers.set(key, buffer);
                } catch (err) {
                    console.warn(`[sfx] failed to preload ${key} from ${url}:`, err);
                }
            })
        ).then(() => undefined);
        return this.preloadPromise;
    }

    /** Look up a decoded buffer if it has been preloaded already. */
    getBuffer(key: SampleKey): AudioBuffer | undefined {
        return this.buffers.get(key);
    }

    /**
     * Play a one-shot sampled SFX through the master gain. Returns
     * `true` if the buffer was found and a source was scheduled,
     * `false` if the buffer hasn't preloaded yet, the audio engine
     * isn't ready, or the mute toggle is on.
     */
    play(key: SampleKey, gainValue: number): boolean {
        return this.playWithFade(key, gainValue, 0);
    }

    /**
     * Variant of {@link play} that ramps the per-source gain from 0
     * to `peakGain` over `fadeInMs`. Used for cues where the caller
     * wants a soft entry instead of an immediate hit (e.g. the
     * title-reveal cue on the boot screen).
     */
    playWithFade(key: SampleKey, peakGain: number, fadeInMs: number): boolean {
        const buffer = this.buffers.get(key);
        if (!buffer) return false;
        if (this.core.muted) return false;
        const ctx = this.core.ensure();
        const master = this.core.master;
        if (!master) return false;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        const peak = Math.max(0, peakGain);
        if (fadeInMs > 0) {
            const t = ctx.currentTime;
            const fadeS = fadeInMs / 1000;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(peak, t + fadeS);
        } else {
            gain.gain.value = peak;
        }
        source.connect(gain);
        gain.connect(master);
        source.start(0);
        return true;
    }
}
