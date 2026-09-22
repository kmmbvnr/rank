import { ownedArray, readArrayItem } from '../array-storage.js';
import { RankError } from '../errors.js';
import { isRankArray, isRankLabel, type RankArray, type RankValue } from '../value.js';
import { expectInteger, native } from './shared.js';
import type { RuntimeModule } from './types.js';

const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
] as const;

export const gridsModule: RuntimeModule = {
    neighbors: () => native('neighbors', [3, 4], values =>
        gridNeighbors(values[0], values[1], values[2], values[3])),
    segments: () => native('segments', 2, values =>
        gridSegments(values[0], values[1])),
};

function gridNeighbors(
    grid: RankValue,
    rowValue: RankValue,
    columnValue: RankValue,
    kind?: RankValue,
): RankArray {
    const [rows, columns] = gridShape(grid, 'neighbors');
    const row = gridIndex(rowValue, rows, 'row');
    const column = gridIndex(columnValue, columns, 'column');
    const items: RankValue[] = [];

    for (const [dy, dx] of neighborDirections(kind)) {
        const nextRow = row + dy;
        const nextColumn = column + dx;
        if (inside(nextRow, nextColumn, rows, columns)) {
            items.push(BigInt(nextRow), BigInt(nextColumn));
        }
        const previousRow = row - dy;
        const previousColumn = column - dx;
        if (inside(previousRow, previousColumn, rows, columns)) {
            items.push(BigInt(previousRow), BigInt(previousColumn));
        }
    }
    return ownedArray(items, [items.length / 2, 2]);
}

function neighborDirections(kind?: RankValue): readonly (readonly number[])[] {
    if (kind === undefined || (isRankLabel(kind) && kind.name === 'four')) {
        return directions.slice(0, 2);
    }
    if (isRankLabel(kind) && kind.name === 'eight') return directions;
    throw new RankError('neighbors expects .four or .eight', 'TypeError');
}

function gridSegments(grid: RankValue, widthValue: RankValue): RankArray {
    const [rows, columns] = gridShape(grid, 'segments');
    const width = positiveWidth(widthValue);
    const items: RankValue[] = [];

    for (const [dy, dx] of directions) {
        for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < columns; column += 1) {
                const lastRow = row + (width - 1) * dy;
                const lastColumn = column + (width - 1) * dx;
                if (!inside(lastRow, lastColumn, rows, columns)) continue;
                for (let step = 0; step < width; step += 1) {
                    items.push(readArrayItem(grid as RankArray,
                        (row + step * dy) * columns + column + step * dx));
                }
            }
        }
    }
    return ownedArray(items, [items.length / width, width]);
}

function gridShape(value: RankValue, operation: string): [number, number] {
    if (!isRankArray(value) || value.shape.length !== 2) {
        throw new RankError(`${operation} expects a rank-2 array`, 'DimensionMismatch');
    }
    return [value.shape[0], value.shape[1]];
}

function gridIndex(value: RankValue, limit: number, name: string): number {
    const index = expectInteger(value);
    if (index < 0n || index >= BigInt(limit)) {
        throw new RankError(`${name} is outside the grid`, 'RangeError');
    }
    return Number(index);
}

function positiveWidth(value: RankValue): number {
    const width = expectInteger(value);
    if (width < 1n || width > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError('segment width must be positive', 'RangeError');
    }
    return Number(width);
}

function inside(row: number, column: number, rows: number, columns: number): boolean {
    return row >= 0 && row < rows && column >= 0 && column < columns;
}
