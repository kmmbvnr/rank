import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { withInterrupt, type InterruptSignal } from '../src/interrupt.js';
import { primePlan } from '../src/prime-sequence.js';
import { PrimeSieve, maxSieveInteger } from '../src/prime-sieve.js';
import { probablePrime } from '../src/primality.js';

function reference(limit: number): bigint[] {
    const composite = new Uint8Array(limit + 1), result: bigint[] = [];
    for (let p = 2; p <= limit; p++) {
        if (composite[p]) continue;
        result.push(BigInt(p));
        for (let n = p * p; n <= limit; n += p) composite[n] = 1;
    }
    return result;
}
const upper = (limit: bigint, inclusive = false) => ({ limit, inclusive });
const cancel = (): InterruptSignal => ({ length: 1, load: () => 0, store() {}, wait() {}, exchange: () => 1 });

describe('segmented prime source', () => {
    it('matches an independent sieve across multiple segments and base-table growth', () => {
        const expected = reference(1_000_000), members = new Set(expected);
        const plan = primePlan(upper(1_000_001n));
        expect([...plan.iterate()]).toEqual(expected);
        for (let n = 0; n <= 20000; n++) {
            expect(plan.contains!(BigInt(n))).toBe(members.has(BigInt(n)));
        }
        expect(expected.length).toBe(78498);
    });

    it('respects inclusive and exclusive boundaries at empty ranges, 2, squares and segment edges', () => {
        const expected = reference(140000);
        for (const start of [-10n, 0n, 1n, 2n, 3n, 7n, 49n, 65535n, 65537n, 131073n]) {
            for (const inclusive of [true, false]) for (const end of [start - 1n, start, start + 1n, start + 100n]) {
                for (const endInclusive of [true, false]) {
                    const plan = primePlan(upper(end, endInclusive), upper(start, inclusive));
                    const values = expected.filter(n => (inclusive ? n >= start : n > start)
                        && (endInclusive ? n <= end : n < end));
                    expect([...plan.iterate()]).toEqual(values);
                    for (const n of [start, start + 1n, end]) expect(plan.contains!(n)).toBe(values.includes(n));
                }
            }
        }
    });

    it('matches primality tests around the sieve fallback boundary', () => {
        const low = BigInt(maxSieveInteger) - 100n, high = low + 200n;
        const expected: bigint[] = [];
        for (let n = low; n <= high; n++) if (probablePrime(n)) expected.push(n);
        const plan = primePlan(upper(high, true), upper(low, true));
        expect([...plan.iterate()]).toEqual(expected);
        for (let n = low; n <= high; n++) expect(plan.contains!(n)).toBe(expected.includes(n));
    });

    it('keeps unbounded local, distant and reverse membership queries exact', () => {
        const plan = primePlan();
        const members = new Set(reference(200000));
        for (const n of [65535, 65537, 65539, 131075, 131077, 131079, 65539, 65537, 65535, 3, 5, 7]) {
            expect(plan.contains!(BigInt(n))).toBe(members.has(BigInt(n)));
        }
        for (const n of [BigInt(maxSieveInteger) - 4n, BigInt(maxSieveInteger) - 2n,
            BigInt(maxSieveInteger), BigInt(maxSieveInteger) + 2n, 10n ** 18n + 3n]) {
            expect(plan.contains!(n)).toBe(probablePrime(n));
        }
    });

    it('rebuilds an interrupted unbounded membership segment', () => {
        const plan = primePlan();
        plan.contains!(200003n);
        expect(() => withInterrupt(cancel(), () => plan.contains!(200009n))).toThrow('Interrupted');
        expect(plan.contains!(200003n)).toBe(true);
        expect(plan.contains!(200001n)).toBe(false);
    });

    it.each([false, true])('preserves unbounded membership under compilation=%s', compilation => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            const value = runtime.execute(`use sequences
Total = 0
for N in 65500 to 132000
  if N in primes
    Total += 1
  end
end
Total`);
            expect(value).toBe(BigInt(reference(132000).filter(p => p >= 65500n).length));
        } finally { runtime.dispose(); }
    });

    it('keeps finite and infinite huge-bound searches lazy and exact', () => {
        const runtime = new Interpreter();
        try {
            for (const source of ['primes take 1 array', 'primes till (10 ** 100) take 1 array']) {
                expect(formatValue(runtime.execute('use sequences\n' + source)!)).toBe('2');
            }
            for (const suffix of ['take 2 array', 'till (10 ** 18 + 10) array']) {
                expect(formatValue(runtime.execute('primes from 10 ** 18 ' + suffix)!))
                    .toBe('1000000000000000003 1000000000000000009');
            }
            expect(runtime.execute('primes from 10 ** 100 till (10 ** 100 - 1) len')).toBe(0n);
        } finally { runtime.dispose(); }
    });

    it('does not share a mutable segment between iterators, indexing and membership', () => {
        const plan = primePlan(upper(200000n));
        const first = plan.iterate(), second = plan.iterate();
        expect(first.next().value).toBe(2n);
        expect(first.next().value).toBe(3n);
        expect(plan.contains!(199999n)).toBe(true);
        expect(plan.at!(100n)).toBe(547n);
        expect(second.next().value).toBe(2n);
        expect(first.next().value).toBe(5n);
        expect(plan.contains!(7n)).toBe(true);
        expect(second.next().value).toBe(3n);
        expect(first.next().value).toBe(7n);
        first.return?.(); second.return?.();
        expect([...plan.iterate()]).toEqual(reference(199999));
    });

    it('interrupts base preparation without poisoning the workspace', () => {
        const sieve = new PrimeSieve();
        expect(() => withInterrupt(cancel(), () => sieve.contains(1_000_000_000_001)))
            .toThrow('Interrupted while preparing prime sieve');
        expect(sieve.contains(65537)).toBe(true);
        expect(sieve.contains(65535)).toBe(false);
    });

    it('interrupts segment marking and rebuilds the partially written segment', () => {
        const sieve = new PrimeSieve();
        sieve.contains(200003);
        expect(() => withInterrupt(cancel(), () => sieve.contains(100003)))
            .toThrow('Interrupted while sieving primes');
        expect(sieve.contains(100003)).toBe(true);
        expect(sieve.contains(100001)).toBe(false);
    });

    it.each([false, true])('preserves bounded membership under compilation=%s and recovers after cancellation', compilation => {
        let loops = 0;
        const runtime = new Interpreter(undefined, { compilation, onIntegerLoopExecuted: () => loops++ });
        try {
            runtime.execute('use sequences\nAllowed\' = primes from 65500 till 132000');
            const value = runtime.execute('S = 0\nfor I in 65400 to 132100\n if I in Allowed\n  S += 1\n end\nend\nS');
            expect(value).toBe(BigInt(reference(131999).filter(p => p >= 65500n).length));
            expect(loops > 0).toBe(compilation);
            runtime.execute('Huge\' = primes till 1000000000002');
            expect(() => withInterrupt(cancel(), () => runtime.execute('1000000000001 in Huge'))).toThrow('Interrupted');
            expect(runtime.execute('65537 in Huge')).toBe(true);
        } finally { runtime.dispose(); }
    });
});
