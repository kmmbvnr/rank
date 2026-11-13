import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, demandValue, isRankArray, type InterpreterOptions, type NativeFunction } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/562_maximalperimeter.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler562-original.ra', import.meta.url), 'utf8');
const { solve: oracle } = await import(new URL('../../../benchmarks/euler562-oracle.mjs', import.meta.url).href);
const small = Array.from({ length: 8 }, (_, i) => ({ radius: i + 1, answer: oracle(i + 1).answer }));
function solve(radius: number, options: InterpreterOptions = {}, band = 2000000, text = source) {
    const r = new Interpreter(() => {}, { ...options, args: [`--r=${radius}`, `--dm=${band}`] });
    try { r.execute(text); return { answer: answerOf(r), norm: r.variables.get('Norm'), q: r.variables.get('Q') }; }
    finally { r.dispose(); }
}
for (const options of [{}, { compilation: false }, { numberLoopCompilation: false }]) describe(`Euler 562 ${JSON.stringify(options)}`, () => {
    it.each(small)('matches independent triangle enumeration at R=$radius', ({ radius, answer }) => {
        expect(solve(radius, options).answer).toBe(answer);
    });
    it.each([[10, 97n], [100, 9158n], [1000, 475723n], [10000000, 51208732914368n]])('retains R=%s', (radius, answer) => {
        expect(solve(radius, options).answer).toBe(answer);
    }, 15000);
    it('includes the last permitted loss without exceeding the band', () => {
        const result = solve(10000000, options, 2718);
        expect(result).toEqual({ answer: 51208732914368n, norm: 399999999997282n, q: 60298508117635n });
        expect(() => solve(10000000, options, 2717)).toThrow(/no triangle in search band/);
    }, 15000);
    it('retains the old geometry search on further small radii', () => {
        for (const radius of [9, 11, 13, 17, 23, 31, 50])
            expect(solve(radius, options, 200).answer).toBe(solve(radius, { compilation: false }, 200, original).answer);
    });
    it.each([[0, 10], [-1, 10], [1, 0], [1, -1]])('rejects radius %s band %s', (radius, band) => {
        expect(() => solve(radius, options, band)).toThrow(/positive radius and band/);
    });
    it('recovers every small primitive orientation and its determinant-one triangle', () => {
        const r = new Interpreter(() => {}, options);
        try {
            r.execute(source.split("Losses'")[0]);
            r.variables.set('Bound', 500n);
            const orientation = r.variables.get('orientation') as NativeFunction;
            for (let n = 2n; n <= 500n; n++) {
                for (let q = 1n; q <= n / 2n; q++) {
                    if ((q * q + 1n) % n !== 0n) continue;
                    // Both other squared sides are <= n, so the origin,
                    // edge and third vertex fit inside this larger circle.
                    expect(demandValue(orientation.call([n, q])), `norm ${n}, root ${q}`).toBe(q);
                }
            }
        } finally { r.dispose(); }
    }, 15000);
    it('enumerates every canonical modular root for small norms', () => {
        const r = new Interpreter(() => {}, options);
        try {
            r.execute(source.split("Losses'")[0]);
            const roots = r.variables.get('roots') as NativeFunction;
            for (let n = 2n; n <= 500n; n++) {
                const result = demandValue(roots.call([n]));
                if (!isRankArray(result)) throw Error('roots must be an array');
                const actual = Array.from({ length: result.shape[0] }, (_, i) => readArrayItem(result, i) as bigint).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
                const expected: bigint[] = [];
                for (let q = 1n; q <= n / 2n; q++) if ((q * q + 1n) % n === 0n) expected.push(q);
                expect(actual, `norm ${n}`).toEqual(expected);
            }
        } finally { r.dispose(); }
    }, 15000);
});
