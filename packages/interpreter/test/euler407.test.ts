import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/407_idempotents.ra', import.meta.url), 'utf8');
function solve(limit: number, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--n=${limit}`] });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        return { answer: answerOf(runtime), diagnostics };
    } finally { runtime.dispose(); }
}
function enumerate(limit: number) {
    let total = 0;
    for (let n = 2; n <= limit; n++) {
        let largest = 1;
        for (let a = 2; a < n; a++) if (a * a % n === a) largest = a;
        total += largest;
    }
    return BigInt(total);
}
describe.each([false, true])('Euler 407 (compilation=%s)', compilation => {
    it('matches exhaustive idempotents at empty, prime-power and mixed-factor bounds', () => {
        for (const n of [0, 1, 2, 3, 4, 6, 8, 9, 12, 25, 36, 49, 64, 100, 209, 1000]) {
            expect(solve(n, compilation).answer, `N=${n}`).toBe(enumerate(n));
        }
    });
    it('retains the full golden answer', () => {
        const result = solve(10000000, compilation);
        expect(result.answer).toBe(39782849136421n);
        if (compilation) {
            expect(result.diagnostics.numberLoops).toBe(1);
            expect(result.diagnostics.numberLoopCopyProbes).toBe(0);
            expect(result.diagnostics.numberLoopOverflows).toBe(0);
            expect(result.diagnostics.typedArrayPublishedCells).toBeLessThan(30000000);
        }
    }, 120000);
});
