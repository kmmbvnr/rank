import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankArray } from '../src/index.js';

const balanced = readFileSync(new URL('../../../demos/dyalog/2013/004_balanced.ra', import.meta.url), 'utf8');

for (const compiled of [false, true]) describe(`text rank (compiled=${compiled})`, () => {
    const runtime = (print?: (line: string) => void) => new Interpreter(print, {
        scalarCompilation: compiled, scalarEntryCompilation: compiled, scalarFunctionCompilation: compiled,
        blockCompilation: compiled, integerLoopCompilation: compiled, tensorFusion: compiled,
    });

    it('runs the balanced text draft including empty input and negative prefixes', () => {
        const r = runtime();
        try {
            r.execute(balanced);
            for (const [text, expected] of [
                ['((2×3)+4)', true], ['(()', false], ['())', false], ['', true],
                [')(', false], ['(😀é)', true], ['plain 😀 text', true], ['((()))()', true],
            ] as const) expect(r.execute(`${JSON.stringify(text)} balanced`), text).toBe(expected);
        } finally { r.dispose(); }
    });

    it('returns arrays of code points and broadcasts a one-code-point operand', () => {
        const r = runtime();
        try {
            r.execute('use sequences\nuse text');
            for (const [source, shape, items] of [
                ['"(😀é)" "(" equal rank 0', [5], [true, false, false, false, false]],
                ['"😀a😀" "😀" equal rank 0', [3], [true, false, true]],
                ['"😀" "😀a😀" equal rank 0', [3], [true, false, true]],
                ['"😀a" "😀b" equal rank 0', [2], [true, false]],
                ['"" "(" equal rank 0', [0], []],
                ['"😀é" codepoint rank 0', [3], [128512n, 101n, 769n]],
            ] as const) {
                const result = r.execute(source)!;
                expect(isRankArray(result), source).toBe(true);
                if (isRankArray(result)) {
                    expect(result.shape).toEqual(shape);
                    expect(result.items).toEqual(items);
                }
            }
            expect(() => r.execute('"ab" "abc" equal rank 0')).toThrow('shape mismatch');
            expect(r.execute('"ab" "ab" equal rank 1')).toBe(true);
            expect(r.execute('"ab" equal "ab"')).toBe(true);
            expect(r.execute('"abc" min "bcd"')).toBe('abc');
            expect(formatValue(r.execute('(array "abc" "xyz") min "def"')!)).toBe('abc def');
            expect(formatValue(r.execute('(array "ab" "cd") len rank 0')!)).toBe('2 2');
        } finally { r.dispose(); }
    });

    it('casts boolean masks without enabling boolean arithmetic', () => {
        const r = runtime();
        try {
            r.execute('use sequences\nMask = (array true false false true) reshape 2 2');
            const result = r.execute('Mask integer')!;
            expect(isRankArray(result)).toBe(true);
            if (isRankArray(result)) {
                expect(result.shape).toEqual([2, 2]);
                expect(result.items).toEqual([1n, 0n, 0n, 1n]);
            }
            expect(formatValue(r.execute('Mask')!)).toBe('true false false true');
            expect(formatValue(r.execute('(array shape 0 3 fill false) integer shape')!)).toBe('0 3');
            expect(formatValue(r.execute('(array shape 0 3 fill false) integer rank 1 shape')!)).toBe('0 3');
            for (const source of ['true + 3', 'Mask * 3', 'true - false']) {
                expect(() => formatValue(r.execute(source)!), source).toThrow();
            }
        } finally { r.dispose(); }
    });

    it('applies explicit ranks to user functions over text', () => {
        const calls: string[] = [];
        const r = runtime(line => calls.push(line));
        try {
            r.execute(`use sequences
use io
fun Text point
  Text print
  return Text
end
fun Left same Right rank 0 0
  return Left equal Right
end`);
            const result = r.execute('"😀é" point rank 0')!;
            expect(isRankArray(result)).toBe(true);
            if (isRankArray(result)) expect(result.items).toEqual(['😀', 'e', '́']);
            expect(calls).toEqual(['😀', 'e', '́']);
            expect(formatValue(r.execute('"aba" same "a" rank 0 0')!)).toBe('true false true');
        } finally { r.dispose(); }
    });
});
import { readFileSync } from 'node:fs';
