import { checkpoint, demandBudgetEnabled, inspectionEnabled, privateLoopPolling, InterruptedError } from '../interrupt.js';
import { RankError } from '../errors.js';
import { floorDivide } from './numeric-division.js';
import { prepareStoredScalarView } from './integer-view.js';
import { IntegerCells } from './owned-array.js';
import type { RankArray } from './value.js';

/** Exact word-sized integer // Int32 arrays. The ordinary compact scalar
 * kernel handles magnitudes below 2^52. Larger quotients use a conservative
 * floating error bound; uncertain cells retain exact BigInt division. */
export function wideScalarQuotients(numerator: bigint, value: RankArray): RankArray | undefined {
    if (numerator > -4503599627370496n && numerator < 4503599627370496n
        || numerator < -9223372036854775808n || numerator > 9223372036854775807n
        || !privateLoopPolling() || demandBudgetEnabled() || inspectionEnabled()
        || value.columnNames || value.tableScopes || value.sortKeys
        || Object.getOwnPropertyDescriptor(value, 'itemAt')?.get
        || Object.getOwnPropertyDescriptor(value, 'shape')?.get) return undefined;
    const view = prepareStoredScalarView(value, true);
    if (!view?.compact || !view.linear || view.validate && !view.validateUniform
        || view.source.columnNames || view.source.tableScopes || view.source.sortKeys
        || typeof SharedArrayBuffer !== 'undefined' && view.compact.buffer instanceof SharedArrayBuffer) return undefined;
    const shape = value.shape, size = shape.reduce((n, d) => n * d, 1);
    const { offset, stride } = view.linear, input = view.compact;
    try { if (size) view.validateUniform?.(BigInt(input[offset])); }
    catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    const numeric = Number(numerator), delta = BigInt(numeric) - numerator;
    const rounding = Number(delta < 0n ? -delta : delta);
    const output = new IntegerCells(size);
    for (let start = 0; start < size; start += 4096) {
        const end = Math.min(size, start + 4096);
        checkpoint('dividing wide integer array', end - start);
        for (let i = start; i < end; i++) {
            const divisor = input[offset + i * stride];
            if (divisor === 0) return undefined;
            const ratio = numeric / divisor, quotient = Math.floor(ratio);
            const fraction = ratio - quotient;
            // Operand conversion contributes rounding/|d|. Four epsilons
            // cover division rounding and rounding of this bound itself.
            const error = rounding / Math.abs(divisor) + 4 * Number.EPSILON * Math.abs(ratio);
            if (Number.isSafeInteger(quotient) && fraction > error && fraction < 1 - error) {
                output.setNumber(i, quotient);
            } else output.set(i, floorDivide(numerator, BigInt(divisor)));
        }
    }
    return output.array(shape);
}
