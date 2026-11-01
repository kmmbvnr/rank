import { expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { typedArray, readArrayItem } from '../src/array-storage.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';

for (const operation of ['+', '*', 'min', 'max']) for (const kind of ['reduce', 'scan']) {
    it(`preserves ordered real ${kind} ${operation}, NaN and signed zero`, () => {
        const values = [1e16, -0, 1, 0, -1e16, NaN, Infinity, 4];
        const keys = values.map((_, i) => i % 2);
        const states: (number | undefined)[] = [];
        const prefixes: number[] = [];
        for (let i = 0; i < values.length; i++) {
            const key = keys[i], value = values[i], previous = states[key];
            const next = previous === undefined ? value : operation === '+' ? previous + value
                : operation === '*' ? previous * value : operation === 'min'
                    ? value < previous ? value : previous : value > previous ? value : previous;
            states[key] = next; prefixes.push(next);
        }
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, { compilation });
            const diagnostics = new RuntimeDiagnostics();
            try {
                runtime.variables.set('V', typedArray(Float64Array.from(values), [2, 4], undefined, 'real'));
                runtime.variables.set('K', typedArray(Int32Array.from(keys), [2, 4]));
                const result = diagnostics.run(() => runtime.execute(`V ${kind} ${operation} by K`));
                if (result === undefined || !isRankArray(result)) throw new Error('expected array');
                const expected = kind === 'scan' ? prefixes : states;
                expect(result.shape).toEqual(kind === 'scan' ? [2, 4] : [2]);
                expect(expected.map((_, i) => readArrayItem(result, i))).toEqual(expected);
                expect(diagnostics.realKeyedFolds).toBe(compilation ? 1 : 0);
            } finally { runtime.dispose(); }
        }
    });
}
it('keeps the ordinary sum zero seed and exact mixed extrema seeds', () => {
    for (const compilation of [true, false]) {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('V', typedArray(Float64Array.of(-0), [1], undefined, 'real'));
            runtime.variables.set('K', typedArray(Int32Array.of(0)));
            const result = runtime.execute('V sum by K');
            if (result === undefined || !isRankArray(result)) throw new Error('expected array');
            expect(Object.is(readArrayItem(result, 0), 0)).toBe(true);
            const mixed = runtime.execute('V reduce max by K with 9007199254740993');
            if (mixed === undefined || !isRankArray(mixed)) throw new Error('expected array');
            expect(readArrayItem(mixed, 0)).toBe(9007199254740993n);
        } finally { runtime.dispose(); }
    }
});
it('retains a first NaN and applies real seeds once per group', () => {
    for (const compilation of [true, false]) {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('V', typedArray(Float64Array.of(NaN, 1, 2, NaN, 3, 4), [6], undefined, 'real'));
            runtime.variables.set('K', typedArray(Int32Array.of(0, 1, 0, 1, 0, 1)));
            const extrema = runtime.execute('V reduce max by K');
            if (extrema === undefined || !isRankArray(extrema)) throw new Error('expected array');
            expect(readArrayItem(extrema, 0)).toBeNaN();
            expect(readArrayItem(extrema, 1)).toBe(4);
            runtime.variables.set('V', typedArray(Float64Array.of(1.5, 2.5, 3.5, 4.5), [2, 2], undefined, 'real'));
            runtime.variables.set('K', typedArray(Int32Array.of(0, 1, 0, 1), [2, 2]));
            const scan = runtime.execute('V scan + by K with 100');
            if (scan === undefined || !isRankArray(scan)) throw new Error('expected array');
            expect(scan.shape).toEqual([2, 2]);
            expect([0, 1, 2, 3].map(i => readArrayItem(scan, i))).toEqual([101.5, 102.5, 105, 107]);
        } finally { runtime.dispose(); }
    }
});
