import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankSequence } from '../src/index.js';
import { DensePrimeSieve, densePrimePlan, maxDensePrimeInteger } from '../src/dense-prime-sieve.js';
import { withInterrupt, type InterruptSignal } from '../src/interrupt.js';

function reference(limit: number): Uint8Array {
    const primes = new Uint8Array(limit + 1).fill(1);
    primes[0] = primes[1] = 0;
    for (let p = 2; p * p <= limit; p++) {
        if (primes[p]) for (let n = p * p; n <= limit; n += p) primes[n] = 0;
    }
    return primes;
}

function run(source: string, compilation = true): string {
    const runtime = new Interpreter(undefined, { compilation });
    try { return formatValue(runtime.execute('use sequences\n' + source)!); }
    finally { runtime.dispose(); }
}

describe('dense bounded prime sieve', () => {
    it('matches an independent sieve in reverse and scattered order across bitmap and segment edges', () => {
        const limit = 200003, expected = reference(limit), table = new DensePrimeSieve(limit);
        expect(table.byteLength).toBe(Math.ceil(Math.floor((limit + 1) / 2) / 8));
        for (let n = limit; n >= 0; n--) {
            if (table.contains(n) !== Boolean(expected[n])) throw new Error(`primality mismatch at ${n}`);
        }
        const plan = densePrimePlan(BigInt(limit));
        expect([...plan.iterate()]).toEqual(Array.from(expected.keys()).filter(n => expected[n]).map(BigInt));
        for (let n = 3; n <= limit; n += 7919) expect(plan.contains!(BigInt(n))).toBe(Boolean(expected[n]));
    });

    it('handles empty and tiny bounds and inclusive endpoints', () => {
        for (const [bound, values] of [[0, ''], [1, ''], [2, '2'], [3, '2 3'], [4, '2 3'], [17, '2 3 5 7 11 13 17']] as const) {
            expect(run(`${bound} primesieve array`)).toBe(values);
        }
        expect(run('P = 17 primesieve\n(array -1 0 1 2 3 17 19) in P'))
            .toBe('false false false true true true false');
        expect(run('P = 17 primesieve\n(array 2.0 3.5 17.0 19.0) in P')).toBe('true false true false');
    });

    it('shares the bitmap across bounded views and keeps independent traversals', () => {
        const plan = densePrimePlan(200003n);
        const first = plan.iterate(), second = plan.iterate();
        expect(first.next().value).toBe(2n);
        expect(first.next().value).toBe(3n);
        expect(plan.contains!(199999n)).toBe(true);
        expect(second.next().value).toBe(2n);
        expect(first.next().value).toBe(5n);
        expect(run('P = 100 primesieve\nP from 31 till 41 array')).toBe('31 37');
        expect(run('P = 100 primesieve\n(array 29 31 37 41) in (P from 31 till 41)')).toBe('false true true false');
        expect(run('(100 primesieve) from (10 ** 100) array')).toBe('');
        expect(run('(100 primesieve) till (-10 ** 100) array')).toBe('');
        expect(run('(100 primesieve) to (10 ** 100) len')).toBe('25');
        expect(run('(100 primesieve) 5')).toBe('13');
    });

    it.each([false, true])('supports scalar helper captures, masks, rebinding and bounds with compilation=%s', compilation => {
        let loops = 0;
        const runtime = new Interpreter(undefined, { compilation, onIntegerLoopExecuted: () => loops++ });
        try {
            runtime.execute(`use sequences
P = 200003 primesieve
fun N allowed
 return N in P
end`);
            expect(runtime.execute(`S = 0
for N in 199900 to 200100
 if N allowed
  S += 1
 end
end
S`)).toBe(BigInt(reference(200003).slice(199900).reduce((a, b) => a + b, 0)));
            expect(loops > 0).toBe(compilation);
            expect(formatValue(runtime.execute('(array 2 3 4 17 19) in (P till 19)')!)).toBe('true true false true false');
            runtime.execute("P = 10 primesieve");
            expect(runtime.execute('17 allowed')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('retains stored tables inside records and tuples without expanding their primes', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\nP = 100 primesieve\nSaved = record\n .primes = P\nend\nPair = tuple P P');
            expect(isRankSequence(runtime.variables.get('P')!)).toBe(true);
            expect(runtime.execute('97 in (Saved .primes)')).toBe(true);
            expect(runtime.execute('97 in (Pair 0)')).toBe(true);
        } finally { runtime.dispose(); }
    });

    it('uses one bit per odd value at the requested Euler bound', () => {
        const table = new DensePrimeSieve(100000001);
        expect(table.byteLength).toBe(6250001);
        for (const n of [2, 3, 99999989]) expect(table.contains(n)).toBe(true);
        for (const n of [1, 99980001, 100000000, 100000001, 100000007]) expect(table.contains(n)).toBe(false);
    });

    it('rejects invalid bounds before allocation', () => {
        for (const source of ['(-1) primesieve', `${maxDensePrimeInteger + 1} primesieve`, '(10 ** 100) primesieve']) {
            expect(() => run(source)).toThrow('primesieve bound must be between');
        }
        for (const source of ['10.0 primesieve', 'true primesieve', '"10" primesieve']) {
            expect(() => run(source)).toThrow('primesieve expects an integer bound');
        }
    });

    it('observes cancellation during bitmap marking', () => {
        let polls = 0;
        const signal: InterruptSignal = { length: 1, load: () => 0, store() {}, wait() {},
            exchange: () => ++polls >= 3 ? 1 : 0 };
        expect(() => withInterrupt(signal, () => new DensePrimeSieve(100000001))).toThrow('Interrupted');
        expect(polls).toBe(3);
        expect(new DensePrimeSieve(97).contains(97)).toBe(true);
    });

    it('cancels construction and leaves an existing binding usable', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute("use sequences\nP = 100 primesieve");
            let polls = 0;
            const signal: InterruptSignal = { length: 1, load: () => 0,
                store() {}, wait() {}, exchange: () => ++polls >= 4 ? 1 : 0 };
            expect(() => withInterrupt(signal, () => runtime.execute("P = 100000001 primesieve"))).toThrow('Interrupted');
            expect(isRankSequence(runtime.variables.get('P')!)).toBe(true);
            expect(runtime.execute('97 in P')).toBe(true);
            expect(runtime.execute('101 in P')).toBe(false);
            expect(run('1000 primesieve len')).toBe('168');
        } finally { runtime.dispose(); }
    });
});
