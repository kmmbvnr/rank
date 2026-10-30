import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';

const n = (s: readonly number[]) => s.reduce((a, b) => a * b, 1);
function sum(cells: Float64Array | Int32Array, shape: number[], axis: number, lazy: boolean) {
    const runtime = new Interpreter();
    try {
        runtime.variables.set('M', typedArray(cells, shape));
        const result = runtime.execute(`use numbers\n(M${lazy ? ' + 0' : ''}) sum axis ${axis}`);
        if (result && isRankArray(result)) return Array.from({ length: n(result.shape) }, (_, i) => readArrayItem(result, i));
        return result;
    } finally { runtime.dispose(); }
}
function expected(cells: ArrayLike<number>, shape: number[], axis: number, big: boolean) {
    const len = shape[axis], inner = n(shape.slice(axis + 1)), outer = n(shape.slice(0, axis));
    const out: (number | bigint)[] = [];
    for (let o = 0; o < outer; o++) for (let i = 0; i < inner; i++) {
        let t: number | bigint = big ? 0n : 0;
        for (let k = 0; k < len; k++) t = big ? (t as bigint) + BigInt(cells[(o * len + k) * inner + i]) : (t as number) + cells[(o * len + k) * inner + i];
        out.push(t);
    }
    return out;
}

describe('sum axis over stored numeric arrays', () => {
    const reals = Float64Array.from({ length: 360 }, (_, i) => (i % 7 - 3) * 0.1 + 1e-9 * i);
    const ints = Int32Array.from({ length: 360 }, (_, i) => i % 2 ? 2147483647 - i : -2147483648 + i);
    for (const [shape, axis] of [[[6, 60], 0], [[6, 60], 1], [[3, 20, 6], 0], [[3, 20, 6], 1], [[3, 20, 6], 2], [[360], 0]] as [number[], number][]) {
        for (const lazy of [false, true]) {
            it(`real ${shape.join('x')} axis ${axis}${lazy ? ' lazy' : ''}`, () => {
                const got = sum(reals, shape, axis, lazy), want = expected(reals, shape, axis, false);
                expect(Array.isArray(got) ? got : [got]).toEqual(want);
            });
            it(`integer ${shape.join('x')} axis ${axis}${lazy ? ' lazy' : ''}`, () => {
                const got = sum(ints, shape, axis, lazy), want = expected(ints, shape, axis, true);
                expect(Array.isArray(got) ? got : [got]).toEqual(want);
            });
        }
    }
});
