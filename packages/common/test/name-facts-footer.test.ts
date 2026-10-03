import { expect, it } from 'vitest';
import stripAnsi from 'strip-ansi';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';
import { notebookFrame } from '../src/screen.js';

function footer(repl: NotebookRepl, source: string, cursor: number, columns = 60, hints = true): string | undefined {
    repl.notebook.replace(source);
    repl.notebook.cursor = cursor;
    const frame = notebookFrame(repl.notebook, columns, 12, 0, '', false, true, '', 'Running…', undefined, 'rank> ',
        undefined, undefined, undefined, false, undefined, hints, 0, repl.diagnosticOutputs, undefined, repl.nameFacts);
    return frame.factsRow === undefined ? stripAnsi(frame.lines.at(-1) ?? '') : `facts: ${stripAnsi(frame.lines[frame.factsRow])}`;
}

it('shows the type of the name under the cursor instead of the hints', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        const source = 'Fib1 = 1\nFib1 + 2';
        expect(footer(repl, source, 2)).toBe('facts: Fib1 · integer');
        expect(footer(repl, source, 4)).toBe('facts: Fib1 · integer');
        expect(footer(repl, source, source.indexOf('Fib1 +') + 4)).toBe('facts: Fib1 · integer');
    } finally { session.dispose(); }
});

it('shows the normal hints on a keyword, an operator or a number', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        const source = 'Count = array shape 2 3 fill 0 + 1';
        expect(footer(repl, source, source.indexOf('array') + 2)).toContain('Ctrl-');
        expect(footer(repl, source, source.indexOf('+') + 1)).toContain('Ctrl-');
        expect(footer(repl, source, source.indexOf('2'))).toContain('Ctrl-');
    } finally { session.dispose(); }
});

it('says unknown for a name nothing proves', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        expect(footer(repl, 'Z + 1', 0)).toBe('facts: Z · unknown');
    } finally { session.dispose(); }
});

it('uses bindings of earlier cells that have not run, and the run for those that have', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('M = array shape 3 4 fill 1');
        await repl.submit(true);
        expect(footer(repl, 'M + 1', 0)).toBe('facts: M · integer [3 4]');
        // A draft that rebinds the name must not borrow the old run.
        expect(footer(repl, 'M = "abc"', 0)).toBe('facts: M · text');
    } finally { session.dispose(); }
});

it('shows the facts line on a touch console, where the footer is otherwise hidden', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        expect(footer(repl, 'Fib1 = 1', 1, 40, false)).toBe('facts: Fib1 · integer');
        expect(footer(repl, 'Fib1 = 1', 7, 40, false)).not.toContain('facts');
    } finally { session.dispose(); }
});

it('keeps a completion candidate and running status ahead of the facts', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('Fib1 = 1');
        repl.notebook.cursor = 1;
        const shown = (suggestion: string, running: boolean) => stripAnsi(notebookFrame(repl.notebook, 60, 12, 0, suggestion, running,
            true, '', 'Running…', undefined, 'rank> ', undefined, undefined, undefined, false, undefined, true, 0, undefined,
            undefined, repl.nameFacts).lines.at(-1)!);
        expect(shown('Fib2', false)).toContain('Fib2');
        expect(shown('', true)).toContain('Running');
    } finally { session.dispose(); }
});

it('clips a long fact to the footer width', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        const line = footer(repl, 'LongerNameThanFits = array shape 100 200 fill 1', 3, 20)!;
        expect(line.replace('facts: ', '').length).toBeLessThanOrEqual(19);
    } finally { session.dispose(); }
});

const frameOf = (repl: NotebookRepl, height: number, followCursor: boolean, overscan: number, previousTop = 0) =>
    notebookFrame(repl.notebook, 40, height, previousTop, '', false, followCursor, '', 'Running…', undefined, 'rank> ',
        undefined, undefined, undefined, false, undefined, false, overscan, undefined, undefined, repl.nameFacts);

it('keeps the footer directly under the viewport when an overscan row follows it', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('Fib1 = 1');
        repl.notebook.cursor = 2;
        const frame = frameOf(repl, 6, true, 1);
        // Five viewport rows, then the footer, then the overscan row: never the footer past the visible rows.
        expect(frame.factsRow).toBe(5);
        expect(stripAnsi(frame.lines[5])).toBe('Fib1 · integer');
        expect(frame.lines).toHaveLength(7);
    } finally { session.dispose(); }
});

it('shows the facts after a tap, which places the cursor without following it', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('Fib1 = 1');
        repl.notebook.cursor = 2;
        const frame = frameOf(repl, 6, false, 1);
        expect(stripAnsi(frame.lines[frame.factsRow!])).toBe('Fib1 · integer');
    } finally { session.dispose(); }
});

it('keeps a cursor that sat on the last row in view when the footer takes that row', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        const lines = Array.from({ length: 12 }, (_, index) => `Fib${index} = ${index}`);
        repl.notebook.replace(lines.join('\n'));
        repl.notebook.cursor = repl.notebook.current.source.lastIndexOf('Fib') + 2;
        const height = 6;
        // Scrolled so the cursor's row is the last of a full viewport.
        const previousTop = frameOf(repl, height, true, 0).caretRow! - (height - 1);
        const frame = frameOf(repl, height, false, 0, previousTop);
        expect(frame.factsRow).toBe(height - 1);
        expect(frame.cursorVisible).toBe(true);
    } finally { session.dispose(); }
});

it('does not show facts while the cursor has been scrolled out of sight', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace(Array.from({ length: 30 }, (_, index) => `Fib${index} = ${index}`).join('\n'));
        repl.notebook.cursor = 2;
        // Reading scrollback far from the cursor: no footer, no shift.
        expect(frameOf(repl, 6, false, 0, 20).factsRow).toBeUndefined();
    } finally { session.dispose(); }
});

it('renders a proven notebook relationship and a concrete call signature in the facts row', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        const definition = 'fun identity Value\n return Value\nend';
        expect(footer(repl, definition, definition.indexOf('identity') + 1)).toBe('facts: identity · a → a');
        const call = definition + '\n1 identity';
        expect(footer(repl, call, call.lastIndexOf('identity') + 1)).toBe('facts: identity · integer → integer');
    } finally { session.dispose(); }
});
