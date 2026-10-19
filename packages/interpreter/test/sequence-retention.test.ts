import { describe, expect, it } from 'vitest';
import { ownedArray } from '../src/array-storage.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { DemandBudgetExhausted, InterruptedError } from '../src/interrupt.js';
import { retainSequencePlan } from '../src/sequence-retention.js';
import type { RankValue, SequencePlan } from '../src/value.js';

function counted(values: RankValue[]) {
    const counts = { reads: 0, starts: 0, closes: 0 };
    const plan: SequencePlan = { name: 'test', replay: 'pure', size: { kind: 'unknown' },
        *iterate() {
            counts.starts++;
            try { for (const value of values) { counts.reads++; yield value; } }
            finally { counts.closes++; }
        },
    };
    return { counts, plan };
}

describe('bounded pure sequence retention', () => {
    it('shares a prefix between interleaved readers without closing an abandoned source', () => {
        const { plan, counts } = counted([1n, 2n, 3n]);
        const replay = retainSequencePlan(plan);
        const a = replay.iterate(), b = replay.iterate();
        expect(a.next().value).toBe(1n);
        expect(b.next().value).toBe(1n);
        expect(b.next().value).toBe(2n);
        a.return?.();
        expect(counts).toEqual({ starts: 1, reads: 2, closes: 0 });
        expect([...replay.iterate()]).toEqual([1n, 2n, 3n]);
        expect([...b]).toEqual([3n]);
        expect(counts).toEqual({ starts: 1, reads: 3, closes: 1 });
        expect(replay.size).toEqual({ kind: 'exact', value: 3n });
    });

    it('remembers empty completion', () => {
        const { plan, counts } = counted([]);
        const replay = retainSequencePlan(plan);
        expect([...replay.iterate()]).toEqual([]);
        expect([...replay.iterate()]).toEqual([]);
        expect(replay.size).toEqual({ kind: 'exact', value: 0n });
        expect(counts.starts).toBe(1);
    });

    it('does not force the tail of an infinite source for indexing or an abandoned reader', () => {
        let reads = 0;
        const replay = retainSequencePlan({ name: 'infinite', replay: 'pure', size: { kind: 'infinite' },
            *iterate() { for (let n = 0n; ; n++) { reads++; yield n; } },
        });
        expect(replay.at!(3n)).toBe(3n);
        expect(reads).toBe(4);
        expect(replay.at!(2n)).toBe(2n);
        expect(reads).toBe(4);
    });

    it('retains a source error at its position without rerunning successful work', () => {
        let starts = 0;
        const error = new Error('source failed');
        const replay = retainSequencePlan({ name: 'error', replay: 'pure', size: { kind: 'unknown' },
            *iterate() { starts++; yield 1n; throw error; },
        });
        expect(() => [...replay.iterate()]).toThrow(error);
        expect(replay.at!(0n)).toBe(1n);
        expect(() => [...replay.iterate()]).toThrow(error);
        expect(starts).toBe(1);
    });

    it.each([new InterruptedError(), new DemandBudgetExhausted()])('restarts after a transient host interruption %s', error => {
        let starts = 0;
        const replay = retainSequencePlan({ name: 'interrupted', replay: 'pure', size: { kind: 'unknown' },
            *iterate() { starts++; yield 1n; if (starts === 1) throw error; yield 2n; },
        });
        expect(() => [...replay.iterate()]).toThrow();
        expect([...replay.iterate()]).toEqual([1n, 2n]);
        expect(starts).toBe(2);
    });

    it('drops history at the budget and keeps current and future readers correct', () => {
        const { plan, counts } = counted([1n, 2n, 3n, 4n]);
        const stats = new RuntimeDiagnostics();
        const replay = stats.run(() => retainSequencePlan(plan, 70));
        const lagging = replay.iterate(), leading = replay.iterate();
        expect(lagging.next().value).toBe(1n);
        expect([...leading]).toEqual([1n, 2n, 3n, 4n]);
        expect([...lagging]).toEqual([2n, 3n, 4n]);
        expect([...replay.iterate()]).toEqual([1n, 2n, 3n, 4n]);
        expect(stats.sequenceCacheBytes).toBe(0);
        expect(stats.sequenceCachePeakBytes).toBeLessThanOrEqual(70);
        expect(stats.sequenceCacheEvictions).toBe(1);
        expect(counts.starts).toBe(3);
    });

    it('does not cache unknown, cheap direct, or single-pass sources', () => {
        for (const extra of [{ replay: undefined }, { replay: 'direct' as const }, { singlePass: true }]) {
            const plan = { ...counted([1n]).plan, ...extra };
            expect(retainSequencePlan(plan)).toBe(plan);
        }
    });

    it('does not force a lazy yielded array to determine whether it fits', () => {
        let reads = 0;
        const lazy = { kind: 'array' as const, items: [], shape: [1], itemAt() { reads++; return 1n; } };
        const { plan } = counted([lazy]);
        const replay = retainSequencePlan(plan);
        expect([...replay.iterate()]).toEqual([lazy]);
        expect(reads).toBe(0);
    });

    it('counts array payloads against the budget rather than just outer elements', () => {
        const stats = new RuntimeDiagnostics();
        const { plan } = counted([ownedArray(Array(100).fill(1n), [100])]);
        const replay = stats.run(() => retainSequencePlan(plan, 100));
        expect([...replay.iterate()]).toHaveLength(1);
        expect(stats.sequenceCacheBytes).toBe(0);
        expect(stats.sequenceCacheEvictions).toBe(1);
    });
});
