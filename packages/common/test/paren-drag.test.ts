import { describe, expect, it } from 'vitest';
import { moveParen, parenSnaps } from '../src/paren-drag.js';

const open = (line: string) => line.indexOf('(');
const close = (line: string) => line.lastIndexOf(')');
const snapped = (line: string, offset: number) => parenSnaps(line, offset).map(at => moveParen(line, offset, at)!.line);

describe('dragging a bracket', () => {
    it('moves an opening bracket left to take in more', () => {
        const line = 'A i (i+1)';

        expect(moveParen(line, open(line), line.indexOf('A'))?.line).toBe('(A i i+1)');
        expect(moveParen(line, open(line), line.indexOf('i'))?.line).toBe('A (i i+1)');
    });

    it('moves a closing bracket right to take in more, and left to take in less', () => {
        const line = '(A + B) * C';

        expect(moveParen(line, close(line), line.length)?.line).toBe('(A + B * C)');
        expect(moveParen(line, close(line), line.indexOf('+') + 1)).toBeUndefined();
        expect(moveParen('(A + B + C)', 10, 6)?.line).toBe('(A + B) + C');
    });

    it('offers every landing on tokens, never a dangling operator', () => {
        expect(snapped('A i (i+1)', 4)).toEqual(['(A i i+1)', 'A (i i+1)', 'A i i+(1)']);
        expect(snapped('(A + B) * C', 6)).toEqual(['(A) + B * C', '(A + B * C)']);
    });

    it('never crosses another pair or empties the group', () => {
        const line = '(A + B) * (C + D)';

        expect(moveParen(line, close(line.slice(0, 8)), line.indexOf('C') + 1)).toBeUndefined();
        expect(moveParen(line, line.lastIndexOf('('), line.indexOf('B'))).toBeUndefined();
        expect(moveParen('(A)', 0, 2)).toBeUndefined();
    });

    it('never takes an assignment into the group', () => {
        const line = 'Total = A + (B * 3)';

        expect(snapped(line, open(line))).toEqual(['Total = (A + B * 3)', 'Total = A + B * (3)']);
    });

    it('does nothing for a line that is not balanced or a character that is not a bracket', () => {
        expect(parenSnaps('(A + B', 0)).toEqual([]);
        expect(parenSnaps('A + B', 2)).toEqual([]);
    });
});
