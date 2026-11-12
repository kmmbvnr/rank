import { fullScale } from './full-scale.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/571_superpandigital.ra', import.meta.url), 'utf8');
function pandigital(n: number, base: number): boolean {
    let seen = 0;
    do { seen |= 1 << (n % base); n = Math.floor(n / base); } while (n);
    return seen === (1 << base) - 1;
}
// Independent exhaustive integers, without permutations or chunk-mask tables.
function oracle(base: number): bigint[] {
    const found: bigint[] = [];
    for (let n = base ** (base - 1); n < base ** base && found.length < 3; n++) {
        let good = true;
        for (let b = base; b >= 2; b--) if (!pandigital(n, b)) { good = false; break; }
        if (good) found.push(BigInt(n));
    }
    return found;
}
const cases = [2, 3, 4, 5, 6, 7].flatMap(base => {
    const found = oracle(base);
    return Array.from({ length: found.length + 1 }, (_, count) => ({ base, count, expected: found.slice(0, count).reduce((a, b) => a + b, 0n) }));
});
function run(base: number, count: number, options: InterpreterOptions) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--b=${base}`, `--t=${count}`] });
    try { runtime.execute(source); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
describe.each([{}, { compilation: false }, { numberLoopCompilation: false }])('Euler 571 %j', options => {
    it.each(cases)('matches exhaustive integers for base $base, count $count', ({ base, count, expected }) => {
        expect(run(base, count, options)).toBe(expected);
    }, 60000);
    fullScale('retains both base-10 statement values', () => {
        expect(run(10, 1, options)).toBe(1093265784n);
        expect(run(10, 10, options)).toBe(20319792309n);
    }, 120000);
});
fullScale('retains the full base-12 result', () => {
    expect(run(12, 10, {})).toBe(30510390701978n);
}, 360000);
