import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { typedArray, derivedArray, readArrayItem } from '../src/array-storage.js';
import { withDemandBudget } from '../src/interrupt.js';

const body = `use sequences
Bias = 2.5
fun Left mix Right
  Low = Left min Right
  High = Left max Right
  Flag = Left greater Right integer
  return (High - Low + Flag) * Bias
end
`;
function run(source: string, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const result = diagnostics.run(() => runtime.execute(source));
        return { value: result === undefined ? undefined : formatValue(result), kernels: diagnostics.compiledArrayFunctions };
    } catch (error) { return { error: String(error), kernels: diagnostics.compiledArrayFunctions }; }
    finally { runtime.dispose(); }
}
function compare(source: string) {
    const reference = run(source, false), compiled = run(source, true);
    expect({ ...compiled, kernels: 0 }).toEqual({ ...reference, kernels: 0 });
    return compiled;
}

describe('pure pointwise function bodies', () => {
    it.each(['array 1.0 2.0 3.0', 'array 1.5 2.5 3.5'])('broadcasts a real result over %s', values => {
        expect(compare(body + `A = ${values}\nB = A reshape 3 1\nB mix A`).kernels).toBe(1);
    });
    it('supports scalar arguments and multiple broadcast axes', () => {
        expect(compare(body + 'A = array shape 2 1 2\n1.0 2.0 3.0 4.0\nend\nB = array shape 1 3 1\n5.0 6.0 7.0\nend\nA mix B').kernels).toBe(1);
        expect(compare(body + '(array 1.0 2.0 3.0) mix 2.0').kernels).toBe(1);
    });
    it('reads a new captured value on each entry', () => {
        expect(compare(body + 'A = array 1.0 2.0 3.0\nFirst = A mix 1.0\nBias = 3.0\nSecond = A mix 1.0\narray First Second').kernels).toBe(2);
    });
    it.each(['"bad"', '9007199254740993'])('revalidates a changed capture: %s', value => {
        expect(compare(body + `A = array 1.0 2.0 3.0\nFirst = A mix 1.0\nBias = ${value}\nA mix 1.0`).kernels).toBe(1);
    });
    it('borrows new inputs without modifying retained outputs', () => {
        expect(compare(body + 'A = array 1.0 2.0 3.0\nB = array 2.0 3.0 4.0\nSaved = A mix B\nA 0 = 9.0\nB = array 4.0 5.0 6.0\nNext = A mix B\narray Saved Next').kernels).toBe(2);
    });
    it.each([
        'A = array 9007199254740993 2\nA mix 1',
        'A = array shape 0 fill 0\nA mix 1',
        'A = array 1 2\nB = array 1 2 3\nA mix B',
        'integer = 7\n(array 1 2) mix 1',
    ])('retains guards and errors: %s', source => { compare(body + source); });
    it('does not lift short circuiting or reductions', () => {
        expect(compare('fun A logic B\n  Flag = A greater 0 and B greater 0\n  return Flag integer * 1.0\nend\n(array 1 0) logic (array 2 0)').kernels).toBe(0);
        expect(compare('use sequences\nfun A total B\n  Count = A sum\n  return Count + B * 1.0\nend\n(array 1 2) total (array 3 4)').kernels).toBe(0);
    });
    it('preserves heterogeneous intermediate min errors', () => {
        expect(compare('fun A clipped B\n  Limit = A min 1\n  return Limit + B * 1.0\nend\n(array 0.5 2.5) clipped 1').kernels).toBe(0);
    });
    it('does not add a broadcast axis from an unused argument', () => {
        expect(compare('fun A first B\n  return A * 1.0\nend\n(array 1.0 2.0) first (array 3 4 5)').kernels).toBe(0);
    });
    it('preserves real zero signs and replays nonfinite arithmetic', () => {
        for (const values of [[-0, 0, -1], [1e308, 1, 2], [NaN, Infinity, -Infinity]]) {
            const outputs = [false, true].map(compilation => {
                const runtime = new Interpreter(() => {}, { compilation });
                try {
                    runtime.variables.set('A', typedArray(Float64Array.from(values), [3]));
                    runtime.execute('fun A scaled B\n  return A * B\nend');
                    const result = runtime.execute('A scaled 2.0')!;
                    if (typeof result !== 'object' || result.kind !== 'array') throw Error('expected array');
                    return values.map((_, i) => readArrayItem(result, i));
                } finally { runtime.dispose(); }
            });
            expect(outputs[1].map((x, i) => Object.is(x, outputs[0][i]))).toEqual([true, true, true]);
        }
    });
    it('declines opaque readers and demand budgets', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        let reads = 0;
        try {
            runtime.execute(body);
            runtime.variables.set('A', derivedArray([3], [], i => { reads++; return BigInt(i); }));
            runtime.variables.set('B', typedArray(new Float64Array([1, 2, 3]), [3]));
            expect(formatValue(diagnostics.run(() => runtime.execute('A mix B'))!)).toBe('2.5 2.5 2.5');
            expect(reads).toBeGreaterThan(0);
            expect(diagnostics.compiledArrayFunctions).toBe(0);
            diagnostics.run(() => withDemandBudget(100000, () => runtime.execute('B mix B')));
            expect(diagnostics.compiledArrayFunctions).toBe(0);
        } finally { runtime.dispose(); }
    });
});
