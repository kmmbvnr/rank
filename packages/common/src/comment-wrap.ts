/**
 * Wraps speech or comment text into `rem ` lines of at most `maxColumns` (default 40) characters,
 * preserving any leading indentation.
 */
export function wrapCommentLines(text: string, maxColumns = 40, indent = ''): string {
    const prefix = indent + 'rem ';
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return prefix;

    const lines: string[] = [];
    let currentLine = prefix + words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        if (currentLine.length + 1 + word.length <= maxColumns) {
            currentLine += ' ' + word;
        } else {
            lines.push(currentLine);
            currentLine = prefix + word;
        }
    }
    lines.push(currentLine);
    return lines.join('\n');
}

/**
 * Normalizes a word for comparison by converting to lower case and stripping surrounding punctuation.
 */
function normalizeWord(w: string): string {
    const stripped = w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    return stripped || w.toLowerCase();
}

/**
 * Merges speech recognition transcripts without repeating phrases or words.
 *
 * Speech recognition engines (especially on Android Chrome / WebView) often emit:
 * 1. Cumulative transcripts where subsequent items repeat the full previous phrase.
 * 2. Overlapping boundary words across subsequent result events.
 * 3. Rewinds or duplicate segments.
 *
 * This function detects prefix/suffix containment and the longest matching boundary
 * overlap, splicing the new segment onto existing text without duplicates.
 */
export function mergeTranscripts(existing: string, addition: string): string {
    const trimmedA = existing.trim();
    const trimmedB = addition.trim();

    if (!trimmedA) return trimmedB;
    if (!trimmedB) return trimmedA;

    const wordsA = trimmedA.split(/\s+/);
    const wordsB = trimmedB.split(/\s+/);

    const normA = wordsA.map(normalizeWord);
    const normB = wordsB.map(normalizeWord);

    // 1. If addition is a prefix of existing, it contains no new words
    if (wordsA.length >= wordsB.length) {
        let prefixMatch = true;
        for (let i = 0; i < wordsB.length; i++) {
            if (normA[i] !== normB[i]) {
                prefixMatch = false;
                break;
            }
        }
        if (prefixMatch) {
            return trimmedA;
        }
    }

    // 2. Find longest suffix of A matching prefix of B
    const maxOverlap = Math.min(wordsA.length, wordsB.length);
    let overlap = 0;

    for (let k = maxOverlap; k >= 1; k--) {
        let match = true;
        for (let i = 0; i < k; i++) {
            if (normA[wordsA.length - k + i] !== normB[i]) {
                match = false;
                break;
            }
        }
        if (match) {
            overlap = k;
            break;
        }
    }

    if (overlap > 0) {
        const remainingB = wordsB.slice(overlap);
        if (remainingB.length === 0) {
            return trimmedA;
        }
        return trimmedA + ' ' + remainingB.join(' ');
    }

    return trimmedA + ' ' + trimmedB;
}
