import { describe, expect, it } from 'vitest';
import { Interpreter, createArraySnapshot, isRankArray, type RankArray, type RankValue } from '../src/index.js';
import { native } from '../src/modules/shared.js';

describe('tensor cell copies', () => {
    it('matches independent coordinate grouping for all cell ranks and ordered cell-axis lists', () => {
        const shapes = [[2, 3, 4], [2, 0, 4], [0, 3, 4]];
        const axes = [[], [0], [1], [2], [0, 1], [1, 0], [0, 2], [2, 0], [1, 2], [2, 1],
            [0, 1, 2], [2, 0, 1], [2, 1, 0]];
        for (const shape of shapes) for (const cellAxes of axes) for (const owned of [false, true]) for (const tensorCellCompilation of [false, true]) {
            const frame = shape.map((_, axis) => axis).filter(axis => !cellAxes.includes(axis));
            const items = Array.from({ length: shape[0] * shape[1] * shape[2] }, (_, i) => BigInt(i + 1));
            const input: RankArray = owned ? createArraySnapshot(items, shape) : { kind: 'array', items, shape };
            const cellShape = cellAxes.map(axis => shape[axis]);
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
            for (const group of groups) {
                const coordinates = shape.map(() => 0);
                frame.forEach((axis, index) => { coordinates[axis] = group.coordinates[index]; });
                const visitCells = (cellAxis: number) => {
                    if (cellAxis === cellAxes.length) {
                        group.items.push(items[(coordinates[0] * shape[1] + coordinates[1]) * shape[2] + coordinates[2]]);
                        return;
                    }
                    const axis = cellAxes[cellAxis];
                    for (let i = 0; i < shape[axis]; i++) {
                        coordinates[axis] = i;
                        visitCells(cellAxis + 1);
                    }
                };
                visitCells(0);
            }
            const observed: { shape: readonly number[]; items: RankValue[] }[] = [];
            const runtime = new Interpreter(undefined, { tensorCellCompilation });
            runtime.variables.set('A', input);
            runtime.variables.set('observe', { ...native('observe', 1, ([value]) => {
                observed.push(isRankArray(value) ? { shape: [...value.shape], items: [...value.items] }
                    : { shape: [], items: [value] });
                return 0n;
            }), arrayCells: true, monadicResultShape: () => [] });
            runtime.execute(`Observed = A observe ${cellAxes.length ? `axis ${cellAxes.join(' ')} rank ${cellAxes.length}` : 'rank 0'}`);
            expect(observed, JSON.stringify({ shape, frame, owned })).toEqual(
                groups.map(group => ({ shape: cellShape, items: group.items })),
            );
            runtime.dispose();
        }
    });
});
