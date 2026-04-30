// Small string helpers used by UI code.

/** Collapse whitespace and truncate with an ellipsis when the text exceeds `maxLength`. */
export function compactText(text: string, maxLength: number): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLength) {
        return clean;
    }

    return `${clean.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
