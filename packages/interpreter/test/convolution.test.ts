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
    const moduli = [1n, 2n, 7n, 998244353n, 1004535809n, 1000000007n, 1073741824n, 1073741827n, 2147483647n, 2147483648n];
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


it('retains exact roots across repeated and evicted transform lengths', () => {
    const modulus = 1000000033n;
    for (const size of [101, 101, 5000, 101, 257, 101]) {
        const a = new Int32Array(size).fill(Number(modulus - 1n));
        const b = new Int32Array(size).fill(Number(modulus - 2n));
        const expected = Array.from({length: size * 2 - 1}, (_, i) =>
            BigInt(2 * Math.min(i + 1, size * 2 - 1 - i, size)));
        expect(run(`A convolve B mod ${modulus}`, {A: a, B: b})).toEqual(expected);
    }
});

it('keeps demand checkpoints and input buffers unchanged with warm roots', async () => {
    const {withDemandBudget, DemandBudgetExhausted} = await import('../src/interrupt.js');
    const {modularConvolve} = await import('../src/convolution.js');
    const a = {cells: Int32Array.from({length: 101}, (_, i) => i + 1), shape: [101]};
    const b = {cells: Int32Array.from({length: 101}, (_, i) => i + 3), shape: [101]};
    const beforeA = a.cells.slice(), beforeB = b.cells.slice();
    const call = () => modularConvolve(a, b, 1000000033);
    expect(() => withDemandBudget(1, call)).toThrow(DemandBudgetExhausted);
    expect(call()).toBeDefined();
    expect(() => withDemandBudget(1, call)).toThrow(DemandBudgetExhausted);
    expect(a.cells).toEqual(beforeA);
    expect(b.cells).toEqual(beforeB);
});


it('checks arbitrary transform moduli, cached roots and unsupported lengths', () => {
    // More than three small moduli exercise eviction; 257 cannot support 512.
    for (const [m, size] of [[257, 65], [3329, 65], [40961, 65], [65537, 65],
        [257, 65], [257, 130], [769, 65], [197633, 65], [1004535809, 130],
        [1004535809, 65], [998244353, 130]]) {
        const a = vector(size, 17, 2 ** 30), b = vector(size + 1, 19, 2 ** 30);
        expect(run(`A convolve B mod ${m}`, { A: a, B: b })).toEqual(reference(a, b, BigInt(m)));
        expect(run(`A convolve A mod ${m}`, { A: a })).toEqual(reference(a, a, BigInt(m)));
    }
});

it('preserves demand limits after a direct transform warms its roots', async () => {
    const {withDemandBudget, DemandBudgetExhausted} = await import('../src/interrupt.js');
    const {modularConvolve} = await import('../src/convolution.js');
    const a = {cells: vector(101, 23, 2 ** 30), shape: [101]};
    const b = {cells: vector(101, 29, 2 ** 30), shape: [101]};
    const savedA = a.cells.slice(), savedB = b.cells.slice();
    const call = () => modularConvolve(a, b, 1004535809);
    expect(() => withDemandBudget(1, call)).toThrow(DemandBudgetExhausted);
    expect(call()).toBeDefined();
    expect(() => withDemandBudget(1, call)).toThrow(DemandBudgetExhausted);
    // Three primes, three transforms each, eight levels of 256 cells.
    expect(() => withDemandBudget(10000, call)).toThrow(DemandBudgetExhausted);
    expect(withDemandBudget(18432, call)).toBeDefined();
    expect(a.cells).toEqual(savedA);
    expect(b.cells).toEqual(savedB);
});


it('cancels a direct transform without changing its inputs', async () => {
    const {withInterrupt, InterruptedError} = await import('../src/interrupt.js');
    const {modularConvolve} = await import('../src/convolution.js');
    const a = {cells: vector(1025, 31, 2 ** 30), shape: [1025]};
    const before = a.cells.slice();
    const call = () => modularConvolve(a, a, 1004535809);
    expect(() => withInterrupt(new Int32Array([1]), call)).toThrow(InterruptedError);
    expect(a.cells).toEqual(before);
    expect(call()).toBeDefined();
});
