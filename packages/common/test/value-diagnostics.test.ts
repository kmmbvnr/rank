import { expect, it } from 'vitest';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';
import { notebookValueDiagnostics } from '../src/value-diagnostics.js';
import { notebookFrame } from '../src/screen.js';
import { Notebook } from '../src/notebook.js';

it('retains scalar diagnostics after a known write without executing the draft', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('fun change X\n X 0 = 1\n return 0\nend\nA = array 1 2\nCount = 3\nA change\nCount + "bad"');
        const text = () => [...(repl.diagnosticOutputs?.values() ?? [])].flat().map(line => line.text).join('\n');
        expect(text()).toContain('does not accept integer and text');
        expect(session.diagnosticFacts.some(([name]) => name === 'A' || name === 'Count')).toBe(false);
        expect(repl.notebook.cells.every(cell => cell.executed === undefined)).toBe(true);
        repl.notebook.replace('fun change X\n X external\n return 0\nend\nA = array 1 2\nCount = 3\nA change\nCount + "bad"');
        expect(text()).not.toContain('does not accept');
    } finally { session.dispose(); }
});

it('retains shape diagnostics for a separate array after a draft write', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        const prefix = 'fun change X\n X 0 = 9\n return X\nend\nA = array 1 2\nB = A\nC = array 3 4 5\n';
        repl.notebook.replace(prefix + 'B change\nA + C');
        const text = () => [...(repl.diagnosticOutputs?.values() ?? [])].flat().map(line => line.text).join('\n');
        expect(text()).toContain('shape mismatch: [2] and [3]');
        expect(repl.notebook.cells.every(cell => cell.executed === undefined)).toBe(true);
        repl.notebook.replace(prefix + 'B change\nA + (array 3 4)');
        expect(text()).not.toContain('shape mismatch');
    } finally { session.dispose(); }
});

it('retains cell-type diagnostics after a safe draft replacement', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        for (const source of ['A = array 1 2', 'B = A', 'A 0 = 3']) repl.notebook.enqueue(source);
        repl.notebook.replace('A + (array true false)');
        const text = () => [...(repl.diagnosticOutputs?.values() ?? [])].flat().map(line => line.text).join('\n');
        expect(text()).toContain('operator + does not accept integer and boolean');
        expect(repl.notebook.cells.every(cell => cell.executed === undefined)).toBe(true);
        repl.notebook.replace('A + (array 3 4)');
        expect(text()).not.toContain('does not accept');
    } finally { session.dispose(); }
});

it('recomputes cell types after an earlier source edit', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('A = array 1 2');
        await repl.submit();
        repl.notebook.replace('A 0 = 3\nA + (array true false)');
        expect(repl.diagnosticOutputs?.get(2)?.[0].text).toContain('integer and boolean');
        repl.notebook.cells[0].source = 'A = array shape 2 fill X';
        expect(notebookValueDiagnostics(repl.notebook, session.diagnosticFacts).size).toBe(0);
    } finally { session.dispose(); }
});

it('invalidates cached hints when a later local test changes', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.enqueue('fun addone X\n return X + 1\nend');
        repl.notebook.replace('test "local"\n (3 addone) equal 4\nend');
        repl.notebook.active = 0;
        expect(repl.diagnosticOutputs?.get(1)?.[0].text).toContain('Expected: integer');
        repl.notebook.cells[1].source = 'test "local"\n (3 addone) equal "changed"\nend';
        expect(repl.diagnosticOutputs?.get(1)?.[0].text).toContain('Expected: text');
    } finally { session.dispose(); }
});

it('combines local and companion tests and refreshes local expectations after edits', () => {
    const book = new Notebook();
    book.enqueue('fun addone X\n return X + 1\nend');
    book.replace('test "local"\n (3 addone) equal 4\nend');
    book.active = 0;
    const companion = { path: '/tmp/helpers_test.ra', examples: [{ name: 'addone',
        arguments: [{ types: ['integer'] }], expected: { types: ['integer'] }, test: 'external', line: 3 }] };
    const lines = () => notebookValueDiagnostics(book, [], companion).get(1)!;
    expect(lines()).toHaveLength(2);
    expect(lines()[0].text).toContain('helpers_test.ra:3');
    expect(lines()[1].text).toContain('this file:5');
    expect(lines()[1].text).toContain('Expected: integer\nFrom code: integer');
    book.cells[1].source = 'test "local"\n (3 addone) equal "changed"\nend';
    expect(lines()[1].text).toContain('Expected: text\nFrom code: integer');
    book.cells[1].source = '';
    expect(lines()).toHaveLength(1);
    expect(book.cells.every(cell => cell.executed === undefined)).toBe(true);
});

it('shows a proven error while typing, without evaluating the draft', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('Count = 1');
        await repl.submit();
        repl.notebook.replace('Count = "wrong"');
        expect(repl.diagnosticOutputs?.get(1)?.[0].text).toContain('cannot receive text');
        expect(repl.diagnosticOutputs).toBe(repl.diagnosticOutputs);
        expect(session.diagnosticFacts.find(([name]) => name === 'Count')?.[1].types).toEqual(['integer']);
        expect(repl.liveOutputs).toBeUndefined();
        const frame = notebookFrame(repl.notebook, 40, 20, 0, '', false, true, '', '',
            undefined, 'rank> ', undefined, undefined, undefined, false, undefined, true, 0, repl.diagnosticOutputs);
        expect(frame.lines.join('\n')).toContain('TypeError');
        expect(frame.lines.join('\n')).not.toContain('▶');
    } finally { session.dispose(); }
});

it('checks excess scalar indices at a clean prompt and removes stale execution errors after editing', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        for (const source of ['A = array 2 2 2 2 shape 2 2', 'A 0 0', 'A 0 0']) {
            repl.notebook.replace(source);
            await repl.submit();
        }
        repl.notebook.replace('A 0 0 0 0 0');
        expect(repl.diagnosticOutputs?.get(1)?.[0].text)
            .toBe('DimensionMismatch: 5 selectors exceed array rank 2');
        await repl.submit();
        expect(repl.notebook.current.status).toBe('error');
        repl.notebook.replace('A 0 0');
        expect(repl.diagnosticOutputs?.size).toBe(0);
        const frame = notebookFrame(repl.notebook, 80, 20, 0, '', false, true, '', '',
            undefined, 'rank> ', undefined, undefined, undefined, false, undefined, true, 0, repl.diagnosticOutputs);
        expect(frame.lines.join('\n')).not.toMatch(/Runtime:|DimensionMismatch:|requires a sequence|exceed array rank/);
        expect(session.diagnosticFacts.find(([name]) => name === 'A')?.[1].shape).toEqual([2, 2]);
    } finally { session.dispose(); }
});

it('does not reuse source element types after an array write', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        for (const source of ['A = array 1 2', 'A 0 = "abc"']) {
            repl.notebook.replace(source);
            await repl.submit();
            expect(repl.notebook.cells.at(-2)?.status).toBe('ok');
        }
        repl.notebook.replace('A 0 0');
        expect(repl.diagnosticOutputs?.size).toBe(0);
        await repl.submit();
        expect(repl.notebook.cells.at(-2)?.output[0].text).toBe('a');
    } finally { session.dispose(); }
});

it('withdraws a diagnostic when the draft is incomplete or corrected', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('Count = 1');
        await repl.submit();
        repl.notebook.replace('Count +');
        expect(repl.diagnosticOutputs?.size).toBe(0);
        repl.notebook.replace('Count + 2');
        expect(repl.diagnosticOutputs?.size).toBe(0);
    } finally { session.dispose(); }
});

it('checks function arguments and inferred results before execution and refreshes after edits', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        for (const source of ['fun increment X\n Y = X + 1\n return Y\nend', 'Input = "bad"']) {
            repl.notebook.replace(source);
            await repl.submit();
            expect(repl.notebook.cells.at(-2)?.status).toBe('ok');
        }
        repl.notebook.replace('Input increment');
        expect(repl.diagnosticOutputs?.get(1)?.[0].text)
            .toBe('TypeError: increment: operator + does not accept text and integer');
        expect(repl.notebook.current.executed).toBeUndefined();
        expect(session.names).not.toContain('Y');
        repl.notebook.replace('3 increment');
        expect(repl.diagnosticOutputs?.size).toBe(0);
        repl.notebook.replace('Result = 3 increment\nResult = "bad"');
        expect(repl.diagnosticOutputs?.get(2)?.[0].text)
            .toBe('TypeError: Result has type integer and cannot receive text');
        expect(session.names).not.toContain('Result');
        repl.notebook.replace('Input increment');
        repl.notebook.cells[0].source = 'fun increment X\n Y = X + "suffix"\n return Y\nend';
        expect(repl.diagnosticOutputs?.size).toBe(0);
    } finally { session.dispose(); }
});

it('checks function argument shapes without changing runtime arrays', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        for (const source of ['fun combine A B\n Result = A + B\n return Result\nend',
            'Left = array shape 2 3 fill 0', 'Right = array shape 2 4 fill 0']) {
            repl.notebook.replace(source);
            await repl.submit();
        }
        repl.notebook.replace('Left Right combine');
        expect(repl.diagnosticOutputs?.get(1)?.[0].text)
            .toBe('DimensionMismatch: combine: shape mismatch: [2, 3] and [2, 4]');
        expect(session.diagnosticFacts.find(([name]) => name === 'Left')?.[1].shape).toEqual([2, 3]);
        expect(session.names).not.toContain('Result');
    } finally { session.dispose(); }
});

it('checks loop ranks in an unexecuted draft and clears the error after an edit', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('A = array 1 2');
        await repl.submit();
        repl.notebook.replace('for I in 1 to 3\n A = array shape 2 2 fill 0\nend');
        expect(repl.diagnosticOutputs?.get(2)?.[0].text)
            .toBe('DimensionMismatch: A has rank 1 and cannot receive rank 2');
        expect(repl.notebook.current.executed).toBeUndefined();
        expect(session.names).not.toContain('I');
        expect(session.diagnosticFacts.find(([name]) => name === 'A')?.[1].shape).toEqual([2]);
        repl.notebook.replace('for I in 1 to 3\n A = array 1 2 3\nend');
        expect(repl.diagnosticOutputs?.size).toBe(0);
        repl.notebook.replace('for I in 1 until 1\n A = array shape 2 2 fill 0\nend');
        expect(repl.diagnosticOutputs?.size).toBe(0);
    } finally { session.dispose(); }
});

it('uses joined branch ranks in a draft without executing either branch', () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        const branches = 'if Flag\n M = array shape 2 3 fill 0\nelse\n M = array shape 4 3 fill 0\nend\n';
        repl.notebook.replace(branches + 'M # # #');
        expect(repl.diagnosticOutputs?.get(6)?.[0].text)
            .toBe('DimensionMismatch: 3 selectors exceed array rank 2');
        expect(session.names).not.toContain('M');
        expect(repl.notebook.current.executed).toBeUndefined();
        repl.notebook.replace(branches + 'M # #');
        expect(repl.diagnosticOutputs?.size).toBe(0);
    } finally { session.dispose(); }
});

it('reports an axis change before Enter and withdraws it after correction', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('A = array 1 2 3');
        await repl.submit();
        repl.notebook.replace('A = array shape 2 2\n 2 2\n 2 2\nend');
        expect(repl.diagnosticOutputs?.get(1)?.[0].text)
            .toBe('DimensionMismatch: A has rank 1 and cannot receive rank 2');
        expect(session.diagnosticFacts.find(([name]) => name === 'A')?.[1].shape).toEqual([3]);
        repl.notebook.replace('A = array 2 3 4 5');
        expect(repl.diagnosticOutputs?.size).toBe(0);
        repl.notebook.replace('A = array shape 2 2 fill 0');
        repl.notebook.cells[0].source = 'A = array shape 3 3 fill 0';
        expect(notebookValueDiagnostics(repl.notebook, session.diagnosticFacts).size).toBe(0);
    } finally { session.dispose(); }
});

it('drops runtime shape facts after an earlier source edit', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('A = array shape 2 3 fill 0');
        await repl.submit();
        repl.notebook.replace('A # # #');
        expect(repl.diagnosticOutputs?.get(1)?.[0].text).toContain('rank 2');
        repl.notebook.cells[0].source = 'A = array shape 2 3 4 fill 0';
        expect(notebookValueDiagnostics(repl.notebook, session.diagnosticFacts).size).toBe(0);
    } finally { session.dispose(); }
});

it('loads companion examples without executing tests and separates expected from inferred types', async () => {
    const reads: string[] = [];
    const session = createReplSession({ readFile: async path => {
        reads.push(path);
        return 'test "sample"\n use "helpers"\n (3 addone) equal 4\nend';
    } });
    try {
        const source = 'fun addone X\n return X + 1\nend';
        session.replaceFile({ path: '/tmp/helpers.ra', source });
        await session.prepareFunctions([]);
        expect(reads).toEqual(['/tmp/helpers_test.ra']);
        expect(session.names).not.toContain('addone');
        const repl = new NotebookRepl(session);
        repl.notebook.replace(source);
        const text = repl.diagnosticOutputs?.get(1)?.map(line => line.text).join('\n');
        expect(text).toContain('helpers_test.ra:3');
        expect(text).toContain('Expected: integer');
        expect(text).toContain('From code: integer');
        repl.notebook.replace('fun addone X\n return "changed"\nend');
        expect(repl.diagnosticOutputs?.get(1)?.map(line => line.text).join('\n')).toContain('From code: text');
        expect(reads).toHaveLength(1);
    } finally { session.dispose(); }
});

it('clears companion hints when the file disappears on refresh', async () => {
    let exists = true;
    const session = createReplSession({ readFile: async () => {
        if (!exists) throw new Error('missing');
        return 'test "sample"\n use "helpers"\n (3 addone) equal 4\nend';
    } });
    try {
        session.replaceFile({ path: '/tmp/helpers.ra', source: '' });
        await session.prepareFunctions([]);
        expect(session.testExamples?.examples).toHaveLength(1);
        exists = false;
        await session.prepareFunctions([]);
        expect(session.testExamples).toBeUndefined();
    } finally { session.dispose(); }
});

it('uses the recorded union for assignment, not only the last loop value', async () => {
    const session = createReplSession();
    try {
        const repl = new NotebookRepl(session);
        repl.notebook.replace('for Value in array 1 "two"\n Value = Value\nend');
        await repl.submit();
        repl.notebook.replace('Value = 3');
        expect(repl.diagnosticOutputs?.size).toBe(0);
        repl.notebook.replace('Value = true');
        expect(repl.diagnosticOutputs?.get(1)?.[0].text).toContain('integer or text');
    } finally { session.dispose(); }
});
