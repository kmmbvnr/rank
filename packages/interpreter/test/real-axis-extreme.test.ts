import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isNativeFunction, isRankArray, type RankValue } from '../src/index.js';
import { arrayValues, derivedArray, typedArray } from '../src/array-storage.js';
import { extremeRealAxis } from '../src/axis-order.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

const observe = (value: RankValue) => isRankArray(value)
    ? { shape: value.shape, cells: [...arrayValues(value)] } : value;

function compare(expression: string, cells: Float64Array, shape: number[]) {
    const results = [true, false].map(tensorFusion => {
        const runtime = new Interpreter(() => {}, { tensorFusion });
        try {
            runtime.variables.set('M', typedArray(cells.slice(), shape));
            return observe(runtime.execute(expression)!);
        } finally { runtime.dispose(); }
    });
    expect(results[0]).toEqual(results[1]);
}

describe('stored real axis extrema', () => {
    it.each(['min', 'max'] as const)('matches ordered %s folds over every axis and explicit scalar rank', op => {
        const values = Float64Array.from({ length: 24 }, (_, i) => Math.sin(i * 7));
        for (const axis of [0, 1, 2, -1, -2, -3]) {
            compare(`M reduce ${op} axis ${axis}`, values, [2, 3, 4]);
            compare(`M reduce ${op} rank 0 axis ${axis}`, values, [2, 3, 4]);
        }
    });

    it.each(['min', 'max'] as const)('retains NaN positions, infinities and the first signed zero for %s', op => {
        const cases = [[NaN, 1, 2], [1, NaN, 2], [3, 2, NaN],
            [0, -0, 0], [-0, 0, -0], [Infinity, -Infinity, 5]];
        for (const values of cases) {
            compare(`M reduce ${op} axis 0`, Float64Array.from(values), [3]);
            compare(`M reduce ${op} axis 0`, Float64Array.from(values), [3, 1]);
            compare(`M reduce ${op} axis 1`, Float64Array.from(values), [1, 3]);
        }
        // Strided lanes exercise the other kernel layout.
        compare(`M reduce ${op} axis 0`, Float64Array.from([NaN, -0, 1, 0, 2, -0]), [3, 2]);
    });

    it.each(['min', 'max'] as const)('retains seeds, multiple axes and whole-cell %s folds', op => {
        const values = Float64Array.from({ length: 24 }, (_, i) => i + 0.5);
        for (const modifiers of ['axis 1 with 10.0', 'axis 1 with 10',
            'axis 1 with (array 3.0 4.0)', 'axis 0 2', 'rank 1 axis 0']) {
            compare(`M reduce ${op} ${modifiers}`, values, [2, 3, 4]);
        }
    });

    it.each(['min', 'max'] as const)('preserves empty frames and empty-axis errors for %s', op => {
        compare(`M reduce ${op} axis 0`, new Float64Array(), [2, 0, 3]);
        compare(`M reduce ${op} axis 2`, new Float64Array(), [0, 2, 3]);
        for (const tensorFusion of [true, false]) {
            const runtime = new Interpreter(() => {}, { tensorFusion });
            try {
                runtime.variables.set('M', typedArray(new Float64Array(), [0, 3]));
                expect(() => formatValue(runtime.execute(`M reduce ${op} axis 0`)!))
                    .toThrow(/requires an initial value/);
            } finally { runtime.dispose(); }
        }
    });

    it('rechecks mutated native implementations', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.variables.set('M', typedArray(Float64Array.from([1, 2, 3, 4]), [2, 2]));
            const operation = runtime.execute('min');
            if (!isNativeFunction(operation!)) throw Error('expected function');
            Object.defineProperty(operation, 'call', { value: () => 77 });
            expect(formatValue(runtime.execute('M reduce min axis 0')!)).toBe('77 77');
        } finally { runtime.dispose(); }
    });

    it('crosses polling chunks in both contiguous and strided layouts', () => {
        const values = Float64Array.from({ length: 24600 }, (_, i) => Math.sin(i));
        for (const op of ['min', 'max']) for (const axis of [0, 1, 2]) {
            compare(`M reduce ${op} axis ${axis}`, values, [2, 3, 4100]);
        }
    });

    it('keeps retained results independent of later input writes', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.variables.set('M', typedArray(Float64Array.from([1, 2, 3, 4]), [2, 2]));
            runtime.execute('R = M reduce min axis 0\nM 0 0 = -10.0');
            expect(formatValue(runtime.execute('R')!)).toBe('1 2');
            expect(formatValue(runtime.execute('M reduce min axis 0')!)).toBe('-10 2');
        } finally { runtime.dispose(); }
    });

    it('keeps lazy read effects and failures on the ordinary path', () => {
        const results = [true, false].map(tensorFusion => {
            const runtime = new Interpreter(() => {}, { tensorFusion });
            const reads: number[] = [];
            try {
                runtime.variables.set('M', derivedArray([2, 2], [], i => {
                    reads.push(i);
                    if (i === 3) throw new Error('last cell');
                    return i + 0.5;
                }));
                expect(() => observe(runtime.execute('M reduce min axis 0')!)).toThrow('last cell');
                return reads;
            } finally { runtime.dispose(); }
        });
        expect(results[0]).toEqual(results[1]);
    });

    it.each([[100000, 1], [2, 50000]])('polls cancellation without modifying a %i by %i input', (...shape) => {
        const cells = Float64Array.from({ length: 100000 }, (_, i) => i);
        const input = typedArray(cells, shape);
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => extremeRealAxis(input, 0, 'min'))).toThrow(InterruptedError);
        expect(cells[0]).toBe(0);
        expect(cells[99999]).toBe(99999);
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => extremeRealAxis(input, 1, 'max'))).toThrow(InterruptedError);
    });
});
