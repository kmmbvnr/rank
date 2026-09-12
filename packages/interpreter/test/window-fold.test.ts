import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankArray, type RankValue } from '../src/index.js';
import { reduceWindowCell, windowValue } from '../src/sequence.js';

const vector = (items: RankValue[]): RankArray => ({ kind: 'array', shape: [items.length], items });
describe('window cell folds', () => {
    it.each([
        [[3], [], [], 1n, 0n],
        [[3, 4], [2, 2], [0, 1], 1n, 0n],
        [[3, 4], [2, 2], [1, 0], 1n, 0n],
        [[2, 3, 4], [2, 3], [0, 2], 1n, 0n],
        [[3, 4], [2, 2], [0, 1], 2n, 1n],
    ] as [number[], number[], number[], bigint, bigint][])(
        'retains coordinates and noncommutative order %j', (shape, widths, axes, stride, padding) => {
            const input = { kind: 'array' as const, shape,
                items: Array.from({ length: shape.reduce((a, b) => a * b, 1) }, (_, i) => BigInt(i + 1)) };
            const windows = windowValue(input, vector(widths.map(BigInt)), axes, stride, padding);
            if (!isRankArray(windows)) throw new Error('not an array');
            const size = widths.reduce((a, b) => a * b, 1);
            const frames = windows.shape.slice(0, shape.length).reduce((a, b) => a * b, 1);
            const subtract = (a: RankValue, b: RankValue) => (a as bigint) - (b as bigint);
            for (let frame = 0; frame < frames; frame++) {
                let expected = windows.itemAt!(frame * size);
                for (let i = 1; i < size; i++) expected = subtract(expected, windows.itemAt!(frame * size + i));
                expect(reduceWindowCell(windows, frame * size, size, subtract)).toBe(expected);
            }
        });
    it('preserves reader demand order and repeated reads after mutation', () => {
        const reads: number[] = [];
        const items = [1n, 2n, 3n, 4n];
        const source = { kind: 'array' as const, shape: [4], items,
            itemAt: (i: number) => { reads.push(i); return items[i]; } };
        const windows = windowValue(source, 3n) as RankArray;
        expect(reads).toEqual([]);
        const plus = (a: RankValue, b: RankValue) => (a as bigint) + (b as bigint);
        expect(reduceWindowCell(windows, 3, 3, plus)).toBe(9n);
        expect(reads).toEqual([1, 2, 3]);
        items[2] = 30n;
        expect(reduceWindowCell(windows, 3, 3, plus)).toBe(36n);
        expect(reads).toEqual([1, 2, 3, 1, 2, 3]);
    });
    it('does not read past a failing operation', () => {
        const reads: number[] = [];
        const source = { kind: 'array' as const, shape: [4], items: [],
            itemAt: (i: number) => { reads.push(i); return BigInt(i); } };
        const windows = windowValue(source, 4n) as RankArray;
        expect(() => reduceWindowCell(windows, 0, 4, () => { throw new Error('stop'); })).toThrow('stop');
        expect(reads).toEqual([0, 1]);
    });
    it('declines partial cells and unrelated arrays', () => {
        const source = vector([1n, 2n, 3n, 4n]);
        const windows = windowValue(source, 3n) as RankArray;
        const plus = (a: RankValue, b: RankValue) => (a as bigint) + (b as bigint);
        expect(reduceWindowCell(windows, 0, 2, plus)).toBeUndefined();
        expect(reduceWindowCell(windows, 1, 3, plus)).toBeUndefined();
        expect(reduceWindowCell(source, 0, 4, plus)).toBeUndefined();
    });
    it.each(['*', '+', '-', '/'])('matches runtime reduction %s', op => {
        function run(tensorFusion: boolean) {
            const runtime = new Interpreter(undefined, { tensorFusion });
            try {
                const value = runtime.execute(`use sequences
use numbers
A = array 1.5 2 3 4 5
Windows = A 3 window
Result = Windows ${op} reduce rank 1
Result copy`);
                return isRankArray(value!) ? { shape: value.shape, items: value.items } : value;
            } catch (error) { return String(error); }
            finally { runtime.dispose(); }
        }
        const actual = run(true);
        expect(actual).toHaveProperty('shape');
        expect(actual).toEqual(run(false));
    });
});
