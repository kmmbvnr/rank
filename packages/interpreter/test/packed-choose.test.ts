import { describe, expect, it } from 'vitest';
import { booleanCells, ownedArray, readArrayItem, typedArray, writeArrayCell } from '../src/array-storage.js';
import { chooseDenseArrays } from '../src/tensor.js';
import { chooseValue } from '../src/modules/sequences.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';
import { MISSING, type RankArray, type RankValue } from '../src/value.js';

const array = (cells: boolean[], shape = [cells.length]) => ownedArray(cells, shape);
const floats = (cells: number[], shape = [cells.length]) => typedArray(Float64Array.from(cells), shape);
const items = (value: RankArray) => Array.from({ length: value.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(value, i));

function compare(bits: boolean[], yes: RankValue, no: RankValue, shape = [bits.length], maskShape = shape) {
    const packed = array(bits, maskShape);
    expect(booleanCells(packed)).toBeDefined();
    // A plain host mask forces the compatibility path without bitmap evidence.
    const plain: RankArray = { kind: 'array', shape: [...maskShape], items: [...bits] };
    const actual = chooseDenseArrays(packed, yes, no, shape), reference = chooseDenseArrays(plain, yes, no, shape);
    expect(actual).toBeDefined();
    expect(reference).toBeDefined();
    expect(actual!.shape).toEqual(reference!.shape);
    const expected = items(reference!);
    items(actual!).forEach((cell, i) => expect(Object.is(cell, expected[i])).toBe(true));
    return actual!;
}

describe('stored choose with packed boolean conditions', () => {
    it.each([1024, 1025, 1055, 1056, 1057, 4095, 4096, 4097])('preserves every bit and tail at %s cells', size => {
        const yes = floats(Array.from({ length: size }, (_, i) => i + 0.25));
        const no = floats(Array.from({ length: size }, (_, i) => -i - 0.75));
        for (const predicate of [(i: number) => i % 3 === 0, () => true, () => false]) {
            const bits = Array.from({ length: size }, (_, i) => predicate(i));
            const result = compare(bits, yes, no);
            expect(items(result)).toEqual(bits.map((bit, i) => bit ? i + 0.25 : -i - 0.75));
        }
    });
    it.each([0, -0, 1.5, Infinity, -Infinity, NaN])('preserves scalar real branches including %s', scalar => {
        const size = 1057, values = Array.from({ length: size }, (_, i) => i % 2 ? -0 : i + 0.5);
        const bits = values.map((_, i) => i % 5 === 0), data = floats(values);
        compare(bits, data, scalar);
        compare(bits, scalar, data);
    });
    it('keeps integer, boolean and mixed branch domains', () => {
        const bits = Array.from({ length: 1057 }, (_, i) => i % 5 === 0);
        compare(bits, 9007199254740993n, 2n);
        compare(bits, true, false);
        compare(bits.map(() => true), 9007199254740993n, 2.5);
        const plain: RankArray = { kind: 'array', shape: [bits.length], items: bits };
        const failure = (mask: RankArray) => {
            try { chooseDenseArrays(mask, 9007199254740993n, 2.5, [bits.length]); }
            catch (error) { return String(error); }
            throw Error('expected mixed-domain error');
        };
        expect(failure(array(bits))).toBe(failure(plain));
    });
    it('addresses full-shape matrix masks in flat row order', () => {
        const bits = Array.from({ length: 1056 }, (_, i) => i % 7 === 0);
        compare(bits, floats(bits.map((_, i) => i + 0.5), [33, 32]), -1.5, [33, 32]);
    });
    it('retains ordinary mask and branch broadcasting', () => {
        const bits = Array.from({ length: 32 }, (_, i) => i % 3 === 0);
        compare(bits, floats(bits.map((_, i) => i + 0.5)), -1.5, [33, 32], [32]);
        compare([true], floats(Array.from({ length: 1056 }, (_, i) => i + 0.5)), 2.5, [1056], [1]);
        const matrix = Array.from({ length: 1056 }, (_, i) => i % 3 === 0);
        compare(matrix, floats(bits.map((_, i) => i + 0.5)), -1.5, [33, 32]);
    });
    it('publishes independent storage before later source and mask writes', () => {
        const bits = Array.from({ length: 1024 }, (_, i) => i % 2 === 0), mask = array(bits);
        const yes = floats(bits.map((_, i) => i + 0.5)), no = floats(bits.map((_, i) => -i - 0.25));
        const result = chooseDenseArrays(mask, yes, no, [1024])!;
        writeArrayCell(mask, 0, false); writeArrayCell(yes, 0, 99.0); writeArrayCell(no, 1, 98.0);
        expect(readArrayItem(result, 0)).toBe(0.5);
        expect(readArrayItem(result, 1)).toBe(-1.25);
    });
    it('does not force unread branches or probe their opaque readers', () => {
        const reads: string[] = [], mask = array(Array.from({ length: 1024 }, (_, i) => i % 2 === 0));
        const yes: RankArray = { kind: 'array', shape: [1024], items: [], itemAt: i => { reads.push(`yes:${i}`); return i + 0.5; } };
        const no: RankArray = { kind: 'array', shape: [1024], items: [], itemAt: i => { reads.push(`no:${i}`); return -i - 0.25; } };
        expect(chooseDenseArrays(mask, yes, no, [1024])).toBeUndefined();
        expect(reads).toEqual([]);
        const selected = chooseValue(mask, yes, no) as RankArray;
        expect(readArrayItem(selected, 0)).toBe(0.5);
        expect(readArrayItem(selected, 1)).toBe(-1.25);
        expect(reads).toEqual(['yes:0', 'no:1']);
    });
    it('declines a missing mask before native bitmap reads', () => {
        const mask = ownedArray(Array.from({ length: 1024 }, (_, i) => i === 8 ? MISSING : i % 2 === 0));
        expect(chooseDenseArrays(mask, 1.5, 2.5, [1024])).toBeUndefined();
    });
    it('declines an inconsistent host shape instead of reading bitmap padding', () => {
        const mask = array(Array.from({ length: 1024 }, (_, i) => i % 2 === 0));
        Object.defineProperty(mask, 'shape', { value: [1025] });
        expect(chooseDenseArrays(mask, 1.5, 2.5, [1025])).toBeUndefined();
    });
    it('exhausts a budget before publishing output and can be demanded again', () => {
        const mask = array(Array.from({ length: 8193 }, (_, i) => i % 3 === 0));
        expect(() => withDemandBudget(1, () => chooseDenseArrays(mask, 1.5, 2.5, [8193]))).toThrow(DemandBudgetExhausted);
        expect(readArrayItem(chooseDenseArrays(mask, 1.5, 2.5, [8193])!, 8192)).toBe(2.5);
    });
});
