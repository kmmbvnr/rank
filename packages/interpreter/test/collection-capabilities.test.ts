import { Interpreter } from '../src/interpreter.js';
import { expect, it } from 'vitest';
import { collectionSize } from '../src/collection-size.js';
import { orderedSource } from '../src/ordered-source.js';
import { indexedSource } from '../src/indexed-source.js';
import { tensorSource } from '../src/tensor-source.js';
import { takeDropValue, sequence } from '../src/sequence.js';
import { meanValue, medianValue } from '../src/modules/stats.js';
import { numericExtreme } from '../src/modules/numbers.js';
import { selectAxis } from '../src/selectors.js';
import { applySelectors } from '../src/value-selection.js';
import { MISSING, isNativeFunction, isRankArray, isRankSequence, type RankValue } from '../src/value.js';

const vector = (items: RankValue[]) => ({ kind: 'array' as const, shape: [items.length], items });
const call = (name: string, value: RankValue): RankValue => {
    const runtime = new Interpreter();
    try {
        runtime.execute('use sequences');
        const fn = runtime.execute(name)!;
        if (!isNativeFunction(fn)) throw Error('expected native function');
        return fn.call([value]);
    } finally { runtime.dispose(); }
};

it('reads dimensions without touching tensor elements and selects whole leading-axis cells', () => {
    const value = { kind: 'array' as const, shape: [2, 2], get items(): RankValue[] { throw Error('forced'); },
        itemAt: (index: number) => BigInt(index + 1) };
    expect(collectionSize(value)!.length()).toBe(2n);
    expect(collectionSize(value, 'shape')!.axes!()).toEqual([2n, 2n]);
    expect(tensorSource(value)).toBe(value);
    const row = orderedSource(value, 'ordered', 'first')!.end!(false);
    expect(isRankArray(row) && row.shape).toEqual([2]);
    expect(isRankArray(row) && row.items).toEqual([1n, 2n]);
    const reversed = orderedSource(value, 'ordered', 'reverse')!.reverse!();
    expect(isRankArray(reversed) && reversed.items).toEqual([3n, 4n, 1n, 2n]);
});

it('separates size, shape and traversal capabilities', () => {
    const tuple = { kind: 'tuple' as const, items: [1n, 'x'] };
    expect(collectionSize(tuple)!.length()).toBe(2n);
    expect(collectionSize(tuple, 'shape')).toBeUndefined();
    expect(orderedSource(tuple, 'ordered', 'first')).toBeUndefined();
    expect(indexedSource(vector([1n]))!.axisSize(0)).toBe(1);
    expect(() => indexedSource(vector([1n]))!.axisSize(1)).toThrow('array has no axis 1');
});

it('retains Unicode code points and plain-host queue ordering', () => {
    const text = 'a𝄞b';
    expect(collectionSize(text)!.length()).toBe(3n);
    expect(orderedSource(text, 'ordered', 'reverse')!.reverse!()).toBe('b𝄞a');
    expect(selectAxis(text, 0, vector([2n, 1n]))).toBe('b𝄞');
    expect(applySelectors([text, 1n])).toBe('𝄞');
    const queue = { kind: 'queue' as const, items: [7n, 2n, 7n] };
    expect(orderedSource(queue, 'ordered', 'first')!.end!(false)).toBe(7n);
    expect(orderedSource(queue, 'ordered', 'last')!.end!(true)).toBe(7n);
    expect(call('unique', queue)).toEqual({ kind: 'queue', items: [7n, 2n] });
    expect(queue.items).toEqual([7n, 2n, 7n]);
});

it('keeps unique lazy and restartable, and take/drop retain sequence size semantics', () => {
    let reads = 0;
    const value = sequence({ name: 'input', size: { kind: 'exact', value: 4n },
        *iterate() { for (const item of [1n, 1n, 2n, 2n]) { reads++; yield item; } } });
    const unique = call('unique', value);
    expect(reads).toBe(0);
    if (!isRankSequence(unique)) throw Error('expected lazy sequence');
    expect([...unique.plan.iterate()]).toEqual([1n, 2n]);
    expect([...unique.plan.iterate()]).toEqual([1n, 2n]);
    expect(reads).toBe(8);
    const dropped = takeDropValue(value, 3n, true);
    expect(isRankSequence(dropped) && dropped.plan.size).toEqual({ kind: 'exact', value: 1n });
    const infinite = sequence({ name: 'forever', size: { kind: 'infinite' },
        *iterate() { throw Error('must not read'); } });
    const empty = takeDropValue(infinite, 0n);
    expect(isRankSequence(empty) && [...empty.plan.iterate()]).toEqual([]);
    expect(() => collectionSize(infinite)!.length()).toThrow('len requires a finite sequence');
});

it('preserves empty, missing and left-to-right short circuit behavior across consumers', () => {
    expect(meanValue(vector([1n, MISSING, 3n]))).toBe(2);
    expect(medianValue(vector([1n, MISSING, 3n]))).toBe(2);
    const items = vector([]);
    expect(call('all', items)).toBe(true);
    expect(call('any', items)).toBe(false);
    expect(() => meanValue(items)).toThrow('mean requires at least one value');
    expect(() => numericExtreme('min', (a, b) => a < b).call([items])).toThrow('min requires at least one value');
    const short = sequence({ name: 'short', size: { kind: 'unknown' },
        *iterate() { yield false; throw Error('read too far'); } });
    expect(call('all', short)).toBe(false);
    const sorted = call('sort', vector([3n, 1n, 2n]));
    expect(isRankArray(sorted) && sorted.items).toEqual([1n, 2n, 3n]);
});
