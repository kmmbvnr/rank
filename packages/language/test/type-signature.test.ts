import { expect, it } from 'vitest';
import { findOperation } from '../src/operations.js';
import { formatTypeSignature, operationSignature } from '../src/type-signature.js';

it('gives unrelated unknown positions distinct letters', () => {
    expect(formatTypeSignature({ inputs: ['unknown', 'unknown'], result: 'unknown' })).toBe('a b → c');
});

it('reuses letters only for an explicit relationship', () => {
    expect(formatTypeSignature({ inputs: [{ variable: 0 }], result: { variable: 0 } })).toBe('a → a');
    expect(formatTypeSignature({ inputs: [{ variable: 0 }], result: { tuple: [{ variable: 0 }, 'text'] } }))
        .toBe('a → tuple(a, text)');
});

it('keeps collection, union, callback and rank information explicit', () => {
    expect(formatTypeSignature({ inputs: ['text', { union: ['text', { collection: 'array', element: 'text' }] }],
        result: { collection: 'array', element: 'text' } }))
        .toBe('text (text | array<text>) → array<text>');
    expect(formatTypeSignature({ inputs: [{ collection: 'array', element: { variable: 0 } },
        { callback: { inputs: [{ variable: 0 }], result: 'boolean' } }],
        result: { collection: 'array', element: { variable: 0 } } }))
        .toBe('array<a> (a → boolean) → array<a>');
    expect(formatTypeSignature({ inputs: ['number', 'number'], result: 'number', ranks: [0, 0] }))
        .toBe('number number → number [rank 0 0]');
});

it('formats nullary and wide tuple signatures without ambiguous variable names', () => {
    expect(formatTypeSignature({ inputs: [], result: 'integer' })).toBe('→ integer');
    expect(formatTypeSignature({ inputs: Array(27).fill('unknown'), result: 'unknown' }))
        .toMatch(/y z t27 → t28$/);
});

it('uses audited overloads rather than a compiled subset or operand names', () => {
    const split = findOperation('split')!;
    expect(operationSignature(split)).toBe('text (text | array<text>) → array<text>');
    expect(operationSignature({ ...split, form: 'Integer Number split' })).toBe(operationSignature(split));
    expect(operationSignature({ ...split, signatures: undefined })).toBeUndefined();
    expect(operationSignature(split, 1)).toBeUndefined();
    expect(operationSignature(findOperation('reverse')!)).toBe(
        'text → text ; array<a> → array<a> ; (queue<a> | stack<a> | deque<a> | sequence<a>) → array<a>');
});

it('selects overloads using known argument facts and preserves alternatives for unknowns', () => {
    const max = findOperation('max')!;
    expect(operationSignature(max, [{ types: ['text'] }, { types: ['text'] }]))
        .toBe('text text → text [rank 0 0]');
    expect(operationSignature(max, [{ types: ['integer'] }, { types: ['real'] }]))
        .toBe('number number → number [rank 0 0]');
    expect(operationSignature(max, [{ types: ['array'], elements: ['integer'] }])).toBe('array<number> → number');
    expect(operationSignature(findOperation('sum')!, [{ types: ['array'], elements: ['integer'] }])).toBe('array<number> → number');
    expect(operationSignature(findOperation('reverse')!, [{ types: ['text'] }])).toBe('text → text');
    expect(operationSignature(max, [{ types: [] }, { types: [] }])).toContain('text text → text');
    expect(operationSignature(max, [{ types: ['text'] }, { types: ['integer'] }])).toContain('number number → number');
});

it('keeps cell lifting separate from whole-operand overloads', () => {
    expect(operationSignature(findOperation('binary')!, 1)).toBe('integer → text [rank 0]');
    expect(operationSignature(findOperation('binary')!, 2)).toBe('integer integer → text');
    expect(operationSignature(findOperation('band')!, [
        { types: ['array'], elements: ['integer'] }, { types: ['integer'] },
    ])).toBe('integer integer → integer [rank 0 0]');
    expect(operationSignature(findOperation('md5')!, [{ types: ['bytes'] }])).toBe('bytes → bytes');
});


it('distinguishes date mapping, scalar components and SQL column overloads', () => {
    expect(operationSignature(findOperation('date')!, [{ types: ['text'] }])).toBe('text → date');
    expect(operationSignature(findOperation('date')!, [{ types: ['array'], elements: ['text'] }]))
        .toBe('array<text> → array<date>');
    expect(operationSignature(findOperation('duration')!, [{ types: ['sequence'], elements: ['integer'] }]))
        .toBe('sequence<number> → sequence<duration>');
    expect(operationSignature(findOperation('year')!, [{ types: ['datetime'] }]))
        .toBe('datetime → integer [rank 0]');
    expect(operationSignature(findOperation('year')!, [{ types: ['sqlite-expression'] }]))
        .toBe('column → column [rank 0]');
    expect(operationSignature(findOperation('hour')!)).not.toContain('column');
    expect(operationSignature(findOperation('weekday')!)).not.toContain('column');
    expect(operationSignature(findOperation('calendar')!, 3)).toBe(
        'database (text | date | datetime) (text | date | datetime) → table');
});


it('describes numeric maps, missing propagation and integer-only reductions', () => {
    expect(operationSignature(findOperation('abs')!, [{ types: ['real'] }])).toBe('real → real [rank 0]');
    expect(operationSignature(findOperation('sin')!, [{ types: ['missing'] }])).toBe('missing → missing');
    expect(operationSignature(findOperation('sin')!, [{ types: ['array'], elements: ['integer'] }]))
        .toBe('array<number> → array<real | missing>');
    expect(operationSignature(findOperation('odd')!, [{ types: ['sequence'], elements: ['integer'] }]))
        .toBe('sequence<integer> → sequence<boolean>');
    expect(operationSignature(findOperation('lcm')!, 1))
        .toBe('(integer | array<integer> | sequence<integer>) → integer');
    expect(operationSignature(findOperation('round')!, [{ types: ['real'] }, { types: ['integer'] }]))
        .toBe('real integer → real [rank 0 0]');
    expect(operationSignature(findOperation('powmod')!)).toBe('integer integer integer → integer');
});


it('keeps text conversion and positional parse result contracts explicit', () => {
    expect(operationSignature(findOperation('integer')!, [{ types: ['text'] }])).toBe('text → integer [rank 1]');
    expect(operationSignature(findOperation('bytes')!, [{ types: ['array'], elements: ['integer'] }]))
        .toBe('array<integer> → bytes');
    expect(operationSignature(findOperation('parse')!)).toBe('text text → array | tuple');
    expect(operationSignature(findOperation('lower')!, [{ types: ['array'], elements: ['text'] }]))
        .toBe('array<text> → array<text>');
    expect(operationSignature(findOperation('lower')!, [{ types: ['sqlite-expression'] }])).toBe('column → column');
    expect(operationSignature(findOperation('join')!, [{ types: ['array'], elements: ['integer'] }, { types: ['text'] }]))
        .toBe('array<number> text → text [rank 1 0]');
    expect(operationSignature(findOperation('len')!, [{ types: ['tuple'] }])).toBe('tuple → integer');
});


it('retains shape-dependent linear algebra results and quantile overloads', () => {
    expect(operationSignature(findOperation('eigh')!)).toBe('array<number> → tuple(array<real>, array<real>)');
    expect(operationSignature(findOperation('matmul')!)).toBe('array<number> array<number> → number | array<number>');
    expect(operationSignature(findOperation('det')!, [{ types: ['array'], elements: ['integer'] }]))
        .toBe('array<integer> → integer [rank 2]');
    expect(operationSignature(findOperation('det')!, [{ types: ['array'], elements: ['real'] }]))
        .toBe('array<real> → number [rank 2]');
    expect(operationSignature(findOperation('quantile')!, [
        { types: ['array'], elements: ['integer'] }, { types: ['array'], elements: ['real'] },
    ])).toBe('array<number> array<number> → array<real>');
    expect(operationSignature(findOperation('mean')!, [{ types: ['integer'] }])).toBe('number → real');
});
