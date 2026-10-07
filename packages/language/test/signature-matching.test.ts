import { expect, it } from 'vitest';
import { formatTypeSignature, inferSignatureResultTypes, instantiateTypeSignature, instantiateTypeSignatures, matchingSignatures, type SignatureType,
    type TypeSignature } from '../src/type-signature.js';

const number: SignatureType = { variable: 0, domain: ['integer', 'real'] };
const same: TypeSignature = { inputs: [number, number], result: number };

it('substitutes a shared finite numeric variable without promotion', () => {
    expect(formatTypeSignature(same)).toBe('a a → a ; a: number');
    for (const atom of ['integer', 'real'] as const) {
        expect(instantiateTypeSignature(same, [atom, atom]))
            .toEqual({ inputs: [atom, atom], result: atom });
    }
    expect(instantiateTypeSignature(same, ['integer', 'real'])).toBeUndefined();
    expect(instantiateTypeSignature(same, ['text', 'text'])).toBeUndefined();
});

it('does not invent bindings for unknown inputs', () => {
    expect(instantiateTypeSignature(same, ['unknown', 'unknown'])).toEqual(same);
    expect(instantiateTypeSignature(same, ['unknown', 'integer'])?.result).toBe('integer');
    expect(instantiateTypeSignature(same, ['unknown', 'text'])).toBeUndefined();
});

it('narrows successful union domains through every occurrence of a variable', () => {
    expect(instantiateTypeSignature(same, [{ union: ['integer', 'real'] }, 'integer'])?.result).toBe('integer');
    expect(instantiateTypeSignature(same, [{ union: ['integer', 'text'] }, 'real'])).toBeUndefined();
});

it('shares constraints even when the constrained reference receives an unknown input', () => {
    const signature = { inputs: [number, { variable: 0 }], result: { variable: 0 } } as const;
    expect(instantiateTypeSignature(signature, ['unknown', 'text'])).toBeUndefined();
    expect(instantiateTypeSignature(signature, ['unknown', 'real'])?.result).toBe('real');
    expect(instantiateTypeSignature({ inputs: [{ variable: 0 }], result: number }, ['text'])).toBeUndefined();
});

it('intersects finite constraints and rejects contradictory ones', () => {
    const signature: TypeSignature = { inputs: [number, { variable: 0, domain: ['integer'] }], result: number };
    expect(formatTypeSignature(signature)).toBe('a a → a ; a: integer');
    expect(instantiateTypeSignature(signature, ['integer', 'integer'])?.result).toBe('integer');
    expect(instantiateTypeSignature(signature, ['real', 'real'])).toBeUndefined();
    expect(instantiateTypeSignature({ inputs: [number], result: { variable: 0, domain: ['text'] } }, ['unknown']))
        .toBeUndefined();
});

it('substitutes element types in concrete collections and tuple positions', () => {
    const signature: TypeSignature = { inputs: [{ collection: 'array', element: number }, number],
        result: { tuple: [number, { collection: 'sequence', element: number }] } };
    expect(instantiateTypeSignature(signature, [{ collection: 'array', element: 'integer', rank: 2 }, 'integer'])?.result)
        .toEqual({ tuple: ['integer', { collection: 'sequence', element: 'integer' }] });
    expect(instantiateTypeSignature(signature, [{ collection: 'array', element: 'integer' }, 'real'])).toBeUndefined();
});

it('retains an exact value type through an unconstrained identity variable', () => {
    const identity: TypeSignature = { inputs: [{ variable: 0 }], result: { variable: 0 } };
    const array: SignatureType = { collection: 'array', element: 'real', rank: 2 };
    expect(instantiateTypeSignature(identity, [array])?.result).toEqual(array);
    expect(instantiateTypeSignature(identity, [{ tuple: ['integer', 'text'] }])?.result)
        .toEqual({ tuple: ['integer', 'text'] });
});

it('keeps distinct variables independent and local to each invocation', () => {
    const independent: TypeSignature = { inputs: [number, { variable: 1, domain: ['integer', 'real'] }],
        result: { tuple: [number, { variable: 1 }] } };
    expect(instantiateTypeSignature(independent, ['integer', 'real'])?.result).toEqual({ tuple: ['integer', 'real'] });
    expect(instantiateTypeSignature(same, ['real', 'real'])?.result).toBe('real');
    expect(instantiateTypeSignature(same, ['integer', 'integer'])?.result).toBe('integer');
});

it('filters shared-variable mismatches but preserves declarations for invalid display calls', () => {
    const signatures = [same, { inputs: ['text', 'text'], result: 'text' } as const];
    expect(matchingSignatures(signatures, [{ types: ['integer'] }, { types: ['integer'] }]))
        .toEqual([{ inputs: ['integer', 'integer'], result: 'integer' }]);
    expect(matchingSignatures(signatures, [{ types: ['integer'] }, { types: ['real'] }])).toEqual(signatures);
});

it('checks exact ranks without assigning a rank to unknown collections', () => {
    const signature: TypeSignature = { inputs: [{ collection: 'array', element: number, rank: 2 }], result: number };
    expect(instantiateTypeSignature(signature, [{ collection: 'array', element: 'real', rank: 1 }])).toBeUndefined();
    expect(instantiateTypeSignature(signature, ['array'])?.result).toEqual(number);
    expect(instantiateTypeSignature(signature, [{ collection: 'array', element: 'real', rank: 2 }])?.result).toBe('real');
});


it('never obtains result facts from a rejected or unresolved variable match', () => {
    expect(inferSignatureResultTypes([same], ['integer', 'integer'])).toEqual(['integer']);
    expect(inferSignatureResultTypes([same], ['integer', 'real'])).toBeUndefined();
    expect(inferSignatureResultTypes([same], ['unknown', 'unknown'])).toBeUndefined();
});

it('shares element constraints with an explicitly described callback', () => {
    const signature: TypeSignature = { inputs: [{ collection: 'array', element: number },
        { callback: { inputs: [number], result: 'boolean' } }], result: number };
    expect(instantiateTypeSignature(signature, [{ collection: 'array', element: 'integer' },
        { callback: { inputs: ['integer'], result: 'boolean' } }])?.result).toBe('integer');
    expect(instantiateTypeSignature(signature, [{ collection: 'array', element: 'integer' },
        { callback: { inputs: ['real'], result: 'boolean' } }])).toBeUndefined();
});

const finiteContainer: SignatureType = { container: 0, kinds: ['array', 'sequence'], element: { variable: 0 } };
const preserveKind: TypeSignature = { inputs: [finiteContainer], result: finiteContainer };

it('expands finite container domains and retains the proven result kind', () => {
    expect(formatTypeSignature(preserveKind)).toBe('c<a> → c<a>');
    for (const collection of ['array', 'sequence'] as const) {
        expect(instantiateTypeSignature(preserveKind, [{ collection, element: 'integer' }]))
            .toEqual({ inputs: [{ collection, element: 'integer' }], result: { collection, element: 'integer' } });
    }
    expect(instantiateTypeSignature(preserveKind, [{ collection: 'set', element: 'integer' }])).toBeUndefined();
    expect(instantiateTypeSignature(preserveKind, ['integer'])).toBeUndefined();
    expect(instantiateTypeSignature(preserveKind, ['unknown'])).toEqual(preserveKind);
    expect(inferSignatureResultTypes([preserveKind], ['unknown'])).toEqual(['array', 'sequence']);
});

it('requires the same kind for a shared container variable, but not for different variables', () => {
    const sameKind: TypeSignature = { inputs: [finiteContainer, finiteContainer], result: finiteContainer };
    const array = { collection: 'array', element: 'integer' } as const;
    const sequence = { collection: 'sequence', element: 'integer' } as const;
    expect(instantiateTypeSignature(sameKind, [array, sequence])).toBeUndefined();
    const other = { container: 1, kinds: ['array', 'sequence'], element: { variable: 1 } } as const;
    const independent: TypeSignature = { inputs: [finiteContainer, other], result: { tuple: [finiteContainer, other] } };
    expect(formatTypeSignature(independent)).toBe('c<a> d<b> → tuple(c<a>, d<b>)');
    expect(instantiateTypeSignature(independent, [array, sequence])?.result).toEqual({ tuple: [array, sequence] });
    expect(instantiateTypeSignature(independent, [array, array])?.result).toEqual({ tuple: [array, array] });
});

it('intersects repeated kind restrictions, including constraints in the result', () => {
    const restricted = { ...finiteContainer, kinds: ['sequence'] } as const;
    const signature = { inputs: [finiteContainer], result: restricted };
    expect(instantiateTypeSignature(signature, ['array'])).toBeUndefined();
    expect(instantiateTypeSignature(signature, ['sequence'])?.result).toEqual({ collection: 'sequence', element: { variable: 0 } });
    expect(formatTypeSignature(signature)).toBe('c<a> → c<a> ; c: sequence');
    expect(instantiateTypeSignatures({ inputs: [restricted], result: { ...restricted, kinds: ['array'] } }, ['unknown'])).toEqual([]);
});

it('keeps container and element alternatives correlated instead of creating cross products', () => {
    const array = { collection: 'array', element: 'integer' } as const;
    const sequence = { collection: 'sequence', element: 'real' } as const;
    const rows = instantiateTypeSignatures(preserveKind, [{ union: [array, sequence] }]);
    expect(rows).toEqual([{ inputs: [array], result: array }, { inputs: [sequence], result: sequence }]);
    expect(instantiateTypeSignature(preserveKind, [{ union: [array, sequence] }])).toBeUndefined();
    const concrete: TypeSignature = { inputs: [finiteContainer], result: { collection: 'array', element: { variable: 0 } } };
    expect(instantiateTypeSignature(concrete, [sequence])?.result).toEqual({ collection: 'array', element: 'real' });
});

it('formats unknown-kind calls compactly and keeps type and kind names distinct', () => {
    expect(matchingSignatures([preserveKind], [{ types: [] }])).toEqual([preserveKind]);
    expect(matchingSignatures([preserveKind], [{ types: ['array'], elements: ['real'] }])[0].result)
        .toEqual({ collection: 'array', element: 'real' });
    const signature: TypeSignature = { inputs: [finiteContainer, { variable: 1 }, { variable: 2 }], result: finiteContainer };
    expect(formatTypeSignature(signature)).toBe('c<a> b g → c<a>');
    expect(instantiateTypeSignature(preserveKind, [{ collection: 'sequence', element: 'text' }])?.result)
        .toEqual({ collection: 'sequence', element: 'text' });
});

it('does not broaden a result kind when compacting intersected unknown-kind rows', () => {
    const limited = { container: 0, kinds: ['array', 'sequence'], element: 'integer' } as const;
    const wider = { ...limited, kinds: ['array', 'sequence', 'set'] } as const;
    expect(inferSignatureResultTypes([{ inputs: [limited], result: wider }], ['unknown']))
        .toEqual(['array', 'sequence']);
});

it('checks and substitutes shared shape references with the existing shape matcher', () => {
    const square = { collection: 'array', element: 'real', shape: ['n', 'n'] } as const;
    const signature: TypeSignature = { inputs: [square], result: square };
    const array = (shape: readonly (number | null)[]): SignatureType => ({ collection: 'array', element: 'real', shape });
    expect(formatTypeSignature(signature)).toBe('array[n, n]<real> → array[n, n]<real>');
    expect(instantiateTypeSignature(signature, [array([3, 3])])?.result)
        .toEqual({ ...square, rank: 2, shape: [3, 3] });
    expect(instantiateTypeSignature(signature, [array([2, 3])])).toBeUndefined();
    expect(instantiateTypeSignature(signature, [array([null, 3])])?.result)
        .toEqual({ ...square, rank: 2, shape: [3, 3] });
    expect(instantiateTypeSignature(signature, ['array'])?.result)
        .toEqual({ ...square, rank: 2 });
});

it('distinguishes exact axes from a minimum rank and does not invent unknown frames', () => {
    const array = (shape: readonly (number | null)[]): SignatureType => ({ collection: 'array', element: 'real', shape });
    const framed = { collection: 'array', element: 'real', shape: [{ spread: 's' }, 'n', 'n'] } as const;
    const signature: TypeSignature = { inputs: [framed], result: framed, ranks: [2] };
    expect(formatTypeSignature(signature)).toBe('array[…s, n, n]<real> → array[…s, n, n]<real> [rank 2]');
    expect(instantiateTypeSignature(signature, [array([2, 3, 3])])?.result)
        .toEqual({ ...framed, rank: 3, shape: [2, 3, 3] });
    expect(instantiateTypeSignature(signature, [array([3])])).toBeUndefined();
    expect(instantiateTypeSignature(signature, ['array'])?.result).toEqual(framed);
    expect(formatTypeSignature({ inputs: [array([null, null])], result: 'real' }))
        .toBe('array[#, #]<real> → real');
});
