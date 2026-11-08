import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
const fixture = new URL('../../../demos/euler/484_arithmeticderivative_test.ra', import.meta.url);
const source = readFileSync(new URL('484_arithmeticderivative.ra', fixture), 'utf8');
const backends: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
function brute(limit: number): bigint[] {
    const smallest = new Int32Array(limit + 1), derivative = new Array<bigint>(limit + 1).fill(0n), sums = [...derivative];
    for (let p = 2; p <= limit; p++) if (!smallest[p]) {
        for (let n = p; n <= limit; n += p) if (!smallest[n]) smallest[n] = p;
    }
    for (let n = 2; n <= limit; n++) {
        const p = smallest[n], rest = n / p;
        // Leibniz directly, rather than the multiplicative g or convolution h.
        derivative[n] = BigInt(p) * derivative[rest] + BigInt(rest);
        let a = BigInt(n), b = derivative[n];
        while (b) [a, b] = [b, a % b];
        sums[n] = sums[n - 1] + a;
    }
    return sums;
}
const expected = brute(100000);
it.each([0, 1, 2, 3, 4, 7, 8, 9, 15, 16, 20, 26, 27, 28, 31, 32, 48, 49, 63, 64, 65, 80, 81, 125, 128, 129, 200, 1000, 100000])('matches direct derivatives through %s', n => {
    for (const options of backends) {
        const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
        try { r.execute(source); expect(r.variables.get('Answer')).toBe(expected[n]); }
        finally { r.dispose(); }
    }
});
it.each(backends)('retains the statement and brute fixtures with options=%j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule(specifier) { expect(specifier).toBe('484_arithmeticderivative'); return { id: new URL('484_arithmeticderivative.ra', fixture).pathname, source }; },
        onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true, true]); }
    finally { r.dispose(); }
});
it.each([1, 7, 31])('splits ragged rows at exact chunk boundaries (%s pairs)', chunk => {
    const small = source.replace('  Chunk = 1000000', `  Chunk = ${chunk}`);
    expect(small).not.toBe(source);
    for (const options of backends) {
        const r = new Interpreter(() => {}, { ...options, args: ['--n=1000'] });
        try { r.execute(small); expect(r.variables.get('Answer')).toBe(expected[1000]); }
        finally { r.dispose(); }
    }
});
it('retains the negative square-root domain error', () => {
    const r = new Interpreter(() => {}, { args: ['--n=-1'] });
    try { expect(() => r.execute(source)).toThrow('isqrt expects a nonnegative integer'); }
    finally { r.dispose(); }
});
it('matches the full independent depth-first oracle', () => {
    const r = new Interpreter(() => {});
    try { r.execute(source); expect(r.variables.get('Answer')).toBe(8907904768686152599n); }
    finally { r.dispose(); }
}, 120000);
