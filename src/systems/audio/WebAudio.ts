/**
 * Low-level Web Audio primitives used by the procedural SFX bank in
 * `audio/ProceduralSfx.ts`. Each helper schedules a fresh oscillator
 * or noise burst routed through the master gain so it shares the
 * mute toggle and the SFX volume slider managed by `audio/AudioCore`.
 *
 * Pure: no class, no instance state — every call takes the live
 * `AudioContext` and `master` gain as explicit arguments. Extracted
 * from the original `SoundManager` so the SFX bank no longer carries
 * its own copy of these helpers.
 */

/**
 * Schedule a single oscillator that starts immediately and stops
 * after `duration`. Returns the oscillator + its gain so callers can
 * shape an envelope on top via {@link env}. Useful when the cue is a
 * fire-and-forget tone (`osc('sine', 440, 0.1)`).
 */
export function osc(
    ctx: AudioContext,
    master: GainNode,
    type: OscillatorType,
    freq: number,
    duration: number,
    volume = 0.3,
    dest?: AudioNode
): { osc: OscillatorNode; gain: GainNode } {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = volume;
    o.connect(g);
    g.connect(dest ?? master);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + duration);
    return { osc: o, gain: g };
}

/**
 * Schedule a short burst of white noise. Returns the source + gain so
 * callers can apply an envelope via {@link env}. Uses raw
 * `Math.random()` for sample generation — these helpers are for
 * audio-side noise, not gameplay rolls, so the project's seeded-Rng
 * rule doesn't apply here.
 */
export function noise(
    ctx: AudioContext,
    master: GainNode,
    duration: number,
    volume = 0.15,
    dest?: AudioNode
): { src: AudioBufferSourceNode; gain: GainNode } {
    const len = Math.round(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(dest ?? master);
    src.start(ctx.currentTime);
    src.stop(ctx.currentTime + duration);
    return { src, gain: g };
}

/**
 * Apply an ADSR-style envelope on the given gain node, starting at
 * the current AudioContext time and using the existing `gain.value`
 * as the peak target. Mutates the gain in place; safe to call right
 * after {@link osc} or {@link noise}.
 */
export function env(
    ctx: AudioContext,
    gain: GainNode,
    attack: number,
    decay: number,
    sustain: number,
    release: number
): void {
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(gain.gain.value, t + attack);
    gain.gain.linearRampToValueAtTime(gain.gain.value * sustain, t + attack + decay);
    gain.gain.linearRampToValueAtTime(0, t + attack + decay + release);
}

/**
 * Schedule an oscillator whose frequency sweeps exponentially from
 * `from` Hz to `to` Hz over `duration` seconds. Used for swooshes,
 * stingers and impact bodies. Applies a built-in envelope so callers
 * don't have to wire a second one on top.
 */
export function sweep(
    ctx: AudioContext,
    master: GainNode,
    from: number,
    to: number,
    duration: number,
    type: OscillatorType = 'sine',
    volume = 0.2
): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(to, 20), ctx.currentTime + duration);
    g.gain.value = volume;
    env(ctx, g, 0.01, duration * 0.3, 0.4, duration * 0.5);
    o.connect(g);
    g.connect(master);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + duration);
}
