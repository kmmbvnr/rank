import { expect, it } from 'vitest';
import { findOperation } from '../src/operations.js';
import { formatTypeSignature, formatTypeSignatures, instantiateTypeSignatures, operationSignature } from '../src/type-signature.js';

it('defines equivalent overload bounds once, regardless of variable IDs or domain order', () => {
    const a = { variable: 28, domain: ['text', 'date'] as const };
    const b = { variable: 7, domain: ['date', 'text'] as const };
    expect(formatTypeSignatures([
        { inputs: [a], result: a },
        { inputs: [{ collection: 'sequence', element: b }], result: b },
        { inputs: [{ variable: 0 }], result: { variable: 0 } },
    ])).toBe("a → a ; c<a> → a ; b → b ; a: text | date");
});

it('does not give different overload bounds the same name', () => {
    const a = { variable: 0, domain: ['text', 'date'] as const };
    const b = { variable: 0, domain: ['boolean', 'symbol'] as const };
    expect(formatTypeSignatures([{ inputs: [a], result: a }, { inputs: [b], result: b }]))
        .toBe('a → a ; b → b ; a: text | date ; b: boolean | symbol');
});

it('keeps two independent variables with equal bounds distinct within each overload', () => {
    const a = { variable: 0, domain: ['text', 'date'] as const };
    const b = { variable: 1, domain: ['text', 'date'] as const };
    expect(formatTypeSignatures([
        { inputs: [a, b], result: a },
        { inputs: [{ ...a, variable: 7 }, { ...b, variable: 4 }], result: { ...b, variable: 4 } },
    ])).toBe('a b → a ; a b → b ; a: text | date ; b: text | date');
});

it('shares container definitions across rows while keeping independent choices and defaults distinct', () => {
    const a = { variable: 0 };
    const c = { container: 0, kinds: ['queue', 'stack'] as const, element: a };
    const d = { ...c, container: 1, kinds: ['stack', 'queue'] as const };
    expect(formatTypeSignatures([
        { inputs: [c], result: c },
        { inputs: [c, d], result: d },
        { inputs: [{ ...c, kinds: ['array', 'sequence'] }], result: a },
    ])).toBe("c<a> → c<a> ; c<a> c<a> → c<a> ; c<a> → a");
});

it('names variables using their full intersected bound before formatting the first occurrence', () => {
    expect(formatTypeSignatures([
        { inputs: [{ variable: 0 }], result: { variable: 0, domain: ['text', 'date'] } },
        { inputs: [{ variable: 8, domain: ['text', 'date', 'boolean'] }], result: { variable: 8, domain: ['text', 'date'] } },
    ])).toBe('a → a ; a: text | date');
});

it('deduplicates min/max bounds without applying the ordered domain to their index overload', () => {
    const signature = operationSignature(findOperation('max')!, undefined, { compact: true, shortNumericNames: true })!;
    expect(signature.match(/a: /g)).toHaveLength(1);
    expect(signature).not.toContain('c:');
    expect(signature).toContain("c<b> .index → i");
    expect(signature).toContain("c<b> .indexed → tuple");
    expect(signature).not.toContain('b:');
});

it('omits implicit scalar ranks in compact footers while preserving other cell ranks', () => {
    const compact = { compact: true, shortNumericNames: true };
    expect(formatTypeSignature({ inputs: ['integer'], result: 'real', ranks: [0] }, compact)).toBe('i → r');
    expect(formatTypeSignature({ inputs: ['array'], result: 'integer', ranks: [1] }, compact))
        .toBe("c → i [rank 1]");
    expect(formatTypeSignature({ inputs: ['array'], result: 'integer', ranks: ['all'] }, compact))
        .toBe("c → i [rank all]");
});

it('compacts numeric families recursively while retaining concrete alternatives', () => {
    expect(formatTypeSignature({ inputs: [{ union: ['integer', 'real'] }],
        result: { collection: 'array', element: { union: ['integer', 'missing', 'real'] } } }))
        .toBe("number → c<number | missing>");
    expect(formatTypeSignature({ inputs: [{ union: ['real', 'text', 'integer', 'number'] }], result: 'real' }))
        .toBe('(number | text) → real');
    expect(formatTypeSignature({ inputs: ['integer'], result: 'integer' })).toBe('integer → integer');
    expect(operationSignature(findOperation('abs')!, 1))
        .toBe('a → a [rank 0] ; a: number ; missing → missing [rank 0]');
});

it('keeps unknowns separate from variables and exact rank separate from cell rank', () => {
    expect(formatTypeSignature({ inputs: ['unknown', { variable: 0 }], result: { variable: 0 } }))
        .toBe('? a → a');
    expect(formatTypeSignature({ inputs: [{ collection: 'array', element: 'real', rank: 2 }],
        result: 'real', ranks: [2] })).toBe("c[#, #]<real> → real [rank 2]");
});

it('keeps unknown positions distinct from established relationships', () => {
    expect(formatTypeSignature({ inputs: ['unknown', 'unknown'], result: 'unknown' })).toBe('? ? → ?');
});

it('reuses letters only for an explicit relationship', () => {
    expect(formatTypeSignature({ inputs: [{ variable: 0 }], result: { variable: 0 } })).toBe('a → a');
    expect(formatTypeSignature({ inputs: [{ variable: 0 }], result: { tuple: [{ variable: 0 }, 'text'] } }))
        .toBe('a → tuple(a, text)');
});

it('keeps collection, union, callback and rank information explicit', () => {
    expect(formatTypeSignature({ inputs: ['text', { union: ['text', { collection: 'array', element: 'text' }] }],
        result: { collection: 'array', element: 'text' } }))
        .toBe("text (text | c<text>) → c<text>");
    expect(formatTypeSignature({ inputs: [{ collection: 'array', element: { variable: 0 } },
        { callback: { inputs: [{ variable: 0 }], result: 'boolean' } }],
        result: { collection: 'array', element: { variable: 0 } } }))
        .toBe("c<a> (a → boolean) → c<a>");
    expect(formatTypeSignature({ inputs: ['number', 'number'], result: 'number', ranks: [0, 0] }))
        .toBe('number number → number [rank 0 0]');
});

it('formats nullary and wide tuple signatures without ambiguous variable names', () => {
    expect(formatTypeSignature({ inputs: [], result: 'integer' })).toBe('→ integer');
    expect(formatTypeSignature({ inputs: Array.from({ length: 27 }, (_, variable) => ({ variable })), result: { variable: 27 } }))
        .toMatch(/z t27 t28 → t29$/);
});

it('uses audited overloads rather than a compiled subset or operand names', () => {
    const split = findOperation('split')!;
    expect(operationSignature(split)).toBe("text (text | c<text>) → c<text>");
    expect(operationSignature({ ...split, form: 'Integer split Number' })).toBe(operationSignature(split));
    expect(operationSignature({ ...split, signatures: undefined })).toBeUndefined();
    expect(operationSignature(split, 1)).toBeUndefined();
    expect(operationSignature(findOperation('reverse')!)).toBe(
        "text → text ; c<a> → c<a>");
});

it('selects overloads using known argument facts and preserves alternatives for unknowns', () => {
    const max = findOperation('max')!;
    expect(operationSignature(max, [{ types: ['text'] }, { types: ['text'] }]))
        .toBe('text text → text [rank 0 0]');
    expect(operationSignature(max, [{ types: ['integer'] }, { types: ['real'] }]))
        .toBe('number number → number [rank 0 0]');
    expect(operationSignature(max, [{ types: ['array'], elements: ['integer'] }])).toBe("c<number> → number");
    expect(operationSignature(findOperation('sum')!, [{ types: ['array'], elements: ['integer'] }])).toBe("c<number> → number");
    expect(operationSignature(findOperation('reverse')!, [{ types: ['text'] }])).toBe('text → text');
    expect(operationSignature(max, [{ types: [] }, { types: [] }])).toContain('a a → a');
    expect(operationSignature(max, [{ types: [] }, { types: [] }])).toContain('a: text | boolean | symbol | date | datetime | record');
    expect(operationSignature(max, [{ types: ['text'] }, { types: ['integer'] }])).toContain('number number → number');
});

it('groups numeric reduction containers without broadening their accepted kinds', () => {
    const sum = findOperation('sum')!;
    expect(operationSignature(sum)).toBe("(number | missing | column | c<number | missing>) → number");
    for (const collection of ['array', 'sequence', 'queue', 'stack', 'deque', 'set'] as const) {
        expect(operationSignature(sum, [{ types: [collection], elements: ['integer'] }]))
            .toBe('c<number> → number');
    }
    expect(operationSignature(sum, [{ types: [] }])).toBe(operationSignature(sum));
    for (const input of ['text', { collection: 'heap', element: 'integer' },
        { collection: 'array', element: 'text' }] as const) {
        expect(instantiateTypeSignatures(sum.signatures![0], [input])).toEqual([]);
    }
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
        .toBe("c<text> → c<date>");
    expect(operationSignature(findOperation('duration')!, [{ types: ['sequence'], elements: ['integer'] }]))
        .toBe("c<number> → c<duration>");
    expect(operationSignature(findOperation('year')!, [{ types: ['datetime'] }]))
        .toBe('datetime → integer [rank 0]');
    expect(operationSignature(findOperation('year')!, [{ types: ['sqlite-expression'] }]))
        .toBe('column → column [rank 0]');
    expect(operationSignature(findOperation('hour')!)).not.toContain('column');
    expect(operationSignature(findOperation('weekday')!)).not.toContain('column');
    expect(operationSignature(findOperation('calendar')!, 3)).toBe(
        "database (text | date | datetime) (text | date | datetime) → c");
});


it('describes numeric maps, missing propagation and integer-only reductions', () => {
    expect(operationSignature(findOperation('abs')!, [{ types: ['real'] }])).toBe('real → real [rank 0]');
    expect(operationSignature(findOperation('sin')!, [{ types: ['missing'] }])).toBe('missing → missing [rank 0]');
    expect(operationSignature(findOperation('sin')!, [{ types: ['array'], elements: ['integer'] }]))
        .toBe("number → real [rank 0]");
    expect(operationSignature(findOperation('odd')!, [{ types: ['sequence'], elements: ['integer'] }]))
        .toBe("c<integer> → c<boolean>");
    expect(operationSignature(findOperation('lcm')!, 1))
        .toBe("(integer | c<integer>) → integer");
    expect(operationSignature(findOperation('round')!, [{ types: ['real'] }, { types: ['integer'] }]))
        .toBe('real integer → real [rank 0 0]');
    const powmod = findOperation('powmod')!;
    const integer = { types: ['integer'] };
    const array = { types: ['array'], elements: ['integer'] };
    expect(operationSignature(powmod, [integer, integer, integer])).toBe('integer integer integer → integer');
    expect(operationSignature(powmod, [array, integer, integer])).toBe('c<integer> integer integer → c<integer>');
    expect(operationSignature(powmod, [integer, integer, array])).toBe('integer integer c<integer> → c<integer>');
    const binomialmod = findOperation('binomialmod')!;
    expect(operationSignature(binomialmod, [integer, integer, integer])).toBe('integer integer integer → integer');
    expect(operationSignature(binomialmod, [array, integer, integer])).toBe('c<integer> integer integer → c<integer>');
    expect(operationSignature(binomialmod, [integer, array, integer])).toBe('integer c<integer> integer → c<integer>');
    expect(operationSignature(binomialmod, [array, array, integer])).toBe('c<integer> c<integer> integer → c<integer>');
});


it('keeps text conversion and positional parse result contracts explicit', () => {
    expect(operationSignature(findOperation('integer')!, [{ types: ['text'] }])).toBe('text → integer');
    expect(operationSignature(findOperation('bytes')!, [{ types: ['array'], elements: ['integer'] }]))
        .toBe("c<integer> → bytes");
    expect(operationSignature(findOperation('parse')!)).toBe("text text → c | tuple");
    expect(operationSignature(findOperation('lower')!, [{ types: ['array'], elements: ['text'] }]))
        .toBe("c<text> → c<text>");
    expect(operationSignature(findOperation('lower')!, [{ types: ['sqlite-expression'] }])).toBe('column → column');
    expect(operationSignature(findOperation('join')!, [{ types: ['array'], elements: ['integer'] }, { types: ['text'] }]))
        .toBe("c<number> text → text [rank 1 0]");
    expect(operationSignature(findOperation('len')!, [{ types: ['tuple'] }])).toBe('tuple → integer');
});


it('retains shape-dependent linear algebra results and quantile overloads', () => {
    expect(operationSignature(findOperation('eigh')!)).toBe("c<number> → tuple(c<real>, c<real>)");
    expect(operationSignature(findOperation('matmul')!)).toBe("c[…s, k]<number> c[k, …t]<number> → number | c[…s, …t]<number>");
    expect(operationSignature(findOperation('det')!, [{ types: ['array'], elements: ['integer'] }]))
        .toBe("c[…s, n, n]<integer> → integer [rank 2]");
    expect(operationSignature(findOperation('det')!, [{ types: ['array'], elements: ['real'] }]))
        .toBe("c[…s, n, n]<real> → number [rank 2]");
    expect(operationSignature(findOperation('quantile')!, [
        { types: ['array'], elements: ['integer'] }, { types: ['array'], elements: ['real'] },
    ])).toBe("c<number> c<number> → c<real>");
    expect(operationSignature(findOperation('mean')!, [{ types: ['integer'] }])).toBe('number → real');
});


it('preserves element relationships for random sampling and grid segments', () => {
    expect(operationSignature(findOperation('shuffle')!, 2)).toBe("c<a> integer → c<a>");
    expect(operationSignature(findOperation('choices')!)).toBe("c<a> integer → c<a>");
    expect(operationSignature(findOperation('segments')!)).toBe("c<a> integer → c<a>");
    expect(operationSignature(findOperation('neighbors')!, 4)).toBe("c integer integer (.four | .eight) → c<integer>");
    expect(operationSignature(findOperation('resize')!)).toBe("c<object> integer integer → c<integer>");
});


it('distinguishes paths from file handles and preserves print values', () => {
    expect(operationSignature(findOperation('readbytes')!, 2)).toBe('file integer → bytes');
    expect(operationSignature(findOperation('readbytes')!, 3)).toBe('text integer integer → bytes');
    expect(operationSignature(findOperation('open')!, 2)).toBe('text (.write | .update | .append) → file');
    expect(operationSignature(findOperation('readlines')!)).toBe("text → c<text>");
    expect(operationSignature(findOperation('print')!)).toBe('a → a');
    expect(operationSignature(findOperation('writebytes')!)).toBe('file bytes → file');
});


it('names document flags explicitly and keeps JSON result alternatives', () => {
    expect(operationSignature(findOperation('xml')!, 1)).toBe('text → object');
    expect(operationSignature(findOperation('xml')!, 2)).toBe("text .flat → c<object>");
    expect(operationSignature(findOperation('json')!, 2)).toBe("text .flat → c<object>");
    expect(operationSignature(findOperation('json')!, 1)).toBe("text → number | boolean | text | symbol | c | tuple | object");
});


it('distinguishes graph, DSU, and functional-graph overloads', () => {
    expect(operationSignature(findOperation('components')!, [{ types: ['dsu'] }])).toBe("c → integer");
    expect(operationSignature(findOperation('components')!, [{ types: ['graph'] }])).toBe("c → record");
    expect(operationSignature(findOperation('distance')!, [
        { types: ['functional'] }, { types: ['integer'] }, { types: ['integer'] },
    ])).toBe("c integer integer → integer");
    expect(operationSignature(findOperation('upto')!)).toBe("c integer integer → integer | record");
    expect(operationSignature(findOperation('findroot')!, [{ types: ['dsu'] }, { types: ['text'] }]))
        .toBe("c text → number | boolean | text | symbol [rank all 0]");
});


it('preserves mutable collection elements without equating heap priorities with payloads', () => {
    expect(operationSignature(findOperation('pushback')!)).toBe("c<a> a → c<a>");
    expect(operationSignature(findOperation('popfront')!)).toBe("c<a> → a");
    expect(operationSignature(findOperation('enqueue')!)).toBe(
        "c<a> (number | boolean | text | symbol | date | datetime | record) a → c<a>");
    expect(operationSignature(findOperation('query')!)).toBe("c integer integer → ?");
    expect(operationSignature(findOperation('permutations')!, [{ types: ['text'] }])).toBe("text → c<text>");
    expect(operationSignature(findOperation('combinations')!, [{ types: ['array'] }, { types: ['integer'] }]))
        .toBe("c<a> integer → c<c<a>>");
});


it('names SQL databases and views without exposing runtime kind identifiers', () => {
    expect(operationSignature(findOperation('sqlite')!)).toBe('text → database');
    expect(operationSignature(findOperation('sql')!, [{ types: ['sqlite-table'] }])).toBe("c → record");
    expect(operationSignature(findOperation('csv')!, [{ types: ['sqlite-table'] }, { types: ['text'] }]))
        .toBe("c text → c");
    expect(operationSignature(findOperation('lookup')!, Array(3).fill({ types: ['sqlite-expression'] })))
        .toBe('column column column → column');
});


it('does not promise unchanged cell types for windows or default-filled shifts', () => {
    expect(operationSignature(findOperation('copy')!, [{ types: ['segment'] }])).toBe("c → c");
    expect(operationSignature(findOperation('copy')!, [{ types: ['array'], elements: ['array'] }])).toBe("c → c");
    expect(operationSignature(findOperation('window')!, [{ types: ['sequence'] }, { types: ['integer'] }]))
        .toBe("c<a> integer → c<a> | c<c<a>>");
    expect(operationSignature(findOperation('shift')!)).toBe("c<a> integer → c<a | integer>");
    expect(operationSignature(findOperation('first')!, [{ types: ['array'] }])).toBe("c<a> → a | c<a>");
});


it('distinguishes text array maps from SQL columns and byte prefix tests', () => {
    expect(operationSignature(findOperation('startswith')!, [{ types: ['bytes'] }, { types: ['bytes'] }]))
        .toBe('bytes bytes → boolean');
    expect(operationSignature(findOperation('startswith')!, [
        { types: ['array'], elements: ['text'] }, { types: ['sqlite-expression'] },
    ])).toBe("c<text> column → c<column>");
    expect(operationSignature(findOperation('lpad')!, [
        { types: ['text'] }, { types: ['array'], elements: ['integer'] }, { types: ['text'] },
    ])).toBe("text c<integer> text → c<text>");
    expect(operationSignature(findOperation('translate')!, [
        { types: ['sqlite-expression'] }, { types: ['text'] }, { types: ['text'] },
    ])).toBe('column text text → column');
});
