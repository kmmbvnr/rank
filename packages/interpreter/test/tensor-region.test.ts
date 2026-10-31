import { describe, expect, it } from 'vitest';
import { Interpreter, parse, type RankArray, type RankValue } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { compileTensorRegion } from '../src/jit/tensor-region.js';
import { DENSE_MIN_CELLS } from '../src/jit/tensor-operands.js';
import { withInterrupt } from '../src/interrupt.js';

const body = `for Iter in 0 till 2
 A = X + Y
 B = A * Z
 C = A - B
end`;
function execute(source = body, compilation = true, x: readonly number[] = [1, 2, 3, 4], z = 0.5, shape = [x.length]) {
    const items = x.length && shape.length === 1 && x.length < DENSE_MIN_CELLS
        ? Array.from({ length: DENSE_MIN_CELLS }, (_, i) => x[i % x.length]) : x;
    const dimensions = shape.length === 1 ? [items.length] : shape;
    const compiled: string[] = [];
    const runtime = new Interpreter(() => {}, {
        compilation, integerLoopCompilation: false,
        onTensorKernelCompiled: source => { if (source.includes('output[')) compiled.push(source); },
    });
    for (const name of ['A', 'B', 'C', 'Saved']) runtime.variables.set(name, typedArray(new Float64Array(items.length), dimensions));
    runtime.variables.set('X', typedArray(Float64Array.from(items), dimensions));
    runtime.variables.set('Y', typedArray(new Float64Array([0.25])));
    runtime.variables.set('Z', z);
    let error: string | undefined;
    try { runtime.execute(source); } catch (caught) { error = (caught as Error).message; }
    const read = (name: string) => {
        const value = runtime.variables.get(name) as RankArray;
        return { shape: [...value.shape], items: [...value.items] };
    };
    const values = Object.fromEntries(['A', 'B', 'C', 'Saved', 'X'].map(name => [name, read(name)]));
    runtime.dispose();
    return { values, error, compiled };
}
function compare(source = body, x: readonly number[] = [1, 2, 3, 4], z = 0.5, shape = [x.length]) {
    const actual = execute(source, true, x, z, shape);
    const reference = execute(source, false, x, z, shape);
    expect({ values: actual.values, error: actual.error }).toEqual({ values: reference.values, error: reference.error });
    return actual;
}

describe('real tensor assignment regions', () => {
    it('retains ordinary execution when cancellation can be observed', () => {
        let reads = 0;
        const region = compileTensorRegion(parse('A = X + Y\nB = A * Y').statements, 0, {
            lookup: () => { reads++; return undefined; },
            commit: () => { throw new Error('unexpected commit'); }, compiled: () => {}, executed: () => {},
        })!;
        const signal = new Int32Array(new SharedArrayBuffer(12));
        withInterrupt(signal, () => expect(region.run()).toBeUndefined(), () => {});
        expect(reads).toBe(0);
    });
    it('does not inspect properties of an unproved host input', () => {
        let reads = 0;
        const host = new Proxy({}, { getOwnPropertyDescriptor() { reads++; throw new Error('host effect'); } });
        const region = compileTensorRegion(parse('A = X + Y\nB = A * Y').statements, 0, {
            lookup: () => host as RankValue,
            commit: () => { throw new Error('unexpected commit'); }, compiled: () => {}, executed: () => {},
        })!;
        expect(region.run()).toBeUndefined();
        expect(reads).toBe(0);
    });
    it('computes dependent outputs together and reuses code on the next iteration', () => {
        const result = compare(body.replace('X + Y', 'X + Z'));
        expect(result.compiled).toHaveLength(1);
        expect(result.values.C.items.slice(0, 4)).toEqual([0.75, 1.25, 1.75, 2.25]);
    });
    it('broadcasts a trailing row against a matrix', () => {
        const result = compare(body, Array.from({ length: 1024 }, (_, i) => i), 0.5, [1024, 1]);
        expect(result.compiled).toHaveLength(1);
    });
    it.each([NaN, Infinity, -Infinity, Number.MAX_VALUE])('falls back for non-finite values or intermediates: %s', value => {
        compare(body.replace('A = X + Y', 'A = X * X'), [1, value]);
    });
    it('keeps earlier assignments when a later division fails', () => {
        const result = compare(body.replace('B = A * Z', 'B = A / Z'), [1, 2], 0);
        expect(result.error).toMatch(/zero/);
        expect(result.values.A.items.slice(0, 2)).toEqual([1.25, 2.25]);
        expect(result.values.B.items.every(value => value === 0)).toBe(true);
    });
    it('keeps errors in scalar subexpressions for empty outputs', () => {
        compare(body.replace('B = A * Z', 'B = A + (1.0 / Z)'), [], 0);
    });
    it('retains outputs captured between iterations', () => {
        compare(body.replace('\nend', '\n if Iter equal 0\n  Saved = A\n end\n X = X + Z\nend'));
    });
    it('falls back to the original assignment order when a later name is missing', () => {
        const result = compare(body.replace('B = A * Z', 'B = A * Unknown'));
        expect(result.error).toMatch(/Unknown/);
        expect(result.values.A.items.slice(0, 4)).toEqual([1.25, 2.25, 3.25, 4.25]);
    });
    it('preserves signed zero', () => {
        compare(body.replace('X + Y', 'X * Z'), [-0, 0], -1);
    });
});
