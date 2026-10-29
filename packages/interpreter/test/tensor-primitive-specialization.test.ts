import { describe, expect, it } from 'vitest';
import { parse, type RankArray, type RankValue } from '../src/index.js';
import { compileTensorKernel } from '../src/tensor-kernel.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';

function probe(expression = 'A * B + C') {
    const values = new Map<string, RankValue>();
    const kernel = compileTensorKernel(parse(`Result = (${expression}) copy`).statements[0], {
        lookup: name => values.get(name), builtin: () => true,
    })!;
    return { values, kernel };
}

describe('physical tensor primitive specialization', () => {
    it('specializes cached layouts while retaining mixed integer/real promotion', () => {
        const { values, kernel } = probe();
        for (let repeat = 0; repeat < 2; repeat++) {
            for (const [cells, b, c, expected] of [
                [new Int32Array([2, 3]), 3n, 1n, [7n, 10n]],
                [new BigInt64Array([2n, 3n]), 3n, 1n, [7n, 10n]],
                [new Float64Array([2, 3]), 3, 1, [7, 10]],
                [new Int32Array([2, 3]), 3, 1n, [7, 10]],
                [new Float64Array([2, 3]), 3n, 1n, [7, 10]],
            ] as const) {
                values.set('A', typedArray(cells));
                values.set('B', b); values.set('C', c);
                const result = kernel.run() as RankArray;
                expect([readArrayItem(result, 0), readArrayItem(result, 1)]).toEqual(expected);
                expect(kernel.source).not.toContain('typeof');
                if (typeof expected[0] === 'bigint') expect(kernel.source).not.toContain('Number.isFinite');
                else if (!kernel.source.includes('bounded tensor')) expect(kernel.source).toContain('Number.isFinite');
            }
        }
    });

    it.each([Infinity, -Infinity, NaN, Number.MAX_VALUE])('declines non-finite inputs or intermediates: %s', value => {
        const { values, kernel } = probe('(A * B) greater C');
        values.set('A', typedArray(new Float64Array([1, value])));
        values.set('B', 2); values.set('C', 0);
        // A comparison could hide Infinity behind a perfectly valid boolean.
        expect(kernel.run()).toBeUndefined();
    });

    it('retains division-by-zero checks in a specialized loop', () => {
        const { values, kernel } = probe('A / B');
        values.set('A', typedArray(new Float64Array([1, 2])));
        values.set('B', typedArray(new Float64Array([1, 0])));
        expect(kernel.run()).toBeUndefined();
    });

    it('keeps exact intermediate arithmetic beyond both safe Number and int64', () => {
        const { values, kernel } = probe();
        const a = (1n << 63n) - 1n;
        values.set('A', typedArray(new BigInt64Array([a])));
        values.set('B', 3n); values.set('C', 1n);
        const result = kernel.run() as RankArray;
        expect(readArrayItem(result, 0)).toBe(a * 3n + 1n);
    });
});
