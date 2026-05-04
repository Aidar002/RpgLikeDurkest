/**
 * Lightweight background-music player.
 *
 * Streams ordinary HTMLAudioElements (no Web Audio decoding cost, no
 * Phaser preload pass) so the build stays small — the `mp3` files in
 * `public/audio/` are served as-is and pulled in only when playback
 * starts. Three tracks are rotated sequentially with a short
 * crossfade; volume is persisted across sessions and clamped to a
 * gentle ambient range.
 */

const VOLUME_KEY = 'dd_music_volume';
const MUTED_KEY = 'dd_music_muted';

/** Upper bound applied to the slider value when it actually drives the audio
 * gain — keeps tracks in the "background ambience" range even at max. */
const MUSIC_GAIN_CAP = 0.55;

/** Crossfade window (seconds) before a track ends. */
const CROSSFADE_S = 1.6;

/** Fade-in time for the very first track (seconds). */
const INITIAL_FADE_S = 1.5;

export interface MusicTrack {
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
    private started = false;
    private destroyed = false;
    private _volume: number;
    private _muted: boolean;

    constructor() {
        this._volume = readVolume();
        this._muted = readMuted();
    }

    setPlaylist(tracks: MusicTrack[]): void {
        this.playlist = tracks;
        this.index = 0;
    }

    /**
     * Try to start playback. Browsers block `audio.play()` until a user
     * gesture, so we listen once on `pointerdown` / `keydown` and start the
     * first track from there. Calling this more than once is a no-op.
     */
    start(): void {
        if (this.started || this.destroyed || this.playlist.length === 0) return;
        const tryPlay = () => {
            if (this.started || this.destroyed) {
                this.detachAutoStart();
                return;
            }
            this.playCurrent(true);
        };
        if (!this.autoStartBound && typeof window !== 'undefined') {
            this.autoStartBound = true;
            window.addEventListener('pointerdown', tryPlay, { once: false });
            window.addEventListener('keydown', tryPlay, { once: false });
        }
        // First attempt — may be allowed if a gesture already fired in this scene.
        tryPlay();
    }

    private detachAutoStart() {
        // The listeners are anonymous; we just rely on `started` to short-circuit.
        // We could remove them, but keeping the early-out keeps the code simple
        // and they get GC'd when the page navigates away.
    }

    private playCurrent(initialFade: boolean): void {
        if (this.playlist.length === 0) return;
        const track = this.playlist[this.index];
        const audio = this.current ?? new Audio();
        audio.src = track.url;
        audio.preload = 'auto';
        audio.loop = false;
        audio.crossOrigin = 'anonymous';
        audio.volume = initialFade ? 0 : this.effectiveGain();
        const playPromise = audio.play();
        if (typeof playPromise?.then === 'function') {
            playPromise.then(() => {
                this.started = true;
                this.current = audio;
                if (initialFade) this.fadeIn(audio, INITIAL_FADE_S);
                this.scheduleAdvance();
            }).catch(() => {
                // Most likely autoplay was blocked. Stay un-started; another
                // user gesture (the auto-start listeners) will retry.
            });
        } else {
            this.started = true;
            this.current = audio;
            this.scheduleAdvance();
        }
    }

    private scheduleAdvance(): void {
        if (!this.current) return;
        const audio = this.current;
        const onTimeUpdate = () => {
            if (!this.current || this.current !== audio) return;
            const dur = audio.duration;
            if (!isFinite(dur) || dur === 0) return;
            const remaining = dur - audio.currentTime;
            if (remaining <= CROSSFADE_S && !this.next) {
                this.beginCrossfade();
            }
        };
        const onEnded = () => {
            if (this.current !== audio) return;
            // If crossfade didn't fire (e.g. duration unknown, very short
            // tracks), advance immediately.
            if (!this.next) this.advance(false);
        };
        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('ended', onEnded);
    }

    private beginCrossfade(): void {
        if (!this.current || this.next) return;
        const fromAudio = this.current;
        const upcomingIndex = (this.index + 1) % this.playlist.length;
        const upcoming = new Audio(this.playlist[upcomingIndex].url);
        upcoming.preload = 'auto';
        upcoming.loop = false;
        upcoming.crossOrigin = 'anonymous';
        upcoming.volume = 0;
        this.next = upcoming;
        const playPromise = upcoming.play();
        const start = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
        const tick = () => {
            if (this.destroyed) return;
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
            const t = Math.min(1, (now - start) / CROSSFADE_S);
            const target = this.effectiveGain();
            fromAudio.volume = Math.max(0, target * (1 - t));
            upcoming.volume = Math.max(0, target * t);
            if (t < 1 && !this.destroyed) {
                this.fadeRaf = (typeof requestAnimationFrame !== 'undefined')
                    ? requestAnimationFrame(tick)
                    : (setTimeout(tick, 16) as unknown as number);
            } else {
                try { fromAudio.pause(); } catch { /* ignored */ }
                fromAudio.src = '';
                this.current = upcoming;
                this.next = null;
                this.index = upcomingIndex;
                this.scheduleAdvance();
            }
        };
        if (typeof playPromise?.then === 'function') {
            playPromise.then(tick).catch(() => {
                // Couldn't start the next track — drop the crossfade and try
                // again from the simple `ended` path.
                this.next = null;
            });
        } else {
            tick();
        }
    }

    private advance(initialFade: boolean): void {
        const oldAudio = this.current;
        if (oldAudio) {
            try { oldAudio.pause(); } catch { /* ignored */ }
            oldAudio.src = '';
        }
        this.current = null;
        this.index = (this.index + 1) % this.playlist.length;
        this.playCurrent(initialFade);
    }

    private fadeIn(audio: HTMLAudioElement, durationS: number): void {
        const start = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
        const tick = () => {
            if (this.destroyed || this.current !== audio) return;
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
            const t = Math.min(1, (now - start) / durationS);
            audio.volume = Math.max(0, this.effectiveGain() * t);
            if (t < 1) {
                this.fadeRaf = (typeof requestAnimationFrame !== 'undefined')
                    ? requestAnimationFrame(tick)
                    : (setTimeout(tick, 16) as unknown as number);
            }
        };
        tick();
    }

    /** Effective gain applied to the underlying HTMLAudioElement. */
    private effectiveGain(): number {
        if (this._muted) return 0;
        return Math.max(0, Math.min(1, this._volume)) * MUSIC_GAIN_CAP;
    }

    private applyVolume(): void {
        const target = this.effectiveGain();
        if (this.current) this.current.volume = target;
        // The `next` track is part of an in-flight crossfade and the
        // crossfade tick re-applies volumes itself, so leave it alone.
    }

    get volume(): number {
        return this._volume;
    }

    setVolume(value: number): void {
        const clamped = Math.max(0, Math.min(1, value));
        this._volume = clamped;
        try { localStorage.setItem(VOLUME_KEY, String(clamped)); } catch { /* ignored */ }
        this.applyVolume();
    }

    get muted(): boolean {
        return this._muted;
    }

    setMuted(muted: boolean): void {
        this._muted = muted;
        try { localStorage.setItem(MUTED_KEY, muted ? '1' : '0'); } catch { /* ignored */ }
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
            try { this.current.pause(); } catch { /* ignored */ }
            this.current.src = '';
            this.current = null;
        }
        if (this.next) {
            try { this.next.pause(); } catch { /* ignored */ }
            this.next.src = '';
            this.next = null;
        }
    }
}

function readVolume(): number {
    try {
        const raw = localStorage.getItem(VOLUME_KEY);
        if (raw == null) return 0.55;
        const parsed = Number.parseFloat(raw);
        if (!Number.isFinite(parsed)) return 0.55;
        return Math.max(0, Math.min(1, parsed));
    } catch {
        return 0.55;
    }
}

function readMuted(): boolean {
    try {
        return localStorage.getItem(MUTED_KEY) === '1';
    } catch {
        return false;
    }
}
