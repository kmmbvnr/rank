import { fullScale } from './full-scale.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/580_squarefreehilbert.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler580-original.ra', import.meta.url), 'utf8');
// Directly remove multiples of every nonunit Hilbert square. This oracle
// uses neither ordinary prime factors nor the coefficient recurrence.
const bound = 20000, flags = new Uint8Array(Math.floor((bound + 3) / 4)).fill(1), prefix = new Int32Array(bound + 1);
for (let h = 5; h * h <= bound; h += 4) {
    const square = h * h;
    for (let index = (square - 1) / 4; index < flags.length; index += square) flags[index] = 0;
}
for (let n = 1; n <= bound; n++) prefix[n] = prefix[n - 1] + (n % 4 === 1 ? flags[(n - 1) / 4] : 0);
function run(n: number | bigint, options: InterpreterOptions = {}, batch?: number, text = source) {
    const args = [`--n=${n}`, ...batch === undefined ? [] : [`--batch=${batch}`]];
    const runtime = new Interpreter(() => {}, { ...options, args });
    try { runtime.execute(text); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
const modes: InterpreterOptions[] = [{}, { compilation: false }, { scalarFunctionCompilation: false, numberLoopCompilation: false }];
describe.each(modes)('Euler 580 %j', options => {
    it.each([0, 1, 4, 5, 8, 9, 24, 25, 26, 80, 81, 82, 98, 99, 100, 116, 117, 118, 168, 169, 170,
        188, 189, 190, 440, 441, 442, 692, 693, 694, 3968, 3969, 3970, 6236, 6237, 6238, 10000, 20000])('matches direct Hilbert-square exclusion through %s', n => {
        expect(run(n, options)).toBe(BigInt(prefix[n]));
    });
    it('retains the statement checkpoint', () => expect(run(9999999, options)).toBe(2327192n));
    fullScale('retains the exact full default', () => expect(run(9999999999999999n, options)).toBe(2327213148095366n), 60000);
    it.each([-1, 0, 1, 2, 7, 13, 100])('keeps arithmetic independent of batch size %s', batch => {
        expect(run(10000, options, batch)).toBe(BigInt(prefix[10000]));
    });
});
it.each([99, 9999999, 10000000000])('matches the old prime-count coefficient sieve at %s', n => {
    expect(run(n)).toBe(run(n, {}, undefined, original));
}, 30000);
