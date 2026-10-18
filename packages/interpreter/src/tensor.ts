import { prepareStoredScalarView, type LinearView } from './integer-view.js';
import { mapPair, runExecution } from './execution.js';
import { evaluateArrayItem, derivedArray, denseScalarItems, storedOperandItems, float64Cells, ownedArray, realCells, typedArray } from './array-storage.js';
import { RankError } from './errors.js';
import { checkpoint, InterruptedError } from './interrupt.js';
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
    const evaluate = (index: number) => mapPair(
        evaluateArrayItem(left, sameShape ? index : broadcastOffset(index, shape, left.shape, leftStrides)),
        () => evaluateArrayItem(right, sameShape ? index : broadcastOffset(index, shape, right.shape, rightStrides)),
        operation,
    );
    return derivedArray(shape, [left, right], index => runExecution(evaluate(index)), true, evaluate);
}

/** Join already stored boolean masks without creating a lazy reader chain.
 * Unread cells, non-boolean values and broadcasting retain the general path. */
export function mapBooleanArrays(left: RankArray, right: RankArray, operator: 'and' | 'or' | 'xor'): RankArray | undefined {
    if (left.shape.length !== right.shape.length
        || left.shape.some((size, axis) => size !== right.shape[axis])) return undefined;
    const a = denseScalarItems(left), b = denseScalarItems(right);
    if (!a || !b) return undefined;
    const items: boolean[] = new Array(a.length);
    for (let index = 0; index < a.length; index++) {
        if ((index & 4095) === 0) checkpoint('combining boolean masks');
        const x = a[index], y = b[index];
        if (typeof x !== 'boolean' || typeof y !== 'boolean') return undefined;
        items[index] = operator === 'and' ? x && y : operator === 'or' ? x || y : x !== y;
    }
    return ownedArray(items, left.shape, true);
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
    allowSmall = false,
): RankArray | undefined {
    const leftArray = isArrayValue(left) ? left : undefined;
    const rightArray = isArrayValue(right) ? right : undefined;
    if (!leftArray && !isNumeric(left)) return undefined;
    if (!rightArray && !isNumeric(right)) return undefined;
    const shape = leftArray && rightArray
        ? broadcastShape(leftArray.shape, rightArray.shape) : (leftArray ?? rightArray!).shape;
    const size = shape.reduce((product, dimension) => product * dimension, 1);
    // Small stored numeric formulas need no lazy cell maps. Comparison masks
    // retain their lazy/read-only interface; unread or host operands decline.
    if (size < DENSE_MIN_CELLS) {
        if (!allowSmall || realCode > LAST_ARITHMETIC_CODE) return undefined;
        const numeric = (array: RankArray | undefined, scalar: RankValue) => {
            if (!array) return isNumeric(scalar);
            const items = denseScalarItems(array) && storedOperandItems(array);
            if (!items) {
                const view = prepareStoredScalarView(array, true);
                return view?.regular && numericKinds(view.kinds);
            }
            for (let index = 0; index < items.length; index++) {
                if (!isNumeric(items[index])) return false;
            }
            return true;
        };
        if (!numeric(leftArray, left) || !numeric(rightArray, right)) return undefined;
    }
    let leftItems = leftArray ? storedOperandItems(leftArray) : undefined;
    let rightItems = rightArray ? storedOperandItems(rightArray) : undefined;
    if (leftArray && !leftItems || rightArray && !rightItems) {
        return mapStoredViews(left, right, shape, operation, realCode);
    }
    const same = !!leftArray && !!rightArray
        && leftArray.shape.length === rightArray.shape.length
        && leftArray.shape.every((dimension, axis) => dimension === rightArray.shape[axis]);
    // 0: the operand has the result's shape; n: its shape is the trailing part
    // of the result's, so its cell is the index modulo n; -1: general broadcast.
    let leftMod = leftArray ? trailingCells(leftArray.shape, shape) : 0;
    let rightMod = rightArray ? trailingCells(rightArray.shape, shape) : 0;
    // Real arithmetic on real cells gives real cells, so the result goes straight
    // into a typed buffer: no boxed doubles, and one allocation outside the heap.
    // Integers beside reals count as reals, as they do in scalar arithmetic.
    const isReal = (array: RankArray | undefined, scalar: RankValue) =>
        array ? realCells(array) !== undefined : typeof scalar === 'number';
    const leftReal = isReal(leftArray, left);
    const rightReal = isReal(rightArray, right);
    let a: Float64Array | number | undefined;
    let b: Float64Array | number | undefined;
    if (realCode >= 0 && (leftReal || rightReal)) {
        // Comparing an integer with a real is exact, so only arithmetic converts.
        const mixed = realCode <= LAST_ARITHMETIC_CODE;
        a = leftReal ? (leftArray ? float64Cells(leftArray)! : (left as number))
            : mixed ? integersAsReals(leftArray, leftItems, left) : undefined;
        b = rightReal ? (rightArray ? float64Cells(rightArray)! : (right as number))
            : mixed ? integersAsReals(rightArray, rightItems, right) : undefined;
    }
    const realMode = a !== undefined && b !== undefined;
    if (realMode) {
        // A shape that is not a trailing part of the result (a column against a
        // table) is laid out once at the result's shape, so the kernels stay flat.
        if (leftMod < 0) { a = expandOperand(a as Float64Array, leftArray!.shape, shape, Float64Array) as Float64Array; leftMod = 0; }
        if (rightMod < 0) { b = expandOperand(b as Float64Array, rightArray!.shape, shape, Float64Array) as Float64Array; rightMod = 0; }
        if (realCode > LAST_ARITHMETIC_CODE) return ownedArray(compareKernel(realCode, size, a!, b!, leftMod, rightMod), shape, true);
        const result = realKernel(realCode, size, a!, b!, leftMod, rightMod);
        if (result) return typedArray(result, shape);
        return undefined;
    }
    if (leftMod < 0) { leftItems = expandOperand<RankValue>(leftItems!, leftArray!.shape, shape, Array as never); leftMod = 0; }
    if (rightMod < 0) { rightItems = expandOperand<RankValue>(rightItems!, rightArray!.shape, shape, Array as never); rightMod = 0; }
    // An operand that is real makes every result cell real, whatever the other
    // one holds, so the result is typed then too.
    const someReal = realCode >= 0 && realCode <= LAST_ARITHMETIC_CODE && !realMode
        && (leftReal || rightReal);
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
            } else {
                for (let index = start; index < end; index += 1) {
                    const a = leftItems![leftMod ? index % leftMod : index];
                    const b = rightItems![rightMod ? index % rightMod : index];
                    cells[index] = typeof a === 'number' && typeof b === 'number'
                        ? realOperation(realCode, a, b, operation) : operation(a, b);
                }
            }
        }
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    // Every cell is a number, a boolean or a bigint: the operands were scalar
    // and the operation returned a scalar.
    return typedResult ? typedArray(cells as unknown as Float64Array, shape) : ownedArray(cells, shape, true);
}

/** Stored selections borrow their cells for this synchronous kernel only. No
 * lazy readers or host getters are probed, and failed checks retain lazy errors. */
function mapStoredViews(left: RankValue, right: RankValue, shape: readonly number[],
    operation: (left: RankValue, right: RankValue) => RankValue, code: number): RankArray | undefined {
    const a = isArrayValue(left) ? prepareStoredScalarView(left, true) : undefined;
    const b = isArrayValue(right) ? prepareStoredScalarView(right, true) : undefined;
    if (isArrayValue(left) && (!a?.regular || !numericKinds(a.kinds))
        || isArrayValue(right) && (!b?.regular || !numericKinds(b.kinds))) return undefined;
    const size = shape.reduce((product, dimension) => product * dimension, 1);
    const leftShape = isArrayValue(left) ? left.shape : [];
    const rightShape = isArrayValue(right) ? right.shape : [];
    const leftStrides = arrayStrides(leftShape), rightStrides = arrayStrides(rightShape);
    const sameLeft = leftShape.length === shape.length && leftShape.every((n, axis) => n === shape[axis]);
    const sameRight = rightShape.length === shape.length && rightShape.every((n, axis) => n === shape[axis]);
    const someReal = (view: typeof a, value: RankValue) => view ? view.kinds?.every(kind => kind === 'real' || kind === 'numeric-limit') : typeof value === 'number';
    const real = code >= 0 && code <= LAST_ARITHMETIC_CODE && (someReal(a, left) || someReal(b, right));
    // Contiguous Float64 slices use the existing typed kernel through zero-copy
    // subarrays. Strided buffers keep their offset/stride in that kernel.
    if (real && code <= LAST_ARITHMETIC_CODE && (!a || sameLeft) && (!b || sameRight)
        && (!a || a.items instanceof Float64Array && a.linear && a.validateUniform)
        && (!b || b.items instanceof Float64Array && b.linear && b.validateUniform)
        && (a || typeof left === 'number') && (b || typeof right === 'number')) {
        try {
            if (size) {
                if (a) a.validateUniform!(a.items[a.linear!.offset]);
                if (b) b.validateUniform!(b.items[b.linear!.offset]);
            }
            const operand = (view: typeof a, value: RankValue): Float64Array | number => view
                ? view.linear!.stride === 1 ? (view.items as Float64Array).subarray(view.linear!.offset, view.linear!.offset + size)
                    : view.items as Float64Array : value as number;
            const result = realKernel(code, size, operand(a, left), operand(b, right), 0, 0,
                a?.linear?.stride === 1 ? undefined : a?.linear, b?.linear?.stride === 1 ? undefined : b?.linear);
            return result ? typedArray(result, shape) : undefined;
        } catch (error) {
            if (error instanceof InterruptedError) throw error;
            if (error instanceof RankError) return undefined;
            throw error;
        }
    }
    const cells: RankValue[] = real ? new Float64Array(size) as unknown as RankValue[] : new Array(size);
    try {
        for (let start = 0; start < size; start += DENSE_CHUNK) {
            const end = Math.min(size, start + DENSE_CHUNK);
            checkpoint('computing array', end - start);
            for (let index = start; index < end; index++) {
                const ai = sameLeft ? index : broadcastOffset(index, shape, leftShape, leftStrides);
                const bi = sameRight ? index : broadcastOffset(index, shape, rightShape, rightStrides);
                const x = a ? a.linear ? a.items[a.linear.offset + a.linear.stride * ai] : a.read(ai) : left;
                const y = b ? b.linear ? b.items[b.linear.offset + b.linear.stride * bi] : b.read(bi) : right;
                if (a?.linear) a.validate?.(x, ai);
                if (b?.linear) b.validate?.(y, bi);
                cells[index] = typeof x === 'number' && typeof y === 'number'
                    ? realOperation(code, x, y, operation) : operation(x, y);
            }
        }
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return real ? typedArray(cells as unknown as Float64Array, shape) : ownedArray(cells, shape, true);
}

/**
 * `choose` at once when every operand is stored: the condition cells
 * must all be booleans and the branches scalars. Unread operands decline,
 * so the lazy form reads only the chosen branch cell.
 */
export function chooseDenseArrays(
    condition: RankValue, whenTrue: RankValue, whenFalse: RankValue, shape: readonly number[],
): RankArray | undefined {
    const size = shape.reduce((product, dimension) => product * dimension, 1);
    if (size < DENSE_MIN_CELLS) return undefined;
    const operands = [condition, whenTrue, whenFalse];
    const cells: ArrayLike<RankValue>[] = [];
    try {
        for (const operand of operands) {
            if (!isArrayValue(operand)) {
                if (typeof operand === 'object' && operand !== null) return undefined;
                cells.push([operand]);
                continue;
            }
            const items = storedOperandItems(operand);
            if (!items) return undefined;
            cells.push(trailingCells(operand.shape, shape) === 0 ? items
                : expandOperand<RankValue>(items, operand.shape, shape, Array as never));
        }
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    const [test, yes, no] = cells;
    const testStep = isArrayValue(condition) ? 1 : 0;
    const yesStep = isArrayValue(whenTrue) ? 1 : 0;
    const noStep = isArrayValue(whenFalse) ? 1 : 0;
    const reals = (values: ArrayLike<RankValue>) => values instanceof Float64Array
        || Array.prototype.every.call(values, cell => typeof cell === 'number');
    const real = reals(yes) && reals(no);
    const out: RankValue[] = real ? new Float64Array(size) as unknown as RankValue[] : new Array(size);
    for (let start = 0; start < size; start += DENSE_CHUNK) {
        checkpoint('computing array');
        const end = Math.min(size, start + DENSE_CHUNK);
        for (let index = start; index < end; index += 1) {
            const selected = test[index * testStep];
            if (typeof selected !== 'boolean') return undefined;
            out[index] = selected ? yes[index * yesStep] : no[index * noStep];
        }
    }
    if (real) return typedArray(out as unknown as Float64Array, shape);
    return out.every(isScalarCell) ? ownedArray(out, shape, true) : undefined;
}

const isScalarCell = (cell: RankValue) => typeof cell === 'number' || typeof cell === 'bigint'
    || typeof cell === 'boolean' || typeof cell === 'string';

const DENSE_MIN_CELLS = 1024;
const DENSE_CHUNK = 4096;

/**
 * Real +, -, *, / over typed buffers. Each operand is a buffer or a scalar, and
 * `aMod`/`bMod` are 0 for full shape or the length of a trailing shape. Declines
 * on a zero divisor, so the general path decides what that means.
 */
function realKernel(
    code: number, size: number, a: Float64Array | number, b: Float64Array | number,
    aMod: number, bMod: number, aView?: LinearView, bView?: LinearView,
): Float64Array | undefined {
    const out = new Float64Array(size);
    for (let start = 0; start < size; start += DENSE_CHUNK) {
        checkpoint('computing array');
        const end = Math.min(size, start + DENSE_CHUNK);
        if (!aView && !bView && typeof a !== 'number' && typeof b !== 'number' && aMod === 0 && bMod === 0 && code < 4) {
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
        } else if (!aView && typeof b === 'number' && typeof a !== 'number' && aMod === 0 && code < 4) {
            switch (code) {
                case 0: for (let i = start; i < end; i += 1) out[i] = a[i] + b; break;
                case 1: for (let i = start; i < end; i += 1) out[i] = a[i] - b; break;
                case 2: for (let i = start; i < end; i += 1) out[i] = a[i] * b; break;
                default:
                    if (b === 0) return undefined;
                    for (let i = start; i < end; i += 1) out[i] = a[i] / b;
            }
        } else if (!bView && typeof a === 'number' && typeof b !== 'number' && bMod === 0 && code < 4) {
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
                const x = typeof a === 'number' ? a : a[aView ? aView.offset + i * aView.stride : aMod ? i % aMod : i];
                const y = typeof b === 'number' ? b : b[bView ? bView.offset + i * bView.stride : bMod ? i % bMod : i];
                switch (code) {
                    case 0: out[i] = x + y; break;
                    case 1: out[i] = x - y; break;
                    case 2: out[i] = x * y; break;
                    case 4: {
                        // Zero to a negative power and a non-real result are errors.
                        const power = x ** y;
                        if (power !== power || (x === 0 && y < 0)) return undefined;
                        out[i] = power;
                        break;
                    }
                    default:
                        if (y === 0) return undefined;
                        out[i] = x / y;
                }
            }
        }
    }
    return out;
}

/** The cells of an operand repeated along its length-1 and missing axes, in
 * the row-major order of the broadcast shape. */
function expandOperand<T>(
    source: ArrayLike<T>, sourceShape: readonly number[], shape: readonly number[],
    Make: { new (size: number): { [index: number]: T; length: number } },
): ArrayLike<T> {
    const rank = shape.length;
    const leading = rank - sourceShape.length;
    const strides = arrayStrides(sourceShape);
    const step = shape.map((_, axis) => axis < leading || sourceShape[axis - leading] === 1 ? 0 : strides[axis - leading]);
    const size = shape.reduce((product, dimension) => product * dimension, 1);
    const out = new Make(size);
    const run = shape[rank - 1];
    const inner = step[rank - 1];
    const counters = new Array<number>(rank).fill(0);
    let base = 0;
    for (let start = 0; start < size; start += run) {
        for (let index = 0; index < run; index += 1) out[start + index] = source[base + index * inner];
        for (let axis = rank - 2; axis >= 0; axis -= 1) {
            counters[axis] += 1;
            base += step[axis];
            if (counters[axis] < shape[axis]) break;
            base -= step[axis] * shape[axis];
            counters[axis] = 0;
        }
    }
    return out;
}

/** The cells of an operand that holds only integers, as reals. */
function integersAsReals(
    array: RankArray | undefined, items: ArrayLike<RankValue> | undefined, scalar: RankValue,
): Float64Array | number | undefined {
    if (!array) return typeof scalar === 'bigint' ? Number(scalar) : undefined;
    if (!items) return undefined;
    const out = new Float64Array(items.length);
    for (let index = 0; index < items.length; index += 1) {
        const cell = items[index];
        if (typeof cell !== 'bigint') return undefined;
        out[index] = Number(cell);
    }
    return out;
}

/** `<`, `>`, `<=`, `>=` over real cells; a comparison with nan is false. */
function compareKernel(
    code: number, size: number, a: Float64Array | number, b: Float64Array | number,
    aMod: number, bMod: number,
): boolean[] {
    const out: boolean[] = new Array(size);
    for (let start = 0; start < size; start += DENSE_CHUNK) {
        checkpoint('computing array');
        const end = Math.min(size, start + DENSE_CHUNK);
        for (let i = start; i < end; i += 1) {
            const x = typeof a === 'number' ? a : a[aMod ? i % aMod : i];
            const y = typeof b === 'number' ? b : b[bMod ? i % bMod : i];
            out[i] = code === 5 ? x < y : code === 6 ? x > y : code === 7 ? x <= y : x >= y;
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
export const REAL_CODES: Readonly<Record<string, number>> = {
    '+': 0, '-': 1, '*': 2, '/': 3, '**': 4, less: 5, greater: 6, atmost: 7, atleast: 8,
};
/** Codes above this compare their operands and give booleans. */
const LAST_ARITHMETIC_CODE = 4;

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
const numericKinds = (kinds: readonly string[] | undefined): boolean => kinds !== undefined
    && (kinds.every(kind => kind === 'integer') || kinds.every(kind => kind === 'real' || kind === 'numeric-limit'));

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
