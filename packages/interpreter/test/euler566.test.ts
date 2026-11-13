import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type InterpreterOptions } from '../src/index.js';
import { withoutReturn, answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/566_cakeicing.ra', import.meta.url), 'utf8');
const { flips, total } = await import(new URL('../../../benchmarks/euler566-oracle.mjs', import.meta.url).href);
function run(n: number, options: InterpreterOptions = {}, triple?: number[]) {
    const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try {
        r.execute(withoutReturn(source) + (triple ? `\nTriple = array ${triple.join(' ')}\nAnswer = Triple icing\n` : ''));
        return answerOf(r);
    } finally { r.dispose(); }
}
for (const options of [{}, { compilation: false }, { numberLoopCompilation: false }]) describe(`Euler 566 ${JSON.stringify(options)}`, () => {
    it.each([[0, 0n], [10, 0n], [11, 60n], [14, 58020n], [17, 1269260n], [23, 61995470n]] as const)('retains the exact prefix G(%s)', (n, expected) => {
        expect(run(n, options)).toBe(expected);
    }, 60000);
    it.each([[9, 10, 11, 60n], [10, 14, 16, 506n], [15, 16, 17, 785232n]] as const)('retains F(%s,%s,%s)', (a, b, c, expected) => {
        expect(run(8, options, [a, b, c])).toBe(expected);
    }, 60000);
});
it('checks statement values with independent colored-interval simulation', () => {
    expect(flips(9, 10, 11)).toBe(60);
    expect(flips(10, 14, 16)).toBe(506);
    expect(flips(15, 16, 17)).toBe(785232);
    expect(total(11)).toBe(60n); expect(total(14)).toBe(58020n); expect(total(17)).toBe(1269260n);
}, 60000);
it('uses native integer word joining in the array solution', () => {
    const r = new Interpreter(() => {}, { args: ['--n=17'] }), d = new RuntimeDiagnostics();
    try {
        d.run(() => r.execute(source));
        expect(answerOf(r)).toBe(1269260n);
        expect(d.nativeIntegerJoins).toBeGreaterThan(0);
    } finally { r.dispose(); }
});
