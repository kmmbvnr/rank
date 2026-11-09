import { currentDiagnostics } from '../diagnostics.js';
import { prepareStoredScalarView } from '../integer-view.js';
import { integer32Cells, integer64Cells, typedArray, IntegerCells } from '../array-storage.js';
import { permutedArraySource } from '../array-permutation.js';
import { checkpoint, privateLoopPolling, demandBudgetEnabled, inspectionEnabled } from '../interrupt.js';
import { isRankArray, type RankValue } from '../value.js';

const WORD = 4294967296;
const LOW = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 0 : 1;

/** Fuse a stored integer matrix times broadcast axis weights into its sum.
 * Absolute-product bounds prove every intermediate fits signed 64 bits.
 * Word arithmetic retains coefficients above Number's exact integer range. */
export function weightedAxisSum(left: RankValue, right: RankValue, axis: number): RankValue | undefined {
    if (axis === -1 || axis === -2) axis += 2;
    if (!Number.isInteger(axis) || !privateLoopPolling() || demandBudgetEnabled() || inspectionEnabled()
        || !isRankArray(left) || !isRankArray(right) || left.shape.length !== 2 || right.shape.length !== 2
        || axis < 0 || axis > 1) return undefined;
    for (const [matrix, weights] of [[left, right], [right, left]]) {
        const inner = matrix.shape[axis], size = matrix.shape[1 - axis];
        if (weights.shape[axis] !== inner || weights.shape[1 - axis] !== 1 || size * inner < 1024) continue;
        const plan = permutedArraySource(matrix);
        const source = plan?.source ?? matrix;
        if (matrix.columnNames || source.columnNames || weights.columnNames) continue;
        const compact = integer32Cells(source), wide = integer64Cells(source);
        const coefficients = prepareStoredScalarView(weights);
        if ((!compact && !wide) || !coefficients) continue;
        const counts = compact ?? new Int32Array(wide!.buffer, wide!.byteOffset, wide!.length * 2);
        const step = compact ? 1 : 2, first = compact ? 0 : LOW;
        const length = compact?.length ?? wide!.length;
        let maximum = 0;
        for (let index = 0; index < length; index++) {
            if ((index & 4095) === 0) checkpoint('checking weighted sum bounds', Math.min(4096, length - index));
            const value = counts[index * step + first];
            if (wide && counts[index * 2 + 1 - LOW] !== (value < 0 ? -1 : 0)) { maximum = Infinity; break; }
            maximum = Math.max(maximum, Math.abs(value));
        }
        // A low-word product must itself remain an exact Number.
        if (maximum > 1048576) continue;
        const lows: number[] = [], highs: number[] = [];
        let bound = 0n;
        for (let index = 0; index < inner; index++) {
            if ((index & 4095) === 0) checkpoint('checking weighted coefficients', Math.min(4096, inner - index));
            const value = coefficients.read(index);
            if (typeof value !== 'bigint') { bound = 9223372036854775808n; break; }
            bound += (value < 0n ? -value : value) * BigInt(maximum);
            lows.push(Number(BigInt.asUintN(32, value)));
            highs.push(Number(value >> 32n));
        }
        if (bound > 9223372036854775807n) continue;
        const diagnostics = currentDiagnostics();
        if (diagnostics) { diagnostics.weightedAxisSums++; diagnostics.weightedAxisSumCells += size; }
        if (maximum === 0) return typedArray(new Int32Array(size), [size]);
        const strides = [source.shape[1], 1];
        const innerStride = strides[plan?.axes[axis] ?? axis];
        const frameStride = strides[plan?.axes[1 - axis] ?? 1 - axis];
        const safe = bound <= 9007199254740991n;
        const numbers = highs.map((high, k) => high * WORD + lows[k]);
        const output = bound <= 2147483647n ? new Int32Array(size) : new BigInt64Array(size);
        const words = new Int32Array(output.buffer);
        for (let index = 0; index < size; index++) {
            if ((index & 4095) === 0) checkpoint('computing weighted axis sum', Math.min(4096, size - index));
            let low = 0, high = 0;
            const start = index * frameStride;
            if (safe) {
                let total = 0;
                for (let k = 0; k < inner; k++) {
                    if (inner >= 4096 && (k & 4095) === 0) checkpoint('contracting weighted axis', Math.min(4096, inner - k));
                    total += numbers[k] * counts[(start + k * innerStride) * step + first];
                }
                if (output instanceof Int32Array) { output[index] = total; continue; }
                low = total | 0;
                high = Math.floor(total / WORD);
            } else for (let k = 0; k < inner; k++) {
                if (inner >= 4096 && (k & 4095) === 0) checkpoint('contracting weighted axis', Math.min(4096, inner - k));
                const count = counts[(start + k * innerStride) * step + first];
                const product = low + lows[k] * count;
                const carry = Math.floor(product / WORD);
                low = product - carry * WORD;
                high += highs[k] * count + carry;
            }
            words[2 * index + LOW] = low;
            words[2 * index + 1 - LOW] = high;
        }
        return typedArray(output, [size]);
    }
    // Completed arbitrary-precision matrices cannot use the word-bound proof.
    // Contract their products directly instead of retaining a wide cell matrix.
    if (left.shape.every((size, axis) => size === right.shape[axis])
        && left.shape[0] * left.shape[1] >= 1024
        && !left.columnNames && !right.columnNames) {
        const a = prepareStoredScalarView(left, true), b = prepareStoredScalarView(right, true);
        const trusted = (view: typeof a) => view && view.kinds?.join() === 'integer'
            && (!view.validate || view.validateUniform) && !view.source.columnNames;
        const privateBuffer = (view: NonNullable<typeof a>) => {
            const buffer = view.compact?.buffer ?? (ArrayBuffer.isView(view.items) ? view.items.buffer : undefined);
            return !buffer || typeof SharedArrayBuffer === 'undefined' || !(buffer instanceof SharedArrayBuffer);
        };
        if (trusted(a) && trusted(b) && a && b && privateBuffer(a) && privateBuffer(b)
            && (Array.isArray(a.items) && !a.compact || Array.isArray(b.items) && !b.compact)) {
            a.validateUniform?.(a.read(0));
            b.validateUniform?.(b.read(0));
            const length = left.shape[axis], size = left.shape[1 - axis];
            const innerStride = axis === 1 ? 1 : left.shape[1];
            const frameStride = axis === 1 ? left.shape[1] : 1;
            const output = new IntegerCells(size);
            for (let frame = 0; frame < size; frame++) {
                let total = 0n;
                const start = frame * frameStride;
                for (let k = 0; k < length; k++) {
                    if ((k & 4095) === 0) checkpoint('contracting exact integer axis', Math.min(4096, length - k));
                    const index = start + k * innerStride;
                    total += (a.read(index) as bigint) * (b.read(index) as bigint);
                }
                output.set(frame, total);
            }
            const diagnostics = currentDiagnostics();
            if (diagnostics) { diagnostics.weightedAxisSums++; diagnostics.weightedAxisSumCells += size; }
            return output.array([size]);
        }
    }
    return undefined;
}
