/**
 * Owns the singleton AudioContext + master gain plus the persisted
 * mute / volume state. Created once by `SoundManager` and passed to
 * the other audio submodules so they all route through the same
 * gain node and respect the same toggle.
 *
 * The context is created lazily on the first {@link AudioCore.ensure}
 * call (typically the first user interaction) so we don't trip the
 * browser autoplay rules at boot.
 */

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

export class AudioCore {
    private _ctx: AudioContext | null = null;
    private _master: GainNode | null = null;
    private _muted: boolean;
    private _volume: number;

    constructor() {
        this._muted = localStorage.getItem(STORAGE_KEY) === '1';
        this._volume = readSavedVolume(0.45);
    }

    /**
     * Lazily create the AudioContext + master gain on first use, and
     * resume it if a previous tab-switch suspended it. Returns the
     * live context so callers can schedule nodes immediately.
     */
    ensure(): AudioContext {
        if (!this._ctx) {
            this._ctx = new AudioContext();
            this._master = this._ctx.createGain();
            this._master.gain.value = this._muted ? 0 : this._volume;
            this._master.connect(this._ctx.destination);
        }
        if (this._ctx.state === 'suspended') {
            this._ctx.resume();
        }
        return this._ctx;
    }

    /** Live AudioContext or `null` before {@link ensure} has run. */
    get ctx(): AudioContext | null {
        return this._ctx;
    }

    /** Live master gain or `null` before {@link ensure} has run. */
    get master(): GainNode | null {
        return this._master;
    }

    get muted(): boolean {
        return this._muted;
    }

    /** Flip the mute toggle and persist; returns the new state. */
    toggleMute(): boolean {
        this._muted = !this._muted;
        localStorage.setItem(STORAGE_KEY, this._muted ? '1' : '0');
        if (this._master) {
            this._master.gain.value = this._muted ? 0 : this._volume;
        }
        return this._muted;
    }

    get volume(): number {
        return this._volume;
    }

    /** Clamp + persist the SFX volume and apply it when not muted. */
    setVolume(v: number): void {
        this._volume = Math.max(0, Math.min(1, v));
        try {
            localStorage.setItem(VOLUME_KEY, String(this._volume));
        } catch {
            /* ignored */
        }
        if (this._master && !this._muted) {
            this._master.gain.value = this._volume;
        }
    }
}
