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
        'database (text | date | datetime) (text | date | datetime) → view');
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


it('preserves element relationships for random sampling and grid segments', () => {
    expect(operationSignature(findOperation('shuffle')!, 2)).toBe('(array<a> | sequence<a>) integer → array<a>');
    expect(operationSignature(findOperation('choices')!)).toBe('(array<a> | sequence<a>) integer → array<a>');
    expect(operationSignature(findOperation('segments')!)).toBe('array<a> integer → array<a>');
    expect(operationSignature(findOperation('neighbors')!, 4)).toBe('array integer integer (.four | .eight) → array<integer>');
    expect(operationSignature(findOperation('resize')!)).toBe('array<object> integer integer → array<integer>');
});


it('distinguishes paths from file handles and preserves print values', () => {
    expect(operationSignature(findOperation('readbytes')!, 2)).toBe('file integer → bytes');
    expect(operationSignature(findOperation('readbytes')!, 3)).toBe('text integer integer → bytes');
    expect(operationSignature(findOperation('open')!, 2)).toBe('text (.write | .update | .append) → file');
    expect(operationSignature(findOperation('readlines')!)).toBe('text → array<text>');
    expect(operationSignature(findOperation('print')!)).toBe('a → a');
    expect(operationSignature(findOperation('writebytes')!)).toBe('file bytes → file');
});


it('names document flags explicitly and keeps JSON result alternatives', () => {
    expect(operationSignature(findOperation('xml')!, 1)).toBe('text → object');
    expect(operationSignature(findOperation('xml')!, 2)).toBe('text .flat → array<object>');
    expect(operationSignature(findOperation('json')!, 2)).toBe('text .flat → array<object>');
    expect(operationSignature(findOperation('json')!, 1)).toBe('text → number | boolean | text | symbol | array | tuple | object');
});


it('distinguishes graph, DSU, and functional-graph overloads', () => {
    expect(operationSignature(findOperation('components')!, [{ types: ['dsu'] }])).toBe('dsu → integer');
    expect(operationSignature(findOperation('components')!, [{ types: ['graph'] }])).toBe('graph → record');
    expect(operationSignature(findOperation('distance')!, [
        { types: ['functional'] }, { types: ['integer'] }, { types: ['integer'] },
    ])).toBe('functional integer integer → integer');
    expect(operationSignature(findOperation('upto')!)).toBe('functional integer integer → integer | record');
    expect(operationSignature(findOperation('findroot')!, [{ types: ['dsu'] }, { types: ['text'] }]))
        .toBe('dsu text → number | boolean | text | symbol [rank all 0]');
});


it('preserves mutable collection elements without equating heap priorities with payloads', () => {
    expect(operationSignature(findOperation('pushback')!)).toBe('deque<a> a → deque<a>');
    expect(operationSignature(findOperation('popfront')!)).toBe('deque<a> → a');
    expect(operationSignature(findOperation('enqueue')!)).toBe(
        'heap<a> (number | boolean | text | symbol | date | datetime | record) a → heap<a>');
    expect(operationSignature(findOperation('query')!)).toBe('segment integer integer → a');
    expect(operationSignature(findOperation('permutations')!, [{ types: ['text'] }])).toBe('text → sequence<text>');
    expect(operationSignature(findOperation('combinations')!, [{ types: ['array'] }, { types: ['integer'] }]))
        .toBe('array<a> integer → sequence<array<a>>');
});


it('names SQL databases and views without exposing runtime kind identifiers', () => {
    expect(operationSignature(findOperation('sqlite')!)).toBe('text → database');
    expect(operationSignature(findOperation('sql')!, [{ types: ['sqlite-table'] }])).toBe('view → record');
    expect(operationSignature(findOperation('csv')!, [{ types: ['sqlite-table'] }, { types: ['text'] }]))
        .toBe('view text → view');
    expect(operationSignature(findOperation('lookup')!, Array(3).fill({ types: ['sqlite-expression'] })))
        .toBe('column column column → column');
});
