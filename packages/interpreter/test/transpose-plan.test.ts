import { describe, expect, it } from 'vitest';
import { Interpreter, type RankArray } from '../src/index.js';
import { denseScalarItems, materializedArrayItems, ownedArray, readArrayItem } from '../src/array-storage.js';
import { transposeValue } from '../src/modules/sequences.js';
import { materializeValue } from '../src/materialize.js';

describe('transpose construction', () => {
    it('keeps large stored inputs as a view until a storage boundary', () => {
        const source = ownedArray(Array.from({ length: 32 * 40 }, (_, index) => BigInt(index)), [32, 40]);
        const transposed = transposeValue(source) as RankArray;
        expect(transposed.shape).toEqual([40, 32]);
        expect(denseScalarItems(transposed)).toBeUndefined();
        expect(materializedArrayItems(transposed)).toBeUndefined();
        expect(readArrayItem(transposed, 3 * 32 + 7)).toBe(283n);
        const stored = materializeValue(transposed) as RankArray;
        expect(stored.shape).toEqual([40, 32]);
        expect(denseScalarItems(stored)).toBeDefined();
        for (let row = 0; row < 40; row++) for (let column = 0; column < 32; column++) {
            expect(readArrayItem(stored, row * 32 + column)).toBe(BigInt(column * 40 + row));
        }
    });

    it('reads only selected cells of a host input', () => {
        const reads: number[] = [];
        const source: RankArray = { kind: 'array', shape: [32, 40], items: [],
            itemAt: index => { reads.push(index); return BigInt(index); } };
        const transposed = transposeValue(source) as RankArray;
        expect(reads).toEqual([]);
        expect(readArrayItem(transposed, 3 * 32 + 7)).toBe(283n);
        expect(reads).toEqual([283]);
    });
});

describe.each([false, true])('transpose binding boundaries (compilation=%s)', compilation => {
    it('stores a writable transpose at an ordinary binding', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("use sequences\nM = (1 to 1280) reshape 32 40\nT' = M transpose");
            expect(runtime.execute('T 3 7')).toBe(284n);
            const stored = runtime.execute('Saved = T') as RankArray;
            expect(stored.shape).toEqual([40, 32]);
            expect(denseScalarItems(stored)).toBeDefined();
            runtime.execute('Saved 3 7 = 99');
            expect(runtime.execute('Saved 3 7')).toBe(99n);
            expect(runtime.execute('M 7 3')).toBe(284n);
        } finally { runtime.dispose(); }
    });
});
