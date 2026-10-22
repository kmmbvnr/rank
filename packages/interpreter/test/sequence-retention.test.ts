import { describe, expect, it } from 'vitest';
import { ownedArray } from '../src/array-storage.js';
import { DemandBudgetExhausted, InterruptedError } from '../src/interrupt.js';
import { materializeValue } from '../src/materialize.js';
import { sequence } from '../src/sequence.js';
import type { RankArray, RankValue } from '../src/value.js';

function counted(values: RankValue[]) {
    const counts = { reads: 0, starts: 0, closes: 0 };
    const source = sequence({ name: 'test', replay: 'pure', size: { kind: 'unknown' },
        *iterate() {
            counts.starts++;
            try { for (const value of values) { counts.reads++; yield value; } }
            finally { counts.closes++; }
        },
    });
    return { counts, source };
}

describe('recomputed sequences and explicit retained values', () => {
    it('keeps interleaved readers independent and closes only the abandoned reader', () => {
        const { source, counts } = counted([1n, 2n, 3n]);
        const a = source.plan.iterate(), b = source.plan.iterate();
        expect(a.next().value).toBe(1n);
        expect(b.next().value).toBe(1n);
        expect(b.next().value).toBe(2n);
        a.return?.();
        expect(counts).toEqual({ starts: 2, reads: 3, closes: 1 });
        expect([...b]).toEqual([3n]);
        expect([...source.plan.iterate()]).toEqual([1n, 2n, 3n]);
        expect(counts).toEqual({ starts: 3, reads: 7, closes: 3 });
    });

    it('recomputes empty completion instead of retaining an exhausted iterator', () => {
        const { source, counts } = counted([]);
        expect((materializeValue(source) as RankArray).items).toEqual([]);
        expect((materializeValue(source) as RankArray).items).toEqual([]);
        expect(counts).toEqual({ starts: 2, reads: 0, closes: 2 });
        expect(source.plan.size).toEqual({ kind: 'unknown' });
    });

    it('can stop independent infinite readers without forcing their tail', () => {
        let reads = 0;
        let closes = 0;
        const source = sequence({ name: 'infinite', replay: 'pure', size: { kind: 'infinite' },
            *iterate() { try { for (let n = 0n; ; n++) { reads++; yield n; } } finally { closes++; } },
        });
        for (let pass = 0; pass < 2; pass++) {
            const reader = source.plan.iterate();
            expect(reader.next().value).toBe(0n);
            expect(reader.next().value).toBe(1n);
            reader.return?.();
        }
        expect(reads).toBe(4);
        expect(closes).toBe(2);
        expect(() => materializeValue(source)).toThrowError(/infinite/);
        expect(reads).toBe(4);
    });

    it('reexecutes both successful work and errors on a later demand', () => {
        let starts = 0;
        let closes = 0;
        let reads = 0;
        const error = new Error('source failed');
        const source = sequence({ name: 'error', replay: 'pure', size: { kind: 'unknown' },
            *iterate() {
                starts++;
                try { reads++; yield 1n; throw error; }
                finally { closes++; }
            },
        });
        expect(() => materializeValue(source)).toThrow(error);
        expect(() => materializeValue(source)).toThrow(error);
        expect({ starts, reads, closes }).toEqual({ starts: 2, reads: 2, closes: 2 });
    });

    it.each([new InterruptedError(), new DemandBudgetExhausted()])('recomputes after host interruption: %s', error => {
        let starts = 0;
        let closes = 0;
        const source = sequence({ name: 'interrupted', replay: 'pure', size: { kind: 'unknown' },
            *iterate() {
                starts++;
                try { yield 1n; if (starts === 1) throw error; yield 2n; }
                finally { closes++; }
            },
        });
        expect(() => materializeValue(source)).toThrow();
        expect((materializeValue(source) as RankArray).items).toEqual([1n, 2n]);
        expect({ starts, closes }).toEqual({ starts: 2, closes: 2 });
    });

    it('does not force a yielded lazy array until a value completion boundary', () => {
        let reads = 0;
        const lazy: RankArray = { kind: 'array', items: [], shape: [1], itemAt() { reads++; return 1n; } };
        const { source } = counted([lazy]);
        expect([...source.plan.iterate()]).toEqual([lazy]);
        expect(reads).toBe(0);
        const ready = materializeValue(source) as RankArray;
        expect(reads).toBe(1);
        expect(ready.shape).toEqual([1, 1]);
        expect(ready.items).toEqual([1n]);
    });

    it('retains an explicitly completed value independently of later source demands', () => {
        const payload = ownedArray(Array(100).fill(1n));
        const { source, counts } = counted([payload]);
        const ready = materializeValue(source) as RankArray;
        expect(ready.shape).toEqual([1, 100]);
        expect(ready.items).toEqual(payload.items);
        expect(counts.reads).toBe(1);
        expect(materializeValue(ready)).toBe(ready);
        expect(materializeValue(ready)).toBe(ready);
        expect(counts.reads).toBe(1);
        materializeValue(source);
        expect(counts.reads).toBe(2);
    });
});
