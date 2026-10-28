import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { booleanCells, ownedArray, typedArray } from '../src/array-storage.js';
import { compareStoredInt32 } from '../src/integer-array-kernel.js';
import { packedTruePositions } from '../src/packed-booleans.js';
import { DemandBudgetExhausted, withDemandBudget, withInterrupt } from '../src/interrupt.js';

const comparisons: Record<string, (a: number, b: number) => boolean> = {
    equal: (a, b) => a === b, notequal: (a, b) => a !== b,
    less: (a, b) => a < b, greater: (a, b) => a > b,
    atmost: (a, b) => a <= b, atleast: (a, b) => a >= b,
};

describe('compact integer comparison masks', () => {
    it.each(Object.entries(comparisons))('%s packs exact results and tail bits', (name, compare) => {
        const values = Int32Array.from({ length: 4097 }, (_, i) => i % 7 - 3);
        const result = compareStoredInt32(typedArray(values, [values.length]), 1n, name)!;
        expect(result).toBeDefined();
        const packed = booleanCells(result)!;
        expect(packed).toBeDefined();
        const expected = Array.from(values, (x, i) => compare(x, 1) ? i : -1).filter(i => i >= 0);
        expect(packedTruePositions(result)).toEqual(expected);
        for (let i = 0; i < values.length; i++) expect(packed.read(i)).toBe(compare(values[i], 1));
    });

    it.each(Object.entries(comparisons))('%s handles scalar-left and row/column broadcasts', (name, compare) => {
        const a = Int32Array.from({ length: 33 }, (_, i) => i - 16);
        const b = Int32Array.from({ length: 35 }, (_, i) => i - 17);
        const result = compareStoredInt32(typedArray(a, [33, 1]), typedArray(b, [1, 35]), name)!;
        expect(result.shape).toEqual([33, 35]);
        const expected = Array.from({ length: 33 * 35 }, (_, i) => compare(a[Math.floor(i / 35)], b[i % 35]) ? i : -1).filter(i => i >= 0);
        expect(packedTruePositions(result)).toEqual(expected);
        const vector = Int32Array.from({ length: 1025 }, (_, i) => i - 512);
        expect(packedTruePositions(compareStoredInt32(0n, typedArray(vector, [1025]), name)!))
            .toEqual(Array.from(vector, (x, i) => compare(0, x) ? i : -1).filter(i => i >= 0));
    });

    it('compares Int32 extrema without subtraction overflow', () => {
        const a = typedArray(Int32Array.from({ length: 1024 }, (_, i) => i % 2 ? -2147483648 : 2147483647), [1024]);
        expect(packedTruePositions(compareStoredInt32(a, -2147483648n, 'less')!)).toEqual([]);
        expect(packedTruePositions(compareStoredInt32(a, 2147483647n, 'equal')!)).toHaveLength(512);
    });

    it('declines wide, real, missing, small and opaque inputs without invoking readers', () => {
        const input = typedArray(new Int32Array(1024), [1024]);
        expect(compareStoredInt32(input, 9007199254740993n, 'equal')).toBeUndefined();
        expect(compareStoredInt32(input, 0, 'equal')).toBeUndefined();
        expect(compareStoredInt32(ownedArray([9007199254740993n], [1]), 1n, 'less')).toBeUndefined();
        expect(compareStoredInt32(ownedArray(Array.from({ length: 1024 }, () => undefined as never), [1024]), 1n, 'equal')).toBeUndefined();
        expect(compareStoredInt32(typedArray(new Int32Array(1023), [1023]), 1n, 'equal')).toBeUndefined();
        expect(compareStoredInt32({ kind: 'array', shape: [1024], items: [], itemAt() { throw new Error('opaque read'); } }, 1n, 'equal')).toBeUndefined();
    });

    it.each([
        ['Input = array shape 2000 fill 9007199254740993\nAnswer = (Input equal 9007199254740992) count', 0n],
        ['Input = array shape 2000 fill 9007199254740993\nAnswer = (Input greater 9007199254740992.0) count', 2000n],
        ['Input = array shape 2000 fill 1\nAnswer = (Input equal 1.0) count', 2000n],
    ])('keeps wide and mixed-domain fallback exact: %s', (source, expected) => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\n' + source);
            expect(runtime.variables.get('Answer')).toBe(expected);
        } finally { runtime.dispose(); }
    });

    it('discards interrupted private work and allows another demand', () => {
        const input = typedArray(new Int32Array(10000), [10000]);
        expect(() => withDemandBudget(4097, () => compareStoredInt32(input, 0n, 'equal'))).toThrow(DemandBudgetExhausted);
        expect(packedTruePositions(compareStoredInt32(input, 0n, 'equal')!)).toHaveLength(10000);
    });

    it('declines arbitrary host polling and replaced array readers', () => {
        const input = typedArray(new Int32Array(1024), [1024]);
        let polls = 0;
        const signal = { length: 1, load() { polls++; return 0; }, store() {}, exchange() { polls++; return 0; }, wait() {} };
        withInterrupt(signal, () => expect(compareStoredInt32(input, 0n, 'equal')).toBeUndefined());
        expect(polls).toBe(0);
        Object.defineProperty(input, 'itemAt', { value: () => { throw new Error('replaced reader'); } });
        expect(compareStoredInt32(input, 0n, 'equal')).toBeUndefined();
    });

    it('keeps completed snapshots independent of later mutations', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\nInput = array shape 5000 fill 1\nMask = Input equal 1\nInput 0 = 2\nAnswer = Mask indices len');
            expect(runtime.variables.get('Answer')).toBe(5000n);
        } finally { runtime.dispose(); }
    });

    it('preserves strided selections and rank-two index coordinates', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\nInput = 0 till 5000 array\nSelected = Input (0 till 5000 by 2)\nAnswer = (Selected greater 4990) indices');
            expect(formatValue(runtime.variables.get('Answer')!)).toBe('2496 2497 2498 2499');
            runtime.execute('Matrix = array shape 33 35 fill 0\nMatrix 32 34 = 1\nCoordinates = (Matrix equal 1) indices');
            expect(formatValue(runtime.variables.get('Coordinates')!)).toBe('32 34');
        } finally { runtime.dispose(); }
    });
});
