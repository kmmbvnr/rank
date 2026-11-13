import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { filledArray, typedArray, writeArrayCell, readArrayItem } from '../src/array-storage.js';
import { packedTruePositions } from '../src/packed-booleans.js';
import { maskSelection, materializeMaskSelection } from '../src/array-mask-selection.js';
import { DemandBudgetExhausted, withDemandBudget, withInterrupt } from '../src/interrupt.js';
import { answerOf } from './support.js';

describe('dense mask positions', () => {
    it.each([65536, 65537, 100003])('packs %s indices including the last partial word', size => {
        const mask = filledArray(true, [size]);
        for (let i = 7; i < size; i += 11) writeArrayCell(mask, i, false);
        expect(Array.from(packedTruePositions(mask)!)).toEqual(Array.from({ length: size }, (_, i) => i).filter(i => i % 11 !== 7));
        expect(packedTruePositions(mask)).toBeInstanceOf(Uint32Array);
    });
    it('retains one-pass storage for small, empty and sparse masks', () => {
        expect(Array.isArray(packedTruePositions(filledArray(true, [65535])))).toBe(true);
        const mask = filledArray(false, [100003]);
        expect(packedTruePositions(mask)).toEqual([]);
        for (const i of [0, 32, 65536, 100002]) writeArrayCell(mask, i, true);
        expect(packedTruePositions(mask)).toEqual([0, 32, 65536, 100002]);
    });
    it('does not assume the sampled density continues through the mask', () => {
        const mask = filledArray(false, [100003]);
        for (let i = 0; i < 512; i++) writeArrayCell(mask, i, true);
        writeArrayCell(mask, 100002, true);
        expect(Array.from(packedTruePositions(mask)!)).toEqual([...Array.from({ length: 512 }, (_, i) => i), 100002]);
    });
    it('snapshots positions before subsequent mask writes', () => {
        const size = 100003;
        const source = typedArray(Int32Array.from({ length: size }, (_, i) => i));
        const mask = filledArray(true, [size]);
        const selected = maskSelection(source, mask);
        writeArrayCell(mask, 0, false);
        const result = materializeMaskSelection(selected)!;
        expect(result.shape).toEqual([size]);
        expect(readArrayItem(result, 0)).toBe(0n);
        expect(readArrayItem(result, size - 1)).toBe(BigInt(size - 1));
    });
    it.each([false, true])('consumes compact positions in stored and lazy sums, compilation=%s', compilation => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(`use sequences
Input = 1 to 100003 array
Mask = Input greater 0
Values' = Input + 2
Answer = (Values filter Mask) sum
Stored = (Input filter Mask) sum
Indices = Mask indices
Grid = array shape 2 40000 fill true
Pairs = Grid indices`);
            expect(answerOf(runtime)).toBe(5000550012n);
            expect(runtime.variables.get('Stored')).toBe(5000350006n);
            const indices = runtime.variables.get('Indices') as ReturnType<typeof typedArray>;
            expect(readArrayItem(indices, 100002)).toBe(100002n);
            const pairs = runtime.variables.get('Pairs') as ReturnType<typeof typedArray>;
            expect(pairs.shape).toEqual([80000, 2]);
            expect(readArrayItem(pairs, 159998)).toBe(1n);
            expect(readArrayItem(pairs, 159999)).toBe(39999n);
        } finally { runtime.dispose(); }
    });
    it('keeps budgets and can retry after cancellation', () => {
        const mask = filledArray(true, [100003]);
        expect(() => withDemandBudget(4097, () => packedTruePositions(mask))).toThrow(DemandBudgetExhausted);
        const flag = new Int32Array(new SharedArrayBuffer(4));
        flag[0] = 1;
        expect(() => withInterrupt(flag, () => packedTruePositions(mask))).toThrow('Interrupted');
        expect(packedTruePositions(mask)).toHaveLength(100003);
    });
});
