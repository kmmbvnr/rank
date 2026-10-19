import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankArray, type RankValue } from '../src/index.js';
import { denseScalarItems, ownedArray } from '../src/array-storage.js';
import { mapStoredIntegers } from '../src/integer-array-kernel.js';
import { sliceSource } from '../src/slice-source.js';
import { readArrayItem } from '../src/array-storage.js';
import { checkpoint, InterruptedError, withInterrupt } from '../src/interrupt.js';

describe('stored segmented integer arithmetic', () => {
    it.each([true, false])('bounds the recurrence without copy (compiled=%s)', compilation => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`use sequences
use numbers
M = 250
Mod = 10000000000000000
Cnt = array shape M fill 0
Cnt 0 = 1
Initial = Cnt
for K in 1 to 2500
 R = K K M powmod
 Head = Cnt take (M - R)
 Tail = Cnt drop (M - R)
 Cnt = (Cnt + concat Tail Head) mod Mod
end`);
            const result = runtime.variables.get('Cnt')!;
            if (!isRankArray(result)) throw new Error('expected array');
            expect(denseScalarItems(result)).toBeDefined();
            expect((result.items[0] as bigint) - 1n).toBe(3576981783379967n);
            expect(runtime.execute('Initial sum')).toBe(1n);
        } finally { runtime.dispose(); }
    });

    it.each([0, 1, 4, 5])('rotates a stored array by %s and preserves aliases', rotation => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`use sequences
A = array 9007199254740993 2 3 4 5
Head = A take ${5 - rotation}
Tail = A drop ${5 - rotation}
Joined = concat Tail Head
B = (A + Joined) mod 10000000000000000
Alias = B
A 0 = 99
B 0 = 42`);
            const a = [9007199254740993n, 2n, 3n, 4n, 5n];
            const shifted = [...a.slice(5 - rotation), ...a.slice(0, 5 - rotation)];
            const alias = runtime.variables.get('Alias') as RankArray;
            expect(alias.items).toEqual(a.map((x, i) => (x + shifted[i]) % 10000000000000000n));
            expect(runtime.execute('B 0')).toBe(42n);
        } finally { runtime.dispose(); }
    });

    it('handles segmented table axes and broadcasts without narrowing', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`use sequences
A = array shape 2 2 fill 9007199254740993
B = concat A A axis 1
C = B + array 1 2 3 4`);
            const result = runtime.variables.get('C') as RankArray;
            expect(result.shape).toEqual([2, 4]);
            expect(result.items).toEqual([1n, 2n, 3n, 4n, 1n, 2n, 3n, 4n].map(x => x + 9007199254740993n));
        } finally { runtime.dispose(); }
    });

    it('keeps zero-divisor errors deferred and unread host cells untouched', () => {
        const runtime = new Interpreter();
        const reads: number[] = [];
        runtime.variables.set('Host', { kind: 'array', shape: [2], items: [],
            itemAt(index) { reads.push(index); return BigInt(index + 1); } });
        try {
            runtime.execute('use sequences\nA = array 3 4\nB = concat A A\nQ = B mod (array 2 2 0 2)\nH = Host + 1');
            expect(reads).toEqual([]);
            expect(runtime.execute('Q 0')).toBe(1n);
            expect(() => runtime.execute('Q 2')).toThrow('division by zero');
            expect(runtime.execute('H 1')).toBe(3n);
            expect(reads).toEqual([1]);
        } finally { runtime.dispose(); }
    });

    it('does not trust a replaced concat reader', () => {
        const runtime = new Interpreter();
        try {
            const value = runtime.execute('use sequences\nA = array 1 2\nconcat A A') as RankArray;
            Object.defineProperty(value, 'itemAt', { value: () => 99n });
            expect(mapStoredIntegers(value, 1n, '+')).toBeUndefined();
        } finally { runtime.dispose(); }
    });

    it('retains a slice cell domain observed by a prepared integer kernel', () => {
        const source = ownedArray([1n], [1], true);
        const view = sliceSource(source)!.slice(1n, false) as RankArray;
        expect(mapStoredIntegers(view, 1n, '+')!.items).toEqual([2n]);
        source.items[0] = 2.5;
        expect(() => readArrayItem(view, 0)).toThrow('one element type');
    });

    it('retains floor division and modulo signs for huge integers', () => {
        const huge = 2n ** 100n + 3n;
        const a = ownedArray([huge, -huge], [2], true);
        for (const divisor of [7n, -7n]) {
            for (const name of ['//', 'mod']) {
                const result = mapStoredIntegers(a, divisor, name)!;
                const expected = [huge, -huge].map(x => {
                    const rem = x % divisor;
                    const adjust = rem !== 0n && (rem < 0n) !== (divisor < 0n);
                    return name === '//' ? x / divisor - (adjust ? 1n : 0n) : rem + (adjust ? divisor : 0n);
                });
                expect(result.items).toEqual(expected);
            }
        }
    });

    it('cancels a stored pass without publishing a partial result', () => {
        const source = ownedArray(Array(20000).fill(1n) as RankValue[], [20000], true);
        const flag = new Int32Array(new SharedArrayBuffer(8));
        Atomics.store(flag, 0, 1);
        expect(() => withInterrupt(flag, () => {
            checkpoint('before kernel', 4096);
            return mapStoredIntegers(source, 2n, '+');
        })).toThrow(InterruptedError);
        expect(mapStoredIntegers(source, 2n, '+')!.items[19999]).toBe(3n);
    });
});
