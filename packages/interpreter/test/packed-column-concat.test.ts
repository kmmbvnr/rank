import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { withInterrupt, withDemandBudget } from '../src/interrupt.js';

for (const compilation of [false, true]) describe(`packed column concat, compilation=${compilation}`, () => {
    for (const real of [false, true]) for (const rows of [0, 1, 8201]) {
        it(`copies ${rows} rows, real=${real}, including repeated sources`, () => {
            const runtime = new Interpreter(() => {}, { compilation });
            const left = Array.from({ length: rows }, (_, i) => real ? i + 0.25 : i - 4100);
            const right = left.map(x => -x);
            const cells = (values: number[]) => real ? Float64Array.from(values) : Int32Array.from(values);
            runtime.variables.set('Left', typedArray(cells(left), [rows, 1]));
            runtime.variables.set('Right', typedArray(cells(right), [rows, 1]));
            try {
                const result = runtime.execute('use sequences\nResult = concat Left Right Left axis 1\nResult');
                if (!result || !isRankArray(result)) throw Error('expected array');
                expect(result.shape).toEqual([rows, 3]);
                const expected = left.flatMap((x, i) => [x, right[i], x]).map(x => real ? x : BigInt(x));
                expect(result.items).toEqual(expected);
            } finally { runtime.dispose(); }
        });
    }
    it('preserves wide integer copies', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        runtime.variables.set('Left', typedArray(BigInt64Array.from([2n ** 60n, -(2n ** 60n)]), [2, 1]));
        try {
            const result = runtime.execute('use sequences\nResult = concat Left Left axis 1\nResult');
            if (!result || !isRankArray(result)) throw Error('expected array');
            expect(result.items).toEqual([2n ** 60n, 2n ** 60n, -(2n ** 60n), -(2n ** 60n)]);
        } finally { runtime.dispose(); }
    });
    it('retains budgeted traversal', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        runtime.variables.set('Left', typedArray(Int32Array.from([1, 2]), [2, 1]));
        try {
            const result = withDemandBudget(1000, () => runtime.execute('use sequences\nResult = concat Left Left axis 1\nResult'));
            if (!result || !isRankArray(result)) throw Error('expected array');
            expect(result.items).toEqual([1n, 1n, 2n, 2n]);
        } finally { runtime.dispose(); }
    });
});

it('preserves per-block observable polling for column completion', () => {
    const rows = 8201, runtime = new Interpreter();
    const cells = Int32Array.from({ length: rows }, (_, i) => i);
    runtime.variables.set('Left', typedArray(cells, [rows, 1]));
    let polls = 0;
    const signal = { length: 1, load: () => 0, store() {}, exchange() { polls++; return 0; }, wait() {} };
    try {
        runtime.execute('use sequences');
        const result = withInterrupt(signal, () => runtime.execute('Result = (concat Left Left axis 1) copy\nResult'));
        if (!result || !isRankArray(result)) throw Error('expected array');
        expect(result.shape).toEqual([rows, 2]);
        expect(result.items.slice(0, 6)).toEqual([0n, 0n, 1n, 1n, 2n, 2n]);
        expect(polls).toBeGreaterThanOrEqual(Math.floor(rows * 2 / 1024));
    } finally { runtime.dispose(); }
});
