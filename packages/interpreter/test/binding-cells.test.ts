import { describe, expect, it } from 'vitest';
import { materializeValue } from '../src/materialize.js';
import { collectBindingCells } from '../src/runtime/binding-cells.js';
import { ownedStorage } from '../src/array-storage-state.js';
import { readArrayItem, registerArrayReadPlan, typedArray, ownedArray } from '../src/array-storage.js';
import { ArrayBindingContract } from '../src/array-binding-contract.js';
import { chooseValue } from '../src/modules/sequences.js';
import { framedArray } from '../src/runtime/framed-array.js';
import { completed } from '../src/execution.js';
import { MISSING, type RankArray, type RankValue } from '../src/value.js';

const size = 8192;
function source(read: (index: number) => RankValue, shape = [size]): RankArray {
    return { kind: 'array', shape, itemAt: read, get items(): RankValue[] { throw Error('unexpected items'); } };
}

describe('packed binding completion', () => {
    it('lets ranked collectors retain their first shape-probing cell', () => {
        let calls = 0;
        const input = framedArray([size], () => BigInt(calls++), {
            ownFiles() {}, mismatch: () => Error('shape mismatch'),
        });
        const result = collectBindingCells(input) as RankValue[];
        expect(calls).toBe(size);
        expect([result[0], result[size - 1]]).toEqual([0n, BigInt(size - 1)]);
    });

    it('reads only selected branches under a broadcast mask', () => {
        const reads = [0, 0];
        const branches = [0, 1].map(parity => source(index => {
            if (index % 2 !== parity) throw Error('unselected branch');
            reads[parity]++;
            return BigInt(index);
        }, [size / 2, 2]));
        const mask = ownedArray([true, false], [1, 2]);
        const result = materializeValue(chooseValue(mask, branches[0], branches[1])) as RankArray;
        expect(reads).toEqual([size / 2, size / 2]);
        expect(readArrayItem(result, size - 1)).toBe(BigInt(size - 1));
    });

    it.each([Int32Array, BigInt64Array, Float64Array])('checks named %s columns without unpacking', Storage => {
        const buffer = new Storage(size);
        const matrix = typedArray(buffer, [size / 2, 2], ['first', 'second']);
        const contract = new ArrayBindingContract('Matrix');
        expect(contract.check(matrix)).toBe(matrix);
        expect(ownedStorage.get(matrix)?.typed).toBe(buffer);
        expect(() => contract.check(ownedArray(['changed', 'changed'], [1, 2], false, ['first', 'second']))).toThrow();
    });

    it('keeps distinct named-column domains and missing replacements', () => {
        const contract = new ArrayBindingContract('Matrix');
        const matrix = ownedArray([1n, 'text', 2n, 'other'], [2, 2], false, ['first', 'second']);
        expect(contract.check(matrix)).toBe(matrix);
        expect(() => contract.check(ownedArray([MISSING, 'ok'], [1, 2], false, ['first', 'second']))).not.toThrow();
        expect(() => contract.check(typedArray(new Int32Array([1, 2]), [1, 2], ['first', 'second']))).toThrow();
    });

    it.each([['int32', 7n, Int32Array], ['int64', 1n << 40n, BigInt64Array],
        ['real', -0, Float64Array]] as const)('stores %s without a boxed intermediate', (_, last, storage) => {
        let reads = 0;
        const input = source(index => {
            expect(index).toBe(reads++);
            return index === size - 1 ? last : typeof last === 'number' ? 0.5 : 1n;
        });
        const result = materializeValue(input) as RankArray;
        expect(reads).toBe(size);
        expect(ownedStorage.get(result)?.typed).toBeInstanceOf(storage);
        expect(Object.is(readArrayItem(result, size - 1), last)).toBe(true);
    });

    it('keeps arbitrary precision after a late overflow', () => {
        const last = 1n << 100n;
        const result = materializeValue(source(index => index === size - 1 ? last : BigInt(index))) as RankArray;
        expect(readArrayItem(result, size - 1)).toBe(last);
        expect(readArrayItem(result, size - 2)).toBe(BigInt(size - 2));
    });

    it('retains missing cells without replaying the numeric prefix', () => {
        let reads = 0;
        const result = materializeValue(source(index => { reads++; return index === size - 1 ? MISSING : 3n; })) as RankArray;
        expect(reads).toBe(size);
        expect(result.items[size - 1]).toBe(MISSING);
        expect(readArrayItem(result, size - 2)).toBe(3n);
    });

    it('still completes deferred children after a numeric prefix', () => {
        let reads = 0, calls = 0;
        const deferred = { kind: 'plan' as const, dependencies: new Map(),
            evaluate: () => { calls++; return completed(9n); } };
        const result = materializeValue(source(index => { reads++; return index === size - 1 ? deferred : 3n; })) as RankArray;
        expect([reads, calls]).toEqual([size, 1]);
        expect(readArrayItem(result, size - 1)).toBe(9n);
    });

    it('preserves specialized collectors', () => {
        const input = source(() => { throw Error('unexpected scalar read'); });
        registerArrayReadPlan(input, { collect: () => Array(size).fill(4n) });
        expect(readArrayItem(materializeValue(input) as RankArray, size - 1)).toBe(4n);
    });

    it('closes a reader whose traversal exceeds its shape', () => {
        let closed = false;
        const input = source(() => 0n);
        registerArrayReadPlan(input, { *values() {
            try { for (let index = 0; index <= size; index++) yield 1n; }
            finally { closed = true; }
        } });
        expect(() => collectBindingCells(input)).toThrow('exceeded its declared shape');
        expect(closed).toBe(true);
    });
});
