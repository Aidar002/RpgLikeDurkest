/**
 * Façade over the audio subsystem. Owns one instance each of the
 * extracted modules under `audio/` and exposes the same public API
 * the rest of the codebase has consumed since this file was a
 * 1.2 kLOC monolith. Most cues are synthesized at runtime via short
 * oscillator + noise chains routed through the master gain in
 * {@link AudioCore}. A small set of UI feedback / boot-screen
 * cues are loaded from OGG / MP3 files in `public/audio/` — see
 * {@link SoundManager.preloadUiSfx}. The footsteps loop also uses a
 * file (`steps_sound1.ogg`); see {@link SoundManager.startFootstepsLoop}.
 *
 * **Adding a new SFX:** add the id to `SoundId` in
 * `audio/ProceduralSfx.ts`, write a `playXxx` function in the same
 * file, wire it into the dispatch switch, then call `play('myId')`
 * from the call site. Do NOT add new procedural methods here.
 */

import { AudioCore } from './audio/AudioCore';
import { DungeonAmbient, TorchAmbient } from './audio/Ambient';
import { FootstepsLoop } from './audio/FootstepsLoop';
import { playSfx, type SoundId } from './audio/ProceduralSfx';
import { SamplePlayback } from './audio/SamplePlayback';

export type { SoundId } from './audio/ProceduralSfx';

export class SoundManager {
    private readonly core = new AudioCore();
    private readonly samples = new SamplePlayback(this.core);
    private readonly footsteps = new FootstepsLoop(this.core);
    private readonly dungeonAmbient = new DungeonAmbient(this.core);
    private readonly torchAmbient = new TorchAmbient(this.core, this.samples);

    get muted(): boolean {
        return this.core.muted;
    }

    toggleMute(): boolean {
        return this.core.toggleMute();
    }

    get volume(): number {
        return this.core.volume;
    }

    setVolume(v: number): void {
        this.core.setVolume(v);
    }

    /**
     * Eagerly load the OGG/MP3 SFX samples so the first hover /
     * click / boot cue fires without fetch latency. Safe to call
     * multiple times — memoised inside {@link SamplePlayback}.
     */
    preloadUiSfx(): Promise<void> {
        return this.samples.preload();
    }

    /**
     * One-shot title-reveal cue (`show_name.ogg`). Played by
     * BootScene at the moment the title text starts fading in.
     * Returns `true` if the sample was scheduled, `false` if the
     * buffer hasn't preloaded yet (or playback is muted) — callers
     * can use the return value to retry after `preloadUiSfx()`
     * resolves.
     */
    playShowName(fadeInMs = 0): boolean {
        // Peak gain doubled (1.0 -> 2.0) so the title cue is audible
        // over the menu music loop on the boot screen.
        return this.samples.playWithFade('showName', 2.0, fadeInMs);
    }

    play(id: SoundId): void {
        playSfx({ core: this.core, samples: this.samples }, id);
    }

    // ─── footsteps loop (room transitions) ─────────────────────

    startFootstepsLoop(fadeInMs = 600): void {
        this.footsteps.start(fadeInMs);
    }

    stopFootstepsLoop(fadeOutMs = 600): void {
        this.footsteps.stop(fadeOutMs);
    }

    // ─── dungeon ambient ───────────────────────────────────────

    startAmbient(depth: number): void {
        this.dungeonAmbient.start(depth);
    }

    updateAmbientDepth(depth: number): void {
        this.dungeonAmbient.updateDepth(depth);
    }

    stopAmbient(): void {
        this.dungeonAmbient.stop();
    }

    // ─── boot-screen torch ambient ─────────────────────────────

    startTorchAmbient(fadeInMs = 600): void {
        this.torchAmbient.start(fadeInMs);
    }

    stopTorchAmbient(fadeOutMs = 400): void {
        this.torchAmbient.stop(fadeOutMs);
    }
}
