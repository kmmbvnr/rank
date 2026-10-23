import { describe, expect, it } from 'vitest';
import { formatLine } from '../src/repl-input.js';

describe('the minus key while formatting a line', () => {
    it.each([
        ['A shift -1', 'A shift -1'],
        ['A shift -1 with 9', 'A shift -1 with 9'],
        ['Values shift -Delta', 'Values shift -Delta'],
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
