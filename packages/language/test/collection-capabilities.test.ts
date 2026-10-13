import { expect, it } from 'vitest';
import { elementSourceProtocols, elementSourceProtocol, capabilityKinds } from '../src/collection-capabilities.js';
import { findOperation } from '../src/operations.js';
import { intersectSignatureTypes } from '../src/signature-matching.js';
import { inferSignatureResultTypes, instantiateTypeSignatures, operationSignature, type SignatureType } from '../src/type-signature.js';

const sum = findOperation('sum')!;

it('declares sum against element access without a finite list of collection kinds', () => {
    expect(sum.signatures).toEqual([{ inputs: [{ union: ['number', 'missing', 'column',
        { collection: 'iterable', element: { union: ['number', 'missing'] } }] }], result: 'number' }]);
    for (const kind of Object.keys(elementSourceProtocols)) {
        const input = { collection: kind, element: 'integer' } as SignatureType;
        expect(inferSignatureResultTypes(sum.signatures!, [input]), kind).toEqual(['integer', 'real']);
        expect(instantiateTypeSignatures(sum.signatures![0], [input]), kind).toHaveLength(1);
        expect(operationSignature(sum, [{ types: [kind], elements: ['integer'] }]), kind).toBe('c<number> → number');
    }
});

it('does not mistake every container or scalar for an iterable numeric source', () => {
    for (const kind of ['heap', 'graph', 'counter', 'multiset', 'tuple', 'record', 'text']) {
        expect(elementSourceProtocol(kind)).toBeUndefined();
        expect(instantiateTypeSignatures(sum.signatures![0], [{ collection: kind, element: 'integer' } as SignatureType])).toEqual([]);
    }
    for (const element of ['text', 'boolean', { collection: 'array', element: 'integer' }] as const)
        expect(instantiateTypeSignatures(sum.signatures![0], [{ collection: 'array', element }])).toEqual([]);
});

it('intersects element-source requirements with concrete kinds and their element types', () => {
    const source: SignatureType = { collection: 'iterable', element: 'number' };
    const array: SignatureType = { collection: 'array', element: 'integer', rank: 2 };
    for (const pair of [[source, array], [array, source]])
        expect(intersectSignatureTypes(pair[0], pair[1])).toEqual(array);
    expect(intersectSignatureTypes('iterable', 'queue')).toBe('queue');
    expect(intersectSignatureTypes('queue', 'iterable')).toBe('queue');
    expect(intersectSignatureTypes('iterable', array)).toEqual(array);
    expect(intersectSignatureTypes(array, 'iterable')).toEqual(array);
    expect(intersectSignatureTypes('iterable', 'heap')).toBeUndefined();
    expect(intersectSignatureTypes(source, { collection: 'set', element: 'text' })).toBeUndefined();
    expect(intersectSignatureTypes(source, { collection: 'heap', element: 'integer' })).toBeUndefined();
});

it('preserves proven axes at a known sum call and keeps SQL dispatch separate', () => {
    expect(operationSignature(sum, [{ types: ['array'], elements: ['integer'], rank: 2, shape: [3, 4] }]))
        .toBe('c[3, 4]<number> → number');
    expect(operationSignature(sum, [{ types: ['sqlite-expression'] }])).toBe('column → number');
});

it('matches common consumers against declared capabilities, not per-operation nominal inventories', () => {
    for (const [name, capability, element] of [
        ['min', 'extrema', 'integer'], ['max', 'extrema', 'text'],
        ['all', 'booleans', 'boolean'], ['any', 'booleans', 'boolean'], ['count', 'booleans', 'boolean'],
        ['mean', 'series', 'integer'], ['median', 'series', 'real'],
        ['sort', 'sortable', 'integer'], ['reverse', 'ordered', 'integer'], ['unique', 'unique', 'integer'],
    ] as const) {
        const operation = findOperation(name)!;
        for (const kind of capabilityKinds(capability).filter(kind => kind !== 'text')) {
            const input = { collection: kind, element } as SignatureType;
            expect(operation.signatures!.some(row => instantiateTypeSignatures(row, [input]).length > 0), `${name}: ${kind}`).toBe(true);
        }
    }
});
