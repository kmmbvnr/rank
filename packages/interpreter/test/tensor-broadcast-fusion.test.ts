import { describe, expect, it } from 'vitest';
import { Interpreter, createArraySnapshot, MISSING, formatValue, parse, type RankValue } from '../src/index.js';
import { isFunctionStatement } from '@arrrank/language';
import { compileTensorKernel } from '../src/tensor-kernel.js';
import { withInterrupt, type InterruptSignal } from '../src/interrupt.js';
import { materializeValue } from '../src/materialize.js';

function run(shapes: number[][], body: string, fused: boolean) {
    let kernels = 0;
    const runtime = new Interpreter(undefined, {
        tensorFusion: fused, onTensorKernelExecuted: () => kernels++,
    });
    try {
        runtime.execute(`use sequences
use numbers
fun A B C probe
  ${body}
end`);
        const args = shapes.map((shape, n) => createArraySnapshot(
            Array.from({ length: shape.reduce((a, b) => a * b, 1) },
                (_, i) => BigInt((i + n) % 7 + 1)), shape,
        ));
        const fn = runtime.variables.get('probe')!;
        if (typeof fn !== 'object' || fn.kind !== 'function') throw new Error('missing probe');
        const result = fn.call(args);
        if (typeof result === 'object' && result.kind === 'array') void result.items;
        return { result, kernels };
    } catch (error) { return { error: String(error), kernels }; }
    finally { runtime.dispose(); }
}
describe('broadcast tensor fusion', () => {
    it.each([
        [[2, 3], [3], [3]],
        [[2, 3], [2, 1], [3]],
        [[2, 1, 3], [1, 4, 1], [3]],
        [[2, 0, 3], [1, 1, 3], [3]],
        [[2, 3], [], [3]],
        [[1, 3], [2, 1], [2, 3]],
    ])('preserves shape domain %j', (...shapes) => {
        for (const terminal of ['copy', 'sum']) {
            const body = `Difference = A - B\n  Scaled = Difference * Difference\n  return (Scaled / C) ${terminal}`;
            const expected = run(shapes, body, false);
            const actual = run(shapes, body, true);
            expect(actual).not.toHaveProperty('error');
            expect({ ...actual, kernels: 0 }).toEqual({ ...expected, kernels: 0 });
            expect(actual.kernels).toBe(1);
        }
    });
    it('matches an independent matrix/vector oracle', () => {
        const actual = run([[2, 3], [3], [3]], 'return ((A - B) / C) copy', true);
        const expected = Array.from({ length: 6 }, (_, i) => ((i % 7 + 1) - (i % 3 + 2)) / (i % 3 + 3));
        expect(actual).toMatchObject({ result: { shape: [2, 3], items: expected }, kernels: 1 });
    });
    it('retains incompatible-shape errors', () => {
        const body = 'return ((A - B) / C) copy';
        const shapes = [[2, 3], [2], [3]];
        expect(run(shapes, body, true)).toEqual(run(shapes, body, false));
        expect(run(shapes, body, true)).toHaveProperty('error');
    });
});

describe('repeated tensor bindings', () => {
    it('refreshes arrays, scalars, shapes and mutations without changing retained results', () => {
        const evaluate = (tensorFusion: boolean) => {
            let kernels = 0;
            const runtime = new Interpreter(undefined, { tensorFusion, onTensorKernelExecuted: () => kernels++ });
            try {
                runtime.execute(`use sequences
fun normalize Data Mean Dev
  Centered = Data - Mean
  return (Centered / Dev) copy
end`);
                const fn = runtime.variables.get('normalize')!;
                if (typeof fn !== 'object' || fn.kind !== 'function') throw new Error('missing function');
                const invoke = (args: RankValue[]) => materializeValue(fn.call(args));
                const a = createArraySnapshot([3n, 5n, 7n, 9n], [2, 2]);
                const mean = createArraySnapshot([1n, 1n], [2]);
                const retained = invoke([a, mean, 2n]);
                const outputs = [retained, invoke([a, mean, 4n])];
                a.items[0] = 11n;
                outputs.push(invoke([a, mean, 2n]));
                outputs.push(invoke([createArraySnapshot([9n, 13n, 17n, 21n], [2, 2]), mean, 4n]));
                outputs.push(invoke([createArraySnapshot([5n, 9n], [1, 2]), mean, 2n]));
                // Keep the warmed shape when a missing cell forces fallback.
                outputs.push(invoke([createArraySnapshot([MISSING, 9n], [1, 2]), mean, 2n]));
                outputs.push(invoke([createArraySnapshot([], [0, 2]), mean, 2n]));
                // Read earlier outputs only after later calls have completed.
                return { outputs: outputs.map(value => {
                    if (typeof value !== 'object' || value.kind !== 'array') throw new Error('missing array');
                    return { shape: [...value.shape], items: [...value.items] };
                }), kernels };
            } finally { runtime.dispose(); }
        };
        const reference = evaluate(false), actual = evaluate(true);
        expect(actual.outputs).toEqual(reference.outputs);
        expect(actual.outputs[0].items).toEqual([1, 2, 3, 4]);
        expect(actual.kernels).toBe(6);
    });

    it('keeps error guards after a successful binding', () => {
        const evaluate = (tensorFusion: boolean) => {
            const runtime = new Interpreter(undefined, { tensorFusion });
            try {
                runtime.execute(`use sequences
fun normalize Data Mean Dev
  return ((Data - Mean) / Dev) copy
end`);
                const fn = runtime.variables.get('normalize')!;
                if (typeof fn !== 'object' || fn.kind !== 'function') throw new Error('missing function');
                const data = createArraySnapshot([3n, 5n], [1, 2]);
                const mean = createArraySnapshot([1n, 1n], [2]);
                fn.call([data, mean, 2n]);
                const errors = [];
                for (const args of [[data, mean, 0n], [data, createArraySnapshot([1n, 2n, 3n]), 2n]]) {
                    try { fn.call(args); errors.push('no error'); }
                    catch (error) { errors.push(String(error)); }
                }
                return errors;
            } finally { runtime.dispose(); }
        };
        expect(evaluate(true)).toEqual(evaluate(false));
        expect(evaluate(true)).not.toContain('no error');
    });
});


it('rechecks a shadowed terminal after warming a tensor layout', () => {
    const evaluate = (tensorFusion: boolean) => {
        let kernels = 0;
        const runtime = new Interpreter(undefined, { tensorFusion, onTensorKernelExecuted: () => kernels++ });
        try {
            runtime.execute(`use sequences
fun A shifted
  return (A + 1) copy
end
A = array 1 2`);
            const first = runtime.execute('A shifted')!;
            runtime.execute(`fun Value replacement
  return Value + 100
end`);
            runtime.variables.set('copy', runtime.variables.get('replacement')!);
            const second = runtime.execute('A shifted')!;
            return { first: formatValue(first), second: formatValue(second), kernels };
        } finally { runtime.dispose(); }
    };
    const reference = evaluate(false), actual = evaluate(true);
    expect(actual).toEqual({ ...reference, kernels: 1 });
    expect(actual.second).toBe('102 103');
});


it('keeps the active layout when an interrupt callback reenters the kernel', () => {
    const statement = parse('fun A shifted\n return (A + 1) copy\nend').statements[0];
    if (!isFunctionStatement(statement)) throw new Error('missing function');
    const outer = createArraySnapshot(Array(2048).fill(1n));
    const inner = createArraySnapshot([5n]);
    let input = outer, armed = false, entered = false;
    let nested: RankValue | undefined;
    const kernel = compileTensorKernel(statement.statements[0], { lookup: () => input, builtin: () => true })!;
    const signal: InterruptSignal = {
        length: 1, load: () => 0, store() {}, wait() {},
        exchange: () => {
            if (armed && !entered) {
                entered = true;
                input = inner;
                try { nested = kernel.run(); }
                finally { input = outer; }
            }
            return 0;
        },
    };
    withInterrupt(signal, () => kernel.run());
    armed = true;
    const result = withInterrupt(signal, () => kernel.run());
    expect(entered).toBe(true);
    expect(nested).toMatchObject({ shape: [1], items: [6n] });
    expect(result).toMatchObject({ shape: [2048], items: Array(2048).fill(2n) });
});


it('pairs a layout with its own code when the compilation hook reenters', () => {
    const statement = parse('fun A shifted B\n return (A - B) copy\nend').statements[0];
    if (!isFunctionStatement(statement)) throw new Error('missing function');
    const outerA = createArraySnapshot([1n, 2n, 3n, 4n], [2, 2]);
    const outerB = createArraySnapshot([10n, 20n]);
    let a = outerA, b = outerB, entered = false;
    let nested: RankValue | undefined;
    const kernel = compileTensorKernel(statement.statements[0], {
        lookup: name => name === 'A' ? a : b, builtin: () => true,
        compiled() {
            if (entered) return;
            entered = true;
            a = createArraySnapshot([100n, 200n, 300n], [1, 3]);
            b = createArraySnapshot([1n, 2n, 3n]);
            try { nested = kernel!.run(); }
            finally { a = outerA; b = outerB; }
        },
    })!;
    const expected = { shape: [2, 2], items: [-9n, -18n, -7n, -16n] };
    expect(kernel.run()).toMatchObject(expected);
    expect(nested).toMatchObject({ shape: [1, 3], items: [99n, 198n, 297n] });
    expect(kernel.run()).toMatchObject(expected);
});
