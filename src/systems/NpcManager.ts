import { ALL_NPC_IDS, NPCS } from './Npcs';
import type { NpcDialogBeat, NpcId, NpcOfferTemplate, NpcProfile, NpcRole, NpcStateTag } from './Npcs';

// State the player accumulates *across* runs about each NPC. This is the
// reason NPCs feel like characters: they remember, and the player remembers
// they remember. Persistence is handled by MetaProgressionManager.
export interface NpcMemory {
    metCount: number;
    affinity: number;     // -5..+5; positive = warmth, negative = wary
    lastDepthMet: number; // most recent depth they were encountered at
    flags: string[];      // free-form tags ("gave-token", "refused-pact", ...)
}

export type NpcMemoryMap = Record<NpcId, NpcMemory>;

export const DEFAULT_NPC_MEMORY: NpcMemory = {
    metCount: 0,
    affinity: 0,
    lastDepthMet: 0,
    flags: [],
};

export function makeDefaultNpcMemoryMap(): NpcMemoryMap {
    const out = {} as NpcMemoryMap;
    for (const id of ALL_NPC_IDS) {
        out[id] = { ...DEFAULT_NPC_MEMORY, flags: [] };
    }
    return out;
}

export function sanitizeNpcMemoryMap(raw: Partial<Record<string, Partial<NpcMemory>>> | undefined): NpcMemoryMap {
    const out = makeDefaultNpcMemoryMap();
    if (!raw) return out;
    for (const id of ALL_NPC_IDS) {
        const r = raw[id];
        if (!r) continue;
        out[id] = {
            metCount: Math.max(0, Math.floor(r.metCount ?? 0)),
            affinity: Math.max(-5, Math.min(5, Math.floor(r.affinity ?? 0))),
            lastDepthMet: Math.max(0, Math.floor(r.lastDepthMet ?? 0)),
            flags: Array.isArray(r.flags) ? r.flags.filter((x) => typeof x === 'string') : [],
        };
    }
    return out;
}

export interface NpcEvalContext {
    depth: number;
    hpFrac: number;          // 0..1
    stress: number;          // 0..100
    resolution: 'none' | 'affliction' | 'virtue';
    bleedDamageDealt: number;
    relicsFound: number;
    bossesKilledEver: number;
}

function tagsFor(memory: NpcMemory, ctx: NpcEvalContext): Set<NpcStateTag> {
    const tags = new Set<NpcStateTag>();
    if (memory.affinity >= 2) tags.add('liked');
    if (memory.affinity >= 4) tags.add('trusted');
    if (memory.affinity <= -2) tags.add('wary');
    if (ctx.hpFrac <= 0.3) tags.add('low-hp');
    if (ctx.stress >= 60) tags.add('high-stress');
    if (ctx.resolution === 'affliction') tags.add('afflicted');
    if (ctx.resolution === 'virtue') tags.add('virtuous');
    if (ctx.bleedDamageDealt >= 8) tags.add('bleeder');
    if (ctx.relicsFound >= 3) tags.add('relic-rich');
    if (ctx.depth >= 6) tags.add('deep-run');
    if (ctx.bossesKilledEver === 0) tags.add('first-run');
    return tags;
}

function beatStageFor(metCount: number): 'first' | 'return' | 'deep' {
    if (metCount === 0) return 'first';
    if (metCount >= 3) return 'deep';
    return 'return';
}

// Score a beat against the active state tags. Higher score = more matches.
// Beats with no tag list get a small base score so they always remain a fallback.
function scoreBeat(beat: NpcDialogBeat, activeTags: Set<NpcStateTag>): number {
    if (!beat.tags || beat.tags.length === 0) return 1;
    let s = 0;
    for (const t of beat.tags) {
        if (activeTags.has(t)) s += 5;
        else return -1; // a beat with a tag the player doesn't have is excluded
    }
    return s;
}

export interface PickedDialog {
    npc: NpcProfile;
    beat: NpcDialogBeat;
    farewell: NpcDialogBeat | null;
    activeTags: NpcStateTag[];
    offers: NpcOfferTemplate[];
    memory: NpcMemory;
}

// Configurable hook from MetaProgressionManager: the manager owns persistence
// and we just operate on a live ref + a save callback so the manager can
// flush to localStorage.
export class NpcManager {
    private memory: NpcMemoryMap;
    private save: () => void;

    constructor(memory: NpcMemoryMap, save: () => void) {
        this.memory = memory;
        this.save = save;
    }

    getMemory(id: NpcId): NpcMemory {
        return this.memory[id];
    }

    // Pick which NPC should occupy a room of the given role. Weighted by:
    //  - role match (hard filter)
    //  - prefer NPCs the player has met fewer times (encourage rotation)
    //  - small random nudge so the same depth doesn't always pick the same one
    pickForRole(role: NpcRole, depth: number): NpcId | null {
        const candidates = ALL_NPC_IDS.filter((id) => NPCS[id].role === role);
        if (candidates.length === 0) return null;

        const scored = candidates.map((id) => {
            const m = this.memory[id];
            // Lower met -> higher base. Different recent depth -> higher.
            const metPenalty = Math.min(m.metCount, 6);
            const recencyBonus = m.lastDepthMet === depth ? -1 : 0;
            const noise = Math.random();
            return { id, score: 6 - metPenalty + recencyBonus + noise };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored[0].id;
    }

    pickDialog(id: NpcId, ctx: NpcEvalContext): PickedDialog {
        const npc = NPCS[id];
        const memory = this.memory[id];
        const stage = beatStageFor(memory.metCount);
        const activeTags = tagsFor(memory, ctx);
        const stageBeats = npc.beats.filter((b) => b.stage === stage);
        let best: NpcDialogBeat | null = null;
        let bestScore = -1;
        for (const b of stageBeats) {
            const s = scoreBeat(b, activeTags);
            if (s > bestScore) {
                bestScore = s;
                best = b;
            }
        }
        // Fallback: any beat at all.
        if (!best) best = stageBeats[0] ?? npc.beats[0];

        const farewell = npc.beats.find((b) => b.stage === 'farewell') ?? null;
        const visibleOffers = npc.offers.filter((o) => {
            if (o.onlyAfterMet !== undefined && memory.metCount < o.onlyAfterMet) return false;
            if (o.requiresAffinity !== undefined && memory.affinity < o.requiresAffinity) return false;
            return true;
        });

        return {
            npc,
            beat: best,
            farewell,
            activeTags: Array.from(activeTags),
            offers: visibleOffers,
            memory,
        };
    }

    // Invoked the moment the room is entered: bumps metCount + lastDepth.
    // The actual affinity changes happen on offer choice via `recordChoice`.
    markEncounter(id: NpcId, depth: number) {
        const m = this.memory[id];
        m.metCount += 1;
        m.lastDepthMet = depth;
        this.save();
    }

    // Apply a delta in [-2..+2] when the player picks a meaningful option.
    adjustAffinity(id: NpcId, delta: number) {
        const m = this.memory[id];
        m.affinity = Math.max(-5, Math.min(5, m.affinity + delta));
        this.save();
    }

    addFlag(id: NpcId, flag: string) {
        const m = this.memory[id];
        if (!m.flags.includes(flag)) {
            m.flags.push(flag);
            this.save();
        }
    }

    hasFlag(id: NpcId, flag: string): boolean {
        return this.memory[id].flags.includes(flag);
    }

    // Pick a boss-intro line from the most-known NPC (highest met OR affinity).
    // Returns null if the player has met no one yet.
    pickBossIntro(): { npc: NpcProfile; line: string } | null {
        const known = ALL_NPC_IDS
            .filter((id) => this.memory[id].metCount > 0)
            .sort((a, b) => {
                const ma = this.memory[a];
                const mb = this.memory[b];
                return (mb.metCount + mb.affinity) - (ma.metCount + ma.affinity);
            });
        if (known.length === 0) return null;
        const npc = NPCS[known[0]];
        const lines = npc.voice.bossIntro;
        const line = lines[Math.floor(Math.random() * lines.length)];
        return { npc, line };
    }

    // Snapshot of all known NPCs for end-of-run summary. Returns lines like
    // "Mira  |  met x3  |  trusted" suitable for display.
    getMemorySummary(): string[] {
        const lines: string[] = [];
        for (const id of ALL_NPC_IDS) {
            const m = this.memory[id];
            if (m.metCount === 0) continue;
            const npc = NPCS[id];
            let bond = 'distant';
            if (m.affinity >= 4) bond = 'trusted';
            else if (m.affinity >= 2) bond = 'liked';
            else if (m.affinity <= -2) bond = 'wary';
            else if (m.metCount >= 1) bond = 'familiar';
            lines.push(`${npc.name} (${npc.title})  |  met x${m.metCount}  |  ${bond}`);
        }
        return lines;
    }

    // Pick a low-hp recall barb from any NPC the player has bonded with
    // (affinity >= 1). Used for the "voice in your head" fallback.
    pickLowHpRecall(): string | null {
        const friends = ALL_NPC_IDS.filter((id) => this.memory[id].affinity >= 1);
        if (friends.length === 0) return null;
        const npc = NPCS[friends[Math.floor(Math.random() * friends.length)]];
        const lines = npc.voice.lowHpRecall;
        return lines[Math.floor(Math.random() * lines.length)];
    }
}
