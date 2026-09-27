import { expect, it } from 'vitest';
import { bindingRankConflict, bindingRankMessage, bindingTypeMessage,
    possibleBindingTypeConflict, provenBindingTypeConflict } from '../src/binding-rule.js';

it('separates a possible runtime conflict from a proven static conflict', () => {
    const accepted = new Set(['integer']);
    expect(possibleBindingTypeConflict(accepted, ['integer', 'text'])).toBe(true);
    expect(provenBindingTypeConflict(accepted, ['integer', 'text'])).toBe(false);
    expect(provenBindingTypeConflict(accepted, ['text', 'real'])).toBe(true);
    expect(provenBindingTypeConflict(accepted, [])).toBe(false);
});

it('uses the same binding messages for runtime and static diagnostics', () => {
    expect(bindingTypeMessage('Value', ['integer'], ['real']))
        .toBe('Value has type integer and cannot receive real');
    expect(bindingRankConflict(2, 1)).toBe(true);
    expect(bindingRankConflict(undefined, 1)).toBe(false);
    expect(bindingRankMessage('Value', 2, 1))
        .toBe('Value has rank 2 and cannot receive rank 1');
});
