import { expect, it } from 'vitest';
import { formatTypeSignature, inferSignatureResultTypes, instantiateTypeSignature, matchingSignatures, type SignatureType,
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
