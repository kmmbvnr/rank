import { booleanCells, IntegerCells } from './array-storage.js';
import { greatestCommonDivisor } from './integer-gcd.js';
import { RankError } from './errors.js';
import { prepareIntegerView } from './integer-view.js';
import { checkpoint, inspectionEnabled, InterruptedError, privateLoopPolling } from './interrupt.js';
import { floorDivide, floorRemainder } from './numeric-division.js';
import { arrayStrides, broadcastOffset, broadcastShape, trailingCells } from './tensor-layout.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

/** Exact arithmetic over stored integers, including trusted segmented views.
 * Borrowed readers live only during this callback-free synchronous pass. */
export function mapStoredIntegers(left: RankValue, right: RankValue, name?: string): RankArray | undefined {
    const operation = name === '+' ? (a: bigint, b: bigint) => a + b
        : name === '-' ? (a: bigint, b: bigint) => a - b
        : name === '*' ? (a: bigint, b: bigint) => a * b
        : name === 'mod' ? floorRemainder : name === '//' ? floorDivide
        : name === 'min' ? (a: bigint, b: bigint) => b < a ? b : a
        : name === 'max' ? (a: bigint, b: bigint) => b > a ? b : a
        : name === 'gcd' ? greatestCommonDivisor
        : name === 'abs' ? (a: bigint) => a < 0n ? -a : a : undefined;
    if (!operation || inspectionEnabled() || !privateLoopPolling()) return undefined;
    const a = isRankArray(left) ? prepareIntegerView(left, true) : undefined;
    const b = isRankArray(right) ? prepareIntegerView(right, true) : undefined;
    if (isRankArray(left) ? !a?.regular : typeof left !== 'bigint') return undefined;
    if (isRankArray(right) ? !b?.regular : typeof right !== 'bigint') return undefined;
    if (!a && !b) return undefined;
    const shape = broadcastShape(a?.shape ?? [], b?.shape ?? []);
    const ai = broadcastIndex(a?.shape, shape), bi = broadcastIndex(b?.shape, shape);
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    const cells = new IntegerCells(size);
    try {
        for (let start = 0; start < size; start += 4096) {
            const end = Math.min(size, start + 4096);
            checkpoint('computing integer array', end - start);
            for (let i = start; i < end; i++) {
                const x = a ? a.read(ai(i)) : left as bigint;
                const y = b ? b.read(bi(i)) : right as bigint;
                if ((name === 'mod' || name === '//') && y === 0n) return undefined;
                cells.set(i, operation(x, y));
            }
        }
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return cells.array(shape);
}

/** Select stored integer branches without boxing the output or mask cells.
 * Unread masks/branches and non-booleans retain the ordinary demand path. */
export function chooseStoredIntegers(
    condition: RankValue, whenTrue: RankValue, whenFalse: RankValue, shape: readonly number[],
): RankArray | undefined {
    if (inspectionEnabled() || !privateLoopPolling()) return undefined;
    const mask = isRankArray(condition) ? booleanCells(condition) : undefined;
    if (isRankArray(condition) ? !mask : typeof condition !== 'boolean') return undefined;
    const yes = isRankArray(whenTrue) ? prepareIntegerView(whenTrue, true) : undefined;
    const no = isRankArray(whenFalse) ? prepareIntegerView(whenFalse, true) : undefined;
    if (isRankArray(whenTrue) ? !yes?.regular : typeof whenTrue !== 'bigint') return undefined;
    if (isRankArray(whenFalse) ? !no?.regular : typeof whenFalse !== 'bigint') return undefined;
    const mi = broadcastIndex(isRankArray(condition) ? condition.shape : undefined, shape);
    const yi = broadcastIndex(yes?.shape, shape), ni = broadcastIndex(no?.shape, shape);
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    const cells = new IntegerCells(size);
    try {
        for (let start = 0; start < size; start += 4096) {
            const end = Math.min(size, start + 4096);
            checkpoint('selecting integer array', end - start);
            for (let i = start; i < end; i++) {
                const selected = mask ? mask.read(mi(i)) : condition;
                cells.set(i, selected ? (yes ? yes.read(yi(i)) : whenTrue as bigint)
                    : (no ? no.read(ni(i)) : whenFalse as bigint));
            }
        }
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return cells.array(shape);
}

function broadcastIndex(operand: readonly number[] | undefined, shape: readonly number[]): (index: number) => number {
    if (!operand) return (_: number) => 0;
    const mod = trailingCells(operand, shape);
    if (mod === 0) return (i: number) => i;
    if (mod > 0) return (i: number) => i % mod;
    const strides = arrayStrides(operand);
    return (i: number) => broadcastOffset(i, shape, operand, strides);
}
