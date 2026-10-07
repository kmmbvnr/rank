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

    it('classifies Unicode characters elementwise', () => {
        expect(run('use text\n"a" letter')).toBe('true');
        expect(run('use text\n"é" letter')).toBe('true');
        expect(run('use text\n"5" letter')).toBe('false');
        expect(run('use text\n"٣" digit')).toBe('true');
        expect(run('use text\n"²" digit')).toBe('false');
        expect(run('use text\n"²" alnum')).toBe('true');
        expect(run('use text\n" " alnum')).toBe('false');
        expect(run('use text\n"Ab 1,é" "" split letter'))
            .toBe('true true false false false true');
        expect(run('use text\n"Ab 1" "" split digit'))
            .toBe('false false false true');
    });

    it('rejects text that is not one character', () => {
        expect(() => run('use text\n"ab" letter')).toThrowError('letter expects one');
        expect(() => run('use text\n"" digit')).toThrowError('digit expects one');
        expect(() => run('use text\n1 alnum')).toThrowError('alnum expects one');
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
