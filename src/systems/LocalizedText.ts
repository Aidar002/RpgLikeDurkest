export type LocalizedText = {
    ru: string;
    en: string;
};

export function lt(ru: string, en: string): LocalizedText {
    return { ru, en };
}

export function pickLocalized(
    language: 'ru' | 'en',
    text: LocalizedText | string | null | undefined
): string {
    if (!text) return '';
    if (typeof text === 'string') return text;
    return text[language] ?? text.ru;
}
