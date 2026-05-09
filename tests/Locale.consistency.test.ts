import { describe, expect, it } from 'vitest';
import { EN_STRINGS } from '../src/systems/locale/en';
import { RU_STRINGS } from '../src/systems/locale/ru';

/**
 * TypeScript already enforces that `RU_STRINGS` is `Record<LocaleKey, string>`,
 * so a missing or extra key fails the build. These runtime tests are a
 * belt-and-suspenders guard for two failure modes the type system does not
 * catch:
 *
 *   1. A future refactor weakens the type (e.g. `as Record<...>`) and silently
 *      ships a missing translation.
 *   2. A translator changes a `{placeholder}` token name only on one side, so
 *      the build still passes but `Localization.t(key, vars)` silently leaves
 *      the placeholder unfilled at render time.
 */

const placeholderRe = /\{(\w+)\}/g;

function placeholders(s: string): string[] {
    const out: string[] = [];
    for (const m of s.matchAll(placeholderRe)) out.push(m[1]);
    return out.sort();
}

describe('locale consistency', () => {
    it('en and ru declare exactly the same keys', () => {
        const en = Object.keys(EN_STRINGS).sort();
        const ru = Object.keys(RU_STRINGS).sort();
        expect(ru).toEqual(en);
    });

    it('every key uses the same set of {placeholder} tokens in en and ru', () => {
        const mismatches: Array<{ key: string; en: string[]; ru: string[] }> = [];
        for (const key of Object.keys(EN_STRINGS) as Array<keyof typeof EN_STRINGS>) {
            const enTokens = placeholders(EN_STRINGS[key]);
            const ruTokens = placeholders(RU_STRINGS[key]);
            if (enTokens.length !== ruTokens.length || enTokens.some((t, i) => t !== ruTokens[i])) {
                mismatches.push({ key, en: enTokens, ru: ruTokens });
            }
        }
        expect(mismatches).toEqual([]);
    });

    /**
     * Every entry in `EN_STRINGS` should be referenced at least once from
     * application code under `src/` outside the `locale/` directory. Catches
     * the dead-locale-key regression tracked in the dead-code audit (PR D):
     * when a key is renamed or its only call site is removed, this test
     * fails so the orphan key gets cleaned up in the same commit.
     *
     * Caveat: keys read via *runtime* template construction (e.g.
     * `loc.t(`combatSkill${id}`)`) cannot be detected by a static
     * string-literal scan. The current call sites that resolve the key
     * dynamically all spell every possible key as a literal in a const
     * table or ternary (see `ROOM_NAME_KEY` in `ui/RoomVisuals.ts`,
     * `encounterKey` in `systems/CombatManager.ts`,
     * `titleKey`/`summaryKey` in `ui/end/VictoryScreen.ts`), so this test
     * covers them. If you ever introduce a `loc.t(`prefix_${x}`)` pattern,
     * either spell every reachable key as a literal somewhere in `src/`
     * (e.g. in a typed lookup map) or add an allow-list here.
     */
    it('every key has a string-literal reference under src/', () => {
        // `import.meta.glob` is the Vite/Vitest equivalent of a recursive
        // `fs.readdirSync` walk — it inlines every matched file's raw
        // contents at transform time. We exclude `src/systems/locale/**`
        // since that's where the keys are *defined* (every key trivially
        // appears in en.ts and ru.ts).
        const sources = import.meta.glob('../src/**/*.{ts,tsx}', {
            query: '?raw',
            import: 'default',
            eager: true,
        }) as Record<string, string>;
        const haystack = Object.entries(sources)
            .filter(([path]) => !path.includes('/locale/'))
            .map(([, contents]) => contents)
            .join('\n');
        const orphans: string[] = [];
        for (const key of Object.keys(EN_STRINGS)) {
            const re = new RegExp(`['"\`]${escapeRegExp(key)}['"\`]`);
            if (!re.test(haystack)) orphans.push(key);
        }
        expect(
            orphans,
            `Orphan locale keys (no string-literal call site under src/, excluding src/systems/locale/): ${orphans.join(', ')}`
        ).toEqual([]);
    });
});

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
