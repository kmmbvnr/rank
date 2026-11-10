import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, type InterpreterOptions } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/581_smoothtriangular.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler581-original.ra', import.meta.url), 'utf8');
const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
// Factor each consecutive integer directly. This oracle uses no Pell
// equations, continued fractions, smooth-number generation or gcd power.
const limit = 20000, prefix = new Float64Array(2 * limit + 1);
function smooth(n: number) {
    for (const p of primes) while (n % p === 0) n /= p;
    return n === 1;
}
for (let n = 1; n < prefix.length; n++) prefix[n] = prefix[n - 1] + (smooth(n) && smooth(n + 1) ? n : 0);
function run(b: number | bigint, options: InterpreterOptions = {}, text = source) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--b=${b}`] });
    try { runtime.execute(text); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
describe.each([{}, { compilation: false }, { scalarFunctionCompilation: false, numberLoopCompilation: false }])('Euler 581 %j', options => {
    it.each([-5, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 23, 24, 25, 26, 47, 48, 49, 50,
        99, 100, 101, 999, 1000, 5000, 10000, 20000])('matches direct smooth-triangle checks at bound %s', b => {
        expect(run(b, options)).toBe(BigInt(prefix[2 * Math.max(0, b)]));
    });
    it('retains the exact full golden', () => expect(run(10000000000000n, options)).toBe(2227616372734n), 30000);
});
it.each([1000, 1000000, 1000000000])('matches the old sorted-neighbour search at bound %s', b => {
    expect(run(b)).toBe(run(b, {}, original));
}, 30000);
it.each([[1000, 216276n], [10000000000000, 2227616372734n]] as const)('compiles every admitted subtotal with exact wide captures at bound %s', (bound, expected) => {
    let calls = 0;
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { args: [`--b=${bound}`], onScalarFunctionExecuted: () => calls++ });
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(runtime.variables.get('Answer')).toBe(expected);
        const parts = runtime.variables.get('Parts');
        if (!parts || !isRankArray(parts)) throw Error('expected squarefree parts');
        expect(calls).toBeGreaterThanOrEqual(parts.shape[0]);
        expect(diagnostics.compilerRejections.filter(item => item.function === 'subtotal')).toEqual([]);
    } finally { runtime.dispose(); }
});
