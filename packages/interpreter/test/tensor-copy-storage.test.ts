import { describe, expect, it } from 'vitest';
import { Interpreter, parse, type RankArray, type RankValue } from '../src/index.js';
import { compileTensorKernel } from '../src/tensor-kernel.js';
import { denseScalarItems, filledArray, ownedScalarArray, readArrayItem, typedArray, typedElementKind } from '../src/array-storage.js';

describe('tensor copy storage', () => {
    it.each([0, 1, 4095, 4096, 5000])('packs exact integer output at size %s', size => {
        const runtime = new Interpreter();
        try {
            const result = runtime.execute(`use numbers\nuse sequences\nA = ((0 till ${size}) mod 31) copy\n(A * 3 + 1) copy`) as RankArray;
            expect(result.shape).toEqual([size]);
            expect(typedElementKind(result)).toBe(size >= 4096 ? 'integer' : undefined);
            for (let i = 0; i < size; i++) expect(readArrayItem(result, i)).toBe(BigInt(i % 31 * 3 + 1));
        } finally { runtime.dispose(); }
    });

    it.each([0, 2500, 4999])('keeps an overflowing integer at position %s exact', position => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\nfun A probe\n return (A * 3 + 1) copy\nend');
            const items = Array<bigint>(5000).fill(2n);
            items[position] = (1n << 63n) - 1n;
            const fn = runtime.variables.get('probe')!;
            if (typeof fn !== 'object' || fn.kind !== 'function') throw new Error('expected function');
            const result = fn.call([typedArray(BigInt64Array.from(items))]) as RankArray;
            expect(typedElementKind(result)).toBeUndefined();
            expect(denseScalarItems(result)).toEqual(items.map(value => value * 3n + 1n));
        } finally { runtime.dispose(); }
    });

    it('separates same-shape backing types and scalar types across repeated calls', () => {
        const sources: string[] = [];
        const values = new Map<string, RankValue>();
        const kernel = compileTensorKernel(parse('Result = (A * B + 1) copy').statements[0], {
            lookup: name => values.get(name), builtin: () => true, compiled: source => sources.push(source),
        })!;
        const integer = ownedScalarArray([1n, 2n], 'integer');
        const packed = typedArray(new BigInt64Array([1n, 2n]));
        const compact = typedArray(new Int32Array([1, 2]));
        const real = typedArray(new Float64Array([1.5, 2.5]));
        for (let repeat = 0; repeat < 2; repeat++) {
            for (const [a, b, expected] of [
                [integer, 3n, [4n, 7n]], [packed, 3n, [4n, 7n]], [compact, 3n, [4n, 7n]],
                [packed, 3, [4, 7]], [real, 2n, [4, 6]],
            ] as const) {
                values.set('A', a);
                values.set('B', b);
                const result = kernel.run() as RankArray;
                expect(typedElementKind(result)).toBe(typeof expected[0] === 'number' ? 'real' : undefined);
                expect(Array.from({ length: 2 }, (_, i) => readArrayItem(result, i))).toEqual(expected);
            }
        }
        expect(sources.some(source => source.includes('/* boxed */'))).toBe(true);
        expect(sources.some(source => source.includes('/* int64 */'))).toBe(true);
        expect(sources.some(source => source.includes('/* float64 */'))).toBe(true);
        expect(sources.some(source => source.includes('/* int32 */'))).toBe(true);
    });
    it('keeps compact integer arithmetic exact past int64 and across widening', () => {
        const runtime = new Interpreter();
        try {
            runtime.variables.set('A', filledArray(2147483647n, [5000]));
            runtime.execute('use sequences\nfun A probe\n return (A * 9223372036854775808 + 1) copy\nend');
            const expected = 2147483647n * 9223372036854775808n + 1n;
            expect(runtime.execute('(A probe) 4999')).toBe(expected);
            runtime.execute('A 4999 = 2147483648');
            expect(runtime.execute('(A probe) 4999')).toBe(2147483648n * 9223372036854775808n + 1n);
            expect(runtime.execute('(A probe) 0')).toBe(expected);
        } finally { runtime.dispose(); }
    });

});
