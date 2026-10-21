import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { describe, expect, it } from 'vitest';
import {
    createRankServices, deferredBindingDiagnostics, functionScopeDiagnostics, type Program,
} from '../src/index.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function diagnostics(source: string) {
    const result = parser.parse<Program>(source);
    expect(result.lexerErrors).toEqual([]);
    expect(result.parserErrors).toEqual([]);
    return { program: result.value, errors: deferredBindingDiagnostics(result.value) };
}

describe('names read by deferred bindings', () => {
    it.each(['A 0 = 9', 'A 0 += 9', 'A .value = 9', 'A 0 .value *= 9', 'A += 9'])(
        'rejects a later write: %s', write => {
            const { errors } = diagnostics(`A = array 1 2\nB' = A * 2\n${write}`);
            expect(errors).toHaveLength(1);
            expect(errors[0].message).toContain('A is read-only because plan B reads it');
            expect(errors[0].node.$cstNode?.range.start.line).toBe(2);
            expect(errors[0].source.$cstNode?.range.start.line).toBe(1);
        },
    );

    it('permits rebinding but keeps the name read-only afterwards', () => {
        const { errors } = diagnostics("A = array 1 2\nB' = A * 2\nA = array 3 4\nA 0 = 9");
        expect(errors).toHaveLength(1);
        expect(errors[0].node.$cstNode?.range.start.line).toBe(3);
    });

    it('permits writes before capture and to independent local names', () => {
        expect(diagnostics("A = array 1 2\nA 0 = 3\nB' = A * 2\nWork = A copy\nWork 0 = 9").errors)
            .toEqual([]);
    });

    it('treats a call as a mention without inspecting the called body', () => {
        const { errors } = diagnostics("fun X identity = X\nA = array 1 2\nB' = A identity\nA 0 = 9");
        expect(errors).toHaveLength(1);
    });

    it('leaves aliases to the existing value-ownership contract', () => {
        expect(diagnostics("A = array 1 2\nAlias = A\nB' = A * 2\nAlias 0 = 9").errors).toEqual([]);
    });

    it('does not infer captures that are absent from the expression', () => {
        const { errors } = diagnostics("A = array 1 2\nfun get = A\nB' = get\nA 0 = 9");
        expect(errors).toEqual([]);
    });

    it('keeps unrelated lexical parameter identities writable', () => {
        const { errors } = diagnostics([
            'A = array 1 2', "B' = A * 2", 'fun A change', ' A 0 = 9', ' return A', 'end',
        ].join('\n'));
        expect(errors).toEqual([]);
    });

    it('protects an enclosing name after a plan in a nested block', () => {
        const { errors } = diagnostics("A = array 1 2\nif true\n B' = A * 2\nend\nA 0 = 9");
        expect(errors).toHaveLength(1);
    });

    it('does not confuse sibling loop bindings', () => {
        const { errors } = diagnostics([
            'for A in array 1 2', " B' = A + 1", 'end',
            'for A in array 3 4', ' A += 1', 'end',
        ].join('\n'));
        expect(errors).toEqual([]);
    });

    it('reports the earliest responsible plan', () => {
        const { errors } = diagnostics("A = array 1 2\nFirst' = A * 2\nSecond' = A + 1\nA 0 = 9");
        expect(errors[0].message).toContain('plan First');
    });

    it.each(["fun X' change", "fun change X'", "fun change .data X'"])(
        'protects a deferred parameter at entry: %s', header => {
            const { program, errors } = diagnostics(`${header}\n X 0 = 9\n return X\nend`);
            expect(errors).toHaveLength(1);
            expect(errors[0].message).toContain('X is a deferred parameter and is read-only');
            expect(functionScopeDiagnostics(program)).toContainEqual(errors[0]);
        },
    );

    it('permits eager local storage and rebinding of a deferred parameter', () => {
        const { errors } = diagnostics("fun X' change\n Y = X\n Y 0 = 9\n X = Y\n return X\nend");
        expect(errors).toEqual([]);
    });

    it('still rejects mutation after rebinding a deferred parameter', () => {
        const { errors } = diagnostics("fun X' change\n X = array 1 2\n X 0 = 9\n return X\nend");
        expect(errors).toHaveLength(1);
    });

    it.each([
        'Q push 9', 'Q push unpack (array 8 9)', 'Q pop',
        'Q 9 pushfront', 'Q 9 pushback', 'Q popfront', 'Q popback',
        'Q add 9', 'Q remove 9', 'Q 1 9 enqueue', 'Q 0 1 merge',
    ])('rejects a mutating receiver operation: %s', write => {
        const { errors } = diagnostics(`use algo\nQ = new queue\nPlan' = Q len\n${write}`);
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('Q is read-only because plan Plan reads it');
        expect(errors[0].node.$cstNode?.range.start.line).toBe(3);
    });

    it('follows a nested field receiver to its source name', () => {
        const { errors } = diagnostics("use algo\nR = record\n .queue = new queue\nend\nPlan' = R\nR .queue push 9");
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('R is read-only');
    });

    it.each([
        'fun X change\n X 0 = 9\n return X\nend\n',
        'fun X leaf\n X 0 = 9\n return X\nend\nfun X change = X leaf\n',
        'fun X leaf\n X 0 = 9\n return X\nend\nchange = leaf\n',
    ])('rejects a write through a helper or function alias', definitions => {
        const { errors } = diagnostics(`${definitions}A = array 1 2\nPlan' = A * 2\nA change`);
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('A is read-only because plan Plan reads it');
        expect(errors[0].node.$cstNode?.range.end.line).toBe(errors[0].node.$cstNode?.range.start.line);
    });

    it('rejects mutation through an alias of a native operation', () => {
        const { errors } = diagnostics("use algo\ntakeout = pop\nQ = new queue\nPlan' = Q len\nQ takeout");
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('Q is read-only');
    });

    it('protects deferred parameters passed to mutating helpers', () => {
        const { errors } = diagnostics("fun X leaf\n X 0 = 9\n return X\nend\nfun X' outer = X leaf");
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('X is a deferred parameter and is read-only');
    });

    it('keeps callback effects specific to their call sites', () => {
        const { errors } = diagnostics([
            'use algo', 'fun X act op = X op', 'Q = new queue', "Plan' = Q len",
            'Q act peek', 'Other = new queue', 'Other act pop',
        ].join('\n'));
        expect(errors).toEqual([]);
        expect(diagnostics([
            'use algo', 'fun X act op = X op', 'Q = new queue', "Plan' = Q len", 'Q act pop',
        ].join('\n')).errors).toHaveLength(1);
    });

    it('starts protection after construction of its own deferred binding', () => {
        expect(diagnostics([
            'use algo', 'fun X append', ' X push 1', ' return X', 'end',
            'Q = new queue', "Plan' = Q append",
        ].join('\n')).errors).toEqual([]);
        expect(diagnostics("use algo\nQ = new queue\nPlan' = Q pop").errors).toEqual([]);
    });

    it('permits reads, writes before protection, fresh copies and unrelated parameters', () => {
        expect(diagnostics([
            'use algo', 'use sequences', 'Q = new queue', 'Q push 1', "Plan' = Q len",
            'Q peek', 'A = array 1 2', "Values' = A * 2", 'Work = A copy',
            'fun X change', ' X 0 = 9', ' return X', 'end', 'Work change',
        ].join('\n')).errors).toEqual([]);
    });

    it('preserves the old behavior for programs without deferred bindings', () => {
        expect(diagnostics('A = array 1 2\nB = A * 2\nA 0 = 9\nA += 1').errors).toEqual([]);
    });
});


describe('editor locations for deferred binding errors', () => {
    it.each([
        { source: "A = array 1 2\nB' = A * 2\nA 0 = 9", writeLine: 2, bindingLine: 1, column: 0 },
        { source: "fun X' change\n X 0 = 9\n return X\nend", writeLine: 1, bindingLine: 0, column: 4 },
        { source: "use algo\nQ = new queue\nB' = Q len\nQ push 9", writeLine: 3, bindingLine: 2, column: 0 },
        { source: "fun X change\n X 0 = 9\n return X\nend\nA = array 1 2\nB' = A * 2\nA change", writeLine: 6, bindingLine: 5, column: 0 },
    ])('links the write to its responsible binding: $bindingLine', async ({ source, writeLine, bindingLine, column }) => {
        const parseDocument = parseHelper<Program>(createRankServices(EmptyFileSystem).Rank);
        const document = await parseDocument(source, { validation: true });
        const diagnostic = document.diagnostics?.find(item => typeof item.message === 'string' && item.message.includes('read-only'));
        expect(diagnostic?.range.start.line).toBe(writeLine);
        expect(diagnostic?.relatedInformation).toEqual([{
            message: 'This binding makes the name read-only.',
            location: { uri: document.uri.toString(), range: expect.objectContaining({
                start: { line: bindingLine, character: column },
            }) },
        }]);
    });
});
