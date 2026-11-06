import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {Interpreter, isRankArray} from '../src/index.js';
import {readArrayItem} from '../src/array-storage.js';
import {connectedCounts, squareTotal, bruteConnected} from '../../../benchmarks/experiments/euler434-oracle.mjs';
const source = readFileSync(new URL('../../../demos/euler/434_rigidgrid.ra', import.meta.url), 'utf8');
const expected = connectedCounts(65);
const modes = [{}, {numberLoopCompilation: false}, {compilation: false}];

describe('Euler 434 normalized convolution rows', () => {
    it('agrees with exhaustive edge subsets on every graph up to 4 by 4', () => {
        for (let m = 1; m <= 4; m++) for (let n = 1; n <= 4; n++) expect(expected[m][n]).toBe(bruteConnected(m, n));
    });
    it.each([0, 1, 2, 3, 4, 5, 8, 10, 12, 25, 31, 32, 63, 64, 65])(
        'matches the independent component recurrence at N=%s', n => {
            for (const options of modes) {
                const runtime = new Interpreter(() => {}, {...options, args: [`--n=${n}`]});
                try {
                    runtime.execute(source);
                    expect(runtime.variables.get('Answer')).toBe(squareTotal(expected, n));
                    const rows = runtime.variables.get('Rg');
                    if (!rows || !isRankArray(rows)) throw Error('expected matrix');
                    expect(rows.shape).toEqual([n + 1, n + 1]);
                    for (let m = 1; m <= n; m++) for (let q = 1; q <= n; q++) expect(readArrayItem(rows, m * (n + 1) + q)).toBe(expected[m][q]);
                } finally { runtime.dispose(); }
            }
        });
    it.each(modes)('keeps the full default golden answer (%j)', options => {
        const runtime = new Interpreter(() => {}, options);
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(863253606n);
        } finally { runtime.dispose(); }
    }, 30000);
});
