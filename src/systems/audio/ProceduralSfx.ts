/**
 * Procedural one-shot SFX bank. Each cue is a short oscillator +
 * noise chain routed through the master gain in `AudioCore`. A few
 * cues (button click, hover, node-select, torch-ignite, door-open)
 * prefer a sampled buffer when {@link SamplePlayback.preload} has
 * resolved and fall back to the procedural path otherwise.
 *
 * Public entry point is {@link playSfx}: a tagged dispatch on
 * {@link SoundId}. Each cue is a plain function (no class state) so
 * adding a new SFX is "extend `SoundId`, write a `playXxx` function,
 * add it to the dispatch switch" — the same shape the original
 * `SoundManager` had, just hoisted out of the 1.2 kLOC monolith.
 */

import type { AudioCore } from './AudioCore';
import type { SamplePlayback } from './SamplePlayback';
import { env, noise, osc, sweep } from './WebAudio';

/** Discriminated union of every procedural SFX id `play()` accepts. */
export type SoundId =
    | 'hit'
    | 'crit'
    | 'defend'
    | 'enemyHit'
    | 'evade'
    | 'skillUse'
    | 'cleave'
    | 'bleedStrike'
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
    | 'doorOpen'
    | 'lockpickClick'
    | 'lockpickBreak';

/**
 * Bundle of audio-system handles each procedural cue may need. Cues
 * read `core.ensure()` for the live `AudioContext`, `core.master` to
 * route through the SFX bus, and the sample-bank lookup for the few
 * cues that layer a recorded transient on top.
 */
interface SfxDeps {
    core: AudioCore;
    samples: SamplePlayback;
}

/** Dispatch from {@link SoundId} to the matching procedural cue. */
export function playSfx(deps: SfxDeps, id: SoundId): void {
    deps.core.ensure();
    switch (id) {
        case 'hit':
            return playHit(deps);
        case 'crit':
            return playCrit(deps);
        case 'defend':
            return playDefend(deps);
        case 'enemyHit':
            return playEnemyHit(deps);
        case 'evade':
            return playEvade(deps);
        case 'skillUse':
            return playSkillUse(deps);
        case 'cleave':
            return playCleave(deps);
        case 'bleedStrike':
            return playBleedStrike(deps);
        case 'potion':
            return playPotion(deps);
        case 'treasure':
            return playTreasure(deps);
        case 'trapTrigger':
            return playTrapTrigger(deps);
        case 'trapDisarm':
            return playTrapDisarm(deps);
        case 'rest':
            return playRest(deps);
        case 'shrine':
            return playShrine(deps);
        case 'merchant':
            return playMerchant(deps);
        case 'bossAppear':
            return playBossAppear(deps);
        case 'eliteAppear':
            return playEliteAppear(deps);
        case 'buttonClick':
            return playButtonClick(deps);
        case 'buttonHover':
            return playButtonHover(deps);
        case 'levelUp':
            return playLevelUp(deps);
        case 'death':
            return playDeath(deps);
        case 'victory':
            return playVictory(deps);
        case 'whisper':
            return playWhisper(deps);
        case 'nodeSelect':
            return playNodeSelect(deps);
        case 'roomHover':
            return playRoomHover(deps);
        case 'relicDrop':
            return playRelicDrop(deps);
        case 'footstep':
            return playFootstep(deps);
        case 'torchIgnite':
            return playTorchIgnite(deps);
        case 'doorOpen':
            return playDoorOpen(deps);
        case 'lockpickClick':
            return playLockpickClick(deps);
        case 'lockpickBreak':
            return playLockpickBreak(deps);
    }
}

/** Short metallic slash. */
function playHit({ core, samples }: SfxDeps): void {
    // Prefer the hand-authored `hit_sound.ogg` sample when it has
    // preloaded — the synth body below stays as the cold-boot
    // fallback so the cue never goes silent on the very first
    // player attack before preload resolves.
    if (samples.play('combatHit', 1.0)) return;
    const ctx = core.ensure();
    const master = core.master!;
    const { gain } = noise(ctx, master, 0.08, 0.25);
    env(ctx, gain, 0.005, 0.02, 0.3, 0.05);
    osc(ctx, master, 'square', 220, 0.06, 0.12);
    osc(ctx, master, 'sawtooth', 440, 0.04, 0.08);
}

/** Big crunch with bright ring. */
function playCrit({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
    const { gain } = noise(ctx, master, 0.14, 0.35);
    env(ctx, gain, 0.005, 0.03, 0.4, 0.08);
    osc(ctx, master, 'sawtooth', 660, 0.08, 0.18);
    osc(ctx, master, 'square', 330, 0.12, 0.15);
    sweep(ctx, master, 880, 220, 0.15, 'sawtooth', 0.12);
}

/** Shield clang. */
function playDefend({ core, samples }: SfxDeps): void {
    // Prefer the hand-authored `shield_sound.wav` sample (deep
    // wooden block / shield brace) when preloaded. Synth fallback
    // below keeps the cue alive before preload resolves.
    if (samples.play('shieldBlock', 1.0)) return;
    const ctx = core.ensure();
    const master = core.master!;
    osc(ctx, master, 'triangle', 520, 0.1, 0.2);
    osc(ctx, master, 'sine', 780, 0.08, 0.1);
    const { gain } = noise(ctx, master, 0.06, 0.12);
    env(ctx, gain, 0.003, 0.02, 0.2, 0.04);
}

/** Dull thud when enemy hits player. */
function playEnemyHit({ core, samples }: SfxDeps): void {
    // Prefer the hand-authored `mob_hit.wav` sample (recorded
    // bone/flesh impact). Synth thud below is the fallback for the
    // pre-preload window.
    if (samples.play('mobHit', 1.0)) return;
    const ctx = core.ensure();
    const master = core.master!;
    const { gain } = noise(ctx, master, 0.1, 0.2);
    env(ctx, gain, 0.005, 0.03, 0.3, 0.06);
    sweep(ctx, master, 180, 60, 0.12, 'sine', 0.2);
}

/** Whoosh for dodge. */
function playEvade({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
    sweep(ctx, master, 800, 200, 0.18, 'sine', 0.12);
    const { gain } = noise(ctx, master, 0.12, 0.06);
    env(ctx, gain, 0.01, 0.04, 0.2, 0.06);
}

/** Magic activation. */
function playSkillUse({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
    sweep(ctx, master, 300, 900, 0.2, 'sine', 0.15);
    osc(ctx, master, 'triangle', 600, 0.15, 0.1);
    setTimeout(() => {
        if (core.ctx) {
            osc(core.ctx, core.master!, 'sine', 800, 0.1, 0.08);
        }
    }, 100);
}

/**
 * Hand-authored "Рубка / Cleave" skill cue (`rubka_sound.ogg`).
 * Played from {@link CombatHudController.performAction} in place of
 * the generic `skillUse` synth when the player triggers the
 * `cleave` skill. Falls back to `playSkillUse` if the sample
 * hasn't preloaded yet so the cue is never silent.
 */
function playCleave(deps: SfxDeps): void {
    if (deps.samples.play('cleaveSwing', 1.0)) return;
    playSkillUse(deps);
}

/**
 * Hand-authored "Кровавый разрез / Bleed Strike" skill cue
 * (`blood_hit_sound.ogg`). Same fallback path as {@link playCleave}.
 */
function playBleedStrike(deps: SfxDeps): void {
    if (deps.samples.play('bleedStrike', 1.0)) return;
    playSkillUse(deps);
}

/** Bubbly gulp. */
function playPotion({ core, samples }: SfxDeps): void {
    // Prefer the hand-authored `potion_use_sound.wav` sample.
    if (samples.play('potionUse', 1.0)) return;
    const ctx = core.ensure();
    const master = core.master!;
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
        g.connect(master);
        o.start(t + i * 0.06);
        o.stop(t + i * 0.06 + 0.08);
    }
}

/** Sparkling coins. */
function playTreasure({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
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
        g.connect(master);
        o.start(t + i * 0.07);
        o.stop(t + i * 0.07 + 0.12);
    });
}

/** Sharp snap. */
function playTrapTrigger({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
    const { gain } = noise(ctx, master, 0.12, 0.35);
    env(ctx, gain, 0.002, 0.02, 0.5, 0.08);
    sweep(ctx, master, 600, 80, 0.1, 'square', 0.2);
}

/** Tight metallic tick when a lockpick ring locks into place. */
function playLockpickClick({ core, samples }: SfxDeps): void {
    // Prefer the hand-authored `good_open_chest_sound.wav` sample —
    // user wants the satisfying lock-snap fired for every chest
    // puzzle ring that the player nails. Synth tick below is the
    // pre-preload fallback.
    if (samples.play('chestRing', 1.0)) return;
    const ctx = core.ensure();
    const master = core.master!;
    // Quick triangle bell + faint noise transient = pin-tumbler tick.
    osc(ctx, master, 'triangle', 880, 0.05, 0.18);
    osc(ctx, master, 'square', 1320, 0.03, 0.08);
    const { gain } = noise(ctx, master, 0.04, 0.08);
    env(ctx, gain, 0.001, 0.01, 0.15, 0.02);
}

/** Wooden-snap "pick broke" cue: dull crack, then a fading splinter. */
function playLockpickBreak({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
    // Short downward chirp = the pick body bending past its limit.
    sweep(ctx, master, 420, 90, 0.08, 'sawtooth', 0.22);
    // Brittle noise burst = the actual snap.
    const { gain } = noise(ctx, master, 0.12, 0.4);
    env(ctx, gain, 0.001, 0.015, 0.35, 0.1);
    // Low "thud" tail.
    osc(ctx, master, 'triangle', 140, 0.12, 0.12);
}

/** Satisfying click. */
function playTrapDisarm({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
    osc(ctx, master, 'triangle', 600, 0.06, 0.15);
    const t = ctx.currentTime;
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'sine';
    o2.frequency.value = 900;
    g2.gain.setValueAtTime(0, t + 0.08);
    g2.gain.linearRampToValueAtTime(0.12, t + 0.09);
    g2.gain.linearRampToValueAtTime(0, t + 0.18);
    o2.connect(g2);
    g2.connect(master);
    o2.start(t + 0.08);
    o2.stop(t + 0.18);
}

/** Warm crackling. */
function playRest({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
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
        g.connect(master);
        src.start(start);
        src.stop(start + len);
    }
    osc(ctx, master, 'sine', 200, 0.3, 0.04);
}

/**
 * Torch catching fire: tiny flint click followed by a low "fwoom"
 * of burning air. ~0.5 s total. Filed under SFX so it respects
 * the same mute/volume controls as the rest of the bank.
 */
function playTorchIgnite({ core, samples }: SfxDeps): void {
    // Prefer the sampled ignition transient when it's preloaded —
    // it carries the body of the cue. The synthesised flint /
    // whoosh / sub triplet below remains as a fallback for the
    // first frame after boot (before sample preload resolves) and
    // as a permanent fallback when the file 404s. Peak gain bumped
    // from 0.9 -> 1.17 (+30 %) so the ignition sample lands clearly
    // even with the boot menu music now playing underneath.
    if (samples.play('torchIgnite', 1.17)) return;

    const ctx = core.ensure();
    const master = core.master!;
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
    clickGain.connect(master);
    clickSrc.start(t);
    clickSrc.stop(t + 0.03);

    // 2) Whoosh — band-passed noise that ramps in over 60 ms,
    //    decays over ~0.45 s. Reads as the body of the flame.
    const whooshLen = 0.5;
    const whooshBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * whooshLen), ctx.sampleRate);
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
    whooshGain.connect(master);
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
    subGain.connect(master);
    sub.start(t + 0.02);
    sub.stop(t + 0.4);
}

/**
 * Heavy wooden door swinging open: low creak ramp + thud at the
 * end of the swing. ~0.9 s total. Used by the boot-screen door
 * sprite when the player clicks "Start expedition".
 */
function playDoorOpen({ core, samples }: SfxDeps): void {
    // Layered sampled cue — when `door_in_dungeon2.mp3` is preloaded
    // it plays alongside the procedural creak/thud below so the door
    // swing carries both the wooden weight and the recorded dungeon
    // ambience. Missing buffer falls through silently to the
    // synth-only path.
    samples.play('doorOpen', 1.0);

    const ctx = core.ensure();
    const master = core.master!;
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
    creakGain.connect(master);
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
    thudGain.connect(master);
    thud.start(t + creakLen - 0.05);
    thud.stop(t + creakLen + 0.3);
}

/** Ethereal chime. */
function playShrine({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
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
        g.connect(master);
        o.start(t + i * 0.12);
        o.stop(t + i * 0.12 + 0.35);
    });
}

/** Coin clink. */
function playMerchant({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
    osc(ctx, master, 'triangle', 1200, 0.05, 0.12);
    const t = ctx.currentTime;
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'triangle';
    o2.frequency.value = 1500;
    g2.gain.setValueAtTime(0, t + 0.07);
    g2.gain.linearRampToValueAtTime(0.1, t + 0.08);
    g2.gain.linearRampToValueAtTime(0, t + 0.14);
    o2.connect(g2);
    g2.connect(master);
    o2.start(t + 0.07);
    o2.stop(t + 0.14);
}

/** Low ominous drone for boss. */
function playBossAppear({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
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
    g.connect(master);
    o.start(t);
    o.stop(t + 0.8);

    const { gain: ng } = noise(ctx, master, 0.6, 0.08);
    env(ctx, ng, 0.1, 0.2, 0.3, 0.3);
}

/** Tension stinger for elite. */
function playEliteAppear({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
    sweep(ctx, master, 200, 100, 0.4, 'sawtooth', 0.15);
    const { gain } = noise(ctx, master, 0.3, 0.06);
    env(ctx, gain, 0.05, 0.1, 0.3, 0.15);
}

/**
 * Click feedback for any UI button. Uses the sampled `ui_click.ogg`
 * once samples have preloaded; until then (and as a permanent
 * fallback if the file is missing) falls back to the short
 * square-wave tick we used historically.
 */
function playButtonClick({ core, samples }: SfxDeps): void {
    if (samples.play('uiClick', 4.4)) return;
    const ctx = core.ensure();
    osc(ctx, core.master!, 'square', 800, 0.03, 0.32);
}

/**
 * Soft chime fired when the cursor enters a reachable map node.
 * Sampled-only — there is no synth fallback because the hover
 * affordance is non-critical and a silent hover is preferable to a
 * beep that doesn't match the rest of the SFX bed.
 */
function playRoomHover({ samples }: SfxDeps): void {
    samples.play('uiHover', 1.6);
}

/**
 * Hover feedback for any UI button. Uses the sampled `ui_hover.ogg`
 * once samples have preloaded — same source file as the map-node
 * hover so the two affordances share one acoustic identity. Falls
 * back to the historical sine pip when the sample hasn't preloaded
 * yet (or 404s).
 */
function playButtonHover({ core, samples }: SfxDeps): void {
    if (samples.play('uiHover', 1.6)) return;
    const ctx = core.ensure();
    osc(ctx, core.master!, 'sine', 1000, 0.02, 0.08);
}

/** Ascending fanfare. */
function playLevelUp({ core, samples }: SfxDeps): void {
    // Prefer the hand-authored `level_up_sound.ogg` sample.
    if (samples.play('levelUp', 1.0)) return;
    const ctx = core.ensure();
    const master = core.master!;
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
        g.connect(master);
        o.start(t + i * 0.1);
        o.stop(t + i * 0.1 + 0.2);
    });
}

/** Dark descending drone. */
function playDeath({ core, samples }: SfxDeps): void {
    // Prefer the hand-authored `death_sound.wav` sample.
    if (samples.play('playerDeath', 1.0)) return;
    const ctx = core.ensure();
    const master = core.master!;
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
    g.connect(master);
    o.start(t);
    o.stop(t + 1.2);

    const { gain: ng } = noise(ctx, master, 1.0, 0.1);
    env(ctx, ng, 0.05, 0.3, 0.3, 0.5);
}

/** Triumphant ascending arpeggio with sustained glow. */
function playVictory({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
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
        g.connect(master);
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
    bg.connect(master);
    bed.start(t + 0.3);
    bed.stop(t + 1.5);
}

/** Soft breathy whisper for narrative events. */
function playWhisper({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
    const { gain } = noise(ctx, master, 0.25, 0.06);
    env(ctx, gain, 0.05, 0.08, 0.4, 0.1);
    osc(ctx, master, 'sine', 300, 0.2, 0.03);
}

/**
 * Map node selection. Uses the same `ui_click.ogg` sample as
 * `buttonClick` so the room-pick feedback matches the rest of the
 * UI. Falls back to the historical sine pip when the sample hasn't
 * preloaded yet.
 */
function playNodeSelect({ core, samples }: SfxDeps): void {
    if (samples.play('uiClick', 1.1)) return;
    const ctx = core.ensure();
    osc(ctx, core.master!, 'sine', 660, 0.05, 0.1);
}

/** Magical shimmer for relic drops. */
function playRelicDrop({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
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
        g.connect(master);
        o.start(t + i * 0.08);
        o.stop(t + i * 0.08 + 0.2);
    });
}

/** Soft footstep for map movement. */
function playFootstep({ core }: SfxDeps): void {
    const ctx = core.ensure();
    const master = core.master!;
    const { gain } = noise(ctx, master, 0.06, 0.1);
    env(ctx, gain, 0.005, 0.02, 0.2, 0.03);
    osc(ctx, master, 'sine', 120, 0.04, 0.06);
}
