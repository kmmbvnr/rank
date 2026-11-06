import {describe, expect, it} from 'vitest';
import {Interpreter, isRankArray} from '../src/index.js';
import {integer32Cells, ownedArray, readArrayItem, typedArray} from '../src/array-storage.js';

function product(row: readonly bigint[], real = false) {
    const runtime = new Interpreter(() => {}, {compilation: false});
    const values = Array.from({length: 32}, () => [...row]).flat();
    const left = values.every(value => BigInt.asIntN(64, value) === value)
        ? typedArray(BigInt64Array.from(values), [32, row.length])
        : ownedArray(values, [32, row.length]);
    const right = real ? typedArray(new Float64Array(row.length * 32).fill(1), [row.length, 32])
        : typedArray(new Int32Array(row.length * 32).fill(1), [row.length, 32]);
    runtime.variables.set('Left', left);
    runtime.variables.set('Right', right);
    try {
        const result = runtime.execute('use linalg\nLeft matmul Right');
        if (!isRankArray(result)) throw Error('expected matrix');
        return {result, cells: Array.from({length: 1024}, (_, i) => readArrayItem(result, i))};
    } finally { runtime.dispose(); }
}

describe('compact dense exact matrix products', () => {
    it.each([
        [2147483647n, 0n], [-2147483648n, 0n], [2147483647n, -2147483647n], [0n, 0n],
    ])('keeps small exact sums packed despite wide input storage: %s, %s', (left, right) => {
        const {result, cells} = product([left, right]);
        expect(cells).toEqual(Array(1024).fill(left + right));
        expect(integer32Cells(result)).toBeDefined();
    });

    it.each([
        [2147483647n, 1n], [-2147483648n, -1n], [4503599627370495n, 0n],
        [9007199254740991n, 1n], [2n ** 100n, -(2n ** 100n) + 3n],
    ])('retains wide and arbitrary-precision sums without truncation: %s, %s', (left, right) => {
        const {result, cells} = product([left, right]);
        expect(cells).toEqual(Array(1024).fill(left + right));
        if (left + right > 2147483647n || left + right < -2147483648n) expect(integer32Cells(result)).toBeUndefined();
    });

    it('retains real results for mixed numeric operands', () => {
        const {result, cells} = product([2n, 3n], true);
        expect(cells).toEqual(Array(1024).fill(5));
        expect(integer32Cells(result)).toBeUndefined();
    });
});
