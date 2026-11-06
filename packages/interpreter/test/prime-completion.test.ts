import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { completeNativeSequence } from '../src/sequence-completion.js';
import { materializeSequence } from '../src/sequence.js';
import { primePlan } from '../src/prime-sequence.js';
import { PrimeSieve } from '../src/prime-sieve.js';
import { withDemandBudget, withInterrupt, type InterruptSignal } from '../src/interrupt.js';

function primes(limit: number): bigint[] {
    const composite = new Uint8Array(limit + 1), values: bigint[] = [];
    for (let n = 2; n <= limit; n++) {
        if (composite[n]) continue;
        values.push(BigInt(n));
        for (let next = n * n; next <= limit; next += n) composite[next] = 1;
    }
    return values;
}
const expected = primes(300000);
const bound = (limit: bigint, inclusive = true) => ({ limit, inclusive });

describe('packed finite prime completion', () => {
    it('does not complete an unused deferred prime array', () => {
        const runtime = new Interpreter(), diagnostics = new RuntimeDiagnostics();
        try {
            expect(diagnostics.run(() => runtime.execute("use sequences\nUnused' = primes to 100000 array\n7"))).toBe(7n);
            expect(diagnostics.nativeSequenceCopies).toBe(0);
        } finally { runtime.dispose(); }
    });

    it.each([
        [2n, true, 100003n, true], [10001n, false, 100003n, false],
        [-100n, false, 300000n, true], [65537n, true, 250000n, false],
    ] as const)('packs exact bounds %s/%s to %s/%s', (low, from, high, to) => {
        const plan = primePlan(bound(high, to), bound(low, from));
        const diagnostics = new RuntimeDiagnostics();
        const result = diagnostics.run(() => completeNativeSequence(plan));
        expect(result).toBeDefined();
        expect(Array.from(result!.items)).toEqual(expected.filter(n =>
            (from ? n >= low : n > low) && (to ? n <= high : n < high)));
        expect(diagnostics.nativeSequenceCopies).toBe(1);
    });

    it('leaves small, empty, unbounded and wider plans on ordinary demand', () => {
        for (const plan of [primePlan(), primePlan(bound(0n)), primePlan(bound(100n)),
            primePlan(bound(2147483648n)), primePlan(bound(100000n), bound(99900n))]) {
            expect(completeNativeSequence(plan)).toBeUndefined();
        }
    });

    it('does not bypass an overridden iterator or changed size evidence', () => {
        const plan = primePlan(bound(100000n));
        plan.iterate = function* () { yield 99n; };
        expect(formatValue(materializeSequence({ kind: 'sequence', plan }))).toBe('99');
        const changed = primePlan(bound(100000n));
        Object.defineProperty(changed, 'size', { value: { kind: 'exact', value: 1n } });
        expect(completeNativeSequence(changed)).toBeUndefined();
    });

    it('preserves budgets, inspection and observable polling', () => {
        const plan = primePlan(bound(100000n));
        expect(withDemandBudget(100, () => completeNativeSequence(plan))).toBeUndefined();
        expect(() => withDemandBudget(100, () => materializeSequence({ kind: 'sequence', plan })))
            .toThrow('demand budget exhausted');
        const signal: InterruptSignal = { length: 1, load: () => 0, store() {}, wait() {}, exchange: () => 0 };
        expect(withInterrupt(signal, () => completeNativeSequence(plan))).toBeUndefined();
        expect(withInterrupt(new Int32Array(3), () => completeNativeSequence(plan), () => {})).toBeUndefined();
    });

    it('polls opaque cancellation during completion and can retry afterward', () => {
        const plan = primePlan(bound(100000n)), flag = new Int32Array(new SharedArrayBuffer(4));
        const contains = PrimeSieve.prototype.contains;
        const spy = vi.spyOn(PrimeSieve.prototype, 'contains').mockImplementation(function (this: PrimeSieve, value) {
            if (value >= 20003) Atomics.store(flag, 0, 1);
            return contains.call(this, value);
        });
        try {
            expect(() => withInterrupt(flag, () => completeNativeSequence(plan))).toThrow('Interrupted');
        } finally { spy.mockRestore(); }
        flag[0] = 0;
        const result = withInterrupt(flag, () => completeNativeSequence(plan));
        expect(Array.from(result!.items)).toEqual(expected.filter(n => n <= 100000n));
    });
});
