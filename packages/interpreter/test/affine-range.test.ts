import { describe, expect, it } from 'vitest';
import { Interpreter, isRankSequence } from '../src/index.js';
import { arithmeticRange } from '../src/range-plan.js';
import { sequence } from '../src/sequence.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
import type { RankSequence } from '../src/value.js';

function progression(runtime: Interpreter, source: string): RankSequence {
    const result = runtime.execute(source);
    if (!result || !isRankSequence(result)) throw Error('expected sequence');
    return result;
}

for (const compilation of [false, true]) describe(`affine range proofs, compilation=${compilation}`, () => {
    it.each([
        ['(2 to 8 by 2) + 7', 9n, 2n, 4n],
        ['7 + (2 to 8 by 2)', 9n, 2n, 4n],
        ['(8 to 2 by -2) - 7', 1n, -2n, 4n],
        ['7 - (2 to 8 by 2)', 5n, -2n, 4n],
        ['(2 to 8 by 2) * -3', -6n, -6n, 4n],
        ['-3 * (2 to 8 by 2)', -6n, -6n, 4n],
        ['((0 till 10) * 0) + 2', 2n, 0n, 10n],
        ['(3 till 3) * 100', 0n, 0n, 0n],
        ['(1 to 3) + 1180591620717411303424', 1180591620717411303425n, 1n, 3n],
    ])('retains exact bounds for %s', (source, start, step, count) => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const result = progression(runtime, source);
            expect(arithmeticRange(result.plan)).toEqual({ start, step, count });
            expect([...result.plan.iterate()]).toEqual(Array.from({ length: Number(count) }, (_, i) => start + BigInt(i) * step));
        } finally { runtime.dispose(); }
    });

    it('keeps modular scan values and budgeted demand exact', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use sequences\nTwos\' = (0 till 40) * 0 + 2\nPowers = Twos scan * with 1 mod 1953125');
            const actual = runtime.execute('Powers');
            expect(actual).toBeDefined();
            for (let i = 0; i <= 40; i++) expect(runtime.execute(`Powers ${i}`)).toBe(2n ** BigInt(i) % 1953125n);
            const range = progression(runtime, '(0 till 40) * 0 + 2');
            expect(withDemandBudget(100, () => arithmeticRange(range.plan))).toBeUndefined();
            const budgetCreated = withDemandBudget(100, () => progression(runtime, '(0 till 40) * 0 + 2'));
            expect(arithmeticRange(budgetCreated.plan)).toEqual({ start: 2n, step: 0n, count: 40n });
            runtime.variables.set('Range', range);
            expect(() => withDemandBudget(2, () => runtime.execute('Range array'))).toThrow('demand budget exhausted');
        } finally { runtime.dispose(); }
    });

    it('rejects opaque plans and invalidates a changed constructor through the chain', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            let reads = 0;
            runtime.variables.set('Opaque', sequence({ name: 'range', size: { kind: 'exact', value: 3n },
                *iterate() { reads++; yield 1n; yield 2n; yield 3n; }, at: () => { reads++; return 1n; } }));
            expect(arithmeticRange(progression(runtime, 'Opaque * 0 + 2').plan)).toBeUndefined();
            expect(reads).toBe(0);
            const source = progression(runtime, '1 to 3');
            runtime.variables.set('Source', source);
            const mapped = progression(runtime, 'Source * 2 + 7');
            expect(arithmeticRange(mapped.plan)).toEqual({ start: 9n, step: 2n, count: 3n });
            source.plan.iterate = function* () { yield 99n; yield 98n; yield 97n; };
            expect(arithmeticRange(mapped.plan)).toBeUndefined();
            expect([...mapped.plan.iterate()]).toEqual([205n, 203n, 201n]);
        } finally { runtime.dispose(); }
    });

    it.each(['iterate', 'at', 'size'])('does not invoke a replaced %s getter while proving bounds', property => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const mapped = progression(runtime, '(1 to 3) * 2');
            expect(arithmeticRange(mapped.plan)).toBeDefined();
            let calls = 0;
            Object.defineProperty(mapped.plan, property, { get() { calls++; throw Error('observable getter'); } });
            expect(arithmeticRange(mapped.plan)).toBeUndefined();
            expect(calls).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('revalidates cached sizes and source getters without observing them', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const source = progression(runtime, '1 to 3');
            runtime.variables.set('Source', source);
            const mapped = progression(runtime, 'Source * 0 + 2');
            expect(arithmeticRange(mapped.plan)).toBeDefined();
            let calls = 0;
            Object.defineProperty(source.plan, 'at', { configurable: true, get() { calls++; throw Error('host read'); } });
            expect(arithmeticRange(mapped.plan)).toBeUndefined();
            expect(calls).toBe(0);
            const another = progression(runtime, '(1 to 3) * 2');
            expect(arithmeticRange(another.plan)).toBeDefined();
            if (another.plan.size.kind !== 'exact') throw Error('exact size');
            Object.defineProperty(another.plan.size, 'value', { value: 4n });
            expect(arithmeticRange(another.plan)).toBeUndefined();
        } finally { runtime.dispose(); }
    });

    it('keeps an already materialized result after a source change and polls cancellation', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const source = progression(runtime, '0 till 4096');
            runtime.variables.set('Source', source);
            runtime.execute("Twos' = Source * 0 + 2\nSaved = Twos array");
            source.plan.iterate = function* () { yield 99n; };
            expect(runtime.execute('Saved 4095')).toBe(2n);
            const flag = new Int32Array(new SharedArrayBuffer(4));
            flag[0] = 1;
            expect(() => withInterrupt(flag, () => runtime.execute('((0 till 4096) * 0 + 2) array'))).toThrow('Interrupted');
        } finally { runtime.dispose(); }
    });

    it('declines proof under inspection and host polling', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            const mapped = progression(runtime, '(1 to 3) * 2');
            const flag = new Int32Array(new SharedArrayBuffer(12));
            expect(withInterrupt(flag, () => arithmeticRange(mapped.plan), () => {})).toBeUndefined();
            const host = { length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} };
            expect(withInterrupt(host, () => arithmeticRange(mapped.plan))).toBeUndefined();
        } finally { runtime.dispose(); }
    });
});
