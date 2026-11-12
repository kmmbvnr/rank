import { fullScale } from './full-scale.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/583_heronenvelopes.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler583-original.ra', import.meta.url), 'utf8');
// Independent direct geometry: try integer halfwidth, flap height and
// rectangle height, checking all three hypotenuses. No Euclid parameters,
// packed keys, insertion queries or ragged expansion enter this oracle.
const bound = 10000, half = bound / 2, prefix = new Float64Array(bound + 1);
const square = (n: number) => { const root = Math.floor(Math.sqrt(n)); return root * root === n; };
for (let a = 1; 2 * a < half; a++) for (let t = 1; 2 * a + t < half; t++) {
    const s2 = a * a + t * t;
    if (!square(s2)) continue;
    const s = Math.sqrt(s2);
    for (let h = t + 1; a + h + s <= half; h++) {
        if (square(4 * a * a + h * h) && square(a * a + (h + t) ** 2)) prefix[2 * (a + h + s)] += 2 * (a + h + s);
    }
}
const first = prefix.findIndex(value => value > 0);
for (let n = 1; n <= bound; n++) prefix[n] += prefix[n - 1];
function run(p: number, options: InterpreterOptions = {}, batch?: number, text = source) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--p=${p}`, ...batch === undefined ? [] : [`--batch=${batch}`]] });
    try { runtime.execute(text); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
const modes: InterpreterOptions[] = [{}, { compilation: false },
    { tensorCellCompilation: false, tensorFusion: false, numberLoopCompilation: false, scalarFunctionCompilation: false }];
it('independently reproduces the published statement checkpoint', () => expect(prefix[10000]).toBe(884680));
describe.each(modes)('Euler 583 %j', options => {
    it.each([0, 1, 2, 11, 12, 50, 100, 500, 1000, 1999, 2000, 5000, 9999, 10000, first - 1, first, first + 1])('matches direct envelope geometry through perimeter %s', p => {
        expect(run(p, options)).toBe(BigInt(prefix[p]));
    });
    it.each([-1, 0, 1, 7, 64, 4096])('keeps the result independent of batch size %s', batch => {
        expect(run(first + 1, options, batch)).toBe(BigInt(prefix[first + 1]));
    });
    fullScale('retains the exact full default', () => expect(run(10000000, options)).toBe(1174137929000n), 180000);
});
it.each([10000, 100000, 1000000])('matches the old independent rectangle/flap search at perimeter %s', p => {
    expect(run(p)).toBe(run(p, {}, undefined, original));
}, 60000);
