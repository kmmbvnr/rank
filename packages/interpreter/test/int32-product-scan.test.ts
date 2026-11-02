import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { integer32Cells, integer64Cells, readArrayItem, typedArray } from '../src/array-storage.js';
import { scanInt32Axis } from '../src/axis-order.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';

for (const compilation of [false, true]) describe(`Int32 product scan (${compilation})`, () => {
    for (const [shape, axis] of [[[2, 6], 1], [[6, 2], 0], [[2, 3, 2], 1]] as [number[], number][]) {
        it(`matches exact strided prefixes for ${shape} axis ${axis}`, () => {
            const cells = Int32Array.from([2, -3, 0, 7, -1, -1, 4, 2, -2, 0, 3, 5]);
            const expected = Array.from(cells, BigInt);
            const inner = shape.slice(axis + 1).reduce((a, b) => a * b, 1);
            for (let i = 0; i < cells.length; i++) if (Math.floor(i / inner) % shape[axis]) {
                expected[i] *= expected[i - inner];
            }
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.variables.set('A', typedArray(cells, shape));
                const result = runtime.execute(`use numbers\nA scan * axis ${axis}`);
                if (!isRankArray(result!)) throw Error('expected array');
                expect(integer32Cells(result!)).toBeDefined();
                expect(Array.from({ length: cells.length }, (_, i) => readArrayItem(result!, i))).toEqual(expected);
            } finally { runtime.dispose(); }
        });
    }

    it('widens safe prefixes and falls back before an unsafe prefix even before a zero', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Wide', typedArray(Int32Array.from([2147483647, 2]), [2]));
            const wide = runtime.execute('use numbers\nWide scan * axis 0');
            if (!isRankArray(wide!)) throw Error('expected array');
            expect(integer64Cells(wide!)).toBeDefined();
            expect(readArrayItem(wide!, 1)).toBe(4294967294n);
            const cells = Int32Array.from([2147483647, 2147483647, 0]);
            const input = typedArray(cells, [3]);
            expect(scanInt32Axis('*', input, [3], 0)).toBeUndefined();
            runtime.variables.set('A', input);
            const result = runtime.execute('A scan * axis 0');
            if (!isRankArray(result!)) throw Error('expected array');
            expect(readArrayItem(result!, 1)).toBe(2147483647n ** 2n);
            expect(readArrayItem(result!, 2)).toBe(0n);
            expect(cells[1]).toBe(2147483647);
        } finally { runtime.dispose(); }
    });

    it('preserves explicit seed and empty-axis behavior', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            expect(runtime.execute('use numbers\nuse sequences\n((array 2 3) scan * axis 0 with 7) last')).toBe(42n);
            runtime.variables.set('Empty', typedArray(new Int32Array(), [2, 0]));
            expect(runtime.execute('Empty scan * axis 1')).toMatchObject({ shape: [2, 0] });
        } finally { runtime.dispose(); }
    });
});

it('polls before publishing a packed product scan', () => {
    const input = typedArray(new Int32Array(16384).fill(1), [16384]);
    expect(() => withDemandBudget(4096, () => scanInt32Axis('*', input, input.shape, 0))).toThrow(DemandBudgetExhausted);
    expect(readArrayItem(input, 0)).toBe(1n);
});
