import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';
import { notebookScope, type NotebookScope } from '../src/value-diagnostics.js';

it('shows the Euler 17 function signature in notebook calls and its later definition before and after running', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.restore(readFileSync(new URL('./fixtures/number-letters.ra', import.meta.url), 'utf8'));
        for (const executed of [false, true]) {
            if (executed) {
                await repl.restart();
                expect(repl.notebook.cells.some(cell => cell.status === 'error')).toBe(false);
                expect(repl.notebook.cells.flatMap(cell => cell.output).some(line => line.text === '21124')).toBe(true);
            }
            for (const text of ['fun Value letters', 'Numbers letters', 'fun Value letters']) {
                const index = repl.notebook.cells.findIndex(cell => cell.source.includes(text));
                const source = repl.notebook.cells[index].source;
                repl.notebook.selectTo(index, source.indexOf(text) + text.indexOf('letters'));
                expect(repl.nameFacts?.signature, `${text}, executed=${executed}`).toBe('i → i');
            }
            const index = repl.notebook.cells.findIndex(cell => cell.source.includes('fun Value letters'));
            const source = repl.notebook.cells[index].source;
            for (const [text, name] of [['fun Value letters', 'Value'], ['N = Value', 'N'],
                ['N = Value', 'Value'], ['unpack D N = N divmod 100', 'D'], ['unpack D N = N divmod 100', 'N'],
                ['unpack D N = N divmod 10\n', 'D'], ['unpack D N = N divmod 10\n', 'N'],
                ['return Count + Small N', 'Small'], ['return Count + Small N', 'N']] as const) {
                const offset = text.startsWith('unpack ') ? text.indexOf(name, 'unpack '.length) : text.lastIndexOf(name);
                repl.notebook.selectTo(index, source.indexOf(text) + offset);
                expect(repl.nameFacts?.facts.types, `${text}, name=${name}, executed=${executed}`)
                    .toEqual(name === 'Small' ? ['array'] : ['integer']);
                if (name === 'Small') expect(repl.nameFacts?.facts.elements).toEqual(['integer']);
            }
            repl.notebook.selectTo(index, source.indexOf('at least 20'));
            expect(repl.nameFacts?.signature).toBe('i i → boolean');
        }
    } finally { session.dispose(); }
});

it('invalidates historical call signatures after editing captured values or the function', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.restore('use io\nValues = array 3 5 7\nA = 0 lookup\nA print\n0 lookup\nfun N lookup\n return Values N\nend');
        const definition = repl.notebook.cells.findIndex(cell => cell.source.includes('fun N lookup'));
        const selectDefinition = () => {
            const source = repl.notebook.cells[definition].source;
            repl.notebook.selectTo(definition, source.indexOf('lookup', source.search(/^fun[^\n]*\blookup\b/m)));
            return repl.nameFacts?.signature;
        };
        expect(selectDefinition()).toBe('i → i');
        repl.notebook.restore('lookup');
        const reference = repl.notebook.cells.findIndex(cell => cell.source.trim() === 'lookup');
        repl.notebook.selectTo(reference, repl.notebook.cells[reference].source.indexOf('lookup'));
        expect(repl.nameFacts?.signature).toBe('i → i');
        const laterCall = repl.notebook.cells.findIndex(cell => cell.source.trim() === '0 lookup');
        repl.notebook.selectTo(laterCall, repl.notebook.cells[laterCall].source.indexOf('lookup'));
        expect(repl.nameFacts?.signature).toBe('i → ?');
        const values = repl.notebook.cells.findIndex(cell => cell.source.includes('Values ='));
        repl.notebook.selectTo(values, 0);
        repl.notebook.replace('Values = array "a" "b" "c"');
        expect(selectDefinition()).toBe('i → text');
        repl.notebook.replace('fun N lookup\n return true\nend');
        expect(selectDefinition()).toContain('→ b');
    } finally { session.dispose(); }
});

it('joins observed parameter and local types for a function analyzed through a relationship', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.restore('1 identity\n"text" identity\nfun Value identity\n N = Value\n return N\nend');
        const index = repl.notebook.cells.findIndex(cell => cell.source.includes('fun Value identity'));
        const source = repl.notebook.cells[index].source;
        for (const [text, name] of [['fun Value identity', 'Value'], ['N = Value', 'N'], ['return N', 'N']]) {
            repl.notebook.selectTo(index, source.indexOf(text) + text.lastIndexOf(name));
            expect(repl.nameFacts?.facts.types.slice().sort(), text).toEqual(['integer', 'text']);
        }
    } finally { session.dispose(); }
});

it('reuses analysis across cursor navigation and refreshes after editing an earlier cell', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.restore('A = 1');
        repl.notebook.restore('A + 1');
        repl.notebook.selectTo(1, 1);
        const diagnostics = repl.diagnosticOutputs;
        expect(repl.nameFacts?.facts.types).toEqual(['integer']);
        repl.notebook.selectTo(0, 1);
        void repl.nameFacts;
        void repl.diagnosticOutputs;
        repl.notebook.selectTo(1, 1);
        expect(repl.diagnosticOutputs).toBe(diagnostics);
        expect(repl.nameFacts?.facts.types).toEqual(['integer']);
        repl.notebook.selectTo(0, 0);
        repl.notebook.replace('A = "text"');
        repl.notebook.selectTo(1, 1);
        expect(repl.diagnosticOutputs).not.toBe(diagnostics);
        expect(repl.nameFacts?.facts.types).toEqual(['text']);
        expect([...repl.diagnosticOutputs!.values()].flat().some(line => line.error)).toBe(true);
    } finally { session.dispose(); }
});

it('keeps scopes correct when moving backward through a large notebook and incomplete input', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        for (let i = 0; i < 70; i++) repl.notebook.restore(i === 25 ? 'array' : `V${i} = ${i}`);
        const prefixes = new Map<number, NotebookScope>();
        for (const active of [69, 68, 40, 24, 26, 69, 0, 1]) {
            repl.notebook.selectTo(active, 0);
            const actual = notebookScope(repl.notebook, [], undefined, prefixes);
            const expected = notebookScope(repl.notebook);
            expect([...actual.bindings]).toEqual([...expected.bindings]);
            expect([...actual.functions.keys()]).toEqual([...expected.functions.keys()]);
            expect(actual.clean).toBe(expected.clean);
            expect(prefixes.size).toBeLessThanOrEqual(33);
        }
    } finally { session.dispose(); }
});

it('does not leak runtime bindings into earlier cached source scopes', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('A = 1');
        await repl.submit(true);
        repl.notebook.replace('A');
        const prefixes = new Map<number, NotebookScope>();
        expect(notebookScope(repl.notebook, [['A', { types: ['real'] }]], undefined, prefixes).bindings.get('A')?.types)
            .toEqual(['real']);
        repl.notebook.selectTo(0, 0);
        expect(notebookScope(repl.notebook, [], undefined, prefixes).bindings.has('A')).toBe(false);
    } finally { session.dispose(); }
});
