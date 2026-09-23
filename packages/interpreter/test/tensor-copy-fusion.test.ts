import { describe, expect, it, vi } from 'vitest';
import { RankError } from '../src/errors.js';
import { type RankValue } from '../src/value.js';
import { Interpreter, formatValue } from '../src/index.js';

function run(body: string, fused: boolean, setup = 'A = array 1 2 3', before = '') {
    let kernels = 0;
    const output: string[] = [];
    const runtime = new Interpreter(line => output.push(line), {
        tensorFusion: fused, onTensorKernelExecuted: () => kernels++,
    });
    try {
        const result = runtime.execute(`use sequences
use numbers
use io
${before}
fun probe A
  ${body}
end
${setup}
Result = A probe
Result print`);
        return { output, value: result === undefined ? undefined : formatValue(result), kernels };
    } catch (error) {
        return { output, error: error instanceof RankError ? error.format() : String(error), kernels };
    } finally { runtime.dispose(); }
}
function compare(body: string, setup?: string, before?: string) {
    const reference = run(body, false, setup, before);
    const actual = run(body, true, setup, before);
    expect({ ...actual, kernels: 0 }).toEqual({ ...reference, kernels: 0 });
    return actual;
}
describe('fused explicit copy', () => {
    it.each([
        'return (A * A + A * 2.0 + 1.0) copy',
        'Squared = A * A\n  Shifted = Squared + A * 2.0 + 1.0\n  return Shifted copy',
        'Result = (A * A + A * 2.0 + 1.0) copy\n  return Result',
    ])('compiles readable form %s', body => {
        expect(compare(body)).toMatchObject({ output: ['4 9 16'], kernels: 1 });
    });
    it.each([
        ['empty', 'A = array', 'return (A + 1) copy'],
        ['large integers', 'A = array 9007199254740993 9007199254740994', 'return (A * A) copy'],
        ['mixed', 'A = array 1 2.0 3', 'return (A + 2) copy'],
        ['boolean', 'A = array 1 2 3', 'return (A greater 1) copy'],
        ['shape', 'A = array shape 2 2\n  1 2\n  3 4\nend', 'return (A + 2) copy'],
        ['division error', 'A = array 1 0 3', 'return (1 / A) copy'],
        ['wrong type', 'A = array "a" "b"', 'return (A + 2) copy'],
        ['lazy', 'A = (array 1 2 3) + 1', 'return (A + 2) copy'],
        ['scalar', 'A = 1', 'return (A + 2) copy'],
    ])('preserves %s', (_, setup, body) => { compare(body, setup); });
    it('creates independent mutable storage', () => {
        expect(compare('B = (A + 1) copy\n  B 0 = 99\n  A print\n  return B'))
            .toMatchObject({ output: ['1 2 3', '99 3 4'], kernels: 1 });
    });
    it('preserves shadowed copy', () => {
        expect(compare('return (A + 1) copy', undefined,
            'fun copy X\n  return 42\nend').kernels).toBe(0);
    });
    it('does not remove observable intermediates', () => {
        expect(compare('B = A + 1\n  C = (B * B) copy\n  B print\n  return C').kernels).toBe(0);
    });
    it('retains closure collisions and original assignment types', () => {
        expect(compare('B = A + 1\n  return (B * B) copy',
            undefined, 'B = 1').kernels).toBe(0);
    });
    it('retains the reference location for competing arithmetic errors', () => {
        expect(compare('B = 1 / A\n  return (B + (A ** -1)) copy',
            'A = array 0 1')).toHaveProperty('error');
    });
    it('does not silently align a filtered copy with an unfiltered vector', () => {
        compare('Mask = A greater 1\n  B = A Mask\n  return (B + A) copy');
    });
    it('supports unavailable dynamic compilation', () => {
        const original = globalThis.Function;
        const mock = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw new Error('CSP'); });
        try { compare('return (A + 1) copy'); }
        finally { mock.mockRestore(); }
        expect(globalThis.Function).toBe(original);
    });
});

describe('copy kernel host values', () => {
    function execute(items: RankValue[], shape: number[], fused: boolean) {
        let kernels = 0;
        const sources: string[] = [];
        const runtime = new Interpreter(undefined, {
            tensorFusion: fused,
            onTensorKernelExecuted: () => kernels++,
            onTensorKernelCompiled: source => sources.push(source),
        });
        try {
            runtime.execute('use sequences\nfun probe A\n  return (A * A + 1) copy\nend');
            const fn = runtime.variables.get('probe')!;
            if (typeof fn !== 'object' || fn.kind !== 'function') throw new Error('missing probe');
            const result = fn.call([{ kind: 'array', items, shape }]);
            return { result, kernels, sources };
        } finally { runtime.dispose(); }
    }
    it.each([
        [[], [0]],
        [[], [2, 0]],
        [[1n, 2n, 3n, 4n], [2, 2]],
        [[-0, Infinity, NaN, -Infinity], [4]],
        [[2n ** 100n, 1.5], [2]],
    ] as [RankValue[], number[]][])('preserves cells %s and shape %s', (items, shape) => {
        const reference = execute(items, shape, false);
        const actual = execute(items, shape, true);
        expect(actual.result).toEqual(reference.result);
        expect(actual.kernels).toBe(0);
        expect(actual.sources).toEqual([]);
    });
});
