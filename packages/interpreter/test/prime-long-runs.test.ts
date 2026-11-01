import { describe, expect, it } from 'vitest';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { primeRange, primePlan } from '../src/prime-sequence.js';
import { PrimeSieve, maxPrimeRunInteger } from '../src/prime-sieve.js';
import { probablePrime } from '../src/primality.js';
import { withInterrupt, type InterruptSignal } from '../src/interrupt.js';

const start = 100000000000000n;
function expectedFrom(first: bigint, count: number): bigint[] {
    const result: bigint[] = [];
    for (let n = first; result.length < count; n++) if (probablePrime(n)) result.push(n);
    return result;
}
const take = <T>(values: Iterable<T>, count: number) => {
    const result: T[] = [];
    for (const value of values) { result.push(value); if (result.length === count) break; }
    return result;
};
const cancel = (): InterruptSignal => ({ length: 1, load: () => 0, store() {}, wait() {}, exchange: () => 1 });

describe('demanded long prime traversals', () => {
    it('promotes only after demand continues beyond the short prefix', () => {
        const iterator = primeRange(start, true, undefined, false)[Symbol.iterator]();
        const d = new RuntimeDiagnostics(), actual: bigint[] = [];
        d.run(() => { for (let i = 0; i < 1024; i++) actual.push(iterator.next().value!); });
        expect(d.primeRunSieves).toBe(0);
        d.run(() => { for (let i = 1024; i < 1368; i++) actual.push(iterator.next().value!); });
        expect(d.primeRunSieves).toBe(1);
        expect(actual).toEqual(expectedFrom(start, 1368));
        iterator.return?.();
    });

    it('keeps promoted finite inclusive/exclusive endpoints exact', () => {
        const values = expectedFrom(start, 1100), end = values.at(-1)!;
        for (const inclusive of [true, false]) {
            const d = new RuntimeDiagnostics();
            const actual = d.run(() => [...primeRange(values[0], false, end, inclusive)]);
            expect(actual).toEqual(values.slice(1, inclusive ? undefined : -1));
            expect(d.primeRunSieves).toBe(1);
        }
    });

    it('keeps distant membership and separate iterators independent', () => {
        const plan = primePlan(undefined, { limit: start, inclusive: true });
        const d = new RuntimeDiagnostics();
        const first = d.run(() => take(plan.iterate(), 1100));
        expect(d.primeRunSieves).toBe(1);
        expect(take(plan.iterate(), 2)).toEqual(first.slice(0, 2));
        d.run(() => expect(plan.contains!(first.at(-1)!)).toBe(true));
        expect(d.primeRunSieves).toBe(1);
    });

    it('retains primality fallback beyond the bounded workspace', () => {
        const low = BigInt(maxPrimeRunInteger) + 1n, d = new RuntimeDiagnostics();
        const actual = d.run(() => take(primeRange(low, true, undefined, false), 270));
        expect(actual).toEqual(expectedFrom(low, 270));
        expect(d.primeRunSieves).toBe(0);
    });


    it('continues exactly when a promoted traversal crosses its upper bound', () => {
        const low = BigInt(maxPrimeRunInteger) - 40000n, d = new RuntimeDiagnostics();
        const actual = d.run(() => take(primeRange(low, true, undefined, false), 1500));
        expect(actual).toEqual(expectedFrom(low, 1500));
        expect(actual.at(-1)!).toBeGreaterThan(BigInt(maxPrimeRunInteger));
        expect(d.primeRunSieves).toBe(1);
    });

    it('marks exact odd cells at the wide upper edge', () => {
        const sieve = new PrimeSieve(true);
        for (let n = maxPrimeRunInteger - 100; n <= maxPrimeRunInteger; n += 2) {
            expect(sieve.contains(n)).toBe(probablePrime(BigInt(n)));
        }
    });

    it('rebuilds interrupted wide preparation without publishing a partial base', () => {
        const sieve = new PrimeSieve(true);
        expect(() => withInterrupt(cancel(), () => sieve.contains(Number(start) + 1))).toThrow('Interrupted');
        for (const n of [100000000000031, 100000000000033]) {
            expect(sieve.contains(n)).toBe(probablePrime(BigInt(n)));
        }
    });
});
