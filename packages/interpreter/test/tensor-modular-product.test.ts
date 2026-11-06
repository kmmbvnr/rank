import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, formatValue } from '../src/index.js';
import { typedArray, readArrayItem } from '../src/array-storage.js';
import { InterruptedError, withInterrupt, withDemandBudget, DemandBudgetExhausted } from '../src/interrupt.js';
const size = 4096;
const edge = [-9007199254740991n, -1073741824n, -1n, 0n, 1n, 1000000006n, 9007199254740991n];
const values = Array.from({ length: size }, (_, i) => i < edge.length ? edge[i] : BigInt((i * 2654435761) | 0));
const other = values.map((_, i) => values[(i * 7 + 3) % size]);
const mod = (a: bigint, m: bigint) => { const r = a % m; return r && (r < 0n) !== (m < 0n) ? r + m : r; };
function runtime(compilation = true) {
    const r = new Interpreter(() => {}, { compilation, numberLoopCompilation: false, scalarFunctionCompilation: false });
    r.variables.set('A', typedArray(BigInt64Array.from(values)));
    r.variables.set('B', typedArray(BigInt64Array.from(other)));
    return r;
}
function cells(r: Interpreter, source: string): unknown[] {
    const result = r.execute(`use sequences\n${source}`);
    if (result === undefined || !isRankArray(result)) throw Error('expected array');
    return Array.from({ length: result.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(result, i));
}
describe('exact modular products in tensor copy kernels', () => {
    it.each([1n, 2n, 17n, 94906267n, 1000000007n, 1073741824n, -17n, 1073741825n, 9007199254740993n])(
        'matches BigInt products for modulus %s', modulus => {
            const r = runtime();
            try {
                expect(cells(r, `Saved = A * B mod ${modulus}\nSaved`))
                    .toEqual(values.map((a, i) => mod(a * other[i], modulus)));
                expect(cells(r, `A * -9007199254740991 mod ${modulus}`))
                    .toEqual(values.map(a => mod(a * -9007199254740991n, modulus)));
                expect(cells(r, `9007199254740991 * B mod ${modulus}`))
                    .toEqual(other.map(a => mod(9007199254740991n * a, modulus)));
            } finally { r.dispose(); }
        });
    it('reuses compiled kernels across supported, unsupported and zero moduli', () => {
        const r = runtime();
        try {
            r.execute('use sequences\nfun A probe M\n  return (A * A mod M) copy\nend');
            for (const m of [17n, -17n, 1n << 70n, 1000000007n]) {
                r.variables.set('M', m);
                expect(cells(r, 'A probe M')).toEqual(values.map(a => mod(a * a, m)));
            }
            r.variables.set('M', 0n);
            expect(() => r.execute('A probe M')).toThrow();
        } finally { r.dispose(); }
    });
    it.each([
        '(A + B) * (A - B) mod 1000000007',
        'A * (B mod 17) mod 1000000007',
        '(A (4095 to 0 by -1)) * B mod 1000000007',
        '(A reshape 64 64) * (B reshape 64 64) mod ((1 to 64 array) reshape 1 64)',
        'A * B mod (array 17)',
        '(array 1 2) * (array 3 4) mod ((array 17 19 23 29) reshape 2 2)',
        '(array 9007199254740993 2) * (array 4 5) mod 17',
        '(array 1.5 2.5) * (array 3 4) mod 17',
    ])('preserves exact replay and layouts: %s', expression => {
        const a = runtime(), b = runtime(false);
        try {
            const observe = (r: Interpreter) => { try { return { value: formatValue(r.execute(`use sequences\n${expression}`)!) }; }
                catch (error) { return { error: String(error) }; } };
            expect(observe(a)).toEqual(observe(b));
        } finally { a.dispose(); b.dispose(); }
    });
    it('keeps snapshots independent when the destination aliases an input', () => {
        const r = runtime();
        try {
            r.execute('Saved = A\nA = A * B mod 1000000007');
            expect(cells(r, 'Saved')).toEqual(values);
            expect(cells(r, 'A')).toEqual(values.map((a, i) => mod(a * other[i], 1000000007n)));
        } finally { r.dispose(); }
    });
    it('retains cancellation and demand budgets', () => {
        const r = runtime();
        try {
            expect(() => withInterrupt(new Int32Array([1]), () => r.execute('A * B mod 17'))).toThrow(InterruptedError);
            expect(() => withDemandBudget(1, () => r.execute('A * B mod 17'))).toThrow(DemandBudgetExhausted);
        } finally { r.dispose(); }
    });
});
