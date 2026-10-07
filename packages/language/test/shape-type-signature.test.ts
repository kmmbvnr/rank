import { constantDim, variableDim } from '../src/analysis/shape-index.js';
import { expect, it } from 'vitest';
import { findOperation } from '../src/operations.js';
import { instantiateTypeSignatures, operationSignature, signatureType } from '../src/type-signature.js';
import type { ValueFacts } from '../src/analysis/value-domain.js';

const array = (shape: readonly (number | null)[], elements = ['real']): ValueFacts => ({ types: ['array'], shape, rank: shape.length, elements });
const display = (name: string, ...values: ValueFacts[]) => operationSignature(findOperation(name)!, values);

it('shows known dimensions and retains square requirements when dimensions are unresolved', () => {
    expect(display('inverse', array([3, 3])))
        .toBe('array[3, 3]<number> → array[3, 3]<real> [rank 2]');
    expect(display('inverse', array([null, null])))
        .toBe('array[n, n]<number> → array[n, n]<real> [rank 2]');
    expect(display('inverse', array([2, 3, 3])))
        .toBe('array[2, 3, 3]<number> → array[2, 3, 3]<real> [rank 2]');
    const rows = findOperation('inverse')!.signatures!;
    expect(instantiateTypeSignatures(rows[0], [signatureType(array([2, 3]))])).toEqual([]);
    expect(instantiateTypeSignatures(rows[0], [signatureType(array([3]))])).toEqual([]);
    expect(instantiateTypeSignatures(rows[0], [signatureType(array([null, null]))])).toHaveLength(1);
    expect(instantiateTypeSignatures(rows[0], [signatureType(array([2, 3], []))])).toEqual([]);
});

it('keeps vector creation, square and rectangular diagonal extraction visible', () => {
    expect(display('diag', array([3], ['integer'])))
        .toBe('array[3]<integer> → array[3, 3]<integer>');
    expect(display('diag', array([3, 3], ['integer'])))
        .toBe('array[3, 3]<integer> → array[3]<integer> [rank 2]');
    expect(display('diag', array([2, 3], ['integer'])))
        .toBe('array[2, 3]<integer> → array[2]<integer> [rank 2]');
    expect(display('diag', array([null, null], ['integer'])))
        .toContain('→ array[#]<integer> [rank 2]');
    expect(operationSignature(findOperation('diag')!)).toContain('array[n]<a> → array[n, n]<a>');
});

it('shows matmul dot, matrix/vector and higher-rank first-right-axis results', () => {
    expect(display('matmul', array([3]), array([3])))
        .toBe('array[3]<number> array[3]<number> → number');
    expect(display('matmul', array([2, 3]), array([3])))
        .toBe('array[2, 3]<number> array[3]<number> → array[2]<number>');
    expect(display('matmul', array([2, 3]), array([3, 4])))
        .toBe('array[2, 3]<number> array[3, 4]<number> → array[2, 4]<number>');
    expect(display('matmul', array([2, 3, 4]), array([4, 5, 6])))
        .toBe('array[2, 3, 4]<number> array[4, 5, 6]<number> → array[2, 3, 5, 6]<number>');
    expect(instantiateTypeSignatures(findOperation('matmul')!.signatures![0],
        [signatureType(array([2, 3])), signatureType(array([4, 5]))])).toEqual([]);
});

it('uses existing symbolic dimension identities without assuming unrelated dimensions differ', () => {
    const n = variableDim('external-length');
    const symbolic: ValueFacts = { ...array([null, null]), dims: [n, n] };
    const identity = { inputs: [{ variable: 0 }], result: { variable: 0 } } as const;
    const known = instantiateTypeSignatures(identity, [signatureType(symbolic)])[0];
    expect(known.result).toEqual(signatureType(symbolic));
    expect(display('inverse', symbolic)).toContain('array[n, n]');
    const result = instantiateTypeSignatures(findOperation('inverse')!.signatures![0], [signatureType(symbolic)])[0].result;
    expect(typeof result === 'object' && 'collection' in result && result.dims).toEqual([n, n]);
    const independent: ValueFacts = { ...array([null, null]), dims: [n, variableDim('other-length')] };
    expect(instantiateTypeSignatures(findOperation('inverse')!.signatures![0], [signatureType(independent)])).toHaveLength(1);
});

it('rejects distinct symbolic constants without rejecting unrelated unknown symbols', () => {
    const square = findOperation('inverse')!.signatures![0];
    const mismatch = { ...array([null, null]), dims: [constantDim(2), constantDim(3)] };
    expect(instantiateTypeSignatures(square, [signatureType(mismatch)])).toEqual([]);
});


it('shows frames around determinant scalar cells without changing scalar matrix results', () => {
    expect(display('det', array([3, 3], ['integer'])))
        .toBe('array[3, 3]<integer> → integer [rank 2]');
    expect(display('det', array([2, 3, 3], ['integer'])))
        .toBe('array[2, 3, 3]<integer> → array[2]<integer> [rank 2]');
    expect(display('det', array([0, 3, 3], ['real'])))
        .toBe('array[0, 3, 3]<real> → array[0]<number> [rank 2]');
    expect(display('det', array([2, 4, 3, 3], ['real'])))
        .toBe('array[2, 4, 3, 3]<real> → array[2, 4]<number> [rank 2]');
    expect(display('det', array([null, 3, 3], ['integer'])))
        .toBe('array[#, 3, 3]<integer> → array[#]<integer> [rank 2]');
});
