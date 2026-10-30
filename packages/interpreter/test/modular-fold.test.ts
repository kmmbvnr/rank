import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';

const n = (s: readonly number[]) => s.reduce((a, b) => a * b, 1);
const mod = (x: bigint, m: bigint) => ((x % m) + m) % m;

function run(program: string, cells?: Int32Array, shape?: number[]) {
    const runtime = new Interpreter();
    try {
        if (cells) runtime.variables.set('X', typedArray(cells, shape!));
        const result = runtime.execute(`use sequences\n${program}`);
        if (result && isRankArray(result)) return Array.from({ length: n(result.shape) }, (_, i) => readArrayItem(result, i));
        return result;
    } finally { runtime.dispose(); }
}

/** Exact fold of each lane along `axis`, reduced at the end. */
function scan(op: '+' | '*', cells: ArrayLike<number>, shape: number[], axis: number, m: bigint, seed?: bigint) {
    const len = shape[axis], inner = n(shape.slice(axis + 1)), outer = n(shape.slice(0, axis));
    const grow = seed === undefined ? 0 : 1;
    const out: bigint[] = new Array(outer * (len + grow) * inner);
    for (let o = 0; o < outer; o++) for (let i = 0; i < inner; i++) {
        let acc = seed;
        if (seed !== undefined) out[(o * (len + 1)) * inner + i] = mod(seed, m);
        for (let k = 0; k < len; k++) {
            const x = BigInt(cells[(o * len + k) * inner + i]);
            acc = acc === undefined ? x : op === '+' ? acc + x : acc * x;
            out[(o * (len + grow) + k + grow) * inner + i] = mod(acc, m);
        }
    }
    return out;
}

const cells = Int32Array.from({ length: 120 }, (_, i) => (i * 7919) % 2001 - 1000);

describe('modular scan and reduce', () => {
    for (const m of [7n, 1000003n, 1008691207n, 2147483647n, 2147483648n]) {
        for (const op of ['+', '*'] as const) {
            for (const [shape, axis] of [[[120], 0], [[6, 20], 0], [[6, 20], 1], [[2, 3, 20], 1]] as [number[], number][]) {
                for (const seed of [undefined, 3n, -5n]) {
                    it(`scan ${op} mod ${m} ${shape} axis ${axis} seed ${seed}`, () => {
                        const withSeed = seed === undefined ? '' : ` with (${seed < 0n ? '0 - ' : ''}${seed < 0n ? -seed : seed})`;
                        expect(run(`(X scan ${op} axis ${axis}${withSeed}) mod ${m}`, cells, shape))
                            .toEqual(scan(op, cells, shape, axis, m, seed));
                    });
                }
            }
            it(`reduce ${op} mod ${m}`, () => {
                const last = scan(op, cells, [120], 0, m).at(-1);
                expect(run(`(X reduce ${op}) mod ${m}`, cells, [120])).toBe(last);
                const seeded = scan(op, cells, [120], 0, m, 4n).at(-1);
                expect(run(`(X reduce ${op} with 4) mod ${m}`, cells, [120])).toBe(seeded);
            });
        }
    }

    it('parses without parentheses', () => {
        expect(run('X scan * with 1 mod 1000', cells, [120])).toEqual(run('(X scan * with 1) mod 1000', cells, [120]));
        expect(run('M = 1000\nX scan * mod M', cells, [120])).toEqual(scan('*', cells, [120], 0, 1000n));
    });

    it('folds a range without materializing exact products', () => {
        const m = 1008691207n;
        let f = 1n;
        const want = [1n];
        for (let k = 1n; k <= 3000n; k++) want.push(f = (f * k) % m);
        expect(run(`1 to 3000 scan * with 1 mod ${m}`)).toEqual(want);
        expect(run(`1 to 3000 reduce * mod ${m}`)).toBe(want.at(-1));
        expect(run('1 till 6 scan + mod 4')).toEqual([1n, 3n, 2n, 2n, 3n]);
        expect(run('-3 to 3 scan * mod 5')).toEqual([2n, 1n, 4n, 0n, 0n, 0n, 0n]);
    });

    it('keeps the ordinary result where the fold declines', () => {
        const big = 2n ** 40n;
        expect(run(`1 to 30 reduce * mod ${big}`)).toBe(mod(Array.from({ length: 30 }, (_, i) => BigInt(i + 1)).reduce((a, b) => a * b), big));
        expect(() => run('1 to 6 reduce * mod 0')).toThrow('division by zero');
    });
});
