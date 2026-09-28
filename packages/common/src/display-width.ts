/// <reference lib="es2022.intl" />
import stringWidth from 'string-width';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Terminal cells a string occupies. The screen layout and every painter use this one
 * measure, so a glyph is never laid out at one width and drawn at another.
 */
export function cellWidth(text: string): number { return stringWidth(text); }

/** The trailing graphemes of `text` that fit in `width` cells, left-padded to exactly `width`. */
export function fitEnd(text: string, width: number): string {
    const parts = [...segmenter.segment(text)].map(part => part.segment);
    let kept = '';
    let used = 0;
    for (let index = parts.length - 1; index >= 0; index--) {
        const size = cellWidth(parts[index]);
        if (used + size > width) break;
        kept = parts[index] + kept;
        used += size;
    }
    return ' '.repeat(Math.max(0, width - used)) + kept;
}
