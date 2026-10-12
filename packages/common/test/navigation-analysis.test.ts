import { expect, it } from 'vitest';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';
import { notebookScope, type NotebookScope } from '../src/value-diagnostics.js';

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
