import { PrimeSieve } from '../src/prime-sieve.js';
import { describe, expect, it } from 'vitest';
import { Interpreter, isRankPlan } from '../src/index.js';
import { checkpoint, DemandBudgetExhausted, interruptsEnabled, interruptibleValues, passOver, withDemandBudget, withInterrupt } from '../src/interrupt.js';
import { demandValue } from '../src/plan.js';
import { compileTensorCellCopy } from '../src/tensor-cell-compiler.js';

describe('cooperative demand work budget', () => {
    it('counts productive computation without a host interrupt signal', () => {
        let completed = 0;
        expect(() => withDemandBudget(3, () => {
            expect(interruptsEnabled()).toBe(true);
            for (let i = 0; i < 10; i++) { checkpoint(); completed++; }
        })).toThrow(DemandBudgetExhausted);
        expect(completed).toBe(3);
        expect(interruptsEnabled()).toBe(false);
        expect(() => checkpoint()).not.toThrow();
    });

    it('charges bulk work before executing the chunk', () => {
        expect(() => withDemandBudget(10, () => {
            checkpoint('first chunk', 7);
            expect(() => checkpoint('too large', 4)).toThrow(DemandBudgetExhausted);
            checkpoint('remaining', 3);
            expect(() => passOver()).toThrow(DemandBudgetExhausted);
        })).not.toThrow();
    });

    it('does not refill the parent allowance in nested observations', () => {
        let work = 0;
        withDemandBudget(3, () => {
            withDemandBudget(100, () => { checkpoint(); work++; });
            withDemandBudget(100, () => { checkpoint(); work++; });
            withInterrupt(new Int32Array(new SharedArrayBuffer(4)), () => withDemandBudget(100, () => { checkpoint(); work++; }));
            expect(() => withDemandBudget(100, () => checkpoint())).toThrow(DemandBudgetExhausted);
        });
        expect(work).toBe(3);
        expect(() => withDemandBudget(1, () => checkpoint())).not.toThrow();
    });

    it('closes a productive iterator when its cooperative work runs out', () => {
        let reads = 0;
        let closes = 0;
        const source = { *[Symbol.iterator]() {
            try { for (let i = 0; i < 20; i++) { reads++; yield i; } }
            finally { closes++; }
        } };
        expect(() => withDemandBudget(2, () => Array.from(interruptibleValues(source, 'test')))).toThrow(DemandBudgetExhausted);
        expect(reads).toBe(3); // The next item is charged before reaching its consumer.
        expect(closes).toBe(1);
    });

    it('checks a tensor-copy kernel created before the demand scope', () => {
        const copy = compileTensorCellCopy(2, [1])!;
        let reads = 0;
        const input = { kind: 'array' as const, shape: [1, 20], get items() { reads++; return Array<bigint>(20).fill(1n); } };
        expect(() => withDemandBudget(2, () => copy(input, [0, 0], [20]))).toThrow(DemandBudgetExhausted);
        expect(reads).toBe(2);
        expect(copy(input, [0, 0], [20])).toHaveLength(20);
    });
});

describe.each([false, true])('bounded planned function work (compilation=%s)', compilation => {
    it('stops a producing loop and leaves ordinary demand unaffected', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(`fun N busy
 Total = 0
 for I in 0 till N
  Total += I
 end
 return Total
end
Result' = ((array 20000) busy rank 0) sum`);
            const plan = runtime.variables.get('Result')!;
            expect(isRankPlan(plan)).toBe(true);
            expect(() => withDemandBudget(100, () => demandValue(plan))).toThrow(DemandBudgetExhausted);
            expect(() => withDemandBudget(100, () => runtime.execute('Saved = Result'))).toThrow(DemandBudgetExhausted);
            expect(runtime.variables.has('Saved')).toBe(false);
            expect(runtime.execute('10 busy')).toBe(45n);
            expect(runtime.variables.has('Total')).toBe(false);
        } finally { runtime.dispose(); }
    });
});


it('keeps the cold prime prefix within budget and validates segment transitions', () => {
    const sieve = new PrimeSieve();
    const prime = (value: number): boolean => {
        for (let divisor = 2; divisor * divisor <= value; divisor++) if (value % divisor === 0) return false;
        return value >= 2;
    };
    withDemandBudget(10_000, () => {
        for (let value = 3; value <= 257; value += 2) expect(sieve.contains(value)).toBe(prime(value));
    });
    for (const value of [259, 263, 65533, 65535, 65537, 65539, 131071, 131073, 3, 257, 259]) {
        expect(sieve.contains(value)).toBe(prime(value));
    }
    expect(() => withDemandBudget(1, () => sieve.contains(300001))).toThrow(DemandBudgetExhausted);
    expect(sieve.contains(300001)).toBe(prime(300001));
});
