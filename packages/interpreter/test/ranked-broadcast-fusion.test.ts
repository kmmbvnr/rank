import { describe, expect, it } from 'vitest';
import { Interpreter, createArraySnapshot, demandValue, isRankArray, type RankValue } from '../src/index.js';

function run(body: string, args: RankValue[], tensorFusion: boolean, deferred = false) {
    let kernels = 0;
    const runtime = new Interpreter(undefined, { tensorFusion, onTensorKernelExecuted: () => kernels++ });
    try {
        runtime.execute(`fun A${deferred ? "'" : ''} probe B\n  return ${body}\nend`);
        const fn = runtime.variables.get('probe')!;
        if (typeof fn !== 'object' || fn.kind !== 'function') throw Error('missing function');
        const value = demandValue(fn.call(args));
        return { value: isRankArray(value) ? { shape: value.shape, items: [...value.items] } : value, kernels };
    } catch (error) { return { error: String(error), kernels }; }
    finally { runtime.dispose(); }
}
const array = (shape: number[], offset = 0) => createArraySnapshot(
    Array.from({ length: shape.reduce((a, b) => a * b, 1) }, (_, i) => BigInt(i + offset + 1)), shape);

describe('ranked binary tensor fusion', () => {
    it.each([
        [[2, 3], [2], '1 0'],
        [[2, 3], [2], '-1 -1'],
        [[2, 3], [1], '1 0'],
        [[2, 1, 3], [1, 4], '1 0'],
        [[2, 3], [2, 1], '1 1'],
        [[2, 3], [2, 4, 3], '1 2'],
        [[2, 3, 1], [2, 1, 4], '2 2'],
        [[0, 3], [0], '1 0'],
        [[2, 0], [2], '1 0'],
    ] as [number[], number[], string][])('aligns frames and cells for %j and %j rank %s', (left, right, ranks) => {
        const args = [array(left), array(right)];
        const expression = `(A - B rank ${ranks}) * 2`;
        const reference = run(expression, args, false), fused = run(expression, args, true);
        expect(reference).not.toHaveProperty('error');
        expect({ ...fused, kernels: 0 }).toEqual(reference);
        expect(fused.kernels).toBe(1);
        const opaque = { kind: 'array' as const, shape: left, items: args[0].items,
            itemAt(index: number) { return this.items[index]; } };
        expect(run(expression, [opaque, args[1]], false, true)).toEqual(reference);
    });

    it('matches a row-major oracle and composes ranked nodes', () => {
        const args = [array([2, 3]), array([2], 2)];
        expect(run('(A - B rank 1 0) * 2', args, true))
            .toEqual({ value: { shape: [2, 3], items: [-4n, -2n, 0n, 0n, 2n, 4n] }, kernels: 1 });
        const expression = '(A - B rank 1 0) / B rank 1 0';
        expect({ ...run(expression, args, true), kernels: 0 }).toEqual(run(expression, args, false));
    });

    it('keeps scalar operands and exact wide integer arithmetic', () => {
        const huge = 2n ** 90n;
        for (const expression of ['(A - B rank 1 0) * 2', '(B - A rank 0 1) * 2']) {
            const args = [createArraySnapshot([huge, huge + 1n, huge + 2n], [1, 3]), 1n];
            expect({ ...run(expression, args, true), kernels: 0 }).toEqual(run(expression, args, false));
        }
    });

    it('retains shape failures, arithmetic failures and exceptional values', () => {
        for (const args of [
            [array([2, 3]), array([3])],
            [array([2, 3]), createArraySnapshot([0n, 1n])],
            [createArraySnapshot([NaN, Infinity, -0, -Infinity, 2, 3], [2, 3]), array([2])],
        ]) {
            expect({ ...run('(A / B rank 1 0) * 2', args, true), kernels: 0 })
                .toEqual(run('(A / B rank 1 0) * 2', args, false));
        }
    });

    it('does not probe opaque readers speculatively', () => {
        const evaluate = (fused: boolean) => {
            const reads: number[] = [];
            const source = { kind: 'array' as const, shape: [2, 3], items: [1n, 2n, 3n, 4n, 5n, 6n],
                itemAt(index: number) { reads.push(index); return this.items[index]; } };
            return { result: run('(A - B rank 1 0) * 2', [source, array([2])], fused, true), reads };
        };
        expect(evaluate(true)).toEqual(evaluate(false));
    });

    it('rebinds warmed kernels after shape changes and retains earlier results', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('fun A probe B\n  return (A - B rank 1 0) * 2\nend');
            const fn = runtime.variables.get('probe')!;
            if (typeof fn !== 'object' || fn.kind !== 'function') throw Error('missing function');
            const outputs = [[2, 3], [1, 4], [3, 2]].map(shape => {
                const a = array(shape), b = array([shape[0]]);
                const value = demandValue(fn.call([a, b]));
                if (!isRankArray(value)) throw Error('missing array');
                return { value, expected: a.items.map((item, index) =>
                    ((item as bigint) - (b.items[Math.floor(index / shape[1])] as bigint)) * 2n) };
            });
            for (const { value, expected } of outputs) expect(value.items).toEqual(expected);
        } finally { runtime.dispose(); }
    });
});
