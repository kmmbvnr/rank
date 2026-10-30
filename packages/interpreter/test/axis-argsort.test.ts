import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';

type Cells = Float64Array | Int32Array;

function reference(cells: Cells, shape: number[], axis: number, down: boolean): number[] {
    const n = shape[axis];
    const inner = shape.slice(axis + 1).reduce((a, b) => a * b, 1);
    const outer = shape.slice(0, axis).reduce((a, b) => a * b, 1);
    const out = new Array<number>(cells.length).fill(0);
    for (let o = 0; o < outer; o++) for (let i = 0; i < inner; i++) {
        const at = (k: number) => o * n * inner + i + k * inner;
        const order = Array.from({ length: n }, (_, k) => k).sort((a, b) =>
            ((down ? -1 : 1) * (cells[at(a)] - cells[at(b)])) || a - b);
        order.forEach((k, position) => { out[at(position)] = k; });
    }
    return out;
}

function run(cells: Cells, shape: number[], axis: number, down: boolean, lazy = false): number[] {
    const runtime = new Interpreter();
    try {
        runtime.variables.set('M', typedArray(cells, shape));
        const sum = lazy ? ' + 0' : '';
        const result = runtime.execute(`use sequences\nuse numbers\n(M${sum}) argsort axis ${axis}${down ? ' .descending' : ''}`);
        if (!result || !isRankArray(result)) throw Error('expected array');
        return Array.from({ length: cells.length }, (_, i) => Number(readArrayItem(result, i)));
    } finally { runtime.dispose(); }
}

const ties = (n: number, real: boolean): Cells => {
    const values = Array.from({ length: n }, (_, i) => ((i * 2654435761) >>> 0) % 7 - 3);
    return real ? Float64Array.from(values, v => v / 4) : Int32Array.from(values);
};

function scan(cells: Int32Array, shape: number[], axis: number, op: string, lazy: boolean): bigint[] {
    const runtime = new Interpreter();
    try {
        runtime.variables.set('M', typedArray(cells, shape));
        const result = runtime.execute(`use numbers\n(M${lazy ? ' + 0' : ''}) scan ${op} axis ${axis}`);
        if (!result || !isRankArray(result)) throw Error('expected array');
        return Array.from({ length: cells.length }, (_, i) => readArrayItem(result, i) as bigint);
    } finally { runtime.dispose(); }
}

describe('integer scan axis', () => {
    const fold: Record<string, (a: bigint, b: bigint) => bigint> = {
        '+': (a, b) => a + b, max: (a, b) => a > b ? a : b, min: (a, b) => a < b ? a : b,
    };
    const big = Int32Array.from({ length: 360 }, (_, i) => i % 3 ? 2147483647 - i : -2147483648 + i);
    for (const [name, cells] of [['small', ties(360, false) as Int32Array], ['near 2^31', big]] as const) {
        for (const [shape, axis] of [[[6, 60], 1], [[60, 6], 0], [[3, 20, 6], 0], [[3, 20, 6], 1], [[3, 20, 6], 2]] as [number[], number][]) {
            for (const op of ['+', 'max', 'min']) for (const lazy of [false, true]) {
                it(`${name} ${shape.join('x')} axis ${axis} ${op}${lazy ? ' lazy' : ''}`, () => {
                    const n = shape[axis], inner = shape.slice(axis + 1).reduce((a, b) => a * b, 1);
                    const expected = Array.from(cells, BigInt);
                    for (let i = 0; i < expected.length; i++) {
                        if (Math.floor(i / inner) % n) expected[i] = fold[op](expected[i - inner], BigInt(cells[i]));
                    }
                    expect(scan(cells, shape, axis, op, lazy)).toEqual(expected);
                });
            }
        }
    }
});

describe('argsort axis on numeric matrices', () => {
    for (const real of [true, false]) for (const [shape, axis] of [[[4, 40], 1], [[40, 4], 0], [[3, 20, 4], 0], [[3, 20, 4], 1], [[3, 20, 4], 2]] as [number[], number][]) {
        for (const down of [false, true]) for (const lazy of [false, true]) {
            it(`${real ? 'real' : 'integer'} ${shape.join('x')} axis ${axis}${down ? ' descending' : ''}${lazy ? ' lazy' : ''}`, () => {
                const cells = ties(shape.reduce((a, b) => a * b, 1), real);
                expect(run(cells, shape, axis, down, lazy)).toEqual(reference(cells, shape, axis, down));
            });
        }
    }

    it('keeps a row longer than one merge run stable', () => {
        const cells = Float64Array.from({ length: 5000 }, (_, i) => (i * 7919) % 13);
        expect(run(cells, [2, 2500], 1, false)).toEqual(reference(cells, [2, 2500], 1, false));
    });

    it('leaves rows with NaN to the ordinary path', () => {
        const cells = Float64Array.from([3, NaN, 1, 2, 0, 5]);
        const ordinary = run(Float64Array.from([3, 4, 1, 2, 0, 5]), [2, 3], 1, false);
        expect(ordinary).toEqual([2, 0, 1, 1, 0, 2]);
        expect(() => run(cells, [2, 3], 1, false)).not.toThrow();
    });

    it('handles empty axes', () => {
        expect(run(new Float64Array(0), [3, 0], 1, false)).toEqual([]);
    });
});
