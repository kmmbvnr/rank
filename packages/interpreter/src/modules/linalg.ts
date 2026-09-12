import { derivedArray, ownedArray, readArrayItem, readArrayShape } from '../array-storage.js';
import { RankError } from '../errors.js';
import { isRankArray, type RankArray, type RankValue } from '../value.js';
import { expectNumeric, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const linalgModule: RuntimeModule = {
    diag: () => native(
        'diag',
        1,
        arguments_ => diagonal(arguments_[0]),
    ),
    det: () => native(
        'det',
        1,
        arguments_ => determinant(arguments_[0]),
        2,
    ),
    inverse: () => native(
        'inverse',
        1,
        arguments_ => inverseMatrix(arguments_[0]),
        2,
        undefined,
        shape => shape,
    ),
    matmul: () => native(
        'matmul',
        2,
        arguments_ => matmulValues(arguments_[0], arguments_[1]),
    ),
    solve: () => native(
        'solve',
        2,
        arguments_ => solveLinearSystem(arguments_[0], arguments_[1]),
    ),
    eigh: () => native(
        'eigh',
        1,
        arguments_ => symmetricEigendecomposition(arguments_[0]),
    ),
};

function diagonal(value: RankValue): RankArray {
    if (!isRankArray(value) || (value.shape.length !== 1 && value.shape.length !== 2)) {
        throw new RankError(
            'diag expects a rank-1 vector or rank-2 matrix',
            'DimensionMismatch',
        );
    }

    if (value.shape.length === 2) {
        const [rows, columns] = value.shape;
        const size = Math.min(rows, columns);
        const items = Array.from({ length: size }, (_, index) =>
            diagNumber(arrayItem(value, index * columns + index)));
        return ownedArray(items);
    }

    const size = value.shape[0];
    const values = Array.from({ length: size }, (_, index) =>
        diagNumber(arrayItem(value, index)));
    const zero = values.some(item => typeof item === 'number') ? 0 : 0n;
    const items = Array.from({ length: size * size }, (_, index) => {
        const row = Math.floor(index / size);
        const column = index % size;
        return row === column ? values[row] : zero;
    });
    return ownedArray(items, [size, size]);
}

function diagNumber(value: RankValue): bigint | number {
    if (typeof value === 'bigint' || typeof value === 'number') return value;
    throw new RankError('diag expects numeric elements', 'TypeError');
}

function symmetricEigendecomposition(value: RankValue): RankArray {
    if (!isRankArray(value) || value.shape.length !== 2
        || value.shape[0] !== value.shape[1]) {
        throw new RankError('eigh expects a square rank-2 matrix', 'DimensionMismatch');
    }

    const size = value.shape[0];
    const matrix = numericMatrix(value, size, 'eigh');
    validateSymmetric(matrix);
    const vectors = identityMatrix(size);
    const scale = Math.max(1, ...matrix.flat().map(Math.abs));
    const tolerance = scale * 1e-12;
    const limit = Math.max(1, 100 * size * size);

    let converged = size < 2;
    for (let iteration = 0; iteration < limit && !converged; iteration += 1) {
        const pivot = largestOffDiagonal(matrix);
        if (pivot.value <= tolerance) {
            converged = true;
            break;
        }
        rotateJacobi(matrix, vectors, pivot.row, pivot.column);
    }
    if (!converged && largestOffDiagonal(matrix).value <= tolerance) converged = true;
    if (!converged) {
        throw new RankError('eigh did not converge', 'ConvergenceError');
    }

    const order = Array.from({ length: size }, (_, index) => index)
        .sort((left, right) => matrix[left][left] - matrix[right][right]);
    const values = ownedArray(order.map(index => cleanReal(matrix[index][index])));
    const vectorItems = Array.from({ length: size * size }, (_, index) => {
        const row = Math.floor(index / size);
        const column = index % size;
        return cleanReal(vectors[row][order[column]]);
    });
    const vectorArray = ownedArray(vectorItems, [size, size]);
    return ownedArray([values, vectorArray]);
}

function numericMatrix(value: RankArray, size: number, operation: string): number[][] {
    return Array.from({ length: size }, (_, row) =>
        Array.from({ length: size }, (_, column) => {
            const item = arrayItem(value, row * size + column);
            if (typeof item !== 'bigint' && typeof item !== 'number') {
                throw new RankError(`${operation} expects numeric elements`, 'TypeError');
            }
            const numeric = Number(item);
            if (!Number.isFinite(numeric)) {
                throw new RankError(`${operation} expects finite elements`, 'DomainError');
            }
            return numeric;
        }));
}

function validateSymmetric(matrix: number[][]): void {
    const size = matrix.length;
    for (let row = 0; row < size; row += 1) {
        for (let column = row + 1; column < size; column += 1) {
            const left = matrix[row][column];
            const right = matrix[column][row];
            const scale = Math.max(1, Math.abs(left), Math.abs(right));
            if (Math.abs(left - right) > scale * 1e-12) {
                throw new RankError('eigh expects a symmetric matrix', 'NotSymmetric');
            }
            const average = (left + right) / 2;
            matrix[row][column] = average;
            matrix[column][row] = average;
        }
    }
}

function identityMatrix(size: number): number[][] {
    return Array.from({ length: size }, (_, row) =>
        Array.from({ length: size }, (_, column) => row === column ? 1 : 0));
}

function largestOffDiagonal(matrix: readonly (readonly number[])[]): {
    row: number;
    column: number;
    value: number;
} {
    let row = 0;
    let column = 0;
    let value = 0;
    for (let i = 0; i < matrix.length; i += 1) {
        for (let j = i + 1; j < matrix.length; j += 1) {
            const candidate = Math.abs(matrix[i][j]);
            if (candidate > value) {
                row = i;
                column = j;
                value = candidate;
            }
        }
    }
    return { row, column, value };
}

function rotateJacobi(
    matrix: number[][],
    vectors: number[][],
    row: number,
    column: number,
): void {
    const offDiagonal = matrix[row][column];
    const difference = matrix[column][column] - matrix[row][row];
    const tau = difference / (2 * offDiagonal);
    const tangent = tau === 0
        ? 1
        : Math.sign(tau) / (Math.abs(tau) + Math.hypot(1, tau));
    const cosine = 1 / Math.sqrt(1 + tangent * tangent);
    const sine = tangent * cosine;

    for (let index = 0; index < matrix.length; index += 1) {
        if (index === row || index === column) continue;
        const left = matrix[index][row];
        const right = matrix[index][column];
        matrix[index][row] = cosine * left - sine * right;
        matrix[row][index] = matrix[index][row];
        matrix[index][column] = sine * left + cosine * right;
        matrix[column][index] = matrix[index][column];
    }

    matrix[row][row] -= tangent * offDiagonal;
    matrix[column][column] += tangent * offDiagonal;
    matrix[row][column] = 0;
    matrix[column][row] = 0;

    for (let index = 0; index < vectors.length; index += 1) {
        const left = vectors[index][row];
        const right = vectors[index][column];
        vectors[index][row] = cosine * left - sine * right;
        vectors[index][column] = sine * left + cosine * right;
    }
}

function cleanReal(value: number): number {
    return Object.is(value, -0) ? 0 : value;
}

export function determinant(value: RankValue): bigint | number {
    if (
        !isRankArray(value)
        || value.shape.length !== 2
        || value.shape[0] !== value.shape[1]
    ) {
        throw new RankError('det expects a square rank-2 matrix', 'DimensionMismatch');
    }

    const size = value.shape[0];
    const items = Array.from({ length: size * size }, (_, index) => arrayItem(value, index));
    if (items.some(item => typeof item !== 'bigint' && typeof item !== 'number')) {
        throw new RankError('det expects numeric elements', 'TypeError');
    }
    if (items.every(item => typeof item === 'bigint')) {
        return integerDeterminant(items as bigint[], size);
    }
    return realDeterminant(items.map(Number), size);
}

function integerDeterminant(items: readonly bigint[], size: number): bigint {
    if (size === 0) return 1n;
    const work = Array.from(
        { length: size },
        (_, row) => items.slice(row * size, (row + 1) * size),
    );
    let sign = 1n;
    let divisor = 1n;

    for (let column = 0; column < size - 1; column += 1) {
        const pivot = work.findIndex((row, index) => index >= column && row[column] !== 0n);
        if (pivot < 0) return 0n;
        if (pivot !== column) {
            [work[column], work[pivot]] = [work[pivot], work[column]];
            sign = -sign;
        }

        const pivotValue = work[column][column];
        for (let row = column + 1; row < size; row += 1) {
            for (let inner = column + 1; inner < size; inner += 1) {
                work[row][inner] = (
                    work[row][inner] * pivotValue
                    - work[row][column] * work[column][inner]
                ) / divisor;
            }
            work[row][column] = 0n;
        }
        divisor = pivotValue;
    }
    return sign * work[size - 1][size - 1];
}

function realDeterminant(items: readonly number[], size: number): number {
    if (size === 0) return 1;
    const work = Array.from(
        { length: size },
        (_, row) => items.slice(row * size, (row + 1) * size),
    );
    let result = 1;

    for (let column = 0; column < size; column += 1) {
        let pivot = column;
        for (let row = column + 1; row < size; row += 1) {
            if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row;
        }
        if (work[pivot][column] === 0) return 0;
        if (pivot !== column) {
            [work[column], work[pivot]] = [work[pivot], work[column]];
            result = -result;
        }

        const pivotValue = work[column][column];
        result *= pivotValue;
        for (let row = column + 1; row < size; row += 1) {
            const factor = work[row][column] / pivotValue;
            for (let inner = column + 1; inner < size; inner += 1) {
                work[row][inner] -= factor * work[column][inner];
            }
        }
    }
    return Object.is(result, -0) ? 0 : result;
}

export function solveLinearSystem(coefficients: RankValue, right: RankValue): RankArray {
    if (
        !isRankArray(coefficients)
        || coefficients.shape.length !== 2
        || coefficients.shape[0] !== coefficients.shape[1]
    ) {
        throw new RankError('solve expects a square rank-2 coefficient matrix', 'DimensionMismatch');
    }
    if (!isRankArray(right) || (right.shape.length !== 1 && right.shape.length !== 2)) {
        throw new RankError('solve expects a rank-1 or rank-2 right side', 'DimensionMismatch');
    }

    const size = coefficients.shape[0];
    if (right.shape[0] !== size) {
        throw new RankError(
            `solve dimensions differ: ${size} and ${right.shape[0]}`,
            'DimensionMismatch',
        );
    }
    const columns = right.shape.length === 1 ? 1 : right.shape[1];
    const matrix = numericRows(coefficients, size, size, 'coefficient');
    const values = numericRows(right, size, columns, 'right-side');

    for (let column = 0; column < size; column += 1) {
        let pivot = column;
        for (let row = column + 1; row < size; row += 1) {
            if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
        }
        if (matrix[pivot][column] === 0) {
            throw new RankError('solve expects a nonsingular matrix', 'SingularMatrix');
        }
        maybeSwap(matrix, column, pivot);
        maybeSwap(values, column, pivot);

        for (let row = column + 1; row < size; row += 1) {
            const factor = matrix[row][column] / matrix[column][column];
            matrix[row][column] = 0;
            for (let inner = column + 1; inner < size; inner += 1) {
                matrix[row][inner] -= factor * matrix[column][inner];
            }
            for (let result = 0; result < columns; result += 1) {
                values[row][result] -= factor * values[column][result];
            }
        }
    }

    const solved = Array.from({ length: size }, () => Array(columns).fill(0) as number[]);
    for (let row = size - 1; row >= 0; row -= 1) {
        for (let result = 0; result < columns; result += 1) {
            let value = values[row][result];
            for (let inner = row + 1; inner < size; inner += 1) {
                value -= matrix[row][inner] * solved[inner][result];
            }
            const answer = value / matrix[row][row];
            solved[row][result] = Object.is(answer, -0) ? 0 : answer;
        }
    }
    return ownedArray(solved.flat(), right.shape);
}

function numericRows(
    value: RankArray,
    rows: number,
    columns: number,
    name: string,
): number[][] {
    return Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, column) => {
            const item = arrayItem(value, row * columns + column);
            if (typeof item !== 'bigint' && typeof item !== 'number') {
                throw new RankError(`solve expects numeric ${name} elements`, 'TypeError');
            }
            return Number(item);
        }));
}

export function matmulValues(
    left: RankValue,
    right: RankValue,
    axes?: readonly [number, number],
): RankValue {
    if (!isRankArray(left) || left.shape.length === 0
        || !isRankArray(right) || right.shape.length === 0) {
        throw new RankError('matmul expects rank-1 or higher arrays');
    }

    const leftAxis = axes?.[0] ?? left.shape.length - 1;
    const rightAxis = axes?.[1] ?? 0;
    validateAxis(left.shape, leftAxis, 'left');
    validateAxis(right.shape, rightAxis, 'right');
    if (left.shape[leftAxis] !== right.shape[rightAxis]) {
        throw new RankError(
            `matmul contracted dimensions differ: ${left.shape[leftAxis]} and ${right.shape[rightAxis]}`,
            'DimensionMismatch',
        );
    }

    const leftAxes = remainingAxes(left.shape, leftAxis);
    const rightAxes = remainingAxes(right.shape, rightAxis);
    const outputShape = [
        ...leftAxes.map(axis => left.shape[axis]),
        ...rightAxes.map(axis => right.shape[axis]),
    ];
    const contracted = left.shape[leftAxis];
    const resultAt = (index: number): bigint | number => {
        const output = coordinatesAt(outputShape, index);
        const leftCoordinates = Array(left.shape.length).fill(0) as number[];
        const rightCoordinates = Array(right.shape.length).fill(0) as number[];
        leftAxes.forEach((axis, position) => {
            leftCoordinates[axis] = output[position];
        });
        rightAxes.forEach((axis, position) => {
            rightCoordinates[axis] = output[leftAxes.length + position];
        });

        let total: bigint | number = 0n;
        for (let inner = 0; inner < contracted; inner += 1) {
            leftCoordinates[leftAxis] = inner;
            rightCoordinates[rightAxis] = inner;
            const a = expectNumeric(arrayItem(left, arrayOffset(readArrayShape(left), leftCoordinates)));
            const b = expectNumeric(arrayItem(right, arrayOffset(readArrayShape(right), rightCoordinates)));
            total = addNumbers(total, multiplyNumbers(a, b));
        }
        return total;
    };

    if (outputShape.length === 0) return resultAt(0);
    return derivedArray(outputShape, [left, right], resultAt, true);
}

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
    return ownedArray(items, [size, size]);
}

function maybeSwap(rows: number[][], left: number, right: number): void {
    if (left !== right) [rows[left], rows[right]] = [rows[right], rows[left]];
}

function arrayItem(value: RankArray, index: number): RankValue {
    return readArrayItem(value, index);
}

function validateAxis(shape: readonly number[], axis: number, side: 'left' | 'right'): void {
    if (axis >= shape.length) {
        throw new RankError(`matmul ${side} axis out of bounds: ${axis}`);
    }
}

function remainingAxes(shape: readonly number[], contractedAxis: number): number[] {
    return shape.map((_, axis) => axis).filter(axis => axis !== contractedAxis);
}

function coordinatesAt(shape: readonly number[], index: number): number[] {
    const result = Array(shape.length).fill(0) as number[];
    for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
        result[axis] = index % shape[axis];
        index = Math.floor(index / shape[axis]);
    }
    return result;
}

function arrayOffset(shape: readonly number[], coordinates: readonly number[]): number {
    return coordinates.reduce((offset, coordinate, axis) => offset * shape[axis] + coordinate, 0);
}


function multiplyNumbers(left: bigint | number, right: bigint | number): bigint | number {
    return typeof left === 'bigint' && typeof right === 'bigint'
        ? left * right
        : Number(left) * Number(right);
}

function addNumbers(left: bigint | number, right: bigint | number): bigint | number {
    return typeof left === 'bigint' && typeof right === 'bigint'
        ? left + right
        : Number(left) + Number(right);
}
