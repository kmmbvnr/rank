import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/565_divisibilityofsigma.ra', import.meta.url), 'utf8');
const sigma = new Float64Array(1000001);
for (let divisor = 1; divisor < sigma.length; divisor++)
    for (let n = divisor; n < sigma.length; n += divisor) sigma[n] += divisor;
const bounds = [0, 1, 100, 12100, 12101, 12102, 24202, 100000, 1000000];
const expected = bounds.map(bound => {
    let total = 0n;
    for (let n = 1; n <= bound; n++) if (sigma[n] % 2017 === 0) total += BigInt(n);
    return total;
});
function run(n: number, options: InterpreterOptions) {
    const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try { r.execute(source); return answerOf(r); }
    finally { r.dispose(); }
}
for (const options of [{}, { compilation: false }, { numberLoopCompilation: false }]) describe(`Euler 565 ${JSON.stringify(options)}`, () => {
    it.each(bounds.map((n, i) => ({ n, expected: expected[i] })))('matches an independent divisor-sum sieve at $n', ({ n, expected }) => {
        expect(run(n, options)).toBe(expected);
    });
    it('matches the billion statement example', () => {
        expect(run(1e9, options)).toBe(249652238344557n);
    });
    it('retains the exact full result beyond Number precision', () => {
        expect(run(1e11, options)).toBe(2992480851924313898n);
    }, 60000);
});
