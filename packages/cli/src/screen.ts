// What the REPL knows about the terminal it draws on. The loop in repl.ts owns
// what to show; this module owns the arithmetic of taking it back.

import * as readline from 'node:readline';

/** The rows a line that wide occupies on a terminal that wide. */
export function screenRows(width: number, columns: number): number {
    if (columns <= 0) return 1;
    return Math.max(1, Math.ceil(width / columns));
}

/**
 * Erases the last `rows` rows and leaves the cursor where they began, so what
 * stood there can be printed again in another form.
 *
 * Returns false when the region is taller than the screen: the rows above are
 * gone and reaching for them would erase whatever scrolled into their place. A
 * caller that is told no leaves the screen alone. A terminal that reports no
 * height at all is taken for an ordinary one rather than for a single row.
 */
export function eraseRows(out: NodeJS.WriteStream, rows: number): boolean {
    if (rows <= 0) return true;
    if (rows >= (out.rows || 24)) return false;
    readline.moveCursor(out, 0, -rows);
    readline.cursorTo(out, 0);
    readline.clearScreenDown(out);
    return true;
}
