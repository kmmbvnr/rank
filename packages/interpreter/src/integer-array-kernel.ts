import { IntegerCells } from './array-storage.js';
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
        : name === 'gcd' ? greatestCommonDivisor
        : name === 'abs' ? (a: bigint) => a < 0n ? -a : a : undefined;
    if (!operation || inspectionEnabled() || !privateLoopPolling()) return undefined;
    const a = isRankArray(left) ? prepareIntegerView(left, true) : undefined;
    const b = isRankArray(right) ? prepareIntegerView(right, true) : undefined;
    if (isRankArray(left) ? !a?.regular : typeof left !== 'bigint') return undefined;
    if (isRankArray(right) ? !b?.regular : typeof right !== 'bigint') return undefined;
    if (!a && !b) return undefined;
    const shape = broadcastShape(a?.shape ?? [], b?.shape ?? []);
    const offset = (operand: typeof a) => {
        if (!operand) return (_: number) => 0;
        const mod = trailingCells(operand.shape, shape);
        if (mod === 0) return (i: number) => i;
        if (mod > 0) return (i: number) => i % mod;
        const strides = arrayStrides(operand.shape);
        return (i: number) => broadcastOffset(i, shape, operand.shape, strides);
    };
    const ai = offset(a), bi = offset(b);
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
