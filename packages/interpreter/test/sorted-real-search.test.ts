import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { ownedArray, typedArray } from '../src/array-storage.js';
import { sortedIndex, sortedIndexBatch } from '../src/sorted-search.js';
import { checkpoint, INTERRUPT_POLL_INTERVAL, withDemandBudget, withInterrupt } from '../src/interrupt.js';
import type { RankArray } from '../src/value.js';

const count = (values: (number | bigint)[], wanted: number | bigint, upper: boolean) => BigInt(values.filter(x => upper ? x <= wanted : x < wanted).length);
it.each([false, true])('searches real and mixed numeric scalars (upper=%s)', upper => {
    const values = [-Infinity, -2.5, -0, 0, 1.25, 1.25, 9007199254740992, Infinity];
    for (const source of [ownedArray(values), typedArray(Float64Array.from(values))]) {
        for (const target of [-Infinity, -3n, -2.5, 0n, 1n, 1.25, 2n, 9007199254740993n, Infinity]) {
            expect(sortedIndex(source, target, upper)).toBe(count(values, target, upper));
        }
    }
    const integers = [-(1n << 100n), -1n, 0n, 1n, 9007199254740993n, 1n << 100n];
    for (const target of [-Infinity, -0.5, 0, 0.5, 1, 9007199254740992, Infinity])
        expect(sortedIndex(ownedArray(integers), target, upper)).toBe(count(integers, target, upper));
});
it.each([false, true])('batches real, integer and mixed tensors (upper=%s)', upper => {
    const values = [-4, -2.5, 0, 1.25, 1.25, 8];
    const source = typedArray(Float64Array.from(values));
    for (const targets of [typedArray(Float64Array.of(-5, 1.25, 8, 9, 0, -2.5), [2, 3]),
        typedArray(BigInt64Array.of(-5n, 1n, 8n, 9n, 0n, -2n), [2, 3])]) {
        const result = sortedIndexBatch(source, targets, upper)!;
        expect(result.shape).toEqual([2, 3]);
        expect(result.items).toEqual(targets.items.map(t => count(values, t as number | bigint, upper)));
    }
    const ints = [0n, 1n, 1n, 8n];
    const queries = [-1, 0.5, 1, 9];
    expect(sortedIndexBatch(typedArray(BigInt64Array.from(ints)), typedArray(Float64Array.from(queries)), upper)!.items)
        .toEqual(queries.map(t => count(ints, t, upper)));
});
it('gallops in both directions, through repeated queries and source edits', () => {
    const values = Array.from({ length: 1000 }, (_, i) => i / 4);
    const queries = [500, 3, 3, 4.5, -9, 250, ...values, ...[...values].reverse()];
    const source = typedArray(Float64Array.from(values)), targets = typedArray(Float64Array.from(queries));
    for (const upper of [false, true]) expect(sortedIndexBatch(source, targets, upper)!.items).toEqual(queries.map(t => count(values, t, upper)));
    source.items[999] = 999.5;
    expect(sortedIndex(source, 300.0, false)).toBe(999n);
});
it.each([false, true])('uses strided views and ranked real targets (compilation=%s)', compilation => {
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        runtime.execute('use algo\nuse sequences\nA = array 5.5 4.5 3.5 2.5 1.5\nQ = (array 0.0 2.5 3.0 9.0) reshape 2 2');
        expect(formatValue(runtime.execute('(A (4 to 0 by -1)) lowerindex Q')!)).toBe('0 1 2 5');
        expect(formatValue(runtime.execute('(A (4 to 0 by -1)) upperindex Q')!)).toBe('0 2 2 5');
    } finally { runtime.dispose(); }
});
it.each([false, true])('compiles real searches in a numeric loop (upper=%s)', upper => {
    const source = `use algo\nA = array 0.5 1.5 1.5 4.5\nDest = array shape 8 fill 0\nfor I in 0 till 8\n Target = I / 2.0\n Dest I = A ${upper ? 'upperindex' : 'lowerindex'} Target\nend`;
    for (const options of [{}, { compilation: false }, { numberLoopCompilation: false }]) {
        const runtime = new Interpreter(() => {}, options), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(source));
            expect((runtime.variables.get('Dest') as RankArray).items).toEqual(Array.from({ length: 8 }, (_, i) => count([0.5, 1.5, 1.5, 4.5], i / 2, upper)));
            if (!Object.keys(options).length) expect(diagnostics.numberLoops).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    }
});
it('rejects NaN only when demanded, including a late batch query', () => {
    expect(() => sortedIndex(typedArray(Float64Array.of(1, 2, 3)), NaN, false)).toThrow('NaN');
    expect(() => sortedIndex(typedArray(Float64Array.of(1, NaN, 3)), 2, true)).toThrow('NaN');
    const runtime = new Interpreter(() => {}, { compilation: false });
    runtime.variables.set('A', typedArray(Float64Array.of(1, 2, 3)));
    runtime.variables.set('Q', typedArray(Float64Array.of(0, NaN)));
    try {
        runtime.execute("use algo\nResult' = A lowerindex Q");
        expect(runtime.execute('Result 0')).toBe(0n);
        expect(() => runtime.execute('Result 1')).toThrow('NaN');
    } finally { runtime.dispose(); }
});
it('keeps foreign scalar reads on the logarithmic search path', () => {
    const visits: number[] = [];
    const source: RankArray = { kind: 'array', shape: [8], items: [], itemAt(index) { visits.push(index); return index + 0.5; } };
    expect(sortedIndex(source, 4.0, false)).toBe(4n);
    expect(visits).toEqual([4, 2, 3]);
});
it.each([4n, 4.0])('reads storage after opaque polling and declines budgeted batches (target=%s)', target => {
    const source = typedArray(Int32Array.of(1, 3, 5));
    const result = withInterrupt({ length: 1, load: () => 0, store() {}, wait() {}, exchange() {
        source.items[1] = 10n; source.items[2] = 20n; return 0;
    } }, () => { checkpoint(undefined, INTERRUPT_POLL_INTERVAL - 1); return sortedIndex(source, target, false); });
    expect(result).toBe(1n);
    expect(withDemandBudget(100, () => sortedIndexBatch(source, typedArray(Float64Array.of(0, 1)), false))).toBeUndefined();
});

it.each([false, true])('preserves public mixed precision and infinite endpoints (compilation=%s)', compilation => {
    const runtime = new Interpreter(() => {}, { compilation });
    runtime.variables.set('A', typedArray(Float64Array.of(-Infinity, 0, Infinity, Infinity)));
    runtime.variables.set('Q', typedArray(Float64Array.of(-Infinity, Infinity)));
    runtime.variables.set('Wide', ownedArray([9007199254740993n, 9007199254740995n]));
    try {
        runtime.execute('use algo');
        expect(formatValue(runtime.execute('A lowerindex Q')!)).toBe('0 2');
        expect(formatValue(runtime.execute('A upperindex Q')!)).toBe('1 4');
        expect(runtime.execute('Wide upperindex 9007199254740992.0')).toBe(0n);
        runtime.execute('Dest = array shape 2 fill 0\nfor I in 0 till 2\n Dest I = Wide upperindex 9007199254740992.0\nend');
        expect(formatValue(runtime.variables.get('Dest')!)).toBe('0 0');
    } finally { runtime.dispose(); }
});
it('declines NaN source proofs without forcing a lazy batch error', () => {
    const source = typedArray(Float64Array.of(1, NaN, 3));
    expect(sortedIndexBatch(source, typedArray(Float64Array.of(1, 2, 3, 4)), false)).toBeUndefined();
    const runtime = new Interpreter(() => {}, { compilation: false });
    runtime.variables.set('A', source);
    runtime.variables.set('Q', typedArray(Float64Array.of(1, 2, 3, 4)));
    try {
        runtime.execute("use algo\nResult' = A upperindex Q");
        expect(() => runtime.execute('Result 0')).toThrow('NaN');
    } finally { runtime.dispose(); }
});
