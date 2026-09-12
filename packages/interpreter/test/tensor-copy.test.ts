import { describe, expect, it } from 'vitest';
import { Interpreter, createArraySnapshot, isRankArray, type RankArray, type RankValue } from '../src/index.js';
import { native } from '../src/modules/shared.js';

describe('tensor cell copies', () => {
    it('matches independent coordinate grouping for all cell ranks and reordered frame axes', () => {
        const shapes = [[2, 3, 4], [2, 0, 4], [0, 3, 4]];
        const axes = [[], [0], [1], [2], [0, 1], [1, 0], [0, 2], [2, 0], [1, 2], [2, 1],
            [0, 1, 2], [2, 0, 1], [2, 1, 0]];
        for (const shape of shapes) for (const frame of axes) for (const owned of [false, true]) for (const tensorCellCompilation of [false, true]) {
            const items = Array.from({ length: shape[0] * shape[1] * shape[2] }, (_, i) => BigInt(i + 1));
            const input: RankArray = owned ? createArraySnapshot(items, shape) : { kind: 'array', items, shape };
            const cellShape = shape.filter((_, axis) => !frame.includes(axis));
            const groups: { coordinates: number[]; items: RankValue[] }[] = [];
            // Enumerate frame tuples independently of the interpreter's linear decoder.
            const visit = (coordinates: number[]) => {
                if (coordinates.length === frame.length) {
                    groups.push({ coordinates, items: [] });
                } else {
                    for (let i = 0; i < shape[frame[coordinates.length]]; i++) visit([...coordinates, i]);
                }
            };
            visit([]);
            for (let a = 0; a < shape[0]; a++) for (let b = 0; b < shape[1]; b++) for (let c = 0; c < shape[2]; c++) {
                const coordinates = [a, b, c];
                const group = groups.find(group => frame.every((axis, i) => coordinates[axis] === group.coordinates[i]))!;
                group.items.push(items[(a * shape[1] + b) * shape[2] + c]);
            }
            const observed: { shape: readonly number[]; items: RankValue[] }[] = [];
            const runtime = new Interpreter(undefined, { tensorCellCompilation });
            runtime.variables.set('A', input);
            runtime.variables.set('observe', native('observe', 1, ([value]) => {
                observed.push(isRankArray(value) ? { shape: [...value.shape], items: [...value.items] }
                    : { shape: [], items: [value] });
                return 0n;
            }));
            runtime.execute(`for Cell in A ${frame.length ? `axis ${frame.join(' ')} ` : ''}rank ${3 - frame.length}
  Cell observe
end`);
            expect(observed, JSON.stringify({ shape, frame, owned })).toEqual(
                groups.map(group => ({ shape: cellShape, items: group.items })),
            );
            runtime.dispose();
        }
    });
});
