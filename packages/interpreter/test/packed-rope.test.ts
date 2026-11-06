import { describe, expect, it } from 'vitest';
import { rope, ropeSlice, ropeReverse, ropeConcat, ropeChunks, ropeRuns } from '../src/rope.js';
import { typedArray, readArrayItem } from '../src/array-storage.js';
import { completeNativeSequence } from '../src/sequence-completion.js';
import { withDemandBudget, withInterrupt, checkpoint, type InterruptSignal } from '../src/interrupt.js';
import { Interpreter, isRankSequence, RuntimeDiagnostics, type RankArray, type RankValue } from '../src/index.js';

function cells(value: RankArray): RankValue[] { return Array.from({ length: value.shape.reduce((a,b) => a*b, 1) }, (_, i) => readArrayItem(value, i)); }
function chunks(tree: ReturnType<typeof rope>) {
    return [...ropeChunks(tree).plan.iterate()].map(value => {
        if (typeof value !== 'object') throw Error('expected chunk');
        return value.kind === 'sequence' ? { kind: value.kind, values: [...value.plan.iterate()] }
            : value.kind === 'array' ? { kind: value.kind, values: cells(value) } : undefined;
    });
}
const irregular = Array.from({ length: 1027 }, (_, i) => BigInt((i * i + 11 * i) % 7919 - 4000));

describe('packed integer rope storage and completion', () => {
    it.each(['int32', 'int64'] as const)('matches snapshots, chunks and runs with %s cells', kind => {
        const values = kind === 'int32' ? irregular : irregular.map(x => x + (1n << 50n));
        const data = kind === 'int32' ? Int32Array.from(values, Number) : BigInt64Array.from(values);
        const source = typedArray(data);
        let reads = 0;
        const fallback: RankArray = { kind: 'array', shape: [values.length], items: [], itemAt: i => { reads++; return values[i]; } };
        const tree = rope(source), expected = rope(fallback);
        expect(reads).toBe(values.length);
        expect([...tree.plan.iterate()]).toEqual(values);
        expect(chunks(tree)).toEqual(chunks(expected));
        expect(cells(ropeRuns(tree))).toEqual(cells(ropeRuns(expected)));
        source.items[0] = 123456n;
        expect(tree.plan.at!(0n)).toBe(values[0]);
        const changed = ropeConcat([ropeSlice(tree, 13n, true), ropeReverse(ropeSlice(tree, 21n, false))]);
        const reference = ropeConcat([ropeSlice(expected, 13n, true), ropeReverse(ropeSlice(expected, 21n, false))]);
        expect([...changed.plan.iterate()]).toEqual([...reference.plan.iterate()]);
        const diagnostics = new RuntimeDiagnostics(), result = diagnostics.run(() => completeNativeSequence(changed.plan));
        expect(result).toBeDefined();
        expect(cells(result!)).toEqual([...reference.plan.iterate()]);
        expect(diagnostics.nativeSequenceCopies).toBe(1);
    });

    it('retains range compression, including a single final cell', () => {
        const values = Array.from({ length: 1025 }, (_, i) => BigInt(i * 7 - 100));
        const native = rope(typedArray(Int32Array.from(values, Number)));
        const fallback = rope({ kind: 'array', shape: [values.length], items: values });
        expect(chunks(native)).toEqual(chunks(fallback));
        expect(cells(ropeRuns(native))).toEqual(cells(ropeRuns(fallback)));
    });

    it('copies signed Int64 extremes exactly and declines wider/mixed completion', () => {
        const values = [-9223372036854775808n, 9223372036854775807n, 0n, 7n, -9n];
        const tree = rope(typedArray(BigInt64Array.from(values)));
        expect(cells(completeNativeSequence(tree.plan)!)).toEqual(values);
        for (const source of [
            { kind: 'array' as const, shape: [3], items: [1n << 100n, 7n, 11n] },
            { kind: 'array' as const, shape: [3], items: [1n, 'x', 2n] },
        ]) {
            const other = rope(source);
            expect(completeNativeSequence(other.plan)).toBeUndefined();
            expect([...other.plan.iterate()]).toEqual(source.items);
        }
        const empty = rope({ kind: 'sequence', plan: { name: 'host', size: { kind: 'exact', value: 0n }, *iterate() {} } });
        expect(completeNativeSequence(empty.plan)).toBeUndefined();
    });

    it('declines huge completion and unregistered replacement plans', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\nHuge = (0 till 1000000000000000000) rope');
            const huge = runtime.variables.get('Huge');
            if (!huge || !isRankSequence(huge)) throw Error('missing rope');
            expect(completeNativeSequence(huge.plan)).toBeUndefined();
            const fake = { ...huge.plan, size: { kind: 'exact' as const, value: 1n }, *iterate() { yield 99n; } };
            expect(completeNativeSequence(fake)).toBeUndefined();
        } finally { runtime.dispose(); }
    });

    it('works when SharedArrayBuffer is unavailable', () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'SharedArrayBuffer')!;
        try {
            Object.defineProperty(globalThis, 'SharedArrayBuffer', { ...descriptor, value: undefined });
            const tree = rope(typedArray(Int32Array.from(irregular, Number)));
            expect(cells(completeNativeSequence(tree.plan)!)).toEqual(irregular);
        } finally { Object.defineProperty(globalThis, 'SharedArrayBuffer', descriptor); }
    });

    it('does not replace a host reader installed on owned storage', () => {
        const source = typedArray(Int32Array.from(irregular, Number));
        let reads = 0;
        Object.defineProperty(source, 'itemAt', { configurable: true, value: () => { reads++; return 42n; } });
        const tree = rope(source);
        expect(reads).toBe(irregular.length);
        expect([...tree.plan.iterate()]).toEqual(Array(irregular.length).fill(42n));
    });

    it('retains observable demand and polling after warm completion', () => {
        const source = typedArray(Int32Array.from(irregular, Number)), tree = rope(source);
        expect(completeNativeSequence(tree.plan)).toBeDefined();
        expect(withDemandBudget(100, () => completeNativeSequence(tree.plan))).toBeUndefined();
        expect(() => withDemandBudget(100, () => rope(source))).toThrow('demand budget exhausted');
        withDemandBudget(10, () => {
            try { rope(source); } catch { /* A failed look must consume the allowance. */ }
            expect(() => checkpoint('after rope')).toThrow('demand budget exhausted');
        });
        const signal: InterruptSignal = { length: 1, load: () => 0, store() {}, wait() {}, exchange: () => 0 };
        expect(withInterrupt(signal, () => completeNativeSequence(tree.plan))).toBeUndefined();
        expect(withInterrupt(new Int32Array(3), () => completeNativeSequence(tree.plan), () => {})).toBeUndefined();
        const flag = new Int32Array(new SharedArrayBuffer(4)); flag[0] = 1;
        expect(() => withInterrupt(flag, () => completeNativeSequence(tree.plan))).toThrow('Interrupted');
        flag[0] = 1;
        expect(() => withInterrupt(flag, () => rope(source))).toThrow('Interrupted');
        expect(completeNativeSequence(tree.plan)).toBeDefined();
    });
});
