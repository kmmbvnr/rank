import { RankError } from '../errors.js';
import { isRankArray, type RankArray, type RankValue } from '../value.js';
import { expectNumeric, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const linalgModule: RuntimeModule = {
    inverse: () => native(
        'inverse',
        1,
        arguments_ => inverseMatrix(arguments_[0]),
        2,
        undefined,
        shape => shape,
    ),
};

function inverseMatrix(value: RankValue): RankArray {
    if (
        !isRankArray(value)
        || value.shape.length !== 2
        || value.shape[0] !== value.shape[1]
    ) {
        throw new RankError('inverse expects a square rank-2 matrix', 'DimensionMismatch');
    }

    const size = value.shape[0];
    const width = size * 2;
    const work = Array.from({ length: size }, (_, row) =>
        Array.from({ length: width }, (_, column) => {
            if (column >= size) return column - size === row ? 1 : 0;
            return Number(expectNumeric(arrayItem(value, row * size + column)));
        }));

    for (let column = 0; column < size; column += 1) {
        let pivot = column;
        for (let row = column + 1; row < size; row += 1) {
            if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row;
        }
        maybeSwap(work, column, pivot);

        const divisor = work[column][column];
        if (divisor === 0) {
            throw new RankError('inverse expects a nonsingular matrix', 'SingularMatrix');
        }
        for (let j = 0; j < width; j += 1) work[column][j] /= divisor;

        for (let row = 0; row < size; row += 1) {
            if (row === column) continue;
            const factor = work[row][column];
            for (let j = 0; j < width; j += 1) {
                work[row][j] -= factor * work[column][j];
            }
        }
    }

    const items = work.flatMap(row =>
        row.slice(size).map(value => Object.is(value, -0) ? 0 : value));
    return { kind: 'array', shape: [size, size], items };
}

function maybeSwap(rows: number[][], left: number, right: number): void {
    if (left !== right) [rows[left], rows[right]] = [rows[right], rows[left]];
}

function arrayItem(value: RankArray, index: number): RankValue {
    return value.itemAt?.(index) ?? value.items[index];
}
