import { describe, expect, it } from 'vitest';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';

function typed(repl: NotebookRepl, text: string): void {
    for (const character of text) {
        repl.notebook.insert(character, true);
        if (character === ' ') repl.capitalizeTypedName();
    }
}

describe('Spelling a typed word as a variable', () => {
    function replWith(declarations: string): NotebookRepl {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.replace(declarations);
        repl.notebook.cursor = declarations.length;
        return repl;
    }

    it('capitalizes a lowercase word that names a variable declared earlier in the cell', () => {
        const repl = replWith('N = 5\n');
        typed(repl, 'n + 1 ');
        expect(repl.notebook.current.source).toBe('N = 5\nN + 1 ');
    });

    it('leaves a word alone when no such variable exists', () => {
        const repl = replWith('N = 5\n');
        typed(repl, 'm + 1 ');
        expect(repl.notebook.current.source).toBe('N = 5\nm + 1 ');
    });

    it('leaves keywords and operator words alone beside a variable of that spelling', () => {
        const repl = replWith('N = 5\nGreater = 2\n');
        typed(repl, 'N greater ');
        expect(repl.notebook.current.source).toBe('N = 5\nGreater = 2\nN greater ');
    });

    it('keeps a lowercase index that is bound itself', () => {
        const repl = replWith('I = 5\nfor i in 1 to 3\n  Total += ');
        typed(repl, 'i ');
        expect(repl.notebook.current.source.endsWith('Total += i ')).toBe(true);
    });

    it('does not rewrite inside text or a comment', () => {
        const repl = replWith('N = 5\n');
        typed(repl, '"n ');
        typed(repl, '"\nrem n ');
        expect(repl.notebook.current.source).toBe('N = 5\n"n "\nrem n ');
    });
});
