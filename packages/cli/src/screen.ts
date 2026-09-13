// What the REPL knows about the terminal it draws on. The loop in repl.ts owns
// what to show; this module owns the arithmetic of taking it back.

import * as readline from 'node:readline';

/** The rows a line that wide occupies on a terminal that wide. */
export function screenRows(width: number, columns: number): number {
    if (columns <= 0) return 1;
    return Math.max(1, Math.ceil(width / columns));
}

/** A terminal that reports no height is taken for an ordinary one. */
export function screenHeight(out: NodeJS.WriteStream): number {
    return out.rows || 24;
}

/** Clears the screen and leaves the cursor at the top left of it. */
export function clearScreen(out: NodeJS.WriteStream): void {
    readline.cursorTo(out, 0, 0);
    readline.clearScreenDown(out);
}

/**
 * Erases the last `rows` rows and leaves the cursor where they began, so what
 * stood there can be printed again in another form.
 *
 * Returns false when the region is taller than the screen: the rows above have
 * scrolled away and reaching for them would erase whatever is there now. A
 * caller that is told no draws the screen again instead, or leaves it alone.
 */
export function eraseRows(out: NodeJS.WriteStream, rows: number): boolean {
    if (rows <= 0) return true;
    if (rows >= screenHeight(out)) return false;
    readline.moveCursor(out, 0, -rows);
    readline.cursorTo(out, 0);
    readline.clearScreenDown(out);
    return true;
}

/** A terminal that can be asked what readline printed through it. */
export interface Counted {
    /** The stream to hand readline. */
    readonly stream: NodeJS.WriteStream;
    /** Start counting the rows written from here. */
    readonly arm: () => void;
    /** Stop counting, keeping what has been counted so far. */
    readonly disarm: () => void;
    /** The rows counted since the last call, and zero again after it. */
    readonly taken: () => number;
}

/**
 * Counts the rows readline prints on its own account.
 *
 * A completion listing is written from inside the tab keystroke, below the
 * prompt and out of reach of anything watching from outside; the completer is
 * called immediately before it, and the keypress handler runs immediately
 * after. Counting between those two is how the REPL learns a listing is there
 * and how tall it is, without copying readline's idea of how to lay one out.
 */
export function countRows(out: NodeJS.WriteStream): Counted {
    let armed = false;
    let rows = 0;
    const stream = new Proxy(out, {
        get(target, property) {
            if (property === 'write') {
                return (chunk: unknown, ...rest: unknown[]): boolean => {
                    if (armed && typeof chunk === 'string') {
                        rows += chunk.split('\n').length - 1;
                    }
                    const write = target.write as (...args: unknown[]) => boolean;
                    return write.call(target, chunk, ...rest);
                };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    return {
        stream,
        arm: () => { armed = true; },
        disarm: () => { armed = false; },
        taken: () => {
            const seen = rows;
            rows = 0;
            return seen;
        },
    };
}
