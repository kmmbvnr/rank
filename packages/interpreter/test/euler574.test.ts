import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, RuntimeDiagnostics, type InterpreterOptions } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/574_verifyingprimes.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler574-original.ra', import.meta.url), 'utf8');
function primes(limit: number) {
    const result: number[] = [];
    for (let n = 2; n < limit; n++) if (result.every(p => n % p !== 0)) result.push(n);
    return result;
}
// Directly test the defining coprimality and prime-divisibility conditions,
// without constructing CRT weights or combining subset sums.
function minimum(prime: number) {
    const small = primes(Math.floor(Math.sqrt(prime)) + 1);
    for (let a = Math.ceil(prime / 2); ; a++) {
        if (a % prime === 0) continue;
        if (small.every(r => a % r === 0 || (a - prime) % r === 0)) return BigInt(a);
    }
}
const expected = new Map(primes(500).map(p => [p, minimum(p)]));
function run(n: number, options: InterpreterOptions = {}, text = source) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] }), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(text));
        const values = runtime.variables.get('Values');
        return { answer: runtime.variables.get('Answer'), values: values !== undefined && isRankArray(values) ? [...values.items] : [], diagnostics };
    } finally { runtime.dispose(); }
}
describe.each([{}, { compilation: false }, { numberLoopCompilation: false }])('Euler 574 %j', options => {
    it.each([0, 1, 2, 3, 4, 10, 49, 121, 152, 169, 200, 500])('matches the defining search below %s', n => {
        const values = [...expected].filter(([p]) => p < n).map(([, v]) => v);
        const result = run(n, options);
        expect(result.values).toEqual(values);
        expect(result.answer).toBe(values.reduce((a, b) => a + b, 0n));
    }, 60000);
    it('retains every individual small-prime value, including the statement examples', () => {
        const result = run(500, options), keys = [...expected.keys()];
        expect(result.values[keys.indexOf(2)]).toBe(1n);
        expect(result.values[keys.indexOf(37)]).toBe(22n);
        expect(result.values[keys.indexOf(151)]).toBe(165n);
        expect(result.values).toEqual([...expected.values()]);
    });
    it('retains the exact full default golden above Number precision', () => {
        expect(run(3800, options).answer).toBe(5780447552057000454n);
    }, 60000);
});
it.each([50, 200, 1000])('matches the original complete-subset search below %s', n => {
    expect(run(n).answer).toBe(run(n, {}, original).answer);
}, 60000);
it('uses the existing exact batch searches and tensor kernels', () => {
    const result = run(3800);
    expect(result.diagnostics.sortedIndexBatches).toBeGreaterThan(0);
    expect(result.diagnostics.compiledTensors).toBeGreaterThan(0);
    expect(result.answer).toBe(5780447552057000454n);
});
