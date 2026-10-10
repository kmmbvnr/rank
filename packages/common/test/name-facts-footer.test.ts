import { readFileSync } from 'node:fs';
import { formatNameFacts } from '../src/name-facts.js';
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

it('shows the recursive memo result under the cursor with rank declared on the function', () => {
    const demo = readFileSync(new URL('../../../demos/euler/014_collatz.ra', import.meta.url), 'utf8');
    const source = 'use numbers\n' + demo.slice(demo.indexOf('memo collatz'), demo.indexOf('Seqs =')).trim();
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        expect(footer(repl, source, source.indexOf('collatz') + 2)).toBe('facts: collatz · a → i');
    } finally { session.dispose(); }
});

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

it('shows the normal hints on a keyword or a number, and signatures on operators', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        const source = 'Count = array shape 2 3 fill 0 + 1';
        expect(footer(repl, source, source.indexOf('array') + 2)).toContain('Ctrl-');
        expect(footer(repl, source, source.indexOf('+') + 1)).toBe('facts: + · integer integer → integer [rank 0 0]');
        expect(footer(repl, source, source.indexOf('2'))).toContain('Ctrl-');
    } finally { session.dispose(); }
});

it('shows nothing for a name nothing defines', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        expect(footer(repl, 'Z + 1', 0)).not.toContain('Z ·');
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

it('wraps a long fact onto more footer rows instead of clipping it', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('LongerNameThanFits = array shape 100 200 fill 1');
        repl.notebook.cursor = 3;
        const frame = notebookFrame(repl.notebook, 20, 12, 0, '', false, true, '', 'Running…', undefined, 'rank> ',
            undefined, undefined, undefined, false, undefined, true, 0, repl.diagnosticOutputs, undefined, repl.nameFacts);
        const rows = frame.lines.slice(frame.factsRow, frame.factsRow! + frame.factsRowCount!).map(line => stripAnsi(line));
        expect(rows.length).toBeGreaterThan(1);
        expect(rows.join(' ')).toContain('LongerNameThanFits');
        for (const row of rows) expect(row.length).toBeLessThanOrEqual(19);
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
        expect(footer(repl, call, call.lastIndexOf('identity') + 1)).toBe('facts: identity · i → i');
    } finally { session.dispose(); }
});

it('keeps the prompt row reachable when the footer appears over a full screen', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        for (let index = 0; index < 11; index++) repl.notebook.insertCell(repl.notebook.cells.length - 1, `V${index} = ${index}`);
        repl.notebook.active = 1;
        repl.notebook.cursor = 2;
        for (const follow of [true, false]) {
            const frame = notebookFrame(repl.notebook, 40, 12, 0, '', false, follow, '', 'Running…', undefined, 'rank> ',
                undefined, undefined, undefined, false, undefined, true, 0, repl.diagnosticOutputs, undefined, repl.nameFacts);
            expect(frame.factsRow).toBe(11);
            expect(stripAnsi(frame.lines[10])).toBe('rank> ');
            expect(frame.cursorVisible).toBe(true);
        }
    } finally { session.dispose(); }
});


it('uses a later notebook predicate definition and analyzes uncalled function locals', () => {
    const session = createReplSession();
    const repl = new NotebookRepl(session);
    try {
        repl.notebook.restore(readFileSync(new URL('../../../demos/euler/004_palproduct.ra', import.meta.url), 'utf8'));
        for (const [site, expected] of [
            ['Candidates filter', 'Candidates · sequence<integer>'],
            ['Answer =', 'Answer · integer'],
            ['Answer print', 'Answer · integer'],
            ['Text =', 'Text · text'],
            ['Text equal', 'Text · text'],
        ]) {
            const index = repl.notebook.cells.findIndex(cell => cell.source.includes(site));
            repl.notebook.selectTo(index, repl.notebook.cells[index].source.indexOf(site));
            expect(formatNameFacts(repl.nameFacts!)).toBe(expected);
        }
    } finally { session.dispose(); }
});


it('shows the type after tapping the name in a CLI declaration on the touch console', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        const source = 'option Digits integer = 3';
        repl.notebook.replace(source);
        repl.notebook.cursor = source.indexOf('Digits') + 2;
        const frame = frameOf(repl, 12, false);
        expect(frame.factsRow).toBeDefined();
        expect(stripAnsi(frame.lines[frame.factsRow!])).toBe('Digits · integer');
    } finally { session.dispose(); }
});


it('shows the sum signature in a filtered pipeline on a touch console before and after running', async () => {
    const session = createReplSession();
    const repl = new NotebookRepl(session);
    try {
        for (const source of ['N = array 1 2 3', 'Mask = array true false true']) {
            repl.notebook.replace(source);
            await repl.submit(true);
        }
        const source = 'N Mask sum';
        footer(repl, source, source.indexOf('sum'), 40, false);
        expect(repl.nameFacts?.signature).toContain('→ number');
        const frame = notebookFrame(repl.notebook, 40, 20, 0, '', false, true, '', 'Running…', undefined, 'rank> ',
            undefined, undefined, undefined, false, undefined, false, 0, repl.diagnosticOutputs, undefined, repl.nameFacts);
        expect(stripAnsi(frame.lines.join('\n'))).toContain('→ number');
        await repl.submit(true);
        const index = repl.notebook.cells.findIndex(cell => cell.source === source);
        repl.notebook.selectTo(index, source.indexOf('sum'));
        expect(repl.nameFacts?.signature).toContain('→ number');
        expect(formatNameFacts(repl.nameFacts!)).not.toContain('· function');
    } finally { session.dispose(); }
});


it('keeps Euler 1 types across restored notebook cells before execution', () => {
    const session = createReplSession();
    const repl = new NotebookRepl(session);
    try {
        repl.notebook.restore(readFileSync(new URL('../../../demos/euler/001_multiples.ra', import.meta.url), 'utf8'));
        for (const [site, expected] of [
            ['N =', 'N · sequence<integer>'],
            ['Mask =', 'Mask · sequence<boolean>'],
            ['Mask or=', 'Mask · sequence<boolean>'],
            ['Mask sum', 'Mask · sequence<boolean>'],
            ['Answer =', 'Answer · integer'],
            ['Answer print', 'Answer · integer'],
        ]) {
            const index = repl.notebook.cells.findIndex(cell => cell.source.includes(site));
            repl.notebook.selectTo(index, repl.notebook.cells[index].source.indexOf(site));
            expect(formatNameFacts(repl.nameFacts!)).toBe(expected);
        }
    } finally { session.dispose(); }
});


it('infers Euler 13 types and parameter requirements across restored cells', () => {
    const session = createReplSession();
    const repl = new NotebookRepl(session);
    try {
        repl.notebook.restore(readFileSync(new URL('../../../demos/euler/013_largesum.ra', import.meta.url), 'utf8'));
        for (const [site, expected] of [
            ['Answer =', 'Answer · integer'], ['Answer print', 'Answer · integer'],
            ['leading_sum Numbers', 'leading_sum · (number | missing) [rank ≥ 0] i → i'],
            ['Prefix =', 'Prefix · text'], ['Digits\n', 'Digits · integer'],
            ['Numbers Digits\n', 'Numbers · (integer or missing or real) [rank ≥ 0]'],
        ]) {
            const index = repl.notebook.cells.findIndex(cell => cell.source.includes(site));
            repl.notebook.selectTo(index, repl.notebook.cells[index].source.indexOf(site));
            expect(formatNameFacts(repl.nameFacts!)).toBe(expected);
        }
    } finally { session.dispose(); }
});
