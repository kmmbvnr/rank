import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, type RankValue } from '../src/index.js';
import { IndexEntries, indexKey, indexGet, indexHas, indexSet } from '../src/index-storage.js';
import { newStructure } from '../src/collections.js';
import { isRankIndex } from '../src/value.js';
import { setValueKey } from '../src/set.js';
import { clonePreviewValue } from '../src/preview-values.js';

describe('index storage', () => {
    it('maintains the integer proof across public writes, replacement, deletion and clear', () => {
        const entries = new IndexEntries();
        expect(entries.integers).toBe(true);
        entries.set(1, 3n).set(2, false).set(3, 'text');
        expect(entries.integers).toBe(false);
        entries.set(2, 4n);
        expect(entries.integers).toBe(false);
        entries.delete(99);
        entries.delete(3);
        expect(entries.integers).toBe(true);
        entries.set(1, false).set(1, true);
        expect(entries.integers).toBe(false);
        entries.clear();
        expect(entries.integers).toBe(true);
        entries.set(1, 5n);
        expect(entries.integers).toBe(true);
        const invalid = { get kind(): 'label' { throw new Error('host getter'); }, name: 'bad' };
        expect(() => entries.set(1, invalid)).toThrow('host getter');
        expect(entries.get(1)).toBe(5n);
        expect(entries.integers).toBe(true);
    });
    it('preserves scalar and tuple key equality across primitive and encoded keys', () => {
        const values: RankValue[] = [0n, 0, -0, 1n, 1, -1n, -1, 1.5, NaN, Infinity, -Infinity,
            9007199254740991n, 9007199254740991, 9007199254740992n, 9007199254740992,
            9007199254740993n, 100000000000000000000n, 1e20,
            false, true, '1', 'number:1', '["number:1"]', '', 'a|text:b',
            { kind: 'label', name: '1' }];
        for (const left of values) for (const right of values) {
            // The existing set codec defines index equality, including integral
            // real/BigInt equivalence. Memo intentionally has a different codec.
            const equal = setValueKey(left) === setValueKey(right);
            expect(indexKey([left]) === indexKey([right])).toBe(equal);
            expect(indexKey([left, 'tail']) === indexKey([right, 'tail'])).toBe(equal);
            expect(indexKey([left, 0n]) === indexKey([right, 0n])).toBe(equal);
        }
        expect(indexKey([1n])).not.toBe(indexKey([1n, 0n]));
        expect(indexKey(['a', 'b|text:c'])).not.toBe(indexKey(['a|text:b', 'c']));
        expect(indexKey([1n, 23n])).not.toBe(indexKey([12n, 3n]));
        expect(indexKey([1n, 2n])).not.toBe(indexKey(['integers:1,2']));
        expect(indexKey([1n, 2n])).not.toBe(indexKey([1n, 2n, 0n]));
    });

    it('keeps aliases, insertion order, cached false/zero and detached previews', () => {
        const index = newStructure('index');
        if (!isRankIndex(index)) throw new Error('expected index');
        indexSet(index, indexKey([1n]), 0n);
        indexSet(index, indexKey(['x']), false);
        indexSet(index, indexKey([1.0]), 2n);
        expect(indexHas(index, indexKey([1.0]))).toBe(true);
        expect(indexGet(index, indexKey(['x']))).toBe(false);
        expect(indexGet(index, indexKey([3n]))).toBeUndefined();
        expect([...index.entries.values()]).toEqual([2n, false]);
        const preview = clonePreviewValue(index);
        if (!isRankIndex(preview)) throw new Error('expected index');
        indexSet(index, indexKey([1n]), 3n);
        expect(indexGet(preview, indexKey([1n]))).toBe(2n);
    });

    it('preserves key errors and interpreter/compiled reads, membership and writes', () => {
        expect(() => indexKey([])).toThrow('index requires at least one key');
        expect(() => indexKey([{ kind: 'index', entries: new Map() }])).toThrow('index keys must be scalar values');
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                expect(runtime.execute(`use algo
fun N work
  Cache = new index
  Cache 1 = 0
  Cache 2 = 7
  Total = 0
  for I in 1 to N
    if I in Cache
      Total += Cache I
    end
    Cache (I + 10) = Total
  end
  return Cache (N + 10)
end
2 work`)).toBe(7n);
                expect(runtime.execute(`Cache = new index
Cache 1 = false
Cache 1.0`)).toBe(false);
                expect(runtime.execute('Cache 2 default -1')).toBe(-1n);
                expect(() => runtime.execute('Cache 2 += 1')).toThrow(RankError);
            } finally { runtime.dispose(); }
        }
    });
});
