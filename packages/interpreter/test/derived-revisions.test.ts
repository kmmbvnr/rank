import { Interpreter } from '../src/index.js';
import { describe, expect, it } from 'vitest';
import { createArraySnapshot, derivedArray, materializedArrayItems, ownedArray } from '../src/array-storage.js';
import type { RankArray, RankPlainArray } from '../src/value.js';

describe('derived array revisions', () => {
    it('tracks materialized sequences through cached outer products', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`A = (1 to 3) array
B = A A + outer`);
            const source = runtime.variables.get('A') as RankArray;
            const result = runtime.variables.get('B') as RankArray;
            let reads = 0;
            const observed = derivedArray([9], [result], i => {
                reads++;
                return result.itemAt!(i);
            });
            expect(observed.items).toEqual([2n, 3n, 4n, 3n, 4n, 5n, 4n, 5n, 6n]);
            expect(observed.itemAt!(0)).toBe(2n);
            expect(reads).toBe(9);
            source.items[0] = 10n;
            expect(reads).toBe(9);
            expect(observed.itemAt!(0)).toBe(20n);
            expect(reads).toBe(10);
            expect(observed.itemAt!(1)).toBe(12n);
        } finally { runtime.dispose(); }
    });

    // Retaining B freezes A, so the loop writes storage of its own. Batching a
    // compiled region's writes is safe for exactly that reason: nothing a name
    // still holds can read the cells it changes.
    it('keeps a compiled loop away from a retained lazy dependent', () => {
        let loops = 0;
        const runtime = new Interpreter(undefined, { onIntegerLoopExecuted: () => { loops++; } });
        try {
            expect(runtime.execute(`use numbers
A = array 0
B = A * 2
Warm = B sum
Answer = 0
for I in 0 until 2
  A 0 = I + 1
  Answer += B 0
end
Answer`)).toBe(0n);
            expect(loops).toBeGreaterThan(0);
            expect(runtime.execute('B 0')).toBe(0n);
            expect(runtime.execute('A 0')).toBe(2n);
        } finally { runtime.dispose(); }
    });

    it('publishes batched writes before an exception leaves a compiled loop', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`use numbers
A = array 0
Warm = (A * 2) sum`);
            expect(() => runtime.execute(`for I in 0 until 3
  A 0 = I + 1
  if I equal 1
    Bad = 1 // 0
  end
end`)).toThrow('division by zero');
            expect(runtime.execute('(A * 2) 0')).toBe(4n);
        } finally { runtime.dispose(); }
    });

    it('tracks a newly inserted child through subsequent writes', () => {
        const parent = ownedArray([ownedArray([1n])]);
        const result = derivedArray([1], [parent], () => (parent.items[0] as RankArray).items[0]);
        expect(result.itemAt!(0)).toBe(1n);
        const child = ownedArray([2n]);
        parent.items[0] = child;
        expect(result.itemAt!(0)).toBe(2n);
        child.items[0] = 3n;
        expect(result.itemAt!(0)).toBe(3n);
    });

    it('revalidates after the bounded write history has expired', () => {
        const source = ownedArray([1n]);
        const result = derivedArray([1], [source], () => source.items[0]);
        expect(result.itemAt!(0)).toBe(1n);
        source.items[0] = 9n;
        const temporary = ownedArray([0n]);
        for (let i = 0; i < 2048; i++) temporary.items[0] = BigInt(i);
        expect(result.itemAt!(0)).toBe(9n);
    });

    it('reuses shared dependencies in deep expression DAGs', () => {
        const source = createArraySnapshot([1n]);
        let result = source;
        let reads = 0;
        for (let depth = 0; depth < 80; depth++) {
            const previous = result;
            result = derivedArray([1], [previous, previous], () => {
                reads++;
                const item = previous.itemAt?.(0) ?? previous.items[0];
                return (item as bigint) * 2n;
            });
        }
        expect(result.itemAt!(0)).toBe(1n << 80n);
        expect(reads).toBe(80);
        source.items[0] = 3n;
        expect(result.itemAt!(0)).toBe(3n << 80n);
        expect(reads).toBe(160);
    });

    it.each([
        { expression: 'A sum rank 1', before: [3n, 7n], after: [7n, 7n] },
        { expression: 'A transpose', before: [1n, 3n, 2n, 4n], after: [5n, 3n, 2n, 4n] },
        { expression: 'A # 0', before: [1n, 3n], after: [5n, 3n] },
        { expression: 'A 0', before: [1n, 2n], after: [5n, 2n] },
        { expression: 'A A matmul', before: [7n, 10n, 15n, 22n], after: [31n, 18n, 27n, 22n] },
        { expression: 'A round 0', before: [1n, 2n, 3n, 4n], after: [5n, 2n, 3n, 4n] },
    ])('refreshes $expression after a host write to its storage', ({ expression, before, after }) => {
        const runtime = new Interpreter();
        try {
            const source = createArraySnapshot([1n, 2n, 3n, 4n], [2, 2]);
            runtime.variables.set('A', source);
            runtime.execute(`use numbers
use sequences
use linalg
Result = ${expression}`);
            const result = runtime.variables.get('Result') as RankArray;
            expect(result.items).toEqual(before);
            source.items[0] = 5n;
            expect(result.items).toEqual(after);
            expect(result.itemAt!(0)).toBe(after[0]);
        } finally { runtime.dispose(); }
    });

    it('invalidates window cells and their downstream arithmetic', () => {
        const runtime = new Interpreter();
        try {
            const source = createArraySnapshot([1n, 2n, 3n]);
            runtime.variables.set('A', source);
            runtime.execute(`use sequences
W = A 2 window
Result = W * 2`);
            const result = runtime.variables.get('Result') as RankArray;
            expect(result.items).toEqual([2n, 4n, 4n, 6n]);
            source.items[1] = 5n;
            expect(result.items).toEqual([2n, 10n, 10n, 6n]);
        } finally { runtime.dispose(); }
    });

    it.each([true, false])('invalidates axis statistics after loop writes with compilation %s', compiled => {
        const runtime = new Interpreter(undefined, { integerLoopCompilation: compiled });
        try {
            runtime.execute(`use numbers
use stats
A = array shape 2 2 fill 1
Warm = (A mean axis 1) sum`);
            expect(runtime.execute('(A mean axis 1) 0')).toBe(1);
            runtime.execute(`for I in 0 until 2
  A I 0 = 3
end`);
            expect(runtime.execute('(A mean axis 1) 0')).toBe(2);
            expect(runtime.execute('(A mean axis 1) 1')).toBe(2);
        } finally { runtime.dispose(); }
    });

    it('invalidates indexed and materialized caches transitively', () => {
        const source = createArraySnapshot([2n, 3n]);
        let reads = 0;
        const doubled = derivedArray([2], [source], i => {
            reads++;
            return (source.items[i] as bigint) * 2n;
        });
        const shifted = derivedArray([2], [doubled], i => (doubled.itemAt!(i) as bigint) + 1n);
        expect(shifted.items).toEqual([5n, 7n]);
        expect(shifted.itemAt!(0)).toBe(5n);
        expect(reads).toBe(2);
        source.items[0] = 10n;
        expect(reads).toBe(2);
        expect(materializedArrayItems(shifted)).toBeUndefined();
        expect(reads).toBe(2);
        expect(shifted.items).toEqual([21n, 7n]);
        expect(reads).toBe(4);
    });

    it('does not invalidate a result after an unrelated array write', () => {
        const source = createArraySnapshot([2n]);
        const other = createArraySnapshot([0n]);
        let reads = 0;
        const result = derivedArray([1], [source], i => { reads++; return source.items[i]; });
        expect(result.itemAt!(0)).toBe(2n);
        other.items[0] = 1n;
        expect(result.itemAt!(0)).toBe(2n);
        expect(reads).toBe(1);
    });

    it('keeps untracked host aliases live without publishing a persistent cache', () => {
        const items = [2n];
        const source: RankArray = { kind: 'array', items, shape: [1] };
        const result = derivedArray([1], [source], i => source.items[i]);
        expect(result.items).toEqual([2n]);
        items[0] = 9n;
        expect(result.itemAt!(0)).toBe(9n);
        expect(result.items).toEqual([9n]);
        expect(materializedArrayItems(result)).toBeUndefined();
    });

    // Each reader here reads the one below it twice, so without a cache the
    // chain costs two to the power of its depth. The host cannot write between
    // the cells of one materialization, which is what lets the cells be kept.
    it('reads an untracked chain once per cell rather than once per path', () => {
        const source: RankPlainArray = { kind: 'array', items: [1n, 2n], shape: [2] };
        let reads = 0;
        let below: RankArray = source;
        for (let level = 0; level < 12; level++) {
            const under = below;
            below = derivedArray([2], [under], index => {
                reads++;
                return ((under.itemAt?.(index) ?? under.items[index]) as bigint)
                    + ((under.itemAt?.(index) ?? under.items[index]) as bigint);
            });
        }
        expect(below.items).toEqual([4096n, 8192n]);
        expect(reads).toBe(24);
        // A write the host makes between two stretches of work is still seen.
        source.items[0] = 2n;
        expect(below.items).toEqual([8192n, 8192n]);
    });
});
