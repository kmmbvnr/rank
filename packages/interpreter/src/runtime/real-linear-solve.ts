import { hasMaskedCells, realCells, typedArray } from './array-storage.js';
import { checkpoint, checkInterrupt, demandBudgetEnabled, inspectionEnabled, privateLoopPolling, interruptsEnabled } from '../interrupt.js';
import { RankError } from '../errors.js';
import type { RankArray } from './value.js';

let workspace: WeakRef<Float64Array> | undefined;

/** Completed finite real inputs can be solved in flat private buffers.
 * Observable demand and opaque readers retain the scalar traversal. */
export function solveStoredReals(left: RankArray, right: RankArray): RankArray | undefined {
    if (!privateLoopPolling() || demandBudgetEnabled() || inspectionEnabled()
        || left.itemAt || right.itemAt || hasMaskedCells(left) || hasMaskedCells(right)) return undefined;
    const size = left.shape[0], columns = right.shape.length === 1 ? 1 : right.shape[1];
    if (!size || !columns) return undefined;
    const coefficients = realCells(left), rhs = realCells(right);
    if (!coefficients || !rhs || coefficients.length !== size * size || rhs.length !== size * columns
        || coefficients instanceof Float64Array && !(coefficients.buffer instanceof ArrayBuffer)
        || rhs instanceof Float64Array && !(rhs.buffer instanceof ArrayBuffer)) return undefined;
    checkInterrupt('computing linear algebra');
    const polling = interruptsEnabled();
    const copy = (source: ArrayLike<number>, reuse?: Float64Array): Float64Array | undefined => {
        const result = reuse?.length === source.length ? reuse : new Float64Array(source.length);
        for (let start = 0; start < source.length; start += 4096) {
            const end = Math.min(source.length, start + 4096);
            if (polling) checkpoint('preparing linear algebra', end - start);
            for (let at = start; at < end; at++) {
                const cell = source[at];
                if (!Number.isFinite(cell)) return undefined;
                result[at] = cell;
            }
        }
        return result;
    };
    // The coefficient scratch never escapes. A weak slot reuses consecutive
    // same-size solves without keeping a large allocation alive across GC.
    const reusable = workspace?.deref();
    workspace = undefined;
    const matrix = copy(coefficients, reusable);
    if (!matrix) return undefined;
    try {
        const values = copy(rhs);
        if (!values) return undefined;
        let work = 0;
        const poll = (amount: number) => {
            if (!polling) return;
            work += amount;
            if (work >= 4096) { checkpoint('computing linear algebra', work); work = 0; }
        };
        for (let column = 0; column < size; column++) {
            if (polling) checkpoint('computing linear algebra', work + 1); work = 0;
            let pivot = column;
            for (let row = column + 1; row < size; row++) {
                poll(1);
                if (Math.abs(matrix[row * size + column]) > Math.abs(matrix[pivot * size + column])) pivot = row;
            }
            if (matrix[pivot * size + column] === 0)
                throw new RankError('solve expects a nonsingular matrix', 'SingularMatrix');
            if (pivot !== column) {
                for (const [cells, width] of [[matrix, size], [values, columns]] as const) {
                    for (let start = 0; start < width; start += 4096) {
                        const end = Math.min(width, start + 4096);
                        if (polling) checkpoint('swapping linear algebra rows', end - start);
                        for (let at = start; at < end; at++) {
                            const a = column * width + at, b = pivot * width + at;
                            const cell = cells[a]; cells[a] = cells[b]; cells[b] = cell;
                        }
                    }
                }
            }
            const head = column * size;
            let finitePivot: boolean | undefined;
            for (let row = column + 1; row < size; row++) {
                const base = row * size, factor = matrix[base + column] / matrix[head + column];
                matrix[base + column] = 0;
                if (factor === 0) {
                    // Zero times an overflowed pivot cell must still propagate NaN.
                    // With a finite pivot row, only unobservable zero signs differ.
                    if (finitePivot === undefined) {
                        finitePivot = true;
                        for (let inner = column + 1; inner < size; inner++) {
                            poll(1);
                            if (!Number.isFinite(matrix[head + inner])) { finitePivot = false; break; }
                        }
                        for (let result = 0; result < columns && finitePivot; result++) {
                            poll(1);
                            if (!Number.isFinite(values[column * columns + result])) finitePivot = false;
                        }
                    }
                    if (finitePivot) continue;
                }
                for (let start = column + 1; start < size; start += 4096) {
                    const end = Math.min(size, start + 4096);
                    poll(end - start);
                    for (let inner = start; inner < end; inner++)
                        matrix[base + inner] -= factor * matrix[head + inner];
                }
                for (let start = 0; start < columns; start += 4096) {
                    const end = Math.min(columns, start + 4096);
                    poll(end - start);
                    for (let result = start; result < end; result++)
                        values[row * columns + result] -= factor * values[column * columns + result];
                }
            }
        }
        for (let row = size - 1; row >= 0; row--) {
            if (polling) checkpoint('computing linear algebra', work + 1); work = 0;
            for (let result = 0; result < columns; result++) {
                let value = values[row * columns + result];
                for (let start = row + 1; start < size; start += 4096) {
                    const end = Math.min(size, start + 4096);
                    poll(end - start);
                    for (let inner = start; inner < end; inner++)
                        value -= matrix[row * size + inner] * values[inner * columns + result];
                }
                const answer = value / matrix[row * size + row];
                values[row * columns + result] = Object.is(answer, -0) ? 0 : answer;
            }
        }
        checkInterrupt('computing linear algebra');
        return typedArray(values, right.shape);
    } finally { workspace = typeof WeakRef === 'function' ? new WeakRef(matrix) : undefined; }
}
