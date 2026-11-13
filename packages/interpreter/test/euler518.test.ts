import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';

const fixture = new URL('../../../demos/euler/518_primetriples_test.ra', import.meta.url);
const source = readFileSync(new URL('518_primetriples.ra', fixture), 'utf8');
const modes: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
const maximum = 1000;
const prime = Array(maximum).fill(true);
prime[0] = prime[1] = false;
for (let i = 2; i * i < maximum; i++) if (prime[i]) for (let j = i * i; j < maximum; j += i) prime[j] = false;
const triples: { last: number; sum: bigint }[] = [];
// Independent enumeration of prime a < b; solve for c exactly, without
// coprime parameters, scale factors, candidate vectors or the demo's sieve.
for (let first = 2; first < maximum; first++) if (prime[first]) {
    for (let middle = first + 1; middle < maximum; middle++) if (prime[middle]) {
        const square = (middle + 1) ** 2;
        if (square % (first + 1)) continue;
        const last = square / (first + 1) - 1;
        if (last > middle && last < maximum && prime[last]) triples.push({ last, sum: BigInt(first + middle + last) });
    }
}
const inputs = [...Array.from({ length: 32 }, (_, i) => i + 1), 49, 50, 99, 100, 101, 127, 128, 199, 200, 499, 1000];
it.each(modes)('matches independent prime-triple enumeration with %j', options => {
    for (const n of inputs) {
        const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
        try {
            r.execute(source);
            const expected = triples.filter(row => row.last < n).reduce((sum, row) => sum + row.sum, 0n);
            expect(answerOf(r), `N=${n}`).toBe(expected);
        } finally { r.dispose(); }
    }
}, 30_000);
it.each(modes)('retains the statement fixture with %j', options => {
    const results: boolean[] = [];
    const r = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule: () => ({ id: new URL('518_primetriples.ra', fixture).pathname, source }),
        onTestResult: result => results.push(result.passed) });
    try { r.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true]); }
    finally { r.dispose(); }
});
it('compiles the main candidate search without reference-cell computation', () => {
    const r = new Interpreter(() => {}, { args: ['--n=1000000'] }), d = new RuntimeDiagnostics();
    try {
        d.run(() => r.execute(source));
        expect(answerOf(r)).toBe(17822459735n);
        expect(d.numberLoops).toBe(1);
        expect(d.cellsComputed).toBe(0);
    } finally { r.dispose(); }
});
