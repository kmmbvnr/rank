import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, type RankArray } from '../src/index.js';
import { arrayValues, integer32Cells, typedArray } from '../src/array-storage.js';
import { extremeIntegerAxis } from '../src/axis-order.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

for (const compilation of [false, true]) describe(`packed integer extrema (${compilation})`, () => {
    it.each(['min', 'max'] as const)('folds %s on every axis without boxing cells', operation => {
        const data = Int32Array.from({ length: 60 }, (_, i) => i % 3 === 0 ? -2147483648 : i % 7 === 0 ? 2147483647 : i - 25);
        const shape = [3, 4, 5];
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.variables.set('A', typedArray(data, shape));
            for (const axis of [0, 1, 2]) {
                const expected = Array<number>(60 / shape[axis]).fill(operation === 'min' ? Infinity : -Infinity);
                for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 5; k++) {
                    const frame = axis === 0 ? j * 5 + k : axis === 1 ? i * 5 + k : i * 4 + j;
                    expected[frame] = Math[operation](expected[frame], data[(i * 4 + j) * 5 + k]);
                }
                for (const expression of [`A ${operation} axis ${axis}`, `A reduce ${operation} axis ${axis}`]) {
                    const diagnostics = new RuntimeDiagnostics();
                    const result = diagnostics.run(() => runtime.execute(expression)) as RankArray;
                    expect(result.shape).toEqual(shape.filter((_, i) => i !== axis));
                    expect([...arrayValues(result)]).toEqual(expected.map(BigInt));
                    if (compilation || !expression.includes('reduce')) {
                        expect(integer32Cells(result)).toBeDefined();
                        expect(diagnostics.cellsComputed).toBe(0);
                        expect(diagnostics.typedUnpacks).toBe(0);
                    }
                }
            }
        } finally { runtime.dispose(); }
    });

    it('keeps empty frames, lazy empty-axis errors and scalar results', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.variables.set('A', typedArray(new Int32Array(), [2, 0, 3]));
            expect((runtime.execute('A min axis 0') as RankArray).shape).toEqual([0, 3]);
            expect(() => formatValue(runtime.execute('A min axis 1')!)).toThrow(/requires at least one value/);
            runtime.variables.set('V', typedArray(Int32Array.of(-3, 7, 1)));
            expect(runtime.execute('V min axis 0')).toBe(-3n);
            expect(runtime.execute('V max axis 0')).toBe(7n);
        } finally { runtime.dispose(); }
    });

    it('retains host read order and checks the current native implementation', () => {
        const runtime = new Interpreter(undefined, { compilation });
        const reads: number[] = [];
        try {
            runtime.variables.set('A', { kind: 'array', shape: [2, 2], items: [],
                itemAt: i => { reads.push(i); return BigInt(i); } });
            expect(formatValue(runtime.execute('A min axis 0')!)).toBe('0 1');
            expect(reads).toEqual([0, 2, 1, 3]);
            const value = typedArray(Int32Array.of(1, 2, 3, 4), [2, 2]);
            Object.defineProperty(value, 'itemAt', { value: (i: number) => BigInt(10 - i) });
            expect(extremeIntegerAxis(value, 0, 'min')).toBeUndefined();
            runtime.variables.set('B', value);
            expect(formatValue(runtime.execute('B min axis 0')!)).toBe('8 7');
            const operation = runtime.execute('min')!;
            Object.defineProperty(operation, 'call', { value: () => 77n });
            expect(formatValue(runtime.execute('B min axis 0')!)).toBe('77 77');
        } finally { runtime.dispose(); }
    });
});

it('polls cancellation in contiguous and strided integer folds', () => {
    for (const shape of [[2, 8192], [8192, 2]]) {
        const value = typedArray(new Int32Array(16384), shape);
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => extremeIntegerAxis(value, 0, 'min'))).toThrow(InterruptedError);
    }
});
