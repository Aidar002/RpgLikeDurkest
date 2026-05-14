/**
 * The two ambient loops the game runs outside the main music track:
 *
 * - {@link DungeonAmbient}: a low droning bed that follows the
 *   player through the dungeon. Pitch and volume scale with depth.
 * - {@link TorchAmbient}: the boot-screen torch-crackle loop. Layers
 *   a sampled `torch_loop.mp3` (when preloaded) over a synthesised
 *   fallback of band-passed noise + scheduled "pops".
 *
 * Each ambient has its own start / stop methods; the
 * `SoundManager` facade owns one instance of each and delegates the
 * existing public API to them without behaviour change.
 */

import type { AudioCore } from './AudioCore';
import type { SamplePlayback } from './SamplePlayback';

/**
 * Deep droning ambience whose pitch drops with depth. Public methods
 * are idempotent — {@link DungeonAmbient.start} stops any previous
 * loop before starting the new one, and {@link DungeonAmbient.stop}
 * is safe to call when nothing is running.
 */
export class DungeonAmbient {
    private nodes: { osc: OscillatorNode; gain: GainNode }[] = [];
    private running = false;
    private readonly core: AudioCore;

    constructor(core: AudioCore) {
        this.core = core;
    }

    /** Start a deep droning ambience; pitch lowers with depth. */
    start(depth: number): void {
        this.stop();
        const ctx = this.core.ensure();
        const master = this.core.master;
        if (!master) return;
        this.running = true;

        const baseFreq = Math.max(25, 50 - depth * 0.8);
        const vol = Math.min(0.06, 0.02 + depth * 0.001);

        // Low drone
        const o1 = ctx.createOscillator();
        const g1 = ctx.createGain();
        o1.type = 'sine';
        o1.frequency.value = baseFreq;
        g1.gain.value = vol;
        o1.connect(g1);
        g1.connect(master);
        o1.start();
        this.nodes.push({ osc: o1, gain: g1 });

        // Subtle harmonic
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.type = 'sine';
        o2.frequency.value = baseFreq * 1.5;
        g2.gain.value = vol * 0.3;
        o2.connect(g2);
        g2.connect(master);
        o2.start();
        this.nodes.push({ osc: o2, gain: g2 });

        // LFO for pulsing
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.15 + depth * 0.005;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = vol * 0.4;
        lfo.connect(lfoGain);
        lfoGain.connect(g1.gain);
        lfo.start();
        this.nodes.push({ osc: lfo, gain: lfoGain });
    }

    /** Update ambient drone pitch for new depth. */
    updateDepth(depth: number): void {
        if (!this.running || this.nodes.length < 2) return;
        const baseFreq = Math.max(25, 50 - depth * 0.8);
        const vol = Math.min(0.06, 0.02 + depth * 0.001);
        const ctx = this.core.ensure();
        const t = ctx.currentTime;
        this.nodes[0].osc.frequency.linearRampToValueAtTime(baseFreq, t + 1);
        this.nodes[0].gain.gain.linearRampToValueAtTime(vol, t + 1);
        this.nodes[1].osc.frequency.linearRampToValueAtTime(baseFreq * 1.5, t + 1);
        this.nodes[1].gain.gain.linearRampToValueAtTime(vol * 0.3, t + 1);
    }

    stop(): void {
        for (const n of this.nodes) {
            try {
                n.osc.stop();
            } catch {
                /* already stopped */
            }
        }
        this.nodes = [];
        this.running = false;
    }
}

/**
 * Boot-screen torch-crackle ambience. When the
 * `torch_loop.mp3` sample is preloaded, two looped sources play at
 * slightly different rates / start offsets so the two on-screen
 * torches sound independent rather than phase-locked. When the
 * sample is missing the synth fallback layers band-passed hiss + a
 * low brown-noise rumble + scheduled high-passed "pop" bursts.
 */
export class TorchAmbient {
    /**
     * Source nodes + per-layer gain envelopes for the torch-crackle
     * ambience. Tracks every active source — sampled loop layers,
     * synth fallback layers, or a mix — so {@link stop} can fade
     * them all together.
     */
    private layers: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
    private running = false;
    private popTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly core: AudioCore;
    private readonly samples: SamplePlayback;

    constructor(core: AudioCore, samples: SamplePlayback) {
        this.core = core;
        this.samples = samples;
    }

    /**
     * Loop a continuous "torch crackle" ambience. Fades in over
     * `fadeInMs` so the boot screen doesn't start with an audible
     * click. Idempotent — if the loop is already running, the
     * second call is a no-op.
     */
    start(fadeInMs = 600): void {
        if (this.running) return;
        const ctx = this.core.ensure();
        const master = this.core.master;
        if (!master) return;
        this.running = true;

        // Prefer the sampled `torch_loop.mp3` once it's preloaded.
        // Two looped sources are layered with different start offsets
        // and slightly different playback rates so:
        //   - the two torches on screen sound independent rather than
        //     phase-locked,
        //   - the audio cycle never aligns cleanly with the ~10 fps
        //     visual flame animation (the rate drift desyncs them
        //     over time even if they happened to start in phase).
        // Tracked in `layers` like the procedural layers so
        // `stop` can fade everything together.
        const loopBuffer = this.samples.getBuffer('torchLoop');
        if (loopBuffer) {
            const t = ctx.currentTime;
            const fadeS = Math.max(0.01, fadeInMs / 1000);
            // Per-layer peak gains scaled to ~39 % of the original
            // (0.8 * 0.7 * 0.7) so the burning loop sits well under
            // the menu music + ignition transients.
            const layerSpecs: Array<{ baseOffset: number; rate: number; gain: number }> = [
                { baseOffset: 0, rate: 1.0, gain: 0.16464 },
                { baseOffset: loopBuffer.duration * 0.5, rate: 0.96, gain: 0.12544 },
            ];
            for (const { baseOffset, rate, gain } of layerSpecs) {
                const src = ctx.createBufferSource();
                src.buffer = loopBuffer;
                src.loop = true;
                src.playbackRate.value = rate;
                const g = ctx.createGain();
                g.gain.value = 0;
                g.gain.linearRampToValueAtTime(gain, t + fadeS);
                src.connect(g);
                g.connect(master);
                // A second of jitter on top of the fixed half-buffer
                // offset so re-mounting BootScene doesn't restart
                // both torches from the same crackle moment every
                // time.
                const jitter = Math.random() * 1.0;
                const offset = (baseOffset + jitter) % loopBuffer.duration;
                src.start(0, offset);
                this.layers.push({ src, gain: g });
            }
            return;
        }

        // 1. Mid-range hiss: 4 s of white noise looped, band-passed
        //    around 1.5 kHz then softened by a low-pass at 3.5 kHz.
        //    Reads as the continuous fire hiss.
        const hissBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 4), ctx.sampleRate);
        const hiss = hissBuf.getChannelData(0);
        for (let i = 0; i < hiss.length; i++) hiss[i] = (Math.random() * 2 - 1) * 0.5;
        const hissSrc = ctx.createBufferSource();
        hissSrc.buffer = hissBuf;
        hissSrc.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1500;
        bp.Q.value = 0.8;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3500;
        const hissGain = ctx.createGain();
        hissGain.gain.value = 0;
        hissSrc.connect(bp);
        bp.connect(lp);
        lp.connect(hissGain);
        hissGain.connect(master);
        hissSrc.start();
        this.layers.push({ src: hissSrc, gain: hissGain });

        // 2. Low rumble: 3 s of brown-noise loop, low-passed at
        //    200 Hz. Gives the cue a body so it doesn't sound like
        //    just static.
        const rumbleBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 3), ctx.sampleRate);
        const rumble = rumbleBuf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < rumble.length; i++) {
            const w = Math.random() * 2 - 1;
            last = (last + 0.02 * w) / 1.02;
            rumble[i] = last * 3;
        }
        const rumbleSrc = ctx.createBufferSource();
        rumbleSrc.buffer = rumbleBuf;
        rumbleSrc.loop = true;
        const rumbleLp = ctx.createBiquadFilter();
        rumbleLp.type = 'lowpass';
        rumbleLp.frequency.value = 200;
        const rumbleGain = ctx.createGain();
        rumbleGain.gain.value = 0;
        rumbleSrc.connect(rumbleLp);
        rumbleLp.connect(rumbleGain);
        rumbleGain.connect(master);
        rumbleSrc.start();
        this.layers.push({ src: rumbleSrc, gain: rumbleGain });

        // Fade the loops up so we don't start with a transient click.
        const t = ctx.currentTime;
        const fadeS = Math.max(0.01, fadeInMs / 1000);
        // Synth-fallback layer peaks scaled to ~39 % of the original
        // (0.8 * 0.7 * 0.7) so the procedural crackle mirrors the
        // sampled loop's very-low mix above.
        hissGain.gain.linearRampToValueAtTime(0.06272, t + fadeS);
        rumbleGain.gain.linearRampToValueAtTime(0.02352, t + fadeS);

        // 3. Schedule random "pops" — short bursts of high-passed
        //    noise — every 200–900 ms. These are what sells the cue
        //    as fire crackle rather than generic radio noise.
        const scheduleNext = () => {
            if (!this.running) return;
            const delayMs = 200 + Math.random() * 700;
            this.popTimer = setTimeout(() => {
                if (!this.running) return;
                this.playPop();
                scheduleNext();
            }, delayMs);
        };
        scheduleNext();
    }

    /**
     * Stop the torch crackle ambience. Fades all layers to silence
     * over `fadeOutMs`, then schedules the underlying source nodes
     * to stop so they GC. Safe to call when nothing is running.
     */
    stop(fadeOutMs = 400): void {
        if (!this.running) return;
        this.running = false;
        if (this.popTimer != null) {
            clearTimeout(this.popTimer);
            this.popTimer = null;
        }
        const ctx = this.core.ensure();
        const t = ctx.currentTime;
        const fadeS = Math.max(0.01, fadeOutMs / 1000);
        const layers = this.layers;
        this.layers = [];
        for (const layer of layers) {
            try {
                layer.gain.gain.cancelScheduledValues(t);
                layer.gain.gain.setValueAtTime(layer.gain.gain.value, t);
                layer.gain.gain.linearRampToValueAtTime(0, t + fadeS);
                layer.src.stop(t + fadeS + 0.05);
            } catch {
                /* already stopped */
            }
        }
    }

    /** One short crackle pop, ~50–90 ms, high-passed so it sits on top of the hiss. */
    private playPop(): void {
        const ctx = this.core.ensure();
        const master = this.core.master;
        if (!master) return;
        const len = 0.04 + Math.random() * 0.05;
        const samples = Math.round(ctx.sampleRate * len);
        const buf = ctx.createBuffer(1, samples, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < samples; i++) {
            // Linear fade so each pop has a sharp attack and decay.
            const envFade = 1 - i / samples;
            data[i] = (Math.random() * 2 - 1) * envFade;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 800;
        const gain = ctx.createGain();
        // ~39 % of the original random range (0.8 * 0.7 * 0.7) so
        // individual crackle pops match the rest of the further-
        // dimmed burning loop.
        gain.gain.value = 0.02352 + Math.random() * 0.02744;
        src.connect(hp);
        hp.connect(gain);
        gain.connect(master);
        src.start();
    }
}
