import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {readArrayItem} from '../src/array-storage.js';
import {Interpreter, RuntimeDiagnostics, isNativeFunction, isRankArray} from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/437_fibonacciprimitive.ra', import.meta.url), 'utf8');

// Enumerate residues and multiply through their actual order, independently
// of the demo's square-root formulas and factorization criterion.
function brute(limit: number) {
    const accepted = new Set<number>();
    for (let prime = 2; prime <= limit; prime++) {
        let isPrime = true;
        for (let divisor = 2; divisor * divisor <= prime; divisor++) {
            if (prime % divisor === 0) { isPrime = false; break; }
        }
        if (!isPrime) continue;
        for (let root = 1; root < prime; root++) {
            if ((root * root - root - 1) % prime !== 0) continue;
            let value = root, order = 1;
            while (value !== 1) { value = value * root % prime; order++; }
            if (order === prime - 1) { accepted.add(prime); break; }
        }
    }
    return accepted;
}
const accepted = brute(2000);
const expected = (limit: number) => BigInt([...accepted].filter(prime => prime <= limit).reduce((a, b) => a + b, 0));

describe('Euler 437 primitive Fibonacci roots', () => {
    it.each([{}, {numberLoopCompilation: false}, {compilation: false}])('matches every small boundary and both root classes: %j', options => {
        for (const limit of [0, 1, 2, 3, 4, 5, 6, 10, 11, 19, 31, 64, 100, 1000, 2000]) {
            const runtime = new Interpreter(() => {}, {...options, args: [`--n=${limit}`]});
            try {
                runtime.execute(source);
                expect(runtime.variables.get('Answer'), `N=${limit}`).toBe(expected(limit));
            } finally { runtime.dispose(); }
        }
    });

    it('preserves the full default golden answer in the compiled region', () => {
        const runtime = new Interpreter(() => {});
        const stats = new RuntimeDiagnostics();
        try {
            stats.run(() => runtime.execute(source));
            expect(runtime.variables.get('Answer')).toBe(74204709657207n);
            expect(stats.compiledTensors).toBeGreaterThan(0);
            expect(stats.numberLoopOverflows).toBe(0);
        } finally { runtime.dispose(); }
    }, 90_000);

    it('checks each admissible prime against its independently enumerated root order', () => {
        const runtime = new Interpreter(() => {}, {args: ['--n=2000']});
        const stats = new RuntimeDiagnostics();
        try {
            stats.run(() => runtime.execute(source));
            expect(runtime.variables.get('Answer')).toBe(70549n);
            expect(stats.compiledTensors).toBeGreaterThan(0);
            expect(stats.numberLoopOverflows).toBe(0);
            const fn = runtime.variables.get('primitive');
            const roots = runtime.variables.get('square_roots');
            if (!fn || !isNativeFunction(fn) || !roots || !isNativeFunction(roots)) throw Error('missing predicate');
            const primes = runtime.variables.get('Primes')!;
            const factors = runtime.variables.get('Factors')!;
            const flags = fn.call([primes, roots.call([primes]), factors]);
            if (!isRankArray(primes) || !isRankArray(flags)) throw Error('missing flags');
            for (let index = 0; index < primes.shape[0]; index++) {
                const prime = Number(readArrayItem(primes, index));
                expect(readArrayItem(flags, index), `prime=${prime}`).toBe(accepted.has(prime));
            }
        } finally { runtime.dispose(); }
    });
});
