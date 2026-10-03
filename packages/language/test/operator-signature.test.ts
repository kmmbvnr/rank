import { expect, it } from 'vitest';
import { operatorSignature } from '../src/operator-signature.js';
import type { ValueFacts } from '../src/analysis/value-domain.js';

const facts = (...types: string[]): ValueFacts[] => types.map(type => ({ types: [type] }));

it('describes arithmetic domains independently of compiler eligibility', () => {
    expect(operatorSignature('//', facts('real', 'integer'))).toBe('real integer → real [rank 0 0]');
    expect(operatorSignature('**', facts('integer', 'integer'))).toBe('number number → number [rank 0 0]');
    expect(operatorSignature('+', facts('datetime', 'duration'))).toBe('datetime duration → datetime [rank 0 0]');
    expect(operatorSignature('-', facts('datetime', 'datetime'))).toBe('datetime datetime → duration [rank 0 0]');
    expect(operatorSignature('*', facts('duration', 'real'))).toBe('duration number → duration [rank 0 0]');
    expect(operatorSignature('+', facts('text', 'text'))).toBe('text text → text');
});

it('does not assert that equality operands have the same type or ignore missing', () => {
    expect(operatorSignature('equal', facts('text', 'integer'))).toBe('a b → boolean | missing [rank 0 0]');
    expect(operatorSignature('not equal', facts('missing', 'integer'))).toContain('boolean | missing');
    expect(operatorSignature('at least', facts('integer', 'real'))).toBe('number number → boolean [rank 0 0]');
    expect(operatorSignature('less', facts('missing', 'integer'))).toBe('missing a → missing [rank 0 0]');
});

it('represents three-valued logic and whole-value type inspection', () => {
    expect(operatorSignature('and', facts('missing', 'boolean'))).toBe('missing boolean → boolean | missing [rank 0 0]');
    expect(operatorSignature('xor', facts('boolean', 'boolean'))).toBe('boolean boolean → boolean [rank 0 0]');
    expect(operatorSignature('is', facts('array', 'symbol'))).toBe('a symbol → boolean');
});

it('respects column dispatch before scalar or missing propagation', () => {
    expect(operatorSignature('+', facts('sqlite-expression', 'missing'))).toBe('column a → column');
    expect(operatorSignature('equal', facts('sqlite-expression', 'integer'))).toBe('column a → column');
    expect(operatorSignature('equal', [{ types: [] }, { types: [] }])).toContain('column');
    expect(operatorSignature('xor')).not.toContain('column');
});

it('shows cell types for arrays and does not assign signatures to unknown words', () => {
    expect(operatorSignature('+', [{ types: ['array'], elements: ['integer'] }, { types: ['integer'] }]))
        .toBe('integer integer → integer [rank 0 0]');
    expect(operatorSignature('until')).toBeUndefined();
});
