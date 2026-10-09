import { describe, expect, it } from 'vitest';
import { KeyRouter } from '../src/key-router.js';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';
import { Notebook } from '../src/notebook.js';
import { notebookFrame } from '../src/screen.js';

describe('clearing a failed source line', () => {
    it('removes the error as soon as the last character is erased', async () => {
        const repl = new NotebookRepl(createReplSession());
        const keys = new KeyRouter(repl);
        repl.notebook.replace('Missing');
        await keys.press('', { name: 'return' });
        expect(repl.notebook.current.status).toBe('error');

        for (let index = 0; index < 'Missing'.length; index++)
            await keys.press('', { name: 'backspace' });

        expect(repl.notebook.current.source).toBe('');
        expect(repl.notebook.current.status).toBe('idle');
        expect(repl.notebook.current.output).toEqual([]);
        expect(repl.notebook.current.errorOffset).toBeUndefined();
        // The emptied cell folds into the empty prompt below it.
        expect(repl.notebook.atPrompt).toBe(true);
        expect(repl.notebook.cells).toHaveLength(1);
    });

    it('clears an error from a whitespace-only cell', async () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.replace('Missing');
        await new KeyRouter(repl).press('', { name: 'return' });
        repl.notebook.replace('   ');

        expect(repl.notebook.current.status).toBe('idle');
        expect(repl.notebook.current.output).toEqual([]);
    });
});

describe('running a line after a failed one', () => {
    it('does not carry a syntax error over to the corrected line', async () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.replace('X = @');
        await repl.submit(true);
        expect(repl.notebook.cells[0]!.status).toBe('error');
        expect(repl.notebook.cells[0]!.output[0]!.text).not.toMatch(/Expecting|Token sequences|<\[NL\]>/);

        repl.notebook.replace('X = 1 + 2');
        await repl.submit(true);
        expect(repl.notebook.cells.some(cell => cell.status === 'error')).toBe(false);
        expect(repl.notebook.cells.flatMap(cell => cell.output.map(line => line.text))).toEqual(['3']);
    });

    it('opens a block on Play for a function header instead of reporting an error', async () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.replace('fun inc N');
        await repl.submit(true);
        expect(repl.notebook.cells.some(cell => cell.status === 'error')).toBe(false);
    });
});

describe('function error origin markers', () => {
    const definition = 'fun leading_sum Numbers Digits\n  Total = Numbers sum\n  Text = Total text\n  Prefix = Text take Digits\n  return Prefix integer\nend';

    it('marks the failing function line once, retaining the call error and ordinary code colors', async () => {
        const session = createReplSession();
        const book = new Notebook();
        try {
            book.enqueue(definition);
            book.finish(0, await session.execute(definition, book.cells[0].id, [], 80, true));
            book.enqueue('0 0 leading_sum');
            const result = await session.execute('0 0 leading_sum', book.cells[1].id, [], 80, true);
            expect(result.errorSource).toEqual({ source: definition, offset: definition.indexOf('return') });
            expect(result.errorOffset).toBeUndefined();
            book.finish(1, result);
            const frame = notebookFrame(book, 24, 200, 0, '', false, false);
            const origin = frame.lines.filter((_, row) => {
                const target = frame.targets?.[row];
                return target?.kind === 'source' && target.cell === 0 && target.line === 5;
            });
            expect(origin.length).toBeGreaterThan(1);
            expect(origin.filter(line => line.startsWith('\x1b[31m●     \x1b[0m'))).toHaveLength(1);
            expect(origin[0]).toContain('\x1b[0m  return');
            expect(book.cells[1].output.some(line => line.error && line.inlineText?.includes('invalid integer text'))).toBe(true);

            book.cells[0].source = definition.replace('Prefix integer', '0');
            expect(notebookFrame(book, 80, 200, 0, '', false, false).lines
                .some(line => line.startsWith('\x1b[31m●     \x1b[0m'))).toBe(false);
            book.cells[0].source = definition;
            book.finish(1, await session.execute('0 1 leading_sum', book.cells[1].id, [], 80, true));
            expect(book.cells[1].errorSource).toBeUndefined();
            expect(notebookFrame(book, 80, 200, 0, '', false, false).lines
                .some(line => line.startsWith('\x1b[31m●     \x1b[0m'))).toBe(false);
        } finally { session.dispose(); }
    });

    it('retains the innermost definition when a function calls another function', async () => {
        const session = createReplSession();
        const inner = 'fun inner X\n  return X / 0\nend';
        try {
            await session.execute(inner, 1, [], 80, true);
            await session.execute('fun outer X\n  return X inner\nend', 2, [], 80, true);
            const result = await session.execute('1 outer', 3, [], 80, true);
            expect(result.errorSource?.source).toBe(inner);
            expect(result.errorOffset).toBeUndefined();
        } finally { session.dispose(); }
    });

    it('marks a hoisted definition below the failed call without marking it as a failed cell', async () => {
        const session = createReplSession();
        const book = new Notebook();
        try {
            book.enqueue('0 0 leading_sum');
            book.enqueue(definition);
            await session.prepareFunctions([{ id: book.cells[1].id, source: definition }]);
            book.finish(0, await session.execute('0 0 leading_sum', book.cells[0].id, [], 80, true));
            const frame = notebookFrame(book, 80, 100, 0, '', false, false);
            expect(frame.lines.find(line => line.includes('return Prefix integer')))
                .toMatch(/^\x1b\[31m● {5}\x1b\[0m/);
            expect(book.cells[1].status).toBe('idle');
            expect(book.cells[1].output).toEqual([]);
        } finally { session.dispose(); }
    });
});
