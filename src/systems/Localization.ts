import type { LocalizedText } from './LocalizedText';
import { RU_ENEMY_TEXT } from '../data/EnemyTextConfig';
import { pickLocalized } from './LocalizedText';
import { EN_STRINGS, type LocaleKey } from './locale/en';
import { RU_STRINGS } from './locale/ru';

/**
 * Player-facing language. The active language is read from
 * `localStorage` on first construct and persisted on every toggle.
 */
export type Language = 'ru' | 'en';

type Vars = Record<string, string | number>;

const STORAGE_KEY = 'rpglikedurkest-language';

/**
 * Per-language string tables. Held as a plain map keyed by
 * `Language` so `t(key)` is a constant-time lookup. The English table
 * is canonical (its keys define {@link LocaleKey}) and Russian is
 * type-checked to define every key, so missing translations fail the
 * build instead of silently falling back at runtime.
 */
const TEXT: Record<Language, Record<LocaleKey, string>> = {
    en: EN_STRINGS,
    ru: RU_STRINGS,
};

/**
 * Tiny localisation runtime. Wraps the per-language string tables and
 * exposes a typed `t(key, vars?)` helper that performs `{name}` style
 * placeholder substitution.
 */
export class Localization {
    language: Language;

    constructor(language: Language = getSavedLanguage()) {
        this.language = language;
    }

    /** Look up a string and substitute `{name}` placeholders. */
    t(key: LocaleKey, vars: Vars = {}): string {
        const template: string = TEXT[this.language][key] || TEXT.en[key];
        return Object.entries(vars).reduce(
            (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
            template
        );
    }

    /** Pick the best-matching string from a {@link LocalizedText} blob. */
    pick(text: LocalizedText | string | null | undefined): string {
        return pickLocalized(this.language, text);
    }

    /** Pick a string and substitute placeholders in a single call. */
    format(text: LocalizedText | string | null | undefined, vars: Vars = {}): string {
        const template = this.pick(text);
        return Object.entries(vars).reduce(
            (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
            template
        );
    }

    enemyName(name: string): string {
        return this.language === 'ru' ? (RU_ENEMY_TEXT[name]?.name ?? name) : name;
    }

    enemyDescription(name: string, fallback: string): string {
        return this.language === 'ru' ? (RU_ENEMY_TEXT[name]?.description ?? fallback) : fallback;
    }

    /** Toggle language, persist to `localStorage`, return the new value. */
    toggle(): Language {
        const next = this.language === 'ru' ? 'en' : 'ru';
        this.language = next;
        saveLanguage(next);
        return next;
    }
}

/** Read the persisted language, defaulting to Russian. */
export function getSavedLanguage(): Language {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ru';
    } catch {
        return 'ru';
    }
}

/** Persist the player-selected language and update the document `lang`. */
export function saveLanguage(language: Language): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
        // Language still applies for the current restart path.
    }
    if (typeof document !== 'undefined') {
        document.documentElement.lang = language;
    }
}
