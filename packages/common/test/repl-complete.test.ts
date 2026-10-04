import { describe, expect, it } from 'vitest';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';

describe('Repl inline completion and cancel', () => {
    it('swiping right completes with a trailing space and cycles candidates', () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.replace('use ');
        repl.complete(true);

        const first = repl.notebook.current.source;
        expect(first.endsWith(' ')).toBe(true);
        expect(repl.hasCompletion).toBe(true);
        expect(repl.suggestion).toMatch(/^Tab:/);

        repl.complete(true);
        const second = repl.notebook.current.source;
        expect(second.endsWith(' ')).toBe(true);
        expect(second).not.toEqual(first);
    });

    it('swiping left cancels completion and restores the original prefix', () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.replace('use ');
        repl.complete(true);
        expect(repl.notebook.current.source).not.toEqual('use ');

        const cancelled = repl.cancelCompletion();
        expect(cancelled).toBe(true);
        expect(repl.notebook.current.source).toBe('use ');
        expect(repl.notebook.cursor).toBe(4);
        expect(repl.hasCompletion).toBe(false);
        expect(repl.suggestion).toBe('');
    });

    it('cycles multiple times and restores original prefix on cancel', () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.replace('use ');
        repl.complete(true);
        repl.complete(true);
        repl.complete(true);

        const cancelled = repl.cancelCompletion();
        expect(cancelled).toBe(true);
        expect(repl.notebook.current.source).toBe('use ');
        expect(repl.notebook.cursor).toBe(4);
    });

    it('cancels completion even when there is only one candidate', () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.replace('option Limit integ');
        repl.complete(true);
        expect(repl.notebook.current.source).toBe('option Limit integer ');
        expect(repl.hasCompletion).toBe(true);

        const cancelled = repl.cancelCompletion();
        expect(cancelled).toBe(true);
        expect(repl.notebook.current.source).toBe('option Limit integ');
        expect(repl.notebook.cursor).toBe('option Limit integ'.length);
    });

    it('typing or dismissing confirms completion so it cannot be cancelled', () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.replace('option Limit integ');
        repl.complete(true);
        expect(repl.notebook.current.source).toBe('option Limit integer ');

        repl.dismiss();
        expect(repl.hasCompletion).toBe(false);
        expect(repl.cancelCompletion()).toBe(false);
        expect(repl.notebook.current.source).toBe('option Limit integer ');
    });

    it('closes a completion when the draft is replaced another way', () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.replace('option Limit integ');
        repl.complete(true);
        expect(repl.hasCompletion).toBe(true);

        repl.notebook.replace('N mo');
        expect(repl.hasCompletion).toBe(false);
        expect(repl.cancelCompletion()).toBe(false);
        repl.complete();
        expect(repl.notebook.current.source).toBe('N mod ');
    });
});
