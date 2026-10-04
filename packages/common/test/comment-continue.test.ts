import { describe, expect, it } from 'vitest';
import { KeyRouter } from '../src/key-router.js';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';
import { wrapLongComments } from '../src/comment-wrap.js';

describe('comments while editing', () => {
    it('continues a comment on the next line when Enter is pressed inside it', async () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.enqueue('Count = 1');
        repl.notebook.enqueue('rem first part');
        repl.notebook.enqueue('Count');
        repl.notebook.selectTo(1, 'rem first'.length);

        await new KeyRouter(repl).press('', { name: 'return' });

        expect(repl.notebook.current.source).toBe('rem first\nrem  part');
        expect(repl.notebook.cursor).toBe('rem first\nrem '.length);
    });

    it('ends the comment when Enter is pressed on an empty comment line', async () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.enqueue('rem one\nrem ');
        repl.notebook.enqueue('Count = 1');
        repl.notebook.selectTo(0, 'rem one\nrem '.length);

        await new KeyRouter(repl).press('', { name: 'return' });

        expect(repl.notebook.current.source).toBe('rem one\n');
    });

    it('wraps a long comment to 40 columns when its cell is left, one comment line per cell', async () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.enqueue('rem Spoken commentary is automatically wrapped at 40 characters per line');
        repl.notebook.enqueue('Count = 1');
        repl.notebook.selectTo(0, 3);
        repl.notebook.selectTo(1, 0);

        const comments = repl.notebook.cells.map(cell => cell.source).filter(source => source.startsWith('rem'));
        expect(comments).toEqual(['rem Spoken commentary is automatically', 'rem wrapped at 40 characters per line']);
        expect(comments.every(line => line.length <= 40)).toBe(true);
    });

    it('wraps only the lines that are too long', () => {
        expect(wrapLongComments('rem https://projecteuler.net/problem=1\nX = 1\n  rem short')).toBe(
            'rem https://projecteuler.net/problem=1\nX = 1\n  rem short');
        expect(wrapLongComments('  rem one two three four five six seven eight nine ten')).toBe(
            '  rem one two three four five six seven\n  rem eight nine ten');
    });
});

describe('a line that ends with an operator named by a higher-order word', () => {
    it('is a finished statement', async () => {
        for (const line of ['Factors Factors outer *', 'Xs reduce +', 'Xs scan and', 'Xs Ys outer not equal', 'Xs Ys outer at least']) {
            const repl = new NotebookRepl(createReplSession());
            for (const char of line) await new KeyRouter(repl).press(char, {});
            await new KeyRouter(repl).press('', { name: 'return' });
            expect(repl.notebook.cells.length, line).toBe(2);
            expect(repl.notebook.cells[0].source, line).toBe(line.replace(/^/, ''));
        }
    });

    it('still folds after a dangling operator', async () => {
        const repl = new NotebookRepl(createReplSession());
        for (const char of 'Total = 1 +') await new KeyRouter(repl).press(char, {});
        await new KeyRouter(repl).press('', { name: 'return' });
        expect(repl.notebook.cells.length).toBe(1);
    });
});
