import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, type NativeFunction, type RankValue } from '../src/index.js';
import { typedArray, readArrayItem } from '../src/array-storage.js';
import { native } from '../src/modules/shared.js';
function run(operation: string, input: RankValue, compilation = true, scalar?: number) {
    const d = new RuntimeDiagnostics(), r = new Interpreter(() => {}, { compilation, scalarFunctionCompilation: false });
    try {
        r.execute(`use numbers\nfun Values transform${scalar === undefined ? '' : ' Scale'}\n Out = ${scalar === undefined ? 'Values '+operation : 'Scale '+operation+' * Values'}\n return Out\nend`);
        const fn = r.variables.get('transform') as NativeFunction;
        const result = d.run(() => fn.call(scalar === undefined ? [input] : [input, scalar]));
        if (!isRankArray(result)) throw Error('expected array');
        return { values: Array.from({ length: result.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(result, i)), shape: result.shape, count: d.compiledArrayFunctions };
    } catch (error) { return { error: (error as Error).message, count: d.compiledArrayFunctions }; }
    finally { r.dispose(); }
}
const cases = [
    { operation: 'sqrt', values: [-0, 0, .5, 1, 2, 100] },
    { operation: 'asin', values: [-1, -.5, -0, 0, .5, 1] },
    { operation: 'log', values: [Number.MIN_VALUE, .5, 1, 2, 100, 1e300] },
    { operation: 'exp', values: [-1000, -1, -0, 0, 1, 700] },
];
describe.each(cases)('numeric function $operation', ({ operation, values }) => {
    it.each([[6], [2, 3]].map(shape => ({ shape })))('compiles real shape $shape without changing signed zeros', ({ shape }) => {
        const make = () => typedArray(Float64Array.from(values), shape);
        const actual = run(operation, make());
        expect(actual.values).toEqual(run(operation, make(), false).values);
        expect(actual.shape).toEqual(shape);
        expect(actual.count).toBe(1);
        actual.values?.forEach((value, i) => expect(Object.is(value, Math[operation as 'sqrt'](values[i]))).toBe(true));
    });
    it('keeps integer inputs real', () => {
        const values = operation === 'asin' ? [-1, 0, 1] : operation === 'log' ? [1, 2, 3] : [0, 1, 2];
        const actual = run(operation, typedArray(Int32Array.from(values)));
        expect(actual.count).toBe(1);
        expect(actual.values?.every(value => typeof value === 'number')).toBe(true);
    });
    it('guards scalar intermediates', () => {
        const make = () => typedArray(new Float64Array([1, 2, 3]));
        const actual = run(operation, make(), true, .5);
        expect(actual.values).toEqual(run(operation, make(), false, .5).values);
        expect(actual.count).toBe(1);
    });
    it('rechecks builtin identity after warming a helper', () => {
        const r = new Interpreter(() => {}, { scalarFunctionCompilation: false }), d = new RuntimeDiagnostics();
        try {
            r.execute(`use numbers\nfun Values transform\n Out = Values ${operation}\n return Out\nend`);
            const fn = r.variables.get('transform') as NativeFunction, input = typedArray(new Float64Array([.25, .5, 1]));
            expect(isRankArray(d.run(() => fn.call([input])))).toBe(true);
            expect(d.compiledArrayFunctions).toBe(1);
            r.variables.set(operation, native('identity', 1, ([value]) => value));
            const actual = d.run(() => fn.call([input]));
            expect(isRankArray(actual)).toBe(true);
            if (!isRankArray(actual)) throw Error('expected array');
            expect([0, 1, 2].map(i => readArrayItem(actual, i))).toEqual([.25, .5, 1]);
            expect(d.compiledArrayFunctions).toBe(1);
        } finally { r.dispose(); }
    });
});
it.each([
    ['sqrt', [-1, 4]], ['sqrt', [NaN, 4]], ['sqrt', [Infinity, 4]],
    ['asin', [-2, 0]], ['asin', [NaN, 0]], ['asin', [Infinity, 0]],
    ['log', [0, 1]], ['log', [-1, 1]], ['log', [NaN, 1]],
    ['exp', [1000, 0]], ['exp', [NaN, 0]], ['exp', [Infinity, 0]],
] as [string, number[]][])('retains domain/error/nonfinite fallback for %s %j', (operation, values) => {
    const make = () => typedArray(Float64Array.from(values));
    expect(run(operation, make())).toEqual(run(operation, make(), false));
});

it('reuses one vector program across changing extents with fresh inputs', () => {
    const generated: string[] = [], r = new Interpreter(() => {}, { scalarFunctionCompilation: false,
        onFunctionBodyCompiled: text => { if (text.includes('numeric-array-function')) generated.push(text); } });
    try {
        r.execute('use numbers\nfun Values transform\n Roots = Values sqrt\n return Roots + Values\nend');
        const fn = r.variables.get('transform') as NativeFunction;
        for (let length = 1; length <= 80; length++) {
            const input = typedArray(Float64Array.from({ length }, (_, i) => i + length));
            const result = fn.call([input]);
            if (!isRankArray(result)) throw Error('expected array');
            expect(result.shape).toEqual([length]);
            expect(readArrayItem(result, length - 1)).toBe(Math.sqrt(2 * length - 1) + (2 * length - 1));
        }
        expect(generated).toHaveLength(1);
        expect(generated[0]).toContain('output[0].length');
    } finally { r.dispose(); }
});
