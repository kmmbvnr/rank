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
