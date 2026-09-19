import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, isRankSequence } from '../src/index.js';
import { createArraySnapshot, materializedArrayItems } from '../src/array-storage.js';
import { takeDropValue } from '../src/sequence.js';
import { run } from './support.js';

describe('positional take and drop', () => {
    it('bounds infinite sources by count, separately from value bounds', () => {
        expect(run('use sequences\nprimes 5 take copy')).toBe('2 3 5 7 11');
        expect(run('use sequences\n(primes from 10) 4 take copy')).toBe('11 13 17 19');
        expect(run('use sequences\nprimes 3 drop 4 take copy')).toBe('7 11 13 17');
        expect(run('use sequences\nfibonacci 3 drop 4 take copy')).toBe('5 8 13 21');
        expect(run('use sequences\n(fibonacci from 8) 3 take copy')).toBe('8 13 21');
        expect(run('use sequences\n((primes from 10) until 20) 2 take copy')).toBe('11 13');
    });

    it('composes with finite, descending and filtered sequences', () => {
        expect(run('use sequences\n(10 to 1 by -2) 2 drop 2 take copy')).toBe('6 4');
        expect(run('use sequences\nuse numbers\nMask = fibonacci even\nF = fibonacci Mask\nF 2 drop 3 take copy')).toBe('34 144 610');
        expect(run('use sequences\n(1 to 3) 9 take copy')).toBe('1 2 3');
        expect(run('use sequences\n(1 to 3) 9 drop copy len')).toBe('0');
        expect(run('use sequences\nprimes 0 take copy len')).toBe('0');
        expect(() => run('use sequences\nprimes 9 drop copy')).toThrow('infinite');
    });

    it('preserves useful size metadata without consuming a source', () => {
        const runtime = new Interpreter();
        for (const [expression, size] of [
            ['primes 4 take', { kind: 'exact', value: 4n }],
            ['primes 4 drop', { kind: 'infinite' }],
            ['(1 to 3) 10 take', { kind: 'exact', value: 3n }],
            ['(1 to 3) 10 drop', { kind: 'exact', value: 0n }],
            ['(primes until 10) 2 take', { kind: 'unknown' }],
        ] as const) {
            const value = runtime.execute(`use sequences\n${expression}`)!;
            expect(isRankSequence(value)).toBe(true);
            if (isRankSequence(value)) expect(value.plan.size).toEqual(size);
        }
    });

    it('does not demand the tail and closes generators on completion or break', () => {
        for (const loop of ['Result = Stream 1 take copy', 'for V in Stream 0 drop 1 take\n  break\nend']) {
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
            runtime.execute('Empty = Stream 0 take copy');
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
Tail = rows 1 drop
Prefix = Tail 1 take`);
        expect(isRankSequence(runtime.variables.get('Prefix')!)).toBe(true);
        expect(runtime.execute('Prefix copy')).toMatchObject({ shape: [1, 2], items: [3n, 4n] });
        expect(run('use sequences\nfun values\n  yield 1\nend\nvalues 9 take copy')).toBe('1');
        expect(run('use sequences\nfun values\n  yield 1\nend\nvalues 9 drop copy len')).toBe('0');
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
T = M 1 drop 1 take`);
        expect(runtime.execute('T copy')).toMatchObject({ shape: [1, 2, 2], items: [5n, 6n, 7n, 8n] });
        runtime.execute('M 1 0 0 = 99');
        expect(runtime.execute('T 0 0 0')).toBe(5n);
        expect(runtime.execute('(M 1 drop 1 take) 0 0 0')).toBe(99n);
        expect(runtime.execute('M 99 drop shape')).toMatchObject({ items: [0n, 2n, 2n] });
        expect(run('use sequences\nM = array shape 3 0 fill 0\nM 1 drop shape')).toBe('2 0');
        expect(run('use sequences\n(array 1 2 3) 9999999999999999999999999 take')).toBe('1 2 3');
    });

    it('counts Unicode code points in text', () => {
        expect(run('use sequences\n"A😀Б" 2 take')).toBe('A😀');
        expect(run('use sequences\n"A😀Б" 2 drop')).toBe('Б');
        expect(run('use sequences\n"abc" 9 drop')).toBe('');
        expect(run('use sequences\n"abc" 0 drop')).toBe('abc');
    });

    it('rejects invalid counts and sources', () => {
        for (const name of ['take', 'drop']) {
            for (const count of ['-1', '1.5', 'true', '"2"']) {
                expect(() => run(`use sequences\nprimes (${count}) ${name}`))
                    .toThrow(`${name} expects a nonnegative integer count`);
            }
            expect(() => run(`use sequences\n7 2 ${name}`))
                .toThrow(`${name} expects text, an array or a sequence`);
        }
    });

    it('preserves take while and user-defined take and drop functions', () => {
        expect(run('use sequences\nV = array 1 2 3\nM = V less 3\nV take while M')).toBe('1 2');
        expect(run('use sequences\nfun take X\n  return X + 1\nend\n4 take')).toBe('5');
        expect(run('use sequences\nfun drop X\n  return X + 2\nend\n4 drop')).toBe('6');
    });
});
