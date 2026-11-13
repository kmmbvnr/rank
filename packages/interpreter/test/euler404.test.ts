import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/404_crazyellipses.ra', import.meta.url), 'utf8');
function solve(limit: bigint, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--n=${limit}`] });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        return { answer: answerOf(runtime), diagnostics };
    } finally { runtime.dispose(); }
}
// Enumerate the original geometry, independently of coprime conic parameters.
function enumerate(limit: bigint) {
    let total = 0n;
    for (let a = 1n; a <= limit; a++) for (let b = a + 1n; b < 2n * a; b++) {
        const numerator = 4n * a * a * b * b, denominator = 5n * b * b - 4n * a * a;
        if (numerator % denominator) continue;
        const square = numerator / denominator;
        let c = BigInt(Math.floor(Math.sqrt(Number(square))));
        while ((c + 1n) * (c + 1n) <= square) c++;
        while (c * c > square) c--;
        if (c * c === square && b < c && c < 2n * a) total++;
    }
    return total;
}

describe.each([false, true])('Euler 404 (compilation=%s)', compilation => {
    it('matches independent geometry at zero and first-family boundaries', () => {
        for (const n of [0n, 1n, 208n, 209n, 210n, 500n, 1000n]) {
            expect(solve(n, compilation).answer, `N=${n}`).toBe(enumerate(n));
        }
    });
    it('keeps the published statement examples', () => {
        expect(solve(10000n, compilation).answer).toBe(106n);
        expect(solve(1000000n, compilation).answer).toBe(11845n);
    });
    it('keeps the full exact golden value', () => {
        const result = solve(100000000000000000n, compilation);
        expect(result.answer).toBe(1199215615081353n);
        if (compilation) {
            expect(result.diagnostics.compiledLoops).toBe(1);
            expect(result.diagnostics.mixedIntegerLoops).toBe(1);
            expect(result.diagnostics.typedArrayPublishedCells).toBeLessThan(100000);
        }
    }, 120000);
});
