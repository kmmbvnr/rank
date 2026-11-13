import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/417_reciprocalcycles.ra', import.meta.url), 'utf8');
// Decimal long division is independent of the sieve/order recurrence.
const expected = [0n];
for (let denominator = 1; denominator <= 1000; denominator++) {
    const seen = new Int32Array(denominator).fill(-1);
    let remainder = 1 % denominator, position = 0;
    while (remainder && seen[remainder] === -1) {
        seen[remainder] = position++;
        remainder = remainder * 10 % denominator;
    }
    expected.push(expected.at(-1)! + BigInt(remainder ? position - seen[remainder] : 0));
}
function run(n: number, options: InterpreterOptions = {}) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        return { answer: answerOf(runtime), diagnostics };
    } finally { runtime.dispose(); }
}
describe('Euler 417 reciprocal cycles', () => {
    it.each([0, 1, 2, 3, 10, 25, 81, 125, 200, 997, 1000])('matches long division through %s', n => {
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            expect(run(n, options).answer).toBe(expected[n]);
        }
    });
    it('matches the published million checkpoint', () => {
        expect(run(1000000).answer).toBe(55535191115n);
    });
    it('retains the full answer with both main loops in Number mode', () => {
        const result = run(100000000);
        expect(result.answer).toBe(446572970925740n);
        expect(result.diagnostics.numberLoops).toBe(2);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
        expect(result.diagnostics.costs['number-loop.snapshot']?.copiedBytes ?? 0).toBe(0);
    }, 120_000);
});
