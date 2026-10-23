import { constantDim, variableDim } from '../src/analysis/shape-index.js';
import { expect, it } from 'vitest';
import { findOperation } from '../src/operations.js';
import { instantiateTypeSignatures, operationSignature, signatureType } from '../src/type-signature.js';
import { operationShapeFacts } from '../src/analysis/operation-shape.js';
import type { ValueFacts } from '../src/analysis/value-domain.js';

const array = (shape: readonly (number | null)[], elements = ['real']): ValueFacts => ({ types: ['array'], shape, rank: shape.length, elements });
const display = (name: string, ...values: ValueFacts[]) => operationSignature(findOperation(name)!, values);

it('shows known dimensions and retains square requirements when dimensions are unresolved', () => {
    expect(display('inverse', array([3, 3])))
        .toBe("c[3, 3]<number> → c[3, 3]<real> [rank 2]");
    expect(display('inverse', array([null, null])))
        .toBe("c[n, n]<number> → c[n, n]<real> [rank 2]");
    expect(display('inverse', array([2, 3, 3])))
        .toBe("c[2, 3, 3]<number> → c[2, 3, 3]<real> [rank 2]");
    const rows = findOperation('inverse')!.signatures!;
    expect(instantiateTypeSignatures(rows[0], [signatureType(array([2, 3]))])).toEqual([]);
    expect(instantiateTypeSignatures(rows[0], [signatureType(array([3]))])).toEqual([]);
    expect(instantiateTypeSignatures(rows[0], [signatureType(array([null, null]))])).toHaveLength(1);
    expect(instantiateTypeSignatures(rows[0], [signatureType(array([2, 3], []))])).toEqual([]);
});

it('keeps vector creation, square and rectangular diagonal extraction visible', () => {
    expect(display('diag', array([3], ['integer'])))
        .toBe("c[3]<integer> → c[3, 3]<integer>");
    expect(display('diag', array([3, 3], ['integer'])))
        .toBe("c[3, 3]<integer> → c[3]<integer> [rank 2]");
    expect(display('diag', array([2, 3], ['integer'])))
        .toBe("c[2, 3]<integer> → c[2]<integer> [rank 2]");
    expect(display('diag', array([null, null], ['integer'])))
        .toContain("→ c[#]<integer> [rank 2]");
    expect(operationSignature(findOperation('diag')!)).toContain("c[n]<a> → c[n, n]<a>");
});

it('shows matmul dot, matrix/vector and higher-rank first-right-axis results', () => {
    expect(display('matmul', array([3]), array([3])))
        .toBe("c[3]<number> c[3]<number> → number");
    expect(display('matmul', array([2, 3]), array([3])))
        .toBe("c[2, 3]<number> c[3]<number> → c[2]<number>");
    expect(display('matmul', array([2, 3]), array([3, 4])))
        .toBe("c[2, 3]<number> c[3, 4]<number> → c[2, 4]<number>");
    expect(display('matmul', array([2, 3, 4]), array([4, 5, 6])))
        .toBe("c[2, 3, 4]<number> c[4, 5, 6]<number> → c[2, 3, 5, 6]<number>");
    expect(instantiateTypeSignatures(findOperation('matmul')!.signatures![0],
        [signatureType(array([2, 3])), signatureType(array([4, 5]))])).toEqual([]);
});

it('uses existing symbolic dimension identities without assuming unrelated dimensions differ', () => {
    const n = variableDim('external-length');
    const symbolic: ValueFacts = { ...array([null, null]), dims: [n, n] };
    const identity = { inputs: [{ variable: 0 }], result: { variable: 0 } } as const;
    const known = instantiateTypeSignatures(identity, [signatureType(symbolic)])[0];
    expect(known.result).toEqual(signatureType(symbolic));
    expect(display('inverse', symbolic)).toContain('c[n, n]');
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
        .toBe("c[3, 3]<integer> → integer [rank 2]");
    expect(display('det', array([2, 3, 3], ['integer'])))
        .toBe("c[2, 3, 3]<integer> → c[2]<integer> [rank 2]");
    expect(display('det', array([0, 3, 3], ['real'])))
        .toBe("c[0, 3, 3]<real> → c[0]<number> [rank 2]");
    expect(display('det', array([2, 4, 3, 3], ['real'])))
        .toBe("c[2, 4, 3, 3]<real> → c[2, 4]<number> [rank 2]");
    expect(display('det', array([null, 3, 3], ['integer'])))
        .toBe("c[#, 3, 3]<integer> → c[#]<integer> [rank 2]");
});


it('retains transposed matrix dimensions and the higher-rank overload', () => {
    expect(operationSignature(findOperation('transpose')!))
        .toBe("c[n, m]<a> → c[m, n]<a> ; c<a> → c<a>");
    expect(display('transpose', array([2, 3], ['integer'])))
        .toBe("c[2, 3]<integer> → c[3, 2]<integer>");
    expect(display('transpose', array([2, 3, 4], ['integer'])))
        .toBe("c[2, 3, 4]<integer> → c[4, 3, 2]<integer>");
    expect(display('transpose', array([0, 3], ['integer'])))
        .toBe("c[0, 3]<integer> → c[3, 0]<integer>");
    expect(display('transpose', array([5], ['integer'])))
        .toBe("c[5]<integer> → c[5]<integer>");
});


it('reuses rank and axis partitioning for transposed cells', () => {
    const transpose = findOperation('transpose')!;
    expect(operationShapeFacts(transpose, [array([2, 3, 4])], [2]))
        .toMatchObject({ types: ['array'], rank: 3, shape: [2, 4, 3] });
    expect(operationShapeFacts(transpose, [array([2, 3, 4])], [2], [0, 2]))
        .toMatchObject({ types: ['array'], rank: 3, shape: [4, 3, 2] });
});

it('keeps dot-product scalar cells distinct from ranked result frames', () => {
    const matmul = findOperation('matmul')!;
    const vector: ValueFacts = { types: ['array'], rank: 1 };
    expect(operationShapeFacts(matmul, [vector, vector]))
        .toEqual({ types: ['integer', 'real'], rank: 0, shape: [] });
    expect(operationShapeFacts(matmul, [array([2, 3]), array([2, 3])], [1, 1]))
        .toEqual({ types: ['array'], rank: 1, shape: [2] });
    expect(operationShapeFacts(matmul, [{ types: ['array'] }, vector])).toBeUndefined();
});
