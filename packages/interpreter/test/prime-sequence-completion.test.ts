import { describe, expect, it } from 'vitest';
import { densePrimePlan, DensePrimeSieve } from '../src/dense-prime-sieve.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { integer32Cells, readArrayItem, typedArray } from '../src/array-storage.js';
import { materializeSequence } from '../src/sequence.js';
import { completeNativeSequence, registerSequenceCompletion } from '../src/sequence-completion.js';
import { withDemandBudget, withInterrupt, DemandBudgetExhausted } from '../src/interrupt.js';
import type { SequencePlan } from '../src/value.js';

function copy(plan: SequencePlan) {
    const diagnostics = new RuntimeDiagnostics();
    const result = diagnostics.run(() => materializeSequence({ kind: 'sequence', plan }));
    return { result, diagnostics };
}
function expected(start: number, end: number): bigint[] {
    const composite = new Uint8Array(end + 1);
    for (let p = 2; p * p <= end; p++) if (!composite[p]) {
        for (let n = p * p; n <= end; n += p) composite[n] = 1;
    }
    return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i)
        .filter(n => n >= 2 && !composite[n]).map(BigInt);
}

describe('bounded prime sequence completion', () => {
    it.each([[2, 200003], [31, 200003], [32, 200002], [8191, 100003]])('fills compact cells for [%s,%s]', (start, end) => {
        const plan = densePrimePlan(200003n).withLowerBound!(BigInt(start), true).withUpperBound!(BigInt(end), true);
        expect(plan.size.kind).toBe('unknown');
        const { result, diagnostics } = copy(plan);
        expect(integer32Cells(result)).toBeInstanceOf(Int32Array);
        expect(Array.from({ length: result.shape[0] }, (_, i) => readArrayItem(result, i))).toEqual(expected(start, end));
        expect(diagnostics.nativeSequenceCopies).toBe(1);
        result.items[0] = -1n;
        expect(readArrayItem(copy(plan).result, 0)).toBe(expected(start, end)[0]);
    });
    it('keeps small, empty and extreme bounds exact', () => {
        const plan = densePrimePlan(200003n);
        for (const view of [densePrimePlan(0n), plan.withUpperBound!(17n, true),
            plan.withLowerBound!(10n ** 100n, true), plan.withUpperBound!(-(10n ** 100n), true),
            plan.withLowerBound!(-(10n ** 100n), true).withUpperBound!(17n, true),
            plan.withLowerBound!(-(10n ** 100n), true).withUpperBound!(-1n, true)]) {
            expect(copy(view).diagnostics.nativeSequenceCopies).toBe(0);
            expect(copy(view).result.items).toEqual([...view.iterate()]);
        }
        expect(copy(plan.withLowerBound!(-(10n ** 100n), true)).result.items).toEqual(expected(2, 200003));
        expect(copy(plan.withLowerBound!(31n, false).withUpperBound!(100003n, false)).result.items).toEqual(expected(32, 100002));
    });
    it('does not invoke an overridden iterator getter during admission', () => {
        const plan: SequencePlan = { name: 'finite native source', size: { kind: 'unknown' },
            *iterate() { yield 2n; yield 3n; } };
        registerSequenceCompletion(plan, () => typedArray(Int32Array.of(2, 3)));
        let getters = 0;
        Object.defineProperty(plan, 'iterate', { get() {
            getters++;
            return function* () { yield 7n; yield 11n; };
        } });
        const { result, diagnostics } = copy(plan);
        expect(result.items).toEqual([7n, 11n]);
        expect(getters).toBe(1);
        expect(diagnostics.nativeSequenceCopies).toBe(0);
    });
    it('declines replaced size evidence and host sieve overrides', () => {
        const plan = densePrimePlan(200003n);
        Object.assign(plan.size, { kind: 'exact', value: 99n });
        expect(completeNativeSequence(plan)).toBeUndefined();
        const original = DensePrimeSieve.prototype.contains;
        try {
            DensePrimeSieve.prototype.contains = () => false;
            expect(copy(densePrimePlan(200003n)).diagnostics.nativeSequenceCopies).toBe(0);
        } finally { DensePrimeSieve.prototype.contains = original; }
    });
    it.each(['contains', 'count'])('does not execute a host %s getter during admission', method => {
        const plan = densePrimePlan(200003n);
        const descriptor = Object.getOwnPropertyDescriptor(DensePrimeSieve.prototype, method)!;
        let reads = 0;
        Object.defineProperty(DensePrimeSieve.prototype, method, { configurable: true,
            get() { reads++; return descriptor.value; } });
        try {
            const { result, diagnostics } = copy(plan);
            expect(result.items).toEqual(expected(2, 200003));
            expect(diagnostics.nativeSequenceCopies).toBe(0);
            expect(reads).toBe(method === 'contains' ? 100002 : 0);
        } finally { Object.defineProperty(DensePrimeSieve.prototype, method, descriptor); }
    });
    it('preserves budgets and opaque polling demands', () => {
        const plan = densePrimePlan(200003n);
        expect(() => withDemandBudget(4097, () => copy(plan))).toThrow(DemandBudgetExhausted);
        expect(withDemandBudget(1000000, () => copy(plan)).diagnostics.nativeSequenceCopies).toBe(0);
        const signal = { length: 1, load: () => 0, exchange: () => 0, store() {}, wait() {} };
        expect(withInterrupt(signal, () => copy(plan)).diagnostics.nativeSequenceCopies).toBe(0);
        expect(copy(plan).diagnostics.nativeSequenceCopies).toBe(1);
    });
    it('discards cancelled completion and can retry the same plan', () => {
        const plan = densePrimePlan(200003n);
        const flag = new Int32Array(new SharedArrayBuffer(4));
        flag[0] = 1;
        expect(() => withInterrupt(flag, () => copy(plan))).toThrow('Interrupted');
        expect(copy(plan).result.items).toEqual(expected(2, 200003));
    });
});
