import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';

const read = (source: string, setup: (runtime: Interpreter) => void) => {
    const runtime = new Interpreter();
    try {
        setup(runtime);
        const result = runtime.execute(`use sequences\n${source}`);
        if (!result || !isRankArray(result)) throw Error('expected array');
        return { shape: [...result.shape], cells: Array.from({ length: result.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(result, i)) };
    } finally { runtime.dispose(); }
};

describe('irregular gathers from stored matrices', () => {
    const rows = 40, cols = 70;
    const reals = Float64Array.from({ length: rows * cols }, (_, i) => i * 0.25);
    const ints = Int32Array.from({ length: rows * cols }, (_, i) => i * 3 - 100);
    const rowOf = (r: number) => (r * 7) % rows, colOf = (c: number) => (c * 11 + 3) % cols;
    for (const [name, cells] of [['real', reals], ['integer', ints]] as const) {
        it(`${name} permuted rows and columns`, () => {
            const got = read('M (((0 to 39) * 7) mod 40) ((((0 to 69) * 11) + 3) mod 70)', runtime => runtime.variables.set('M', typedArray(cells, [rows, cols])));
            expect(got.shape).toEqual([rows, cols]);
            got.cells.forEach((x, i) => {
                const expected = cells[rowOf(Math.floor(i / cols)) * cols + colOf(i % cols)];
                expect(typeof x === 'bigint' ? Number(x) : x).toBe(expected);
            });
        });
        it(`${name} one fixed row and permuted columns`, () => {
            const got = read('M 5 ((((0 to 69) * 11) + 3) mod 70)', runtime => runtime.variables.set('M', typedArray(cells, [rows, cols])));
            expect(got.cells.map(x => typeof x === 'bigint' ? Number(x) : x)).toEqual(Array.from({ length: cols }, (_, c) => cells[5 * cols + colOf(c)]));
        });
        it(`${name} repeated and short selectors`, () => {
            const got = read('M (array 3 3 0) (array 69 0)', runtime => runtime.variables.set('M', typedArray(cells, [rows, cols])));
            expect(got.shape).toEqual([3, 2]);
            expect(got.cells.map(x => typeof x === 'bigint' ? Number(x) : x)).toEqual([3, 3, 0].flatMap(r => [69, 0].map(c => cells[r * cols + c])));
        });
    }
});
