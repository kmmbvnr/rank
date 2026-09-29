import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, isRankSequence } from '../src/index.js';
import { createArraySnapshot, materializedArrayItems } from '../src/array-storage.js';
import { takeDropValue } from '../src/sequence.js';
import { run } from './support.js';

describe('positional take and drop', () => {
    it('bounds infinite sources by count, separately from value bounds', () => {
        expect(run('use sequences\nprimes take 5 copy')).toBe('2 3 5 7 11');
        expect(run('use sequences\nprimes from 10 take 4 copy')).toBe('11 13 17 19');
        expect(run('use sequences\nprimes drop 3 take 4 copy')).toBe('7 11 13 17');
        expect(run('use sequences\nfibonacci drop 3 take 4 copy')).toBe('5 8 13 21');
        expect(run('use sequences\nfibonacci from 8 take 3 copy')).toBe('8 13 21');
        expect(run('use sequences\nprimes from 10 till 20 take 2 copy')).toBe('11 13');
    });

    it('composes with finite, descending and filtered sequences', () => {
        expect(run('use sequences\n(10 to 1 by -2) drop 2 take 2 copy')).toBe('6 4');
        expect(run('use sequences\nuse numbers\nMask = fibonacci even\nF = fibonacci Mask\nF drop 2 take 3 copy')).toBe('34 144 610');
        expect(run('use sequences\nuse numbers\nfibonacci filter even drop 2 take 3 copy')).toBe('34 144 610');
        expect(run('use sequences\n(1 to 3) take 9 copy')).toBe('1 2 3');
        expect(run('use sequences\n(1 to 3) drop 9 copy len')).toBe('0');
        expect(run('use sequences\nprimes take 0 copy len')).toBe('0');
        expect(() => run('use sequences\nprimes drop 9 copy')).toThrow('infinite');
    });

    it('preserves useful size metadata without consuming a source', () => {
        const runtime = new Interpreter();
        for (const [expression, size] of [
            ['primes take 4', { kind: 'exact', value: 4n }],
            ['primes drop 4', { kind: 'infinite' }],
            ['(1 to 3) take 10', { kind: 'exact', value: 3n }],
            ['(1 to 3) drop 10', { kind: 'exact', value: 0n }],
            ['primes till 10 take 2', { kind: 'unknown' }],
        ] as const) {
            const value = runtime.execute(`use sequences\n${expression}`)!;
            expect(isRankSequence(value)).toBe(true);
            if (isRankSequence(value)) expect(value.plan.size).toEqual(size);
        }
    });

    it('does not demand the tail and closes generators on completion or break', () => {
        for (const loop of ['Result = Stream take 1 copy', 'for V in Stream drop 0 take 1\n  break\nend']) {
            const output: string[] = [];
            const runtime = new Interpreter(line => output.push(line));
            runtime.execute(`use sequences
use io
fun values
  try
    "started" print
    yield 7
    raise "tail demanded"
  finally
    "closed" print
  end
end
Stream = values`);
            runtime.execute('Empty = Stream take 0 copy');
            expect(output).toEqual([]);
            runtime.execute(loop);
            expect(output).toEqual(['started', 'closed']);
            expect(() => runtime.execute('Stream copy')).toThrow('already been consumed');
        }
    });

    it('works with unknown-size generators and stacks retained rows only on copy', () => {
        const runtime = new Interpreter();
        runtime.execute(`use sequences
fun rows
  yield array 1 2
  yield array 3 4
  yield array 5 6
end
Tail = rows drop 1
Prefix = Tail take 1`);
        expect(isRankSequence(runtime.variables.get('Prefix')!)).toBe(true);
        expect(runtime.execute('Prefix copy')).toMatchObject({ shape: [1, 2], items: [3n, 4n] });
        expect(run('use sequences\nfun values\n  yield 1\nend\nvalues take 9 copy')).toBe('1');
        expect(run('use sequences\nfun values\n  yield 1\nend\nvalues drop 9 copy len')).toBe('0');
    });

    it('slices the leading array axis lazily and keeps a named slice', () => {
        const source = createArraySnapshot([1n, 2n, 3n, 4n], [2, 2]);
        const tail = takeDropValue(source, 1n, true);
        expect(isRankArray(tail)).toBe(true);
        if (isRankArray(tail)) expect(materializedArrayItems(tail)).toBeUndefined();
        const runtime = new Interpreter();
        runtime.execute(`use sequences
A = (1 to 12) copy
M = A (array 3 2 2) reshape
T = M drop 1 take 1`);
        expect(runtime.execute('T copy')).toMatchObject({ shape: [1, 2, 2], items: [5n, 6n, 7n, 8n] });
        runtime.execute('M 1 0 0 = 99');
        expect(runtime.execute('T 0 0 0')).toBe(5n);
        expect(runtime.execute('(M drop 1 take 1) 0 0 0')).toBe(99n);
        expect(runtime.execute('M drop 99 shape')).toMatchObject({ items: [0n, 2n, 2n] });
        expect(run('use sequences\nM = array shape 3 0 fill 0\nM drop 1 shape')).toBe('2 0');
        expect(run('use sequences\n(array 1 2 3) take 9999999999999999999999999')).toBe('1 2 3');
    });

    it('counts Unicode code points in text', () => {
        expect(run('use sequences\n"A😀Б" take 2')).toBe('A😀');
        expect(run('use sequences\n"A😀Б" drop 2')).toBe('Б');
        expect(run('use sequences\n"abc" drop 9')).toBe('');
        expect(run('use sequences\n"abc" drop 0')).toBe('abc');
    });

    it('rejects invalid counts and sources', () => {
        for (const name of ['take', 'drop']) {
            for (const count of ['-1', '1.5', 'true', '"2"']) {
                expect(() => run(`use sequences\nprimes ${name} (${count})`))
                    .toThrow(`${name} expects a nonnegative integer count`);
            }
            expect(() => run(`use sequences\n7 ${name} 2`))
                .toThrow(`${name} expects text, an array or a sequence`);
        }
    });

    it('names the clause to write for a spelling Rank does not have', () => {
        expect(() => run('use sequences\nprimes 5 take')).toThrow('take takes its count after it: write `Values take 5`');
        expect(() => run('use sequences\nprimes 5 drop')).toThrow('drop takes its count after it: write `Values drop 5`');
        expect(() => run('use sequences\nV = array 1 2 3\nM = V less 3\nV take while M'))
            .toThrow('take while is not a Rank clause: write `till not Condition`');
        expect(() => run('use sequences\nprimes until 10')).toThrow('until is not a Rank word: write `till`');
        expect(() => run('A = array 1 2 3\nA from 0 until 2')).toThrow('until is not a Rank word');
    });
});
