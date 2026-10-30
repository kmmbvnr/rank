import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';

const mod = (x: bigint, m: bigint) => ((x % m) + m) % m;

function run(program: string, vars: Record<string, Int32Array> = {}) {
    const runtime = new Interpreter();
    try {
        for (const [name, cells] of Object.entries(vars)) runtime.variables.set(name, typedArray(cells, [cells.length]));
        const result = runtime.execute(`use numbers\n${program}`);
        if (result && isRankArray(result)) return Array.from({ length: result.shape[0] }, (_, i) => readArrayItem(result, i));
        return result;
    } finally { runtime.dispose(); }
}

function reference(a: ArrayLike<number>, b: ArrayLike<number>, m?: bigint) {
    const out: bigint[] = new Array(a.length + b.length - 1).fill(0n);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += BigInt(a[i]) * BigInt(b[j]);
    return m === undefined ? out : out.map(x => mod(x, m));
}

const vector = (n: number, seed: number, range: number) =>
    Int32Array.from({ length: n }, (_, i) => ((i * 7919 + seed * 104729) * 31 + i * i) % (2 * range + 1) - range);

describe('convolve', () => {
    it('multiplies polynomials exactly', () => {
        expect(run('(array 1 2 3) convolve (array 4 5 6 7)')).toEqual([4n, 13n, 28n, 34n, 32n, 21n]);
    });
    it('keeps integers wider than 64 bits', () => {
        const big = 10n ** 20n;
        expect(run(`A = array ${big} 1\nA convolve A`)).toEqual([big * big, 2n * big, 1n]);
    });
    it('rejects reals and matrices', () => {
        expect(() => run('(array 1.5 2.5) convolve (array 1 2)')).toThrow(/integer/);
        expect(() => run('use sequences\n((array 1 2 3 4) reshape 2 2) convolve (array 1 2)')).toThrow(/vectors/);
    });
    it('requires use numbers', () => {
        const runtime = new Interpreter();
        try { expect(() => runtime.execute('((array 1 2) convolve (array 3 4)) mod 7')).toThrow(/numbers/); } finally { runtime.dispose(); }
    });
});

describe('convolve mod', () => {
    const moduli = [1n, 2n, 7n, 998244353n, 1000000007n, 1073741824n, 1073741827n, 2147483647n, 2147483648n];
    const sizes: [number, number][] = [[1, 1], [1, 9], [5, 7], [33, 40], [64, 64], [100, 129], [300, 257], [1000, 3]];
    for (const m of moduli) {
        for (const [p, q] of sizes) {
            it(`mod ${m}, ${p} x ${q}`, () => {
                const a = vector(p, 1, 2 ** 30);
                const b = vector(q, 2, 2 ** 30);
                expect(run(`(A convolve B) mod ${m}`, { A: a, B: b })).toEqual(reference(a, b, m));
            });
        }
    }
    it('takes the extreme residues without overflow', () => {
        const m = 2147483648n;
        const a = new Int32Array(2000).fill(2147483647);
        expect(run(`(A convolve A) mod ${m}`, { A: a })).toEqual(reference(a, a, m));
    });
    it('parses without parentheses', () => {
        const a = vector(200, 3, 1000);
        const b = vector(150, 4, 1000);
        expect(run('R = A convolve B mod 1000003\nR', { A: a, B: b })).toEqual(reference(a, b, 1000003n));
    });
    it('declines a modulus past 2^31 to the exact path', () => {
        const a = vector(60, 5, 1000);
        const b = vector(70, 6, 1000);
        const m = 2n ** 40n + 15n;
        expect(run(`(A convolve B) mod ${m}`, { A: a, B: b })).toEqual(reference(a, b, m));
    });
    it('squares a vector as the Kitamasa step does', () => {
        const a = vector(5000, 7, 1000000006);
        const out = run('(A convolve A) mod 1000000007', { A: a }) as bigint[];
        const m = 1000000007n;
        const spot = [0, 1, 4998, 4999, 5000, 9997, 9998];
        const full = reference(a, a);
        expect(out.length).toBe(9999);
        for (const k of spot) expect(out[k]).toBe(mod(full[k], m));
    });
});
