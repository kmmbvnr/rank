import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/408_admissiblepaths.ra', import.meta.url), 'utf8');
function solve(limit: number, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--n=${limit}`] }), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        return { answer: runtime.variables.get('Answer'), count: runtime.variables.get('Count'),
            x: formatValue(runtime.variables.get('X')!), y: formatValue(runtime.variables.get('Y')!), diagnostics };
    } finally { runtime.dispose(); }
}
// Independent rolling grid DP: visit every cell, not parameterized triples.
function enumerate(n: number) {
    const square = (value: number) => Number.isInteger(Math.sqrt(value));
    const paths = Array<bigint>(n + 1).fill(0n), x: number[] = [], y: number[] = [];
    paths[0] = 1n;
    for (let column = 0; column <= n; column++) for (let row = 0; row <= n; row++) {
        if (column > 0 && row > 0 && square(column) && square(row) && square(column + row)) {
            paths[row] = 0n; x.push(column); y.push(row);
        } else if (row > 0) paths[row] = (paths[row] + paths[row - 1]) % 1000000007n;
    }
    return { answer: paths[n], count: BigInt(x.length), x: x.join(' '), y: y.join(' ') };
}

describe.each([false, true])('Euler 408 (compilation=%s)', compilation => {
    it('matches every grid cell at empty, square and first-forbidden-point boundaries', () => {
        for (const n of [0, 1, 5, 8, 9, 15, 16, 17, 25, 36, 64, 100, 1000]) {
            const { diagnostics: _, ...result } = solve(n, compilation);
            expect(result, `N=${n}`).toEqual(enumerate(n));
        }
    });
    it('retains statement examples', () => {
        expect(solve(5, compilation).answer).toBe(252n);
        expect(solve(16, compilation).answer).toBe(596994440n);
        expect(solve(1000, compilation).answer).toBe(341920854n);
    });
    it('retains the full default answer without overflow replay', () => {
        const result = solve(10000000, compilation);
        expect(result.answer).toBe(299742733n);
        expect(result.count).toBe(7850n);
        if (compilation) {
            expect(result.diagnostics.numberLoops).toBe(1);
            expect(result.diagnostics.numberLoopOverflows).toBe(0);
            expect(result.diagnostics.typedArrayPublishedCells).toBeLessThan(80000000);
        }
    }, 120000);
});
