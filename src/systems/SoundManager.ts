/**
 * Procedural sound engine using Web Audio API.
 *
 * Most cues are synthesized at runtime via short oscillator + noise
 * chains routed through the master gain. A small set of UI feedback
 * sounds (hover / click) are loaded from OGG files in `public/audio/`
 * because the procedural versions read as "beeps" — see
 * {@link SoundManager.preloadUiSfx}. The footsteps loop also uses a
 * file (`steps_sound1.ogg`); see {@link SoundManager.startFootstepsLoop}.
 */

type SoundId =
    | 'hit'
    | 'crit'
    | 'defend'
    | 'enemyHit'
    | 'evade'
    | 'skillUse'
    | 'potion'
    | 'treasure'
    | 'trapTrigger'
    | 'trapDisarm'
    | 'rest'
    | 'shrine'
    | 'merchant'
    | 'bossAppear'
    | 'eliteAppear'
    | 'buttonClick'
    | 'buttonHover'
    | 'levelUp'
    | 'death'
    | 'victory'
    | 'whisper'
    | 'nodeSelect'
    | 'roomHover'
    | 'relicDrop'
    | 'footstep'
    | 'torchIgnite'
    | 'doorOpen';

/**
 * Keys for the small set of sampled UI SFX preloaded from
 * `public/audio/*.ogg`. Kept distinct from {@link SoundId} so the
 * compile-time exhaustiveness check on `play()` doesn't need to know
 * about the buffer cache.
 */
type SampleKey = 'uiHover' | 'uiClick';

const STORAGE_KEY = 'dd_sound_muted';
const VOLUME_KEY = 'dd_sound_volume';

function readSavedVolume(fallback: number): number {
    try {
        const raw = localStorage.getItem(VOLUME_KEY);
        if (raw == null) return fallback;
        const parsed = Number.parseFloat(raw);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(0, Math.min(1, parsed));
    } catch {
        return fallback;
    }
}

export class SoundManager {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private _muted: boolean;
    private _volume: number;
    private ambientNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
    private ambientRunning = false;
    private footstepsAudio: HTMLAudioElement | null = null;
    private footstepsFadeGain: GainNode | null = null;
    private footstepsFadeRaf: number | null = null;
    /**
     * Decoded AudioBuffers for the sampled UI SFX (hover / click).
     * Populated by {@link preloadUiSfx}; missing entries make the
     * corresponding `play(...)` call fall back to the procedural synth.
     */
    private sampleBuffers: Map<SampleKey, AudioBuffer> = new Map();
    /**
     * Tracks an in-flight `preloadUiSfx()` call so repeat invocations
     * (e.g. BootScene's create + a future scene-restart) share the
     * same fetch instead of re-downloading the OGG files.
     */
    private samplePreloadPromise: Promise<void> | null = null;

    constructor() {
        this._muted = localStorage.getItem(STORAGE_KEY) === '1';
        this._volume = readSavedVolume(0.45);
    }

    /** Lazily create AudioContext on first user interaction. */
    private ensure(): AudioContext {
        if (!this.ctx) {
            this.ctx = new AudioContext();
            this.master = this.ctx.createGain();
            this.master.gain.value = this._muted ? 0 : this._volume;
            this.master.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        return this.ctx;
    }

    get muted(): boolean {
        return this._muted;
    }

    toggleMute(): boolean {
        this._muted = !this._muted;
        localStorage.setItem(STORAGE_KEY, this._muted ? '1' : '0');
        if (this.master) {
            this.master.gain.value = this._muted ? 0 : this._volume;
        }
        return this._muted;
    }

    get volume(): number {
        return this._volume;
    }

    setVolume(v: number) {
        this._volume = Math.max(0, Math.min(1, v));
        try {
            localStorage.setItem(VOLUME_KEY, String(this._volume));
        } catch {
            /* ignored */
        }
        if (this.master && !this._muted) {
            this.master.gain.value = this._volume;
        }
    }

    // ─── helpers ───────────────────────────────────────────────

    private osc(
        type: OscillatorType,
        freq: number,
        duration: number,
        volume = 0.3,
        dest?: AudioNode
    ): { osc: OscillatorNode; gain: GainNode } {
        const ctx = this.ensure();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.value = volume;
        o.connect(g);
        g.connect(dest ?? this.master!);
        o.start(ctx.currentTime);
        o.stop(ctx.currentTime + duration);
        return { osc: o, gain: g };
    }

    private noise(
        duration: number,
        volume = 0.15,
        dest?: AudioNode
    ): { src: AudioBufferSourceNode; gain: GainNode } {
        const ctx = this.ensure();
        const len = Math.round(ctx.sampleRate * duration);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = volume;
        src.connect(g);
        g.connect(dest ?? this.master!);
        src.start(ctx.currentTime);
        src.stop(ctx.currentTime + duration);
        return { src, gain: g };
    }

    private env(gain: GainNode, attack: number, decay: number, sustain: number, release: number) {
        const ctx = this.ensure();
        const t = ctx.currentTime;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(gain.gain.value, t + attack);
        gain.gain.linearRampToValueAtTime(gain.gain.value * sustain, t + attack + decay);
        gain.gain.linearRampToValueAtTime(0, t + attack + decay + release);
    }

    private sweep(
        from: number,
        to: number,
        duration: number,
        type: OscillatorType = 'sine',
        volume = 0.2
    ) {
        const ctx = this.ensure();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(from, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(Math.max(to, 20), ctx.currentTime + duration);
        g.gain.value = volume;
        this.env(g, 0.01, duration * 0.3, 0.4, duration * 0.5);
        o.connect(g);
        g.connect(this.master!);
        o.start(ctx.currentTime);
        o.stop(ctx.currentTime + duration);
    }

    // ─── sampled UI SFX ────────────────────────────────────────

    /**
     * Eagerly load the OGG-encoded UI samples (hover / click) so the
     * first hover / click after boot fires without a fetch-latency
     * gap. Safe to call multiple times — the underlying fetch +
     * decode is memoised by {@link samplePreloadPromise}.
     *
     * Resolves even if individual files 404 — missing buffers stay
     * out of the cache and the corresponding `play(...)` call falls
     * back to the synth (or stays silent for `roomHover`).
     */
    preloadUiSfx(): Promise<void> {
        if (this.samplePreloadPromise) return this.samplePreloadPromise;
        const base = import.meta.env.BASE_URL;
        const ctx = this.ensure();
        const samples: Array<{ key: SampleKey; url: string }> = [
            { key: 'uiHover', url: `${base}audio/ui_hover.ogg` },
            { key: 'uiClick', url: `${base}audio/ui_click.ogg` },
        ];
        this.samplePreloadPromise = Promise.all(
            samples.map(async ({ key, url }) => {
                try {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const arrayBuffer = await res.arrayBuffer();
                    const buffer = await ctx.decodeAudioData(arrayBuffer);
                    this.sampleBuffers.set(key, buffer);
                } catch (err) {
                    console.warn(`[sfx] failed to preload ${key} from ${url}:`, err);
                }
            })
        ).then(() => undefined);
        return this.samplePreloadPromise;
    }

    /**
     * Play a one-shot sampled SFX through the master gain so it
     * obeys the mute toggle and the SFX volume slider. Each call
     * creates a fresh `AudioBufferSourceNode`, so rapid repeat plays
     * (e.g. mouse darting across map nodes) overlap cleanly without
     * cutting each other off.
     *
     * Returns `true` if the buffer was found and a source was
     * scheduled — callers use this to decide whether to run a synth
     * fallback. Returns `false` if the buffer hasn't been preloaded
     * yet, the audio engine isn't ready, or the mute toggle is on
     * (no point feeding a source through a 0-gain master node).
     */
    private playSample(key: SampleKey, gainValue: number): boolean {
        const buffer = this.sampleBuffers.get(key);
        if (!buffer) return false;
        if (this._muted) return false;
        const ctx = this.ensure();
        if (!this.master) return false;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.value = Math.max(0, gainValue);
        source.connect(gain);
        gain.connect(this.master);
        source.start(0);
        return true;
    }

    // ─── public play ───────────────────────────────────────────

    play(id: SoundId) {
        this.ensure();
        switch (id) {
            case 'hit':
                return this.playHit();
            case 'crit':
                return this.playCrit();
            case 'defend':
                return this.playDefend();
            case 'enemyHit':
                return this.playEnemyHit();
            case 'evade':
                return this.playEvade();
            case 'skillUse':
                return this.playSkillUse();
            case 'potion':
                return this.playPotion();
            case 'treasure':
                return this.playTreasure();
            case 'trapTrigger':
                return this.playTrapTrigger();
            case 'trapDisarm':
                return this.playTrapDisarm();
            case 'rest':
                return this.playRest();
            case 'shrine':
                return this.playShrine();
            case 'merchant':
                return this.playMerchant();
            case 'bossAppear':
                return this.playBossAppear();
            case 'eliteAppear':
                return this.playEliteAppear();
            case 'buttonClick':
                return this.playButtonClick();
            case 'buttonHover':
                return this.playButtonHover();
            case 'levelUp':
                return this.playLevelUp();
            case 'death':
                return this.playDeath();
            case 'victory':
                return this.playVictory();
            case 'whisper':
                return this.playWhisper();
            case 'nodeSelect':
                return this.playNodeSelect();
            case 'roomHover':
                return this.playRoomHover();
            case 'relicDrop':
                return this.playRelicDrop();
            case 'footstep':
                return this.playFootstep();
            case 'torchIgnite':
                return this.playTorchIgnite();
            case 'doorOpen':
                return this.playDoorOpen();
        }
    }

    // ─── sound implementations ─────────────────────────────────

    /** Short metallic slash. */
    private playHit() {
        const { gain } = this.noise(0.08, 0.25);
        this.env(gain, 0.005, 0.02, 0.3, 0.05);
        this.osc('square', 220, 0.06, 0.12);
        this.osc('sawtooth', 440, 0.04, 0.08);
    }

    /** Big crunch with bright ring. */
    private playCrit() {
        const { gain } = this.noise(0.14, 0.35);
        this.env(gain, 0.005, 0.03, 0.4, 0.08);
        this.osc('sawtooth', 660, 0.08, 0.18);
        this.osc('square', 330, 0.12, 0.15);
        this.sweep(880, 220, 0.15, 'sawtooth', 0.12);
    }

    /** Shield clang. */
    private playDefend() {
        this.osc('triangle', 520, 0.1, 0.2);
        this.osc('sine', 780, 0.08, 0.1);
        const { gain } = this.noise(0.06, 0.12);
        this.env(gain, 0.003, 0.02, 0.2, 0.04);
    }

    /** Dull thud when enemy hits player. */
    private playEnemyHit() {
        const { gain } = this.noise(0.1, 0.2);
        this.env(gain, 0.005, 0.03, 0.3, 0.06);
        this.sweep(180, 60, 0.12, 'sine', 0.2);
    }

    /** Whoosh for dodge. */
    private playEvade() {
        this.sweep(800, 200, 0.18, 'sine', 0.12);
        const { gain } = this.noise(0.12, 0.06);
        this.env(gain, 0.01, 0.04, 0.2, 0.06);
    }

    /** Magic activation. */
    private playSkillUse() {
        this.sweep(300, 900, 0.2, 'sine', 0.15);
        this.osc('triangle', 600, 0.15, 0.1);
        const ctx = this.ensure();
        setTimeout(() => {
            if (this.ctx) {
                this.osc('sine', 800, 0.1, 0.08);
            }
        }, 100);
        void ctx;
    }

    /** Bubbly gulp. */
    private playPotion() {
        const ctx = this.ensure();
        const t = ctx.currentTime;
        for (let i = 0; i < 3; i++) {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = 400 + i * 80;
            g.gain.setValueAtTime(0, t + i * 0.06);
            g.gain.linearRampToValueAtTime(0.12, t + i * 0.06 + 0.02);
            g.gain.linearRampToValueAtTime(0, t + i * 0.06 + 0.08);
            o.connect(g);
            g.connect(this.master!);
            o.start(t + i * 0.06);
            o.stop(t + i * 0.06 + 0.08);
        }
    }

    /** Sparkling coins. */
    private playTreasure() {
        const ctx = this.ensure();
        const t = ctx.currentTime;
        const notes = [800, 1000, 1200, 1400];
        notes.forEach((f, i) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = f;
            g.gain.setValueAtTime(0, t + i * 0.07);
            g.gain.linearRampToValueAtTime(0.15, t + i * 0.07 + 0.01);
            g.gain.linearRampToValueAtTime(0, t + i * 0.07 + 0.12);
            o.connect(g);
            g.connect(this.master!);
            o.start(t + i * 0.07);
            o.stop(t + i * 0.07 + 0.12);
        });
    }

    /** Sharp snap. */
    private playTrapTrigger() {
        const { gain } = this.noise(0.12, 0.35);
        this.env(gain, 0.002, 0.02, 0.5, 0.08);
        this.sweep(600, 80, 0.1, 'square', 0.2);
    }

    /** Satisfying click. */
    private playTrapDisarm() {
        this.osc('triangle', 600, 0.06, 0.15);
        const ctx = this.ensure();
        const t = ctx.currentTime;
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.type = 'sine';
        o2.frequency.value = 900;
        g2.gain.setValueAtTime(0, t + 0.08);
        g2.gain.linearRampToValueAtTime(0.12, t + 0.09);
        g2.gain.linearRampToValueAtTime(0, t + 0.18);
        o2.connect(g2);
        g2.connect(this.master!);
        o2.start(t + 0.08);
        o2.stop(t + 0.18);
    }

    /** Warm crackling. */
    private playRest() {
        const ctx = this.ensure();
        const t = ctx.currentTime;
        for (let i = 0; i < 4; i++) {
            const len = 0.03 + Math.random() * 0.04;
            const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * len), ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let j = 0; j < data.length; j++) data[j] = (Math.random() * 2 - 1) * 0.3;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const g = ctx.createGain();
            const start = t + i * 0.12 + Math.random() * 0.05;
            g.gain.setValueAtTime(0, start);
            g.gain.linearRampToValueAtTime(0.08, start + 0.01);
            g.gain.linearRampToValueAtTime(0, start + len);
            src.connect(g);
            g.connect(this.master!);
            src.start(start);
            src.stop(start + len);
        }
        this.osc('sine', 200, 0.3, 0.04);
    }

    /**
     * Torch catching fire: tiny flint click followed by a low "fwoom"
     * of burning air. ~0.5 s total. Filed under SFX so it respects
     * the same mute/volume controls as the rest of the bank.
     */
    private playTorchIgnite() {
        const ctx = this.ensure();
        const t = ctx.currentTime;

        // 1) Flint click — very short, slightly metallic crack.
        const clickBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.03), ctx.sampleRate);
        const clickData = clickBuf.getChannelData(0);
        for (let i = 0; i < clickData.length; i++) {
            clickData[i] = (Math.random() * 2 - 1) * (1 - i / clickData.length);
        }
        const clickSrc = ctx.createBufferSource();
        clickSrc.buffer = clickBuf;
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.18, t);
        clickGain.gain.linearRampToValueAtTime(0, t + 0.03);
        clickSrc.connect(clickGain);
        clickGain.connect(this.master!);
        clickSrc.start(t);
        clickSrc.stop(t + 0.03);

        // 2) Whoosh — band-passed noise that ramps in over 60 ms,
        //    decays over ~0.45 s. Reads as the body of the flame.
        const whooshLen = 0.5;
        const whooshBuf = ctx.createBuffer(
            1,
            Math.round(ctx.sampleRate * whooshLen),
            ctx.sampleRate
        );
        const whooshData = whooshBuf.getChannelData(0);
        for (let i = 0; i < whooshData.length; i++) {
            whooshData[i] = Math.random() * 2 - 1;
        }
        const whooshSrc = ctx.createBufferSource();
        whooshSrc.buffer = whooshBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(380, t + 0.02);
        bp.frequency.exponentialRampToValueAtTime(180, t + whooshLen);
        bp.Q.value = 0.9;
        const whooshGain = ctx.createGain();
        const start = t + 0.02;
        whooshGain.gain.setValueAtTime(0, start);
        whooshGain.gain.linearRampToValueAtTime(0.22, start + 0.06);
        whooshGain.gain.linearRampToValueAtTime(0.05, start + 0.3);
        whooshGain.gain.linearRampToValueAtTime(0, start + whooshLen);
        whooshSrc.connect(bp);
        bp.connect(whooshGain);
        whooshGain.connect(this.master!);
        whooshSrc.start(start);
        whooshSrc.stop(start + whooshLen);

        // 3) Sub-bass "thump" so the ignition lands with weight.
        const sub = ctx.createOscillator();
        const subGain = ctx.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(110, t + 0.02);
        sub.frequency.exponentialRampToValueAtTime(60, t + 0.35);
        subGain.gain.setValueAtTime(0, t + 0.02);
        subGain.gain.linearRampToValueAtTime(0.12, t + 0.05);
        subGain.gain.linearRampToValueAtTime(0, t + 0.4);
        sub.connect(subGain);
        subGain.connect(this.master!);
        sub.start(t + 0.02);
        sub.stop(t + 0.4);
    }

    /**
     * Heavy wooden door swinging open: low creak ramp + thud at the
     * end of the swing. ~0.9 s total. Used by the boot-screen door
     * sprite when the player clicks "Start expedition".
     */
    private playDoorOpen() {
        const ctx = this.ensure();
        const t = ctx.currentTime;

        // 1) Creak — narrow band-passed noise sweeping down from
        //    ~280 Hz to ~120 Hz over ~0.7 s. Reads as old hinges.
        const creakLen = 0.7;
        const creakBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * creakLen), ctx.sampleRate);
        const creakData = creakBuf.getChannelData(0);
        for (let i = 0; i < creakData.length; i++) {
            creakData[i] = Math.random() * 2 - 1;
        }
        const creakSrc = ctx.createBufferSource();
        creakSrc.buffer = creakBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(280, t);
        bp.frequency.exponentialRampToValueAtTime(120, t + creakLen);
        bp.Q.value = 4.2;
        const creakGain = ctx.createGain();
        creakGain.gain.setValueAtTime(0, t);
        creakGain.gain.linearRampToValueAtTime(0.28, t + 0.08);
        creakGain.gain.linearRampToValueAtTime(0.18, t + 0.45);
        creakGain.gain.linearRampToValueAtTime(0, t + creakLen);
        creakSrc.connect(bp);
        bp.connect(creakGain);
        creakGain.connect(this.master!);
        creakSrc.start(t);
        creakSrc.stop(t + creakLen);

        // 2) Wood thud — low sine pulse landing at the end of the
        //    swing so the door settles with weight.
        const thud = ctx.createOscillator();
        const thudGain = ctx.createGain();
        thud.type = 'sine';
        thud.frequency.setValueAtTime(90, t + creakLen - 0.05);
        thud.frequency.exponentialRampToValueAtTime(45, t + creakLen + 0.25);
        thudGain.gain.setValueAtTime(0, t + creakLen - 0.05);
        thudGain.gain.linearRampToValueAtTime(0.24, t + creakLen);
        thudGain.gain.linearRampToValueAtTime(0, t + creakLen + 0.3);
        thud.connect(thudGain);
        thudGain.connect(this.master!);
        thud.start(t + creakLen - 0.05);
        thud.stop(t + creakLen + 0.3);
    }

    /** Ethereal chime. */
    private playShrine() {
        const ctx = this.ensure();
        const t = ctx.currentTime;
        [523, 659, 784].forEach((f, i) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = f;
            g.gain.setValueAtTime(0, t + i * 0.12);
            g.gain.linearRampToValueAtTime(0.15, t + i * 0.12 + 0.03);
            g.gain.linearRampToValueAtTime(0, t + i * 0.12 + 0.35);
            o.connect(g);
            g.connect(this.master!);
            o.start(t + i * 0.12);
            o.stop(t + i * 0.12 + 0.35);
        });
    }

    /** Coin clink. */
    private playMerchant() {
        this.osc('triangle', 1200, 0.05, 0.12);
        const ctx = this.ensure();
        const t = ctx.currentTime;
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.type = 'triangle';
        o2.frequency.value = 1500;
        g2.gain.setValueAtTime(0, t + 0.07);
        g2.gain.linearRampToValueAtTime(0.1, t + 0.08);
        g2.gain.linearRampToValueAtTime(0, t + 0.14);
        o2.connect(g2);
        g2.connect(this.master!);
        o2.start(t + 0.07);
        o2.stop(t + 0.14);
    }

    /** Low ominous drone for boss. */
    private playBossAppear() {
        const ctx = this.ensure();
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(55, t);
        o.frequency.linearRampToValueAtTime(40, t + 0.8);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.2, t + 0.15);
        g.gain.setValueAtTime(0.2, t + 0.5);
        g.gain.linearRampToValueAtTime(0, t + 0.8);
        o.connect(g);
        g.connect(this.master!);
        o.start(t);
        o.stop(t + 0.8);

        const { gain: ng } = this.noise(0.6, 0.08);
        this.env(ng, 0.1, 0.2, 0.3, 0.3);
    }

    /** Tension stinger for elite. */
    private playEliteAppear() {
        this.sweep(200, 100, 0.4, 'sawtooth', 0.15);
        const { gain } = this.noise(0.3, 0.06);
        this.env(gain, 0.05, 0.1, 0.3, 0.15);
    }

    /**
     * Click feedback for any UI button. Uses the sampled
     * `ui_click.ogg` once {@link preloadUiSfx} resolves; until then
     * (and as a permanent fallback if the file is missing) it falls
     * back to the short square-wave tick we used historically.
     */
    private playButtonClick() {
        if (this.playSample('uiClick', 1.1)) return;
        this.osc('square', 800, 0.03, 0.08);
    }

    /**
     * Soft chime fired when the cursor enters a reachable map node.
     * Sampled-only — there is no synth fallback because the hover
     * affordance is non-critical and a silent hover is preferable to
     * a beep that doesn't match the rest of the SFX bed.
     */
    private playRoomHover() {
        this.playSample('uiHover', 0.8);
    }

    /** Very soft tick on hover. */
    private playButtonHover() {
        this.osc('sine', 1000, 0.02, 0.04);
    }

    /** Ascending fanfare. */
    private playLevelUp() {
        const ctx = this.ensure();
        const t = ctx.currentTime;
        const notes = [523, 659, 784, 1047];
        notes.forEach((f, i) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'triangle';
            o.frequency.value = f;
            g.gain.setValueAtTime(0, t + i * 0.1);
            g.gain.linearRampToValueAtTime(0.18, t + i * 0.1 + 0.02);
            g.gain.linearRampToValueAtTime(0, t + i * 0.1 + 0.2);
            o.connect(g);
            g.connect(this.master!);
            o.start(t + i * 0.1);
            o.stop(t + i * 0.1 + 0.2);
        });
    }

    /** Dark descending drone. */
    private playDeath() {
        const ctx = this.ensure();
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(200, t);
        o.frequency.exponentialRampToValueAtTime(30, t + 1.2);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.2, t + 0.1);
        g.gain.setValueAtTime(0.2, t + 0.6);
        g.gain.linearRampToValueAtTime(0, t + 1.2);
        o.connect(g);
        g.connect(this.master!);
        o.start(t);
        o.stop(t + 1.2);

        const { gain: ng } = this.noise(1.0, 0.1);
        this.env(ng, 0.05, 0.3, 0.3, 0.5);
    }

    /** Triumphant ascending arpeggio with sustained glow. */
    private playVictory() {
        const ctx = this.ensure();
        const t = ctx.currentTime;
        const notes = [523, 659, 784, 1047, 1319];
        notes.forEach((f, i) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = f;
            g.gain.setValueAtTime(0, t + i * 0.12);
            g.gain.linearRampToValueAtTime(0.16, t + i * 0.12 + 0.03);
            g.gain.linearRampToValueAtTime(0.08, t + i * 0.12 + 0.25);
            g.gain.linearRampToValueAtTime(0, t + i * 0.12 + 0.5);
            o.connect(g);
            g.connect(this.master!);
            o.start(t + i * 0.12);
            o.stop(t + i * 0.12 + 0.5);
        });
        // Sustained harmonic bed
        const bed = ctx.createOscillator();
        const bg = ctx.createGain();
        bed.type = 'triangle';
        bed.frequency.value = 262;
        bg.gain.setValueAtTime(0, t + 0.3);
        bg.gain.linearRampToValueAtTime(0.06, t + 0.5);
        bg.gain.linearRampToValueAtTime(0, t + 1.5);
        bed.connect(bg);
        bg.connect(this.master!);
        bed.start(t + 0.3);
        bed.stop(t + 1.5);
    }

    /** Soft breathy whisper for narrative events. */
    private playWhisper() {
        const { gain } = this.noise(0.25, 0.06);
        this.env(gain, 0.05, 0.08, 0.4, 0.1);
        this.osc('sine', 300, 0.2, 0.03);
    }

    /** Map node selection. Uses the same `ui_click.ogg` sample as
     *  buttonClick so the room-pick feedback matches the rest of the
     *  UI. Falls back to the historical sine pip when the sample
     *  hasn't preloaded yet. */
    private playNodeSelect() {
        if (this.playSample('uiClick', 1.1)) return;
        this.osc('sine', 660, 0.05, 0.1);
    }

    /** Magical shimmer for relic drops. */
    private playRelicDrop() {
        const ctx = this.ensure();
        const t = ctx.currentTime;
        [880, 1100, 1320].forEach((f, i) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = f;
            g.gain.setValueAtTime(0, t + i * 0.08);
            g.gain.linearRampToValueAtTime(0.1, t + i * 0.08 + 0.02);
            g.gain.linearRampToValueAtTime(0, t + i * 0.08 + 0.2);
            o.connect(g);
            g.connect(this.master!);
            o.start(t + i * 0.08);
            o.stop(t + i * 0.08 + 0.2);
        });
    }

    /** Soft footstep for map movement. */
    private playFootstep() {
        const { gain } = this.noise(0.06, 0.1);
        this.env(gain, 0.005, 0.02, 0.2, 0.03);
        this.osc('sine', 120, 0.04, 0.06);
    }

    // ─── footsteps loop (room transitions) ─────────────────────

    /** Peak gain target for the footsteps loop. Web Audio gain nodes
     *  accept values >1 (the master gain that follows the SFX slider
     *  scales it back down), so a small boost here keeps the recording
     *  audible above the rest of the SFX bed without distorting. */
    private readonly footstepsPeakGain = 3.0;

    /**
     * Start a looped footsteps SFX (used while the camera-pan transition
     * between rooms is playing). The audio file is lazily loaded the first
     * time this is called and routed through the master gain so it shares
     * the SFX volume slider and mute toggle. The volume ramps up from 0
     * to `footstepsPeakGain` over `fadeInMs` so it never lurches into
     * existence.
     */
    startFootstepsLoop(fadeInMs = 600) {
        const ctx = this.ensure();
        if (!this.footstepsAudio || !this.footstepsFadeGain) {
            const audio = new Audio(`${import.meta.env.BASE_URL}audio/steps_sound1.ogg`);
            audio.loop = true;
            audio.preload = 'auto';
            audio.volume = 1;
            const source = ctx.createMediaElementSource(audio);
            const gain = ctx.createGain();
            gain.gain.value = 0;
            source.connect(gain);
            gain.connect(this.master!);
            this.footstepsAudio = audio;
            this.footstepsFadeGain = gain;
        }
        const audio = this.footstepsAudio;
        try {
            audio.currentTime = 0;
        } catch {
            /* file may not be ready yet */
        }
        void audio.play().catch(() => {
            /* autoplay race; safe to ignore */
        });
        this.fadeFootsteps(this.footstepsPeakGain, fadeInMs);
    }

    /** Fade the footsteps loop to silence over `fadeOutMs` and pause. */
    stopFootstepsLoop(fadeOutMs = 600) {
        if (!this.footstepsAudio) return;
        const audio = this.footstepsAudio;
        this.fadeFootsteps(0, fadeOutMs, () => {
            try {
                audio.pause();
            } catch {
                /* ignored */
            }
        });
    }

    private fadeFootsteps(target: number, durationMs: number, onComplete?: () => void) {
        if (!this.footstepsFadeGain) return;
        const gain = this.footstepsFadeGain;
        const startValue = gain.gain.value;
        const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (this.footstepsFadeRaf != null && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(this.footstepsFadeRaf);
        }
        this.footstepsFadeRaf = null;
        const safeDuration = Math.max(1, durationMs);
        const tick = () => {
            if (!this.footstepsFadeGain) return;
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const t = Math.max(0, Math.min(1, (now - startTime) / safeDuration));
            this.footstepsFadeGain.gain.value = startValue + (target - startValue) * t;
            if (t < 1) {
                this.footstepsFadeRaf =
                    typeof requestAnimationFrame !== 'undefined'
                        ? requestAnimationFrame(tick)
                        : (setTimeout(tick, 16) as unknown as number);
            } else {
                this.footstepsFadeRaf = null;
                onComplete?.();
            }
        };
        tick();
    }

    // ─── ambient ────────────────────────────────────────────────

    /** Start a deep droning ambience; pitch lowers with depth. */
    startAmbient(depth: number) {
        this.stopAmbient();
        const ctx = this.ensure();
        this.ambientRunning = true;

        const baseFreq = Math.max(25, 50 - depth * 0.8);
        const vol = Math.min(0.06, 0.02 + depth * 0.001);

        // Low drone
        const o1 = ctx.createOscillator();
        const g1 = ctx.createGain();
        o1.type = 'sine';
        o1.frequency.value = baseFreq;
        g1.gain.value = vol;
        o1.connect(g1);
        g1.connect(this.master!);
        o1.start();
        this.ambientNodes.push({ osc: o1, gain: g1 });

        // Subtle harmonic
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.type = 'sine';
        o2.frequency.value = baseFreq * 1.5;
        g2.gain.value = vol * 0.3;
        o2.connect(g2);
        g2.connect(this.master!);
        o2.start();
        this.ambientNodes.push({ osc: o2, gain: g2 });

        // LFO for pulsing
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.15 + depth * 0.005;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = vol * 0.4;
        lfo.connect(lfoGain);
        lfoGain.connect(g1.gain);
        lfo.start();
        this.ambientNodes.push({ osc: lfo, gain: lfoGain });
    }

    /** Update ambient drone pitch for new depth. */
    updateAmbientDepth(depth: number) {
        if (!this.ambientRunning || this.ambientNodes.length < 2) return;
        const baseFreq = Math.max(25, 50 - depth * 0.8);
        const vol = Math.min(0.06, 0.02 + depth * 0.001);
        const ctx = this.ensure();
        const t = ctx.currentTime;
        this.ambientNodes[0].osc.frequency.linearRampToValueAtTime(baseFreq, t + 1);
        this.ambientNodes[0].gain.gain.linearRampToValueAtTime(vol, t + 1);
        this.ambientNodes[1].osc.frequency.linearRampToValueAtTime(baseFreq * 1.5, t + 1);
        this.ambientNodes[1].gain.gain.linearRampToValueAtTime(vol * 0.3, t + 1);
    }

    stopAmbient() {
        for (const n of this.ambientNodes) {
            try {
                n.osc.stop();
            } catch {
                /* already stopped */
            }
        }
        this.ambientNodes = [];
        this.ambientRunning = false;
    }

    // ─── torch crackle ambient (boot screen) ───────────────────

    /**
     * Holds the source nodes + per-layer gain envelopes for the boot
     * screen's torch-crackle ambience. The layers are: (1) a band-
     * passed white-noise hiss centred where fire crackle naturally
     * lives, (2) a low-passed brown-noise rumble for the room
     * presence, and (3) a stream of short noise "pops" scheduled by
     * {@link torchPopTimer} that read as oil hitting flame.
     */
    private torchLayers: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
    private torchAmbientRunning = false;
    private torchPopTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Loop a continuous "torch crackle" ambience. Fades in over
     * `fadeInMs` so the boot screen doesn't start with an audible
     * click. Idempotent — if the loop is already running, the second
     * call is a no-op.
     *
     * The cue is built from synthesised noise routed through filters
     * (no audio file dependency) so it never blocks on a fetch, and
     * is intentionally quiet so it sits under any voice-over or
     * music a player adds later.
     */
    startTorchAmbient(fadeInMs = 600): void {
        if (this.torchAmbientRunning) return;
        const ctx = this.ensure();
        if (!this.master) return;
        this.torchAmbientRunning = true;

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
        hissGain.connect(this.master);
        hissSrc.start();
        this.torchLayers.push({ src: hissSrc, gain: hissGain });

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
        rumbleGain.connect(this.master);
        rumbleSrc.start();
        this.torchLayers.push({ src: rumbleSrc, gain: rumbleGain });

        // Fade the loops up so we don't start with a transient click.
        const t = ctx.currentTime;
        const fadeS = Math.max(0.01, fadeInMs / 1000);
        hissGain.gain.linearRampToValueAtTime(0.16, t + fadeS);
        rumbleGain.gain.linearRampToValueAtTime(0.06, t + fadeS);

        // 3. Schedule random "pops" — short bursts of high-passed
        //    noise — every 200–900 ms. These are what sells the cue
        //    as fire crackle rather than generic radio noise.
        const scheduleNext = () => {
            if (!this.torchAmbientRunning) return;
            const delayMs = 200 + Math.random() * 700;
            this.torchPopTimer = setTimeout(() => {
                if (!this.torchAmbientRunning) return;
                this.playTorchPop();
                scheduleNext();
            }, delayMs);
        };
        scheduleNext();
    }

    /** One short crackle pop, ~50–90 ms, high-passed so it sits on top of the hiss. */
    private playTorchPop(): void {
        const ctx = this.ensure();
        if (!this.master) return;
        const len = 0.04 + Math.random() * 0.05;
        const samples = Math.round(ctx.sampleRate * len);
        const buf = ctx.createBuffer(1, samples, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < samples; i++) {
            // Linear fade so each pop has a sharp attack and decay.
            const env = 1 - i / samples;
            data[i] = (Math.random() * 2 - 1) * env;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 800;
        const gain = ctx.createGain();
        gain.gain.value = 0.06 + Math.random() * 0.07;
        src.connect(hp);
        hp.connect(gain);
        gain.connect(this.master);
        src.start();
    }

    /**
     * Stop the torch crackle ambience. Fades all layers to silence
     * over `fadeOutMs`, then schedules the underlying source nodes
     * to stop so they GC. Safe to call when nothing is running.
     */
    stopTorchAmbient(fadeOutMs = 400): void {
        if (!this.torchAmbientRunning) return;
        this.torchAmbientRunning = false;
        if (this.torchPopTimer != null) {
            clearTimeout(this.torchPopTimer);
            this.torchPopTimer = null;
        }
        const ctx = this.ensure();
        const t = ctx.currentTime;
        const fadeS = Math.max(0.01, fadeOutMs / 1000);
        const layers = this.torchLayers;
        this.torchLayers = [];
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
}
