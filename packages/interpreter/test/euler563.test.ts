import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, type InterpreterOptions, type RankValue } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
const source = readFileSync(new URL('../../../demos/euler/563_robotwelders.ra', import.meta.url), 'utf8');
const { solve: oracle } = await import(new URL('../../../benchmarks/euler563-oracle.mjs', import.meta.url).href);
function solve(limit: number, k: number, options: InterpreterOptions = {}) {
    const r = new Interpreter(() => {}, { ...options, args: [`--l=${limit}`, `--k=${k}`] });
    try { r.execute(source); return r.variables.get('Answer'); } finally { r.dispose(); }
}
const small = [[1, 0], [1, 1], [486, 2], [500, 2], [600, 2], [1038, 3], [1100, 3], [2000, 3]].map(([limit, k]) => ({ limit, k, answer: oracle(limit, k).answer }));
for (const options of [{}, { compilation: false }, { numberLoopCompilation: false }]) describe(`Euler 563 ${JSON.stringify(options)}`, () => {
    it.each(small)('matches independent side enumeration at L=$limit K=$k', ({ limit, k, answer }) => {
        expect(solve(limit, k, options)).toBe(answer);
    });
    it.each([[3000000, 3, 1083240n], [3000000, 10, 3813201480n], [60000000, 100, 27186308211734760n]])('retains L=%s K=%s', (limit, k, answer) => {
        expect(solve(limit, k, options)).toBe(answer);
    }, 30000);
    it.each([[485, 2], [1037, 3], [1000, 100]])('rejects incomplete searches at L=%s K=%s', (limit, k) => {
        expect(oracle(limit, k).complete).toBe(false);
        expect(() => solve(limit, k, options)).toThrow(/increase L/);
    });
    it.each([[0, 2], [-1, 2], [500, -1]])('rejects invalid bounds L=%s K=%s', (limit, k) => {
        expect(() => solve(limit, k, options)).toThrow(/invalid bounds/);
    });
});
function cells(value: RankValue): bigint[] {
    if (!isRankArray(value)) throw Error('expected array');
    return Array.from({ length: value.shape[0] }, (_, i) => readArrayItem(value, i) as bigint);
}
it('adaptive bands keep every pair and never split an equal-area group', () => {
    const r = new Interpreter(() => {});
    try {
        r.execute(source.split('Empty = End max 1')[0].replace('arg L integer = 60000000', 'arg L integer = 1100').replace('arg K integer = 100', 'arg K integer = 3'));
        r.execute('Batch = 64');
        const smooth = cells(r.variables.get('Smooth')!);
        const end = r.variables.get('End') as bigint, actual = new Map<bigint, number>();
        let low = 1n, passes = 0;
        while (low < end) {
            r.variables.set('Low', low);
            r.execute('Band = Low pairBand End');
            const high = r.execute('Band .high') as bigint;
            const sides = cells(r.execute('Band .sides')!), first = cells(r.execute('Band .first')!), counts = cells(r.execute('Band .counts')!);
            expect(high).toBeGreaterThan(low); expect(high).toBeLessThanOrEqual(end);
            const size = counts.reduce((a, b) => a + b, 0n);
            expect(size <= 64n || high === low + 1n).toBe(true);
            for (let i = 0; i < counts.length; i++) for (let j = 0n; j < counts[i]; j++) {
                const area = sides[i] * smooth[Number(first[i] + j)];
                expect(area >= low && area < high).toBe(true);
                actual.set(area, (actual.get(area) ?? 0) + 1);
            }
            low = high;
            expect(++passes).toBeLessThan(1000);
        }
        const expected = new Map<bigint, number>([...oracle(1100, 3).counts].map(([area, count]: [number, number]) => [BigInt(area), count]));
        expect(actual).toEqual(expected);
        r.execute('Batch = 1\nBand = 194040 pairBand 194041');
        const indivisible = cells(r.execute('Band .counts')!);
        expect(indivisible.reduce((a, b) => a + b, 0n)).toBe(2n);
        expect(r.execute('Band .high')).toBe(194041n);
    } finally { r.dispose(); }
});
it('uses ordered numeric frequency kernels in complete area bands', () => {
    const d = new RuntimeDiagnostics(), r = new Interpreter(() => {}, { args: ['--l=3000000', '--k=10'] });
    try {
        d.run(() => r.execute(source));
        expect(r.variables.get('Answer')).toBe(3813201480n);
        expect(d.numericSortedCounts).toBeGreaterThan(0);
        expect(d.sortedIndexBatches).toBeGreaterThan(0);
    } finally { r.dispose(); }
});
