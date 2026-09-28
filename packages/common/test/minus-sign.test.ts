import { describe, expect, it } from 'vitest';
import { formatLine } from '../src/repl-input.js';

describe('the minus key while formatting a line', () => {
    it.each([
        ['A -1 shift', 'A -1 shift'],
        ['A -1 shift with 9', 'A -1 shift with 9'],
        ['Values -Delta shift', 'Values -Delta shift'],
        ['X-1', 'X - 1'],
        ['X - 1', 'X - 1'],
        ['X- 1', 'X - 1'],
        ['Y = X-1', 'Y = X - 1'],
        ['Y = -1', 'Y = -1'],
        ['Q push -1', 'Q push -1'],
        ['X -= 1', 'X -= 1'],
    ])('formats %j as %j', (typed, stored) => {
        expect(formatLine(typed)).toBe(stored);
    });
});
