import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { ownedArray, typedArray, readArrayItem } from '../src/array-storage.js';
import { registerScalarView } from '../src/integer-view.js';
import { sortedIndexBatch } from '../src/sorted-search.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

const huge = 10n ** 100n;
const values = [-huge, -huge, -1n, 0n, 1n, huge, huge, huge + 1n];
const queries = [huge + 2n, huge, -huge - 1n, -huge, 0n, 2n, -1n, huge + 1n];
const read = (value: RankArray) => Array.from({ length: value.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(value, i));

describe.each([false, true])('unbounded integer search batches (upper=%s)', upper => {
    it('matches independent counts through duplicates and both directions', () => {
        const source = ownedArray(values), targets = ownedArray(queries, [2, 4]);
        const diagnostics = new RuntimeDiagnostics();
        const found = diagnostics.run(() => sortedIndexBatch(source, targets, upper))!;
        expect(found).toBeDefined();
        expect(found.shape).toEqual([2, 4]);
        expect(read(found)).toEqual(queries.map(q => BigInt(values.filter(x => upper ? x <= q : x < q).length)));
        expect(diagnostics.sortedIndexBatches).toBe(1);
        expect(diagnostics.sortedIndexBatchQueries).toBe(8);
        expect(read(source)).toEqual(values);
    });
    it.each(['int32', 'int64', 'boxed'])('combines boxed sources with %s targets', type => {
        const items = [-2n, -1n, 0n, 1n, 2n];
        const target = type === 'int32' ? typedArray(Int32Array.from(items, Number))
            : type === 'int64' ? typedArray(BigInt64Array.from(items)) : ownedArray(items);
        const found = sortedIndexBatch(ownedArray(values), target, upper)!;
        expect(read(found)).toEqual(items.map(q => BigInt(values.filter(x => upper ? x <= q : x < q).length)));
    });
    it.each(['int32', 'int64'])('combines %s sources with unbounded targets', type => {
        const cells = [-2n, -1n, 0n, 1n, 2n];
        const source = type === 'int32' ? typedArray(Int32Array.from(cells, Number)) : typedArray(BigInt64Array.from(cells));
        const found = sortedIndexBatch(source, ownedArray(queries), upper)!;
        expect(read(found)).toEqual(queries.map(q => BigInt(cells.filter(x => upper ? x <= q : x < q).length)));
    });
    it('uses logical offsets for strided sources and reversed targets', () => {
        const stored = ownedArray(values.flatMap(x => [x, 999n]));
        const source = registerScalarView<RankArray>({ kind: 'array', shape: [values.length], items: [] },
            stored, i => i * 2, { linear: () => ({ offset: 0, stride: 2 }) });
        const target = registerScalarView<RankArray>({ kind: 'array', shape: [queries.length], items: [] },
            ownedArray(queries), i => queries.length - 1 - i, { linear: () => ({ offset: queries.length - 1, stride: -1 }) });
        const found = sortedIndexBatch(source, target, upper)!;
        expect(read(found)).toEqual([...queries].reverse().map(q => BigInt(values.filter(x => upper ? x <= q : x < q).length)));
    });
    it('keeps opaque readers unforced', () => {
        let reads = 0;
        const opaque: RankArray = { kind: 'array', shape: [8], items: [], itemAt: () => { reads++; return huge; } };
        expect(sortedIndexBatch(opaque, ownedArray(queries), upper)).toBeUndefined();
        expect(sortedIndexBatch(ownedArray(values), opaque, upper)).toBeUndefined();
        expect(reads).toBe(0);
    });
    it('retains ordinary paths for mixed, real, budgeted and shared inputs', () => {
        const source = ownedArray(values), target = ownedArray(queries);
        for (const bad of [ownedArray(['bad']), typedArray(Float64Array.of(1, NaN)),
            typedArray(new BigInt64Array(new SharedArrayBuffer(16))),
            typedArray(new Int32Array(new SharedArrayBuffer(16)))]) {
            expect(sortedIndexBatch(source, bad, upper)).toBeUndefined();
            expect(sortedIndexBatch(bad, target, upper)).toBeUndefined();
        }
        withDemandBudget(100, () => expect(sortedIndexBatch(source, target, upper)).toBeUndefined());
    });
});
it.each([false, true])('invalidates integer proofs after edits (compilation=%s)', compilation => {
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        runtime.execute('use algo\nuse sequences\nData = array 0 (10 ** 100)\nQuery = array 1 (10 ** 101)');
        const diagnostics = new RuntimeDiagnostics();
        const first = diagnostics.run(() => runtime.execute('Data upperindex Query')) as RankArray;
        expect(read(first)).toEqual([1n, 2n]);
        expect(diagnostics.sortedIndexBatches).toBe(1);
        runtime.execute('Data 1 = 0');
        expect(read(runtime.execute('Data upperindex Query') as RankArray)).toEqual([2n, 2n]);
        expect(() => runtime.execute('Data 1 = "bad"')).toThrow();
        expect(read(runtime.execute('Data upperindex Query') as RankArray)).toEqual([2n, 2n]);
    } finally { runtime.dispose(); }
});
it('declines observable host polling without touching readers', () => {
    let calls = 0;
    const signal = { length: 1, load: () => { calls++; return 0; }, store: () => {}, exchange: () => 0, wait: () => {} };
    withInterrupt(signal, () => expect(sortedIndexBatch(ownedArray(values), ownedArray(queries), true)).toBeUndefined());
    expect(calls).toBe(0);
});
it.each([false, true])('repairs rounded search boundaries exactly (upper=%s)', upper => {
    const source = [-huge, -(1n << 80n), -(1n << 54n), 0n, 1n << 54n, 1n << 80n, huge];
    const cycle = source.flatMap(x => [x - 1n, x, x + 1n]).reverse();
    const targets = Array.from({ length: 4096 }, (_, i) => cycle[i % cycle.length]);
    const diagnostics = new RuntimeDiagnostics();
    const found = diagnostics.run(() => sortedIndexBatch(ownedArray(source), ownedArray(targets), upper))!;
    expect(read(found)).toEqual(targets.map(q => BigInt(source.filter(x => upper ? x <= q : x < q).length)));
    expect(diagnostics.sortedIndexCoarseBatches).toBe(1);
});
it.each([false, true])('keeps exact searches when source images collide or overflow (upper=%s)', upper => {
    for (const source of [[huge, huge + 1n, huge + 2n], [10n ** 400n, 10n ** 401n]]) {
        const cycle = source.flatMap(x => [x - 1n, x, x + 1n]);
        const targets = Array.from({ length: 2048 }, (_, i) => cycle[i % cycle.length]);
        const diagnostics = new RuntimeDiagnostics();
        const found = diagnostics.run(() => sortedIndexBatch(ownedArray(source), ownedArray(targets), upper))!;
        expect(read(found)).toEqual(targets.map(q => BigInt(source.filter(x => upper ? x <= q : x < q).length)));
        expect(diagnostics.sortedIndexCoarseBatches).toBe(0);
    }
});
it.each([false, true])('repairs infinite target images against distinct endpoint images (upper=%s)', upper => {
    const source = [-(10n ** 400n), -huge, 0n, huge, 10n ** 400n];
    const cycle = source.flatMap(x => [x - 1n, x, x + 1n]);
    const targets = Array.from({ length: 2048 }, (_, i) => cycle[i % cycle.length]);
    const diagnostics = new RuntimeDiagnostics();
    const found = diagnostics.run(() => sortedIndexBatch(ownedArray(source), ownedArray(targets), upper))!;
    expect(read(found)).toEqual(targets.map(q => BigInt(source.filter(x => upper ? x <= q : x < q).length)));
    expect(diagnostics.sortedIndexCoarseBatches).toBe(1);
});

it('does not run deferred binding checks to admit a wide batch', () => {
    let checks = 0;
    const source = registerScalarView<RankArray>({ kind: 'array', shape: [values.length], items: [] }, ownedArray(values), i => i,
        { linear: () => ({ offset: 0, stride: 1 }), accepts: () => false, check: value => { checks++; return value; } });
    expect(sortedIndexBatch(source, ownedArray(queries), true)).toBeUndefined();
    expect(checks).toBe(0);
});
it('handles empty sources and target tensors without inspecting a cell', () => {
    const empty = typedArray(new Int32Array(0));
    expect(read(sortedIndexBatch(empty, ownedArray(queries), true)!)).toEqual(queries.map(() => 0n));
    const found = sortedIndexBatch(ownedArray(values), typedArray(new Int32Array(0), [2, 0]), true)!;
    expect(found.shape).toEqual([2, 0]); expect(read(found)).toEqual([]);
});
