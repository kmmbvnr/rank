import { describe, expect, it } from 'vitest';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';
import { createModuleLoader, importedPaths } from '../src/module-loader.js';

const BAD = 'A has type integer and cannot receive text';
const TEXT_MODULE = 'fun label X\n return "x"\nend\n';

/** A REPL whose imports read `files`, for analysis and for the run. */
function replWith(files: Record<string, string>) {
    const session = createReplSession({ options: { loadModule: (specifier: string) => {
        const source = files[specifier];
        if (source === undefined) throw new Error(`no module ${specifier}`);
        return { id: `/work/${specifier}.ra`, source };
    } } });
    const repl = new NotebookRepl(session, () => {}, () => 80, false, specifier => files[specifier]);
    const text = () => [...(repl.diagnosticOutputs?.values() ?? [])].flat().map(line => line.text).join('\n');
    return { session, repl, text };
}

describe('imported calls in REPL diagnostics', () => {
    it('knows the result of a call into a module named in the same cell', () => {
        const { session, repl, text } = replWith({ helper: TEXT_MODULE });
        try {
            repl.notebook.replace('use "helper" as M\nA = 1\nA = 2 M.label');
            expect(text()).toContain(BAD);
        } finally { session.dispose(); }
    });

    it('carries an import from an earlier cell that has not run', () => {
        const { session, repl, text } = replWith({ helper: TEXT_MODULE });
        try {
            repl.notebook.enqueue('use "helper" as M');
            repl.notebook.replace('A = 1\nA = 2 M.label');
            expect(text()).toContain(BAD);
        } finally { session.dispose(); }
    });

    it('carries an import from an earlier cell that did run', async () => {
        const { session, repl, text } = replWith({ helper: TEXT_MODULE });
        try {
            repl.notebook.replace('use "helper" as M');
            await repl.submit(true);
            expect(repl.notebook.cells[0].status).toBe('ok');
            repl.notebook.replace('A = 1\nA = 2 M.label');
            expect(text()).toContain(BAD);
        } finally { session.dispose(); }
    });

    it('says nothing when the module cannot be read, or has syntax errors', () => {
        const { session, repl, text } = replWith({ broken: 'fun label X\n return "x"\nend\nB =\n' });
        try {
            repl.notebook.replace('use "missing" as M\nA = 1\nA = 2 M.label');
            expect(text()).toBe('');
            repl.notebook.replace('use "broken" as M\nA = 1\nA = 2 M.label');
            expect(text()).toBe('');
        } finally { session.dispose(); }
    });

    it('follows an edit of the module file without any edit of the notebook', () => {
        const files: Record<string, string> = { helper: TEXT_MODULE };
        const { session, repl, text } = replWith(files);
        try {
            repl.notebook.replace('use "helper" as M\nA = 1\nA = 2 M.label');
            expect(text()).toContain(BAD);
            files.helper = 'fun label X\n return 1\nend\n';
            expect(text()).not.toContain(BAD);
            files.helper = TEXT_MODULE;
            expect(text()).toContain(BAD);
        } finally { session.dispose(); }
    });

    it('drops the summary after the alias or the name is rebound in a later cell', () => {
        const { session, repl, text } = replWith({ helper: TEXT_MODULE, other: 'fun label X\n return 1\nend\n' });
        try {
            repl.notebook.enqueue('use "helper" as M');
            repl.notebook.enqueue('use "other" as M');
            repl.notebook.replace('A = 1\nA = 2 M.label');
            expect(text()).not.toContain(BAD);
        } finally { session.dispose(); }
        const second = replWith({ helper: TEXT_MODULE });
        try {
            second.repl.notebook.enqueue('use "helper" as M');
            second.repl.notebook.enqueue('M.label = 5');
            second.repl.notebook.replace('A = 1\nA = 2 M.label');
            expect(second.text()).not.toContain(BAD);
        } finally { second.session.dispose(); }
    });

    it('is inert without a module source: imports stay opaque', () => {
        const session = createReplSession();
        try {
            const repl = new NotebookRepl(session);
            repl.notebook.replace('use "helper" as M\nA = 1\nA = 2 M.label');
            expect([...(repl.diagnosticOutputs?.values() ?? [])].flat()).toEqual([]);
        } finally { session.dispose(); }
    });

    it('survives modules that import each other', () => {
        const { session, repl, text } = replWith({
            first: 'use "second" as S\nfun label X\n return 1 S.label\nend\n',
            second: 'use "first" as F\nfun label X\n return 1 F.label\nend\n',
        });
        try {
            repl.notebook.replace('use "first" as M\nA = 1\nA = 2 M.label');
            expect(text()).not.toContain(BAD);
        } finally { session.dispose(); }
    });
});

describe('the type of an imported call in the footer', () => {
    it('is known from the module', () => {
        const { session, repl } = replWith({ helper: TEXT_MODULE });
        try {
            repl.notebook.replace('use "helper" as M\nR = 2 M.label\nR');
            repl.notebook.cursor = repl.notebook.current.source.length;
            expect(repl.nameFacts?.facts.types).toEqual(['text']);
        } finally { session.dispose(); }
    });

    it('is unknown when the module is unavailable', () => {
        const { session, repl } = replWith({});
        try {
            repl.notebook.replace('use "helper" as M\nR = 2 M.label\nR');
            repl.notebook.cursor = repl.notebook.current.source.length;
            expect(repl.nameFacts?.facts.types).toEqual([]);
        } finally { session.dispose(); }
    });
});

describe('createModuleLoader', () => {
    it('reads again on every request and reparses only changed text', () => {
        let source = TEXT_MODULE;
        let reads = 0;
        const load = createModuleLoader(() => { reads++; return source; });
        const first = load('helper');
        expect(load('helper')).toBe(first);
        expect(reads).toBe(2);
        source = 'fun label X\n return 1\nend\n';
        expect(load('helper')).not.toBe(first);
    });

    it('resolves a missing, throwing or malformed module to nothing', () => {
        expect(createModuleLoader(() => undefined)('x')).toBeUndefined();
        expect(createModuleLoader(() => { throw new Error('denied'); })('x')).toBeUndefined();
        expect(createModuleLoader(() => 'B =\n')('x')).toBeUndefined();
    });

    it('finds the paths a notebook imports', () => {
        expect(importedPaths(['use "a" as A\nuse text', '  use "b/c.ra" as B\nrem use "d" as D', 'use "a" as Again']))
            .toEqual(['a', 'b/c.ra']);
    });
});
