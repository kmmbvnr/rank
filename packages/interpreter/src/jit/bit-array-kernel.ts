import { BooleanCells } from '../boolean-cells.js';
import { createOwned } from '../owned-array.js';
import { prepareIntegerRange, prepareIntegerView } from '../integer-view.js';
import { checkpoint, demandBudgetEnabled, inspectionEnabled, InterruptedError, privateLoopPolling } from '../interrupt.js';
import { RankError } from '../errors.js';
import { arrayStrides, broadcastOffset, broadcastShape } from './tensor-layout.js';
import { isRankArray, type RankArray, type RankValue } from '../value.js';

/** Only native integer storage/ranges may run ahead of scalar demand. Failed
 * domains discard private bits and leave errors to the ordinary lazy mapper. */
export function mapIntegerBits(left: RankValue, right: RankValue): RankArray | undefined {
    if (inspectionEnabled() || demandBudgetEnabled() || !privateLoopPolling()) return undefined;
    const reader = (value: RankValue) => {
        if (!isRankArray(value)) return typeof value === 'bigint' ? (_: number) => value : undefined;
        const range = prepareIntegerRange(value);
        if (range) return (index: number) => range.start + BigInt(index) * range.step;
        return prepareIntegerView(value, true)?.read;
    };
    const a = reader(left), rawPosition = reader(right);
    const range = isRankArray(right) ? prepareIntegerRange(right) : undefined;
    const span = range && (range.count - 1n) * range.step;
    const last = range && range.start + span!;
    const safe = (value: bigint) => Number.isSafeInteger(Number(value));
    const first = range && Number(range.start), step = range && Number(range.step);
    const b = range && safe(range.start) && safe(range.step) && span !== undefined && safe(span)
        && last !== undefined && safe(last)
        ? (index: number) => first! + index * step! : rawPosition;
    if (!a || !b) return undefined;
    const shape = broadcastShape(isRankArray(left) ? left.shape : [], isRankArray(right) ? right.shape : []);
    const size = shape.reduce((n, axis) => n * axis, 1);
    if (size === 0) return undefined;
    const offset = (value: RankValue) => {
        if (!isRankArray(value)) return (_: number) => 0;
        if (value.shape.length === shape.length && value.shape.every((n, i) => n === shape[i])) return (i: number) => i;
        const strides = arrayStrides(value.shape);
        return (i: number) => broadcastOffset(i, shape, value.shape, strides);
    };
    const ai = offset(left), bi = offset(right);
    const cells = new BooleanCells(size);
    // One bounded decoder, shared by a scalar or adjacent repeated values.
    // Hex conversion is linear in bit width; each lookup then reads one nibble
    // instead of allocating a position-sized BigInt mask for every cell.
    let previous: bigint | undefined, digits = '', width = 0, small = 0;
    try {
        for (let start = 0; start < size; start += 4096) {
            const end = Math.min(size, start + 4096);
            checkpoint('reading integer bits', end - start);
            for (let i = start; i < end; i++) {
                const value = a(ai(i)), position = b(bi(i));
                if (value < 0n || position < 0) return undefined;
                // Varying wide values should not pay to decode all their bits
                // for one lookup. Keep their exact scalar arithmetic.
                if (isRankArray(left) && value > 0xffffffffn) {
                    if ((value & (1n << BigInt(position))) !== 0n) cells.words[i >>> 5] |= 1 << (i & 31);
                    continue;
                }
                if (value !== previous) {
                    small = value <= 0xffffffffn ? Number(value) : -1;
                    digits = small < 0 ? value.toString(16) : '';
                    width = small < 0 ? digits.length * 4 : 32;
                    previous = value;
                }
                if (position >= width) continue;
                const at = Number(position);
                let bit: number;
                if (small >= 0) bit = small >>> at & 1;
                else {
                    const code = digits.charCodeAt(digits.length - 1 - Math.floor(at / 4));
                    const nibble = code >= 97 ? code - 87 : code - 48;
                    bit = nibble >>> (at % 4) & 1;
                }
                cells.words[i >>> 5] |= bit << (i & 31);
            }
        }
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return createOwned(cells, shape, true);
}
