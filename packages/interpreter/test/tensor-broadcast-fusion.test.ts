import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

function run(shapes: number[][], body: string, fused: boolean) {
    let kernels = 0;
    const runtime = new Interpreter(undefined, {
        tensorFusion: fused, onTensorKernelExecuted: () => kernels++,
    });
    try {
        runtime.execute(`use sequences
use numbers
fun probe A B C
  ${body}
end`);
        const args = shapes.map((shape, n) => ({
            kind: 'array' as const, shape,
            items: Array.from({ length: shape.reduce((a, b) => a * b, 1) },
                (_, i) => BigInt((i + n) % 7 + 1)),
        }));
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
