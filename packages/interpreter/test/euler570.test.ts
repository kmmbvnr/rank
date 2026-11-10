import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/570_snowflakes.ra', import.meta.url), 'utf8');
function gcd(a: bigint, b: bigint): bigint {
    a = a < 0n ? -a : a; b = b < 0n ? -b : b;
    while (b) [a, b] = [b, a % b];
    return a;
}
// Independent closed forms for the two original snowflake counts.
function oracle(n: number): bigint {
    let total = 0n;
    for (let k = 3; k <= n; k++) {
        const u = 4n ** BigInt(k - 2), v = 3n ** BigInt(k - 2);
        const a = 6n * (2n * u - v);
        const b = 6n * (BigInt(3 * k - 23) * u + BigInt(2 * k + 13) * v);
        total += gcd(a, b);
    }
    return total;
}
function run(n: number, options: InterpreterOptions) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try { runtime.execute(source); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
describe.each([{}, { compilation: false }, { numberLoopCompilation: false }])('Euler 570 %j', options => {
    it.each([0, 1, 2, 3, 4, 11, 24, 100, 500])('matches the original counts through %s', n => {
        expect(run(n, options)).toBe(oracle(n));
    }, 60000);
});
it('retains the full snowflake sum', () => {
    expect(run(10000000, {})).toBe(271197444n);
}, 60000);
