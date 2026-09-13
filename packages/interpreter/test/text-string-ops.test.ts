import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('Unicode string operations', () => {
    it('keeps scalar text whole and maps columns lazily', () => {
        expect(run('use text\n"ÄBC" lower')).toBe('äbc');
        expect(run('use text\n(array "ÄBC" "B") lower')).toBe('äbc b');
        expect(run('use text\n(array "Tennis" "Other") "T" startswith'))
            .toBe('true false');
        expect(run('use text\n"Ä😀" 5 "é🙂" lpad')).toBe('é🙂éÄ😀');
        expect(run('use text\n(array "A" "AB") 3 "0" lpad'))
            .toBe('00A 0AB');
        expect(run('use text\n"Ä(x)" "Ä(" "a" translate')).toBe('ax)');
        expect(run('use text\n(array "(1)" "(2)") "()" "" translate'))
            .toBe('1 2');
    });

    it('rejects invalid widths, fills and mismatched argument arrays', () => {
        expect(() => run('use text\n"A" (-1) "0" lpad'))
            .toThrowError('lpad expects text');
        expect(() => run('use text\n"A" 3 "" lpad'))
            .toThrowError('lpad expects text');
        expect(() => run('use text\n(array "A" "B") (array 2) "0" lpad'))
            .toThrowError('same shape');
        expect(() => run('use text\n"A" "A" 1 translate'))
            .toThrowError('translate expects three text values');
    });
});
