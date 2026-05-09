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
});
