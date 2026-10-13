import { capabilityKinds } from '../src/collection-capabilities.js';
import { expect, it } from 'vitest';
import { operations, findOperation } from '../src/operations.js';
import { compactSignatures } from '../src/signature-compaction.js';
import { expandContainerSignatures } from '../src/signature-matching.js';
import { instantiateTypeSignatures, operationSignature, type SignatureType, type TypeSignature } from '../src/type-signature.js';

const compact = { compact: true, shortNumericNames: true };
const alternatives = (type: SignatureType): readonly SignatureType[] => typeof type === 'object' && 'union' in type
    ? type.union.flatMap(alternatives) : [type];
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)])) : value;

/** Independently expand the display sugar to concrete overloads, including cross-products. */
function concrete(signatures: readonly TypeSignature[]): Set<string> {
    return new Set(signatures.flatMap(expandContainerSignatures).flatMap(row => {
        let inputs: SignatureType[][] = [[]];
        for (const input of row.inputs) inputs = inputs.flatMap(prior => alternatives(input).map(type => [...prior, type]));
        return inputs.flatMap(input => alternatives(row.result).map(result => JSON.stringify(stable({ ...row, inputs: input, result }))));
    }));
}

it('preserves every concrete catalogue overload when compacting general signatures', () => {
    for (const operation of operations) {
        if (!operation.signatures) continue;
        expect(concrete(compactSignatures(operation.signatures)), operation.name).toEqual(concrete(operation.signatures));
    }
});

it('never fills the missing corner when two argument positions differ', () => {
    const rows: TypeSignature[] = [
        { inputs: ['text', 'column'], result: 'column' },
        { inputs: ['column', 'text'], result: 'column' },
        { inputs: ['column', 'column'], result: 'column' },
    ];
    const expanded = concrete(compactSignatures(rows));
    expect(expanded).toEqual(concrete(rows));
    expect(expanded.has(JSON.stringify(stable({ inputs: ['text', 'text'], result: 'column' })))).toBe(false);
});

it('does not intersect type-variable bounds belonging to different overloads', () => {
    const rows: TypeSignature[] = [
        { inputs: [{ variable: 0, domain: ['text'] }], result: { variable: 0 } },
        { inputs: [{ variable: 0, domain: ['date'] }], result: { variable: 0 } },
    ];
    const compacted = compactSignatures(rows);
    expect(compacted).toHaveLength(2);
    for (const input of ['text', 'date'] as const) expect(compacted.flatMap(row => instantiateTypeSignatures(row, [input])))
        .toEqual(rows.flatMap(row => instantiateTypeSignatures(row, [input])));
});

it('keeps independent collection choices, cell ranks and exact array shapes', () => {
    const choices = { union: [{ collection: 'array' as const, element: 'integer' as const },
        { collection: 'sequence' as const, element: 'integer' as const }] };
    const rows: TypeSignature[] = [
        { inputs: [choices, choices], result: 'real' },
        { inputs: [{ collection: 'array', element: 'integer', rank: 2 }], result: 'integer', ranks: [2] },
        { inputs: [{ collection: 'array', element: 'integer', shape: ['n'] }], result: 'integer' },
    ];
    expect(concrete(compactSignatures(rows))).toEqual(concrete(rows));
    expect(compactSignatures(rows)[0].inputs).toMatchObject([{ container: 0 }, { container: 1 }]);
});

it('abbreviates repeated domains without asserting that different arguments share a type', () => {
    expect(operationSignature(findOperation('maxflow')!, undefined, compact))
        .toBe("c u u → record ; u = number | boolean | text | symbol");
    expect(operationSignature(findOperation('sort')!, undefined, compact))
        .toBe("text → text [rank 1] ; c<u> → c<u> [rank 1] ; text (.ascending | .descending) → text ; c<u> (.ascending | .descending) → c<u> ; u = number | boolean | text | symbol | date | datetime | record");
});

it('keeps proven calls concrete and nested one-off unions inline', () => {
    expect(operationSignature(findOperation('maxflow')!, [{ types: ['graph'] }, { types: ['text'] }, { types: ['integer'] }], compact))
        .toBe("c text number → record");
    expect(operationSignature(findOperation('join')!, undefined, compact)).toContain('c<number | boolean | text | symbol | date | datetime>');
});

it('uses a bare container receiver for len and shape without enumerating its kinds', () => {
    expect(operationSignature(findOperation('len')!, undefined, compact))
        .toBe('c → i');
    expect(operationSignature(findOperation('shape')!, undefined, compact))
        .toBe("c → c<i>");
    expect(operationSignature(findOperation('len')!, [{ types: ['tuple'] }], compact)).toBe('tuple → i');
    expect(operationSignature(findOperation('len')!, [{ types: ['text'] }], compact)).toBe('text → i');
    expect(operationSignature(findOperation('len')!, [{ types: ['text', 'array'] }], compact)).toBe('c → i');
    expect(operationSignature(findOperation('shape')!, [{ types: ['text'] }], compact)).toBe("text → c<i>");
    expect(operationSignature(findOperation('shape')!, [{ types: ['array'], elements: ['integer'], rank: 2, shape: [3, 4] }], compact))
        .toBe("c[3, 4]<i> → c<i>");
});

it('derives len and shape receivers from declared capabilities without a catalogue kind list', () => {
    for (const [name, capability] of [['len', 'size'], ['shape', 'shape']] as const) {
        const operation = findOperation(name)!;
        expect(operation.signatures![0].inputs).toEqual([name === 'len' ? 'sized' : 'shaped']);
        for (const kind of capabilityKinds(capability))
            expect(operation.signatures!.some(row => instantiateTypeSignatures(row, [kind as import('../src/type-signature.js').SignatureAtom]).length > 0), kind).toBe(true);
    }
});

it('keeps distinct len/shape domains and the full noncompact contracts', () => {
    const len = findOperation('len')!, shape = findOperation('shape')!;
    expect(len.signatures!.some(row => instantiateTypeSignatures(row, ['tuple']).length > 0)).toBe(true);
    expect(shape.signatures!.some(row => instantiateTypeSignatures(row, ['tuple']).length > 0)).toBe(false);
    for (const operation of [len, shape]) {
        expect(operationSignature(operation)).toMatch(/^c →/);
        expect(operationSignature(operation)).not.toContain('u =');
        expect(operation.signatures!.some(row => instantiateTypeSignatures(row, ['integer']).length > 0)).toBe(false);
    }
});

it('uses the same container family across all collection implementations', () => {
    const operation = findOperation('unique')!;
    for (const kind of ['array', 'sequence', 'set', 'queue', 'stack', 'deque'] as const) {
        expect(operationSignature(operation, [{ types: [kind], elements: ['integer'] }], compact))
            .toBe('c<i> → c<i>');
    }
    expect(operationSignature(operation, [{ types: ['text'] }], compact)).toBe('text → text');
    expect(operationSignature(operation, [{ types: ['sqlite-table'] }], compact)).toBe('c → c');
});

it('explains window results by source kind and exact runtime length metadata', () => {
    const operation = findOperation('window')!;
    const summary = 'text (i | c<i>) → c<text> ; c<a> (i | c<i>) → c<a> ; c<a> (i | c<i>) → c<a> | c<c<a>>';
    expect(operationSignature(operation, undefined, compact)).toBe(summary);
    expect(operationSignature(operation, 2, compact)).toBe(summary);
    expect(operationSignature(operation, [{ types: [] }, { types: [] }], compact)).toBe(summary);
    expect(operationSignature(operation, 1, compact)).toBeUndefined();
    expect(operationSignature({ ...operation, signatures: undefined }, undefined, compact)).toBeUndefined();
    expect(operationSignature(operation)).not.toContain('exact length:');
    expect(operationSignature(operation, [{ types: ['text'] }, { types: ['integer'] }], compact))
        .toBe("text i → c<text>");
    for (const kind of ['array', 'queue', 'stack', 'deque'] as const) {
        expect(operationSignature(operation, [{ types: [kind], elements: ['integer'] }, { types: ['integer'] }], compact))
            .toBe('c<i> i → c<i>');
    }
    // A proven length is not itself proof that the runtime plan records exact cardinality.
    expect(operationSignature(operation, [{ types: ['sequence'], elements: ['integer'], rank: 1, shape: [5] },
        { types: ['integer'] }], compact)).toContain("→ c<i> | c<c<i>>");
});

it('retains the distinct text, array and SQL results for mapping text operations', () => {
    for (const name of ['startswith', 'translate', 'lpad']) {
        const operation = findOperation(name)!;
        expect(operationSignature(operation, undefined, compact)!.length)
            .toBeLessThan(operationSignature(operation, undefined, { shortNumericNames: true })!.length);
        expect(concrete(compactSignatures(operation.signatures!))).toEqual(concrete(operation.signatures!));
    }
});

it('summarizes argument mapping without listing every array and SQL combination', () => {
    expect(operationSignature(findOperation('startswith')!, undefined, compact))
        .toBe("text text → boolean ; bytes bytes → boolean ; containers: elementwise ; SQL: column result ; containers + SQL: c<column> result");
    expect(operationSignature(findOperation('translate')!, undefined, compact))
        .toBe('text text text → text ; containers: elementwise ; SQL: column result ; containers + SQL: unsupported');
    expect(operationSignature(findOperation('lpad')!, 3, compact))
        .toBe('text i text → text ; containers: elementwise ; SQL: column result ; containers + SQL: unsupported');
    expect(operationSignature(findOperation('lpad')!, 2, compact)).toBeUndefined();
    const operation = findOperation('translate')!;
    expect(operationSignature({ ...operation, name: 'renamed' }, undefined, compact))
        .toBe(operationSignature(operation, undefined, compact));
    expect(operationSignature({ ...operation, signatures: undefined }, undefined, compact)).toBeUndefined();
});

it('narrows the base family for partial calls without discarding unknown array elements', () => {
    const startswith = findOperation('startswith')!;
    expect(operationSignature(startswith, [{ types: ['bytes'] }, { types: [] }], compact))
        .toBe("bytes bytes → boolean ; containers: elementwise ; SQL: column result ; containers + SQL: c<column> result");
    for (const types of [['array'], ['text', 'array']] as const) {
        const summary = operationSignature(startswith, [{ types }, { types: [] }], compact)!;
        expect(summary).toContain('text text → boolean');
        expect(summary).toContain('bytes bytes → boolean');
    }
    expect(operationSignature(startswith, [{ types: ['array'], elements: ['bytes'] }, { types: [] }], compact))
        .toContain('bytes bytes → boolean');
});

it('keeps fully known scalar, array, bytes and SQL calls concrete', () => {
    const text = { types: ['text'] as const }, column = { types: ['sqlite-expression'] as const };
    expect(operationSignature(findOperation('startswith')!, [text, text], compact)).toBe('text text → boolean');
    expect(operationSignature(findOperation('startswith')!, [{ types: ['bytes'] }, { types: ['bytes'] }], compact))
        .toBe('bytes bytes → boolean');
    expect(operationSignature(findOperation('startswith')!, [column, text], compact)).toBe('column text → column');
    expect(operationSignature(findOperation('startswith')!, [column, column], compact)).toBe('column column → column');
    expect(operationSignature(findOperation('startswith')!, [
        { types: ['array'], elements: ['text'], rank: 1, shape: [2] }, column,
    ], compact)).toBe("c[2]<text> column → c<column>");
    expect(operationSignature(findOperation('translate')!, [column, text, text], compact)).toBe('column text text → column');
    expect(operationSignature(findOperation('lpad')!, [text, { types: ['integer'] }, text], compact)).toBe('text i text → text');
    for (const name of ['translate', 'lpad', 'startswith']) {
        const args = [{ types: ['array'] as const, elements: ['text'] as const, rank: 1, shape: [2] },
            name === 'lpad' ? { types: ['integer'] as const } : text, ...(name === 'startswith' ? [] : [text])];
        const signature = operationSignature(findOperation(name)!, args, compact)!;
        expect(signature).toContain('c[2]<');
        expect(signature).not.toContain('arrays:');
        expect(signature).not.toContain('SQL:');
    }
});

it('preserves the recursive SQL exception and separate SQL/array contracts', () => {
    const array: SignatureType = { collection: 'array', element: 'text' };
    const accepts = (name: string, inputs: SignatureType[]) => findOperation(name)!.signatures!
        .some(row => instantiateTypeSignatures(row, inputs).length > 0);
    expect(accepts('startswith', [array, 'column'])).toBe(true);
    expect(accepts('startswith', [{ collection: 'array', element: 'column' }, 'text'])).toBe(true);
    expect(accepts('translate', [array, 'column', 'text'])).toBe(false);
    expect(accepts('lpad', [array, 'column', 'text'])).toBe(false);
});

it('keeps the audited collection and numeric contracts after catalogue grouping', () => {
    const accepts = (name: string, inputs: SignatureType[]) => findOperation(name)!.signatures!
        .some(row => instantiateTypeSignatures(row, inputs).length > 0);
    const array: SignatureType = { collection: 'array', element: 'integer' };
    const sequence: SignatureType = { collection: 'sequence', element: 'integer' };
    for (const name of ['mae', 'mse', 'merge']) {
        expect(accepts(name, [array, sequence]), name).toBe(true);
        expect(accepts(name, [sequence, array]), name).toBe(true);
    }
    for (const name of ['min', 'max']) {
        expect(accepts(name, ['integer', 'real']), name).toBe(true);
        expect(accepts(name, ['real', 'integer']), name).toBe(true);
        expect(accepts(name, ['text', 'text']), name).toBe(true);
        expect(accepts(name, ['text', 'boolean']), name).toBe(false);
    }
    expect(accepts('all', [{ collection: 'heap', element: 'boolean' }])).toBe(true);
    expect(accepts('all', [{ collection: 'set', element: 'boolean' }])).toBe(false);
    expect(operationSignature(findOperation('unique')!, [{ types: ['stack'], elements: ['integer'] }], compact))
        .toBe("c<i> → c<i>");
    expect(operationSignature(findOperation('unique')!, [{ types: ['set'], elements: ['integer'] }], compact))
        .toBe("c<i> → c<i>");
});
