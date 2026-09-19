import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankValue } from '../src/index.js';
import { MissingValueError, RankError } from '../src/errors.js';
import { createArraySnapshot } from '../src/array-storage.js';

function run(operation: string, axes: string, shape: number[], cells: RankValue[], fused: boolean,
    failAt?: number, missingAt?: number) {
    const reads: number[] = [];
    const runtime = new Interpreter(undefined, { tensorFusion: fused });
    try {
        runtime.execute(`use stats
fun probe A
  return A ${operation} axis ${axes}
end`);
        const source = { kind: 'array' as const, shape, items: cells, itemAt(i: number) {
            reads.push(i);
            if (i === failAt) throw new RankError('reader failed', 'ReaderError');
            if (i === missingAt) throw new MissingValueError('missing');
            return cells[i];
        } };
        const fn = runtime.variables.get('probe')!;
        if (typeof fn !== 'object' || fn.kind !== 'function') throw new Error('missing probe');
        const value = fn.call([source]);
        return { value: isRankArray(value) ? { shape: value.shape, items: value.items } : value, reads };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error), reads };
    } finally { runtime.dispose(); }
}
describe('axis statistics reader fusion', () => {
    it.each(['mean', 'std'])('preserves %s cells and axes', operation => {
        for (const [shape, axes] of [
            [[2, 3], '0'], [[2, 3], '1'], [[2, 3, 4], '2 0'],
            [[2, 3, 4], '0 2'], [[2, 3, 4], '1'], [[2, 0], '1'],
        ] as [number[], string][]) {
            const values = Array.from({ length: shape.reduce((a, b) => a * b, 1) },
                (_, i) => i % 2 ? i / 8 : BigInt(i));
            expect(run(operation, axes, shape, values, true)).toEqual(run(operation, axes, shape, values, false));
        }
    });
    it.each(['mean', 'std'])('retains exceptional %s values', operation => {
        for (const values of [
            [1n, 2n ** 100n, 3.5], [NaN, Infinity, -Infinity], [-0, -0, 0],
            [1n, 'bad', 2n], [Infinity, 'bad', 1n], ['bad', Infinity, 1n],
        ]) expect(run(operation, '0', [3], values, true)).toEqual(run(operation, '0', [3], values, false));
    });
    it.each(['mean', 'std'])('preserves %s missing values and competing errors', operation => {
        for (const failAt of [undefined, 2]) for (const missingAt of [undefined, 0]) {
            const actual = run(operation, '0', [3], ['bad', 2n, 3n], true, failAt, missingAt);
            expect(actual).toEqual(run(operation, '0', [3], ['bad', 2n, 3n], false, failAt, missingAt));
            if (failAt === 2) expect(actual.error).toContain('ReaderError');
        }
    });
    it('matches a scalar oracle', () => {
        expect(run('mean', '0', [3, 2], [1n, 2n, 3n, 4n, 5n, 6n], true).value)
            .toEqual({ shape: [2], items: [3, 4] });
        expect(run('std', '0', [3, 2], [1n, 2n, 3n, 4n, 5n, 6n], true).value)
            .toEqual({ shape: [2], items: [Math.sqrt(8 / 3), Math.sqrt(8 / 3)] });
    });
    // Naming M freezes A against Rank writes, so the cache is exercised through
    // storage the embedding still owns.
    it('retains repeated indexed evaluation after a host write', () => {
        for (const tensorFusion of [false, true]) {
            const runtime = new Interpreter(undefined, { tensorFusion });
            try {
                const source = createArraySnapshot([1n, 2n, 3n, 4n], [2, 2]);
                runtime.variables.set('A', source);
                runtime.execute('use stats\nuse sequences\nM = A mean axis 0');
                const m = runtime.variables.get('M')!;
                if (!isRankArray(m)) throw new Error('missing array');
                expect(m.itemAt!(0)).toBe(2);
                source.items[0] = 5n;
                expect(m.itemAt!(0)).toBe(4);
            } finally { runtime.dispose(); }
        }
    });
});
