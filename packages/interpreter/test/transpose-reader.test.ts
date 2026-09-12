import { describe, expect, it } from 'vitest';
import { transposeValue } from '../src/modules/sequences.js';
import type { RankArray, RankValue } from '../src/index.js';

describe('transpose readers', () => {
    it('maps rectangular matrices with default and explicit permutations', () => {
        for (const shape of [[2, 3], [3, 2], [0, 3], [3, 0], [1, 4]]) {
            const items = Array.from({ length: shape[0] * shape[1] }, (_, i) => BigInt(i + 1));
            const input: RankArray = { kind: 'array', shape, items };
            const expected: RankValue[] = [];
            for (let column = 0; column < shape[1]; column++) {
                for (let row = 0; row < shape[0]; row++) expected.push(items[row * shape[1] + column]);
            }
            expect((transposeValue(input) as RankArray).items).toEqual(expected);
            expect((transposeValue(input, [1, 0]) as RankArray).items).toEqual(expected);
            expect((transposeValue(input, [0, 1]) as RankArray).items).toEqual(items);
        }
    });

    it('keeps host shape, reader and cell access order', () => {
        const reads: string[] = [];
        const shape = new Proxy([2, 3], {
            get(target, key, receiver) { reads.push(`dimension ${String(key)}`); return Reflect.get(target, key, receiver); },
        });
        const items: RankValue[] = [1n, 2n, 3n, 4n, 5n, 6n];
        Object.defineProperty(items, 3, { get() { reads.push('cell'); return 4n; } });
        const source: RankArray = {
            kind: 'array',
            get shape() { reads.push('shape'); return shape; },
            get itemAt() { reads.push('itemAt'); return undefined; },
            get items() { reads.push('items'); return items; },
        };
        const view = transposeValue(source) as RankArray;
        reads.length = 0;
        expect(view.itemAt!(1)).toBe(4n);
        expect(reads).toEqual(['shape', 'dimension length', 'shape', 'dimension 0',
            'shape', 'dimension 1', 'itemAt', 'items', 'cell']);
    });

    it('does not share coordinate scratch arrays across reentrant host reads', () => {
        let view: RankArray | undefined;
        let nested = false;
        const inner: RankValue[] = [];
        const source: RankArray = {
            kind: 'array', items: [1n, 2n, 3n, 4n, 5n, 6n],
            get shape() {
                if (view && !nested) {
                    nested = true;
                    inner.push(view.itemAt!(0));
                    nested = false;
                }
                return [2, 3];
            },
        };
        view = transposeValue(source) as RankArray;
        expect(view.itemAt!(1)).toBe(4n);
        expect(inner).toEqual([1n, 1n, 1n]);
    });

    it('keeps host itemAt reads and materialization live', () => {
        const source: RankArray = { kind: 'array', shape: [2, 3], items: [1n, 2n, 3n, 4n, 5n, 6n] };
        const view = transposeValue(source) as RankArray;
        expect(view.itemAt!(1)).toBe(4n);
        source.items[3] = 40n;
        expect(view.itemAt!(1)).toBe(40n);
        const materialized = view.items;
        expect(materialized).toEqual([1n, 40n, 2n, 5n, 3n, 6n]);
        source.items[3] = 400n;
        expect(view.itemAt!(1)).toBe(400n);
        expect(view.items).not.toBe(materialized);
        expect(view.items[1]).toBe(400n);
    });
});
