import { derivedArray, eagerOperandItems, float64Cells, ownedArray, readArrayItem, realCells, typedArray } from './array-storage.js';
import { RankError } from './errors.js';
import { checkpoint } from './interrupt.js';
import type { RankArray, RankValue } from './value.js';

export function mapBroadcastArrays(
    left: RankArray,
    right: RankArray,
    operation: (left: RankValue, right: RankValue) => RankValue,
): RankArray {
    const shape = broadcastShape(left.shape, right.shape);
    const leftStrides = arrayStrides(left.shape);
    const rightStrides = arrayStrides(right.shape);
    const sameShape = left.shape.length === right.shape.length
        && left.shape.every((dimension, axis) => dimension === right.shape[axis]);
    return derivedArray(shape, [left, right], index => operation(
        arrayItem(left, sameShape ? index : broadcastOffset(index, shape, left.shape, leftStrides)),
        arrayItem(right, sameShape ? index : broadcastOffset(index, shape, right.shape, rightStrides)),
    ), true);
}

/**
 * Apply an elementwise operation at once when both operands are stored scalar
 * arrays (or numeric scalars), instead of stacking one lazy layer per operation.
 * Nothing unread is forced: an operand that is itself lazy declines, and an
 * operation that raises for some cell declines, so that cell raises only when
 * it is read, as in the lazy path.
 */
export function mapDenseArrays(
    left: RankValue,
    right: RankValue,
    operation: (left: RankValue, right: RankValue) => RankValue,
    realCode = -1,
): RankArray | undefined {
    const leftArray = isArrayValue(left) ? left : undefined;
    const rightArray = isArrayValue(right) ? right : undefined;
    if (!leftArray && !isNumeric(left)) return undefined;
    if (!rightArray && !isNumeric(right)) return undefined;
    const shape = leftArray && rightArray
        ? broadcastShape(leftArray.shape, rightArray.shape) : (leftArray ?? rightArray!).shape;
    const size = shape.reduce((product, dimension) => product * dimension, 1);
    // A small array costs little to keep lazy; the layers only add up on large ones.
    if (size < DENSE_MIN_CELLS) return undefined;
    const leftItems = leftArray ? eagerOperandItems(leftArray) : undefined;
    const rightItems = rightArray ? eagerOperandItems(rightArray) : undefined;
    if (leftArray && !leftItems) return undefined;
    if (rightArray && !rightItems) return undefined;
    const same = !!leftArray && !!rightArray
        && leftArray.shape.length === rightArray.shape.length
        && leftArray.shape.every((dimension, axis) => dimension === rightArray.shape[axis]);
    const leftStrides = leftArray && arrayStrides(leftArray.shape);
    const rightStrides = rightArray && arrayStrides(rightArray.shape);
    // 0: the operand has the result's shape; n: its shape is the trailing part
    // of the result's, so its cell is the index modulo n; -1: general broadcast.
    const leftMod = leftArray ? trailingCells(leftArray.shape, shape) : 0;
    const rightMod = rightArray ? trailingCells(rightArray.shape, shape) : 0;
    // Real arithmetic on real cells gives real cells, so the result goes straight
    // into a typed buffer: no boxed doubles, and one allocation outside the heap.
    const realMode = realCode >= 0
        && (leftArray ? realCells(leftArray) !== undefined : typeof left === 'number')
        && (rightArray ? realCells(rightArray) !== undefined : typeof right === 'number');
    if (realMode && leftMod >= 0 && rightMod >= 0) {
        const a = leftArray ? float64Cells(leftArray)! : (left as number);
        const b = rightArray ? float64Cells(rightArray)! : (right as number);
        const result = realKernel(realCode, size, a, b, leftMod, rightMod);
        if (result) return typedArray(result, shape);
    }
    // An operand that is real makes every result cell real, whatever the other
    // one holds, so the result is typed then too.
    const someReal = realCode >= 0 && !realMode
        && ((leftArray ? realCells(leftArray) !== undefined : typeof left === 'number')
            || (rightArray ? realCells(rightArray) !== undefined : typeof right === 'number'));
    const typedResult = realMode || someReal;
    const cells: RankValue[] = typedResult ? new Float64Array(size) as unknown as RankValue[] : new Array(size);
    try {
        // Each shape case gets its own loop, so the hot one has no per-cell branch.
        for (let start = 0; start < size; start += DENSE_CHUNK) {
            checkpoint('computing array');
            const end = Math.min(size, start + DENSE_CHUNK);
            if (leftItems && rightItems && same) {
                for (let index = start; index < end; index += 1) {
                    const a = leftItems[index], b = rightItems[index];
                    cells[index] = typeof a === 'number' && typeof b === 'number'
                        ? realOperation(realCode, a, b, operation) : operation(a, b);
                }
            } else if (leftItems && !rightArray) {
                for (let index = start; index < end; index += 1) {
                    const a = leftItems[index];
                    cells[index] = typeof a === 'number' && typeof right === 'number'
                        ? realOperation(realCode, a, right, operation) : operation(a, right);
                }
            } else if (rightItems && !leftArray) {
                for (let index = start; index < end; index += 1) {
                    const b = rightItems[index];
                    cells[index] = typeof left === 'number' && typeof b === 'number'
                        ? realOperation(realCode, left, b, operation) : operation(left, b);
                }
            } else if (leftMod >= 0 && rightMod >= 0) {
                for (let index = start; index < end; index += 1) {
                    const a = leftItems![leftMod ? index % leftMod : index];
                    const b = rightItems![rightMod ? index % rightMod : index];
                    cells[index] = typeof a === 'number' && typeof b === 'number'
                        ? realOperation(realCode, a, b, operation) : operation(a, b);
                }
            } else {
                for (let index = start; index < end; index += 1) {
                    cells[index] = operation(
                        leftItems![broadcastOffset(index, shape, leftArray!.shape, leftStrides!)],
                        rightItems![broadcastOffset(index, shape, rightArray!.shape, rightStrides!)]);
                }
            }
        }
    } catch (error) {
        if (error instanceof RankError) return undefined;
        throw error;
    }
    // Every cell is a number, a boolean or a bigint: the operands were scalar
    // and the operation returned a scalar.
    return typedResult ? typedArray(cells as unknown as Float64Array, shape) : ownedArray(cells, shape, true);
}

const DENSE_MIN_CELLS = 1024;
const DENSE_CHUNK = 4096;

/**
 * Real +, -, *, / over typed buffers. Each operand is a buffer or a scalar, and
 * `aMod`/`bMod` are 0 for full shape or the length of a trailing shape. Declines
 * on a zero divisor, so the general path decides what that means.
 */
function realKernel(
    code: number, size: number, a: Float64Array | number, b: Float64Array | number,
    aMod: number, bMod: number,
): Float64Array | undefined {
    const out = new Float64Array(size);
    for (let start = 0; start < size; start += DENSE_CHUNK) {
        checkpoint('computing array');
        const end = Math.min(size, start + DENSE_CHUNK);
        if (typeof a !== 'number' && typeof b !== 'number' && aMod === 0 && bMod === 0) {
            switch (code) {
                case 0: for (let i = start; i < end; i += 1) out[i] = a[i] + b[i]; break;
                case 1: for (let i = start; i < end; i += 1) out[i] = a[i] - b[i]; break;
                case 2: for (let i = start; i < end; i += 1) out[i] = a[i] * b[i]; break;
                default:
                    for (let i = start; i < end; i += 1) {
                        if (b[i] === 0) return undefined;
                        out[i] = a[i] / b[i];
                    }
            }
        } else if (typeof b === 'number' && typeof a !== 'number' && aMod === 0) {
            switch (code) {
                case 0: for (let i = start; i < end; i += 1) out[i] = a[i] + b; break;
                case 1: for (let i = start; i < end; i += 1) out[i] = a[i] - b; break;
                case 2: for (let i = start; i < end; i += 1) out[i] = a[i] * b; break;
                default:
                    if (b === 0) return undefined;
                    for (let i = start; i < end; i += 1) out[i] = a[i] / b;
            }
        } else if (typeof a === 'number' && typeof b !== 'number' && bMod === 0) {
            switch (code) {
                case 0: for (let i = start; i < end; i += 1) out[i] = a + b[i]; break;
                case 1: for (let i = start; i < end; i += 1) out[i] = a - b[i]; break;
                case 2: for (let i = start; i < end; i += 1) out[i] = a * b[i]; break;
                default:
                    for (let i = start; i < end; i += 1) {
                        if (b[i] === 0) return undefined;
                        out[i] = a / b[i];
                    }
            }
        } else {
            for (let i = start; i < end; i += 1) {
                const x = typeof a === 'number' ? a : a[aMod ? i % aMod : i];
                const y = typeof b === 'number' ? b : b[bMod ? i % bMod : i];
                switch (code) {
                    case 0: out[i] = x + y; break;
                    case 1: out[i] = x - y; break;
                    case 2: out[i] = x * y; break;
                    default:
                        if (y === 0) return undefined;
                        out[i] = x / y;
                }
            }
        }
    }
    return out;
}

function trailingCells(operand: readonly number[], result: readonly number[]): number {
    if (operand.length === result.length) return operand.every((size, axis) => size === result[axis]) ? 0 : -1;
    if (operand.length > result.length) return -1;
    const offset = result.length - operand.length;
    return operand.every((size, axis) => size === result[offset + axis])
        ? operand.reduce((product, size) => product * size, 1) : -1;
}

/** Codes for the real operations that run without a call through `operation`. */
export const REAL_CODES: Readonly<Record<string, number>> = { '+': 0, '-': 1, '*': 2, '/': 3 };

// One switch on a constant per cell is cheaper than a closure call per cell.
function realOperation(
    code: number, a: number, b: number, operation: (left: RankValue, right: RankValue) => RankValue,
): RankValue {
    switch (code) {
        case 0: return a + b;
        case 1: return a - b;
        case 2: return a * b;
        case 3: return b === 0 ? operation(a, b) : a / b;
        default: return operation(a, b);
    }
}
const isArrayValue =(value: RankValue): value is RankArray =>
    typeof value === 'object' && value !== null && (value as { kind?: string }).kind === 'array';
const isNumeric = (value: RankValue) => typeof value === 'number' || typeof value === 'bigint';

export function broadcastShape(
    left: readonly number[],
    right: readonly number[],
): readonly number[] {
    const rank = Math.max(left.length, right.length);
    const shape = Array(rank).fill(1) as number[];
    for (let offset = 1; offset <= rank; offset += 1) {
        const a = left.at(-offset) ?? 1;
        const b = right.at(-offset) ?? 1;
        if (a !== b && a !== 1 && b !== 1) {
            throw new RankError(
                `shape mismatch: ${left.join(',')} and ${right.join(',')}`,
                'DimensionMismatch',
            );
        }
        shape[rank - offset] = a === 1 ? b : b === 1 ? a : a;
    }
    return shape;
}

function broadcastOffset(
    index: number,
    resultShape: readonly number[],
    sourceShape: readonly number[],
    sourceStrides: readonly number[],
): number {
    const leading = resultShape.length - sourceShape.length;
    let remaining = index;
    let offset = 0;
    for (let axis = resultShape.length - 1; axis >= 0; axis -= 1) {
        const coordinate = remaining % resultShape[axis];
        remaining = Math.floor(remaining / resultShape[axis]);
        const sourceAxis = axis - leading;
        if (sourceAxis >= 0 && sourceShape[sourceAxis] !== 1) {
            offset += coordinate * sourceStrides[sourceAxis];
        }
    }
    return offset;
}

function arrayStrides(shape: readonly number[]): number[] {
    const strides = Array(shape.length).fill(1) as number[];
    for (let axis = shape.length - 2; axis >= 0; axis -= 1) {
        strides[axis] = strides[axis + 1] * shape[axis + 1];
    }
    return strides;
}

function arrayItem(value: RankArray, index: number): RankValue {
    return readArrayItem(value, index);
}
