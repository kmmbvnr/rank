import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type InterpreterOptions } from '../src/index.js';

const fixture = new URL('../../../demos/euler/521_smallestprime_test.ra', import.meta.url);
const source = readFileSync(new URL('521_smallestprime.ra', fixture), 'utf8');
const modes: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
// Independent small sieve: mark the first prime divisor of every integer.
const limit = 10000, factor = new Int32Array(limit + 1), totals = [0n, 0n];
for (let p = 2; p <= limit; p++) if (!factor[p]) {
    for (let n = p; n <= limit; n += p) if (!factor[n]) factor[n] = p;
}
for (let n = 2; n <= limit; n++) totals[n] = totals[n - 1] + BigInt(factor[n]);
const inputs = [...Array.from({ length: 41 }, (_, n) => n), 63, 64, 65, 99, 100, 101,
    124, 125, 126, 215, 216, 217, 999, 1000, 1001, 4095, 4096, 4097, 9999, 10000];
it.each(modes)('matches independent smallest-factor sums with %j', options => {
    for (const n of inputs) {
        const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
        try { r.execute(source); expect(r.variables.get('Answer'), `N=${n}`).toBe(totals[n]); }
        finally { r.dispose(); }
    }
}, 30_000);
it.each(modes)('retains the statement fixture with %j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule: () => ({ id: new URL('521_smallestprime.ra', fixture).pathname, source }),
        onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true]); }
    finally { r.dispose(); }
});
it('compiles the prime sieve loop with named ranges', () => {
    const r = new Interpreter(() => {}, { args: ['--n=10000'] }), d = new RuntimeDiagnostics();
    try { d.run(() => r.execute(source)); expect(r.variables.get('Answer')).toBe(totals[10000]); expect(d.numberLoops).toBe(1); }
    finally { r.dispose(); }
});
