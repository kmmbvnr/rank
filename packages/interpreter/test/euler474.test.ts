import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
const fixture = new URL('../../../demos/euler/474_lastdigitsdivisors_test.ra', import.meta.url);
const source = readFileSync(new URL('474_lastdigitsdivisors.ra', fixture), 'utf8');
const backends: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
// Enumerate actual divisors of small factorials, without a residue DP.
function direct(n: number, digits: number) {
    const factors = new Map<number, number>();
    for (let i = 2; i <= n; i++) {
        let rest = i;
        for (let prime = 2; prime <= rest; prime++) while (rest % prime === 0) {
            factors.set(prime, (factors.get(prime) ?? 0) + 1); rest /= prime;
        }
    }
    let divisors = [1n];
    for (const [prime, exponent] of factors) {
        const old = divisors; divisors = [];
        let power = 1n;
        for (let e = 0; e <= exponent; e++, power *= BigInt(prime)) for (const d of old) divisors.push(d * power);
    }
    const modulus = 10n ** BigInt(String(digits).length);
    return BigInt(divisors.filter(d => d % modulus === BigInt(digits)).length);
}
function solve(n: number, d: number, options: InterpreterOptions) {
    const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--d=${d}`] });
    try { r.execute(source); return r.variables.get('Answer'); } finally { r.dispose(); }
}
it.each([
    { n: 0, d: 0 }, { n: 0, d: 1 }, { n: 1, d: 1 }, { n: 1, d: 2 },
    { n: 2, d: 2 }, { n: 5, d: 0 }, { n: 5, d: 5 }, { n: 8, d: 7 },
    { n: 10, d: 10 }, { n: 12, d: 12 }, { n: 12, d: 16 }, { n: 12, d: 25 },
    { n: 12, d: 125 }, { n: 12, d: 64 }, { n: 15, d: 128 }, { n: 15, d: 625 },
    { n: 15, d: 1024 }, { n: 15, d: 343 },
])('matches enumerated divisors at N=$n D=$d', ({ n, d }) => {
    const expected = direct(n, d);
    for (const options of backends) expect(solve(n, d, options)).toBe(expected);
});
it.each(backends)('retains imported examples with options=%j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule(specifier) {
            expect(specifier).toBe('474_lastdigitsdivisors');
            return { id: new URL('474_lastdigitsdivisors.ra', fixture).pathname, source };
        }, onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true, true, true]); }
    finally { r.dispose(); }
}, 30000);
