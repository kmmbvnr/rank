import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';

const pool = [0, -0, 1.5, -2.25, 3, NaN, Infinity, -Infinity, 1e300, 0.1];
const fill = (n: number, seed: number) => Float64Array.from({ length: n }, (_, i) => pool[(i * 7 + seed * 3 + (i >> 3)) % pool.length]);
const pick = { min: (a: number, b: number) => a < b ? a : b, max: (a: number, b: number) => a > b ? a : b };

function run(name: string, left: Float64Array | number, ls: number[], right: Float64Array | number, rs: number[], size: number): number[] {
    const runtime = new Interpreter();
    try {
        if (typeof left !== 'number') runtime.variables.set('A', typedArray(left, ls));
        if (typeof right !== 'number') runtime.variables.set('B', typedArray(right, rs));
        const result = runtime.execute(`${typeof left === 'number' ? `(${left}.0)` : 'A'} ${name} ${typeof right === 'number' ? `(${right}.0)` : 'B'}`);
        if (!result || !isRankArray(result)) throw Error('expected array');
        return Array.from({ length: size }, (_, i) => readArrayItem(result, i) as number);
    } finally { runtime.dispose(); }
}

describe('real min and max over stored arrays', () => {
    for (const name of ['min', 'max'] as const) {
        const f = pick[name];
        it(`${name} same shape`, () => {
            const a = fill(300, 1), b = fill(300, 2);
            const got = run(name, a, [300], b, [300], 300);
            got.forEach((x, i) => expect(Object.is(x, f(a[i], b[i]))).toBe(true));
        });
        it(`${name} with a scalar on either side`, () => {
            const a = fill(300, 3);
            for (const s of [0, 2, -3]) {
                run(name, a, [300], s, [], 300).forEach((x, i) => expect(Object.is(x, f(a[i], s))).toBe(true));
                run(name, s, [], a, [300], 300).forEach((x, i) => expect(Object.is(x, f(s, a[i]))).toBe(true));
            }
        });
        for (const [ls, rs] of [[[1, 80], [5, 1]], [[5, 1], [1, 80]], [[80], [5, 80]], [[5, 80], [5, 1]], [[3, 1, 20], [4, 1]], [[2, 3, 30], [30]]] as number[][][]) {
            it(`${name} broadcast ${ls.join('x')} with ${rs.join('x')}`, () => {
                const n = (s: number[]) => s.reduce((x, y) => x * y, 1);
                const a = fill(n(ls), 4), b = fill(n(rs), 5);
                const rank = Math.max(ls.length, rs.length);
                const out = Array.from({ length: rank }, (_, k) => Math.max(ls.at(k - rank) ?? 1, rs.at(k - rank) ?? 1));
                const at = (s: number[], idx: number[]) => s.reduce((acc, d, k) => acc * d + (d === 1 ? 0 : idx[rank - s.length + k]), 0);
                const got = run(name, a, ls, b, rs, n(out));
                got.forEach((x, i) => {
                    const idx = out.map((_, k) => Math.floor(i / out.slice(k + 1).reduce((p, q) => p * q, 1)) % out[k]);
                    expect(Object.is(x, f(a[at(ls, idx)], b[at(rs, idx)]))).toBe(true);
                });
            });
        }
    }
});
