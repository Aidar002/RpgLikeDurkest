/**
 * Lightweight background-music player.
 *
 * Streams ordinary HTMLAudioElements (no Web Audio decoding cost, no
 * Phaser preload pass) so the build stays small — the `mp3` files in
 * `public/audio/` are served as-is and pulled in only when playback
 * starts. Tracks rotate sequentially with a short crossfade; volume is
 * persisted across sessions.
 *
 * Each audio element is routed through a Web Audio `MediaElementAudioSourceNode`
 * → master `GainNode` → `destination`, so the master gain is allowed to exceed
 * the HTMLAudioElement.volume hard cap of 1.0. If Web Audio is unavailable for
 * any reason, the manager falls back to driving `audio.volume` directly
 * (limited to 1.0).
 */

const VOLUME_KEY = 'dd_music_volume';
const MUTED_KEY = 'dd_music_muted';

/** Upper bound applied to the slider value when it actually drives the
 * audio gain. The previous cap was 1.0 — i.e. native HTMLAudioElement max
 * — and players still reported the music as too quiet (or sometimes
 * inaudible). Routing through Web Audio lifts the cap, so we now double
 * the peak to 2.0 (≈ 2× louder than the previous peak).
 */
const MUSIC_GAIN_CAP = 2.0;

/** Crossfade window (seconds) before a track ends. */
const CROSSFADE_S = 1.6;

/** Fade-in time for the very first track (seconds). */
const INITIAL_FADE_S = 1.5;

interface MusicTrack {
    /** Resolved URL to play (already prefixed with the Vite base path). */
    url: string;
}

export class MusicManager {
    private playlist: MusicTrack[] = [];
    private index = 0;
    private current: HTMLAudioElement | null = null;
    private next: HTMLAudioElement | null = null;
    private fadeRaf: number | null = null;
    private autoStartBound = false;
    private playRequested = false;
    private playing = false;
    private destroyed = false;
    private _volume: number;
    private _muted: boolean;
    private autoStartHandler: (() => void) | null = null;
    private audioContext: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private webAudioFailed = false;
    private wiredAudios = new WeakSet<HTMLAudioElement>();

    constructor() {
        this._volume = readVolume();
        this._muted = readMuted();
    }

    setPlaylist(tracks: MusicTrack[]): void {
        this.playlist = tracks;
        this.index = 0;
    }

    /**
     * Mark playback as requested. The actual `audio.play()` call needs a
     * user gesture, so we lazy-attach `pointerdown` / `keydown` listeners
     * on the window and retry from there. `kick()` may be called directly
     * from a known gesture handler to start immediately.
     */
    start(): void {
        if (this.destroyed || this.playlist.length === 0) return;
        this.playRequested = true;
        this.bindAutoStart();
        // Try once eagerly — sometimes the page already has gesture activation
        // (e.g. after a scene restart).
        this.attemptPlay();
    }

    /** Force a play attempt. Call this from a fresh user-gesture handler. */
    kick(): void {
        if (!this.playRequested) this.start();
        else this.attemptPlay();
    }

    private bindAutoStart(): void {
        if (this.autoStartBound || typeof window === 'undefined') return;
        this.autoStartBound = true;
        const handler = () => {
            if (this.destroyed) return;
            if (this.playing) return;
            this.attemptPlay();
        };
        this.autoStartHandler = handler;
        window.addEventListener('pointerdown', handler, true);
        window.addEventListener('keydown', handler, true);
        window.addEventListener('touchstart', handler, true);
    }

    private detachAutoStart(): void {
        if (!this.autoStartBound || !this.autoStartHandler || typeof window === 'undefined') return;
        window.removeEventListener('pointerdown', this.autoStartHandler, true);
        window.removeEventListener('keydown', this.autoStartHandler, true);
        window.removeEventListener('touchstart', this.autoStartHandler, true);
        this.autoStartBound = false;
        this.autoStartHandler = null;
    }

    private ensureCurrent(): HTMLAudioElement {
        if (this.current) return this.current;
        const audio = new Audio();
        audio.preload = 'auto';
        audio.loop = false;
        audio.src = this.playlist[this.index].url;
        audio.volume = 0;
        this.wireToMaster(audio);
        audio.addEventListener('error', () => {
            const err = audio.error;
            console.warn('[music] audio element error:', err?.code, err?.message, audio.src);
        });
        audio.addEventListener('ended', () => this.handleEnded(audio));
        audio.addEventListener('timeupdate', () => this.handleTimeUpdate(audio));
        this.current = audio;
        return audio;
    }

    private attemptPlay(): void {
        if (!this.playRequested || this.destroyed || this.playing) return;
        const audio = this.ensureCurrent();
        this.resumeAudioContext();
        const promise = audio.play();
        if (typeof promise?.then === 'function') {
            promise
                .then(() => {
                    this.playing = true;
                    this.fadeIn(audio, INITIAL_FADE_S);
                    this.detachAutoStart();
                })
                .catch((err: DOMException) => {
                    // NotAllowedError = autoplay policy; an upcoming user
                    // gesture will retry. Other errors are unexpected.
                    if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
                        console.warn('[music] play() rejected:', err.name, err.message);
                    }
                });
        } else {
            this.playing = true;
        }
    }

    private handleTimeUpdate(audio: HTMLAudioElement): void {
        if (audio !== this.current || !this.playing) return;
        const dur = audio.duration;
        if (!isFinite(dur) || dur === 0) return;
        const remaining = dur - audio.currentTime;
        if (remaining <= CROSSFADE_S && !this.next) {
            this.beginCrossfade();
        }
    }

    private handleEnded(audio: HTMLAudioElement): void {
        if (audio !== this.current) return;
        // Fallback path when `timeupdate` didn't fire close enough to the end
        // (e.g. very short tracks, browsers that throttle background tabs).
        if (this.next) return;
        this.advanceIndex();
        const replacement = new Audio();
        replacement.preload = 'auto';
        replacement.loop = false;
        replacement.src = this.playlist[this.index].url;
        this.wireToMaster(replacement);
        replacement.volume = this.targetElementVolume();
        replacement.addEventListener('error', () => {
            const err = replacement.error;
            console.warn('[music] audio element error:', err?.code, err?.message, replacement.src);
        });
        replacement.addEventListener('ended', () => this.handleEnded(replacement));
        replacement.addEventListener('timeupdate', () => this.handleTimeUpdate(replacement));
        this.current = replacement;
        replacement.play().catch((err: DOMException) => {
            if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
                console.warn('[music] follow-up play() rejected:', err.name, err.message);
            }
            this.playing = false;
        });
    }

    private beginCrossfade(): void {
        if (!this.current || this.next) return;
        const fromAudio = this.current;
        const upcomingIndex = (this.index + 1) % this.playlist.length;
        const upcoming = new Audio(this.playlist[upcomingIndex].url);
        upcoming.preload = 'auto';
        upcoming.loop = false;
        upcoming.volume = 0;
        this.wireToMaster(upcoming);
        upcoming.addEventListener('error', () => {
            const err = upcoming.error;
            console.warn('[music] crossfade audio error:', err?.code, err?.message, upcoming.src);
        });
        this.next = upcoming;
        const playPromise = upcoming.play();
        const start = nowSeconds();
        const tick = () => {
            if (this.destroyed) return;
            const t = Math.min(1, (nowSeconds() - start) / CROSSFADE_S);
            const target = this.targetElementVolume();
            fromAudio.volume = Math.max(0, target * (1 - t));
            upcoming.volume = Math.max(0, target * t);
            if (t < 1 && !this.destroyed) {
                this.fadeRaf = scheduleFrame(tick);
            } else {
                try {
                    fromAudio.pause();
                } catch {
                    /* ignored */
                }
                fromAudio.src = '';
                upcoming.addEventListener('ended', () => this.handleEnded(upcoming));
                upcoming.addEventListener('timeupdate', () => this.handleTimeUpdate(upcoming));
                this.current = upcoming;
                this.next = null;
                this.index = upcomingIndex;
            }
        };
        if (typeof playPromise?.then === 'function') {
            playPromise.then(tick).catch((err: DOMException) => {
                console.warn('[music] crossfade play() rejected:', err.name, err.message);
                this.next = null;
            });
        } else {
            tick();
        }
    }

    private advanceIndex(): void {
        this.index = (this.index + 1) % this.playlist.length;
    }

    private fadeIn(audio: HTMLAudioElement, durationS: number): void {
        const start = nowSeconds();
        const tick = () => {
            if (this.destroyed || this.current !== audio) return;
            const t = Math.min(1, (nowSeconds() - start) / durationS);
            audio.volume = Math.max(0, this.targetElementVolume() * t);
            if (t < 1) this.fadeRaf = scheduleFrame(tick);
        };
        tick();
    }

    /**
     * Effective master gain applied via Web Audio (range 0..MUSIC_GAIN_CAP).
     * Combines the persisted slider value, the muted flag, and the cap.
     */
    private effectiveMasterGain(): number {
        if (this._muted) return 0;
        return Math.max(0, Math.min(1, this._volume)) * MUSIC_GAIN_CAP;
    }

    /**
     * Per-element fade target applied to `HTMLAudioElement.volume`.
     * When Web Audio is wired up, the master gain handles slider/mute, so the
     * element itself runs at full pre-gain (1.0) and fade-in/crossfade tween
     * 0..1. Without Web Audio we fall back to driving the element directly,
     * capped at 1.0.
     */
    private targetElementVolume(): number {
        if (this.masterGain) return 1;
        if (this._muted) return 0;
        return Math.max(0, Math.min(1, this._volume));
    }

    private applyVolume(): void {
        if (this.masterGain) {
            this.masterGain.gain.value = this.effectiveMasterGain();
            return;
        }
        const target = this.targetElementVolume();
        if (this.current) this.current.volume = target;
        // The `next` track is part of an in-flight crossfade and the
        // crossfade tick re-applies volumes itself, so leave it alone.
    }

    private ensureAudioContext(): AudioContext | null {
        if (this.audioContext) return this.audioContext;
        if (this.webAudioFailed) return null;
        if (typeof window === 'undefined') return null;
        const Ctor: typeof AudioContext | undefined =
            typeof AudioContext !== 'undefined'
                ? AudioContext
                : (window as unknown as { webkitAudioContext?: typeof AudioContext })
                      .webkitAudioContext;
        if (!Ctor) {
            this.webAudioFailed = true;
            return null;
        }
        try {
            const ctx = new Ctor();
            const master = ctx.createGain();
            master.gain.value = this.effectiveMasterGain();
            master.connect(ctx.destination);
            this.audioContext = ctx;
            this.masterGain = master;
            return ctx;
        } catch (err) {
            console.warn('[music] Web Audio init failed; falling back to element volume:', err);
            this.webAudioFailed = true;
            return null;
        }
    }

    private wireToMaster(audio: HTMLAudioElement): void {
        if (this.wiredAudios.has(audio)) return;
        const ctx = this.ensureAudioContext();
        if (!ctx || !this.masterGain) return;
        try {
            const source = ctx.createMediaElementSource(audio);
            source.connect(this.masterGain);
            this.wiredAudios.add(audio);
        } catch (err) {
            console.warn('[music] could not route audio through Web Audio:', err);
        }
    }

    private resumeAudioContext(): void {
        const ctx = this.audioContext;
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch((err: DOMException) => {
                console.warn('[music] AudioContext resume rejected:', err.name, err.message);
            });
        }
    }

    get volume(): number {
        return this._volume;
    }

    setVolume(value: number): void {
        const clamped = Math.max(0, Math.min(1, value));
        this._volume = clamped;
        try {
            localStorage.setItem(VOLUME_KEY, String(clamped));
        } catch {
            /* ignored */
        }
        this.applyVolume();
    }

    get muted(): boolean {
        return this._muted;
    }

    setMuted(muted: boolean): void {
        this._muted = muted;
        try {
            localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
        } catch {
            /* ignored */
        }
        this.applyVolume();
    }

    toggleMute(): boolean {
        this.setMuted(!this._muted);
        return this._muted;
    }

    /** Stop all playback and detach. */
    destroy(): void {
        this.destroyed = true;
        if (this.fadeRaf != null && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(this.fadeRaf);
        }
        if (this.current) {
            try {
                this.current.pause();
            } catch {
                /* ignored */
            }
            this.current.src = '';
            this.current = null;
        }
        if (this.next) {
            try {
                this.next.pause();
            } catch {
                /* ignored */
            }
            this.next.src = '';
            this.next = null;
        }
        this.detachAutoStart();
        if (this.audioContext) {
            try {
                this.audioContext.close();
            } catch {
                /* ignored */
            }
            this.audioContext = null;
            this.masterGain = null;
        }
    }
}

function readVolume(): number {
    // Fresh installs default to max slider — combined with the cap
    // bump above this lands roughly 2× louder than the previous
    // default of 0.55 × 0.55 ≈ 0.30 effective gain. Players asked
    // for the music to be louder out of the box; existing users
    // with a stored slider keep their last-chosen position.
    try {
        const raw = localStorage.getItem(VOLUME_KEY);
        if (raw == null) return 1.0;
        const parsed = Number.parseFloat(raw);
        if (!Number.isFinite(parsed)) return 1.0;
        return Math.max(0, Math.min(1, parsed));
    } catch {
        return 1.0;
    }
}

function readMuted(): boolean {
    try {
        return localStorage.getItem(MUTED_KEY) === '1';
    } catch {
        return false;
    }
}

function nowSeconds(): number {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

function scheduleFrame(cb: () => void): number {
    if (typeof requestAnimationFrame !== 'undefined') return requestAnimationFrame(cb);
    return setTimeout(cb, 16) as unknown as number;
}
