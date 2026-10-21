import { expect, it } from 'vitest';
import { arrayValueTraversal, collectArrayCells, registerArrayReadPlan } from '../src/array-storage.js';
import type { RankArray, RankValue } from '../src/value.js';

it('preserves the primary failure when closing a traversal also fails', () => {
    let closed = 0;
    const value = registerArrayReadPlan({ kind: 'array', shape: [1], items: [], itemAt: () => 0n } as RankArray, {
        *values() {
            try { yield 1n; yield 2n; }
            finally { closed++; throw Error('close failure'); }
        },
    });
    expect(() => collectArrayCells(value)).toThrow('exceeded its declared shape');
    expect(closed).toBe(1);
});

it.each([
    [2, [1n], 'ended before'],
    [1, [1n, 2n], 'exceeded'],
] as const)('rejects a traversal that disagrees with its shape (%s)', (size, values, error) => {
    let reads = 0;
    let closed = 0;
    const value = registerArrayReadPlan({ kind: 'array', shape: [size],
        itemAt() { throw Error('unexpected scalar read'); },
        get items(): RankValue[] { throw Error('unexpected items getter'); },
    } as RankArray, { *values() {
        try { for (const item of values) { reads++; yield item; } }
        finally { closed++; }
    } });
    expect(arrayValueTraversal(value)).toBeTypeOf('function');
    expect(reads).toBe(0);
    for (let attempt = 1; attempt <= 2; attempt++) {
        expect(() => collectArrayCells(value)).toThrow(error);
        expect(reads).toBe(values.length * attempt);
        expect(closed).toBe(attempt);
    }
});
