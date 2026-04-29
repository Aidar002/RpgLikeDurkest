/**
 * Procedural sound engine using Web Audio API.
 * All sounds are synthesized at runtime — no audio files required.
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
    | 'relicDrop'
    | 'stressSpike'
    | 'footstep';

const STORAGE_KEY = 'dd_sound_muted';

export class SoundManager {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private _muted: boolean;
    private _volume = 0.45;
    private ambientNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
    private ambientRunning = false;

    constructor() {
        this._muted = localStorage.getItem(STORAGE_KEY) === '1';
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

    setVolume(v: number) {
        this._volume = Math.max(0, Math.min(1, v));
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

    private noise(duration: number, volume = 0.15, dest?: AudioNode): { src: AudioBufferSourceNode; gain: GainNode } {
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

    private sweep(from: number, to: number, duration: number, type: OscillatorType = 'sine', volume = 0.2) {
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

    // ─── public play ───────────────────────────────────────────

    play(id: SoundId) {
        this.ensure();
        switch (id) {
            case 'hit': return this.playHit();
            case 'crit': return this.playCrit();
            case 'defend': return this.playDefend();
            case 'enemyHit': return this.playEnemyHit();
            case 'evade': return this.playEvade();
            case 'skillUse': return this.playSkillUse();
            case 'potion': return this.playPotion();
            case 'treasure': return this.playTreasure();
            case 'trapTrigger': return this.playTrapTrigger();
            case 'trapDisarm': return this.playTrapDisarm();
            case 'rest': return this.playRest();
            case 'shrine': return this.playShrine();
            case 'merchant': return this.playMerchant();
            case 'bossAppear': return this.playBossAppear();
            case 'eliteAppear': return this.playEliteAppear();
            case 'buttonClick': return this.playButtonClick();
            case 'buttonHover': return this.playButtonHover();
            case 'levelUp': return this.playLevelUp();
            case 'death': return this.playDeath();
            case 'victory': return this.playVictory();
            case 'whisper': return this.playWhisper();
            case 'nodeSelect': return this.playNodeSelect();
            case 'relicDrop': return this.playRelicDrop();
            case 'stressSpike': return this.playStressSpike();
            case 'footstep': return this.playFootstep();
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

    /** Subtle click. */
    private playButtonClick() {
        this.osc('square', 800, 0.03, 0.08);
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

    /** Map node selection pip. */
    private playNodeSelect() {
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

    /** Dissonant sting for stress. */
    private playStressSpike() {
        this.osc('sawtooth', 180, 0.12, 0.1);
        this.osc('square', 233, 0.1, 0.06);
    }

    /** Soft footstep for map movement. */
    private playFootstep() {
        const { gain } = this.noise(0.06, 0.1);
        this.env(gain, 0.005, 0.02, 0.2, 0.03);
        this.osc('sine', 120, 0.04, 0.06);
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
            try { n.osc.stop(); } catch { /* already stopped */ }
        }
        this.ambientNodes = [];
        this.ambientRunning = false;
    }
}
