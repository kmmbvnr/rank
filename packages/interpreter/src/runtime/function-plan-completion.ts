import { hasStoredInt32View, modularProduct } from './modular-fold.js';
import { prepareStoredScalarView } from './integer-view.js';
import { materializeValue } from '../materialize.js';
import { checkpoint } from '../interrupt.js';
import { isRankArray, type RankValue } from './value.js';

/** Complete one arithmetic stage through native storage kernels. Named inputs
 * have already completed; opaque readers and deferred expressions stay in the
 * generated cell loop. Materialization preserves the ordinary `=` barrier. */
export function completeStoredBinary(operation: string, left: RankValue, right: RankValue,
    binary: (name: string, left: RankValue, right: RankValue) => RankValue): RankValue | undefined {
    if (!['+', '-', '*', '//', 'mod'].includes(operation)) return undefined;
    let arrays = 0;
    for (const value of [left, right]) {
        if (isRankArray(value)) {
            if (!hasStoredInt32View(value)) return undefined;
            arrays++;
        } else if (typeof value !== 'bigint') return undefined;
    }
    if (!arrays) return undefined;
    return materializeValue(binary(operation, left, right));
}

/** Exact blocked sum without boxing every Int32 input cell. */
export function sumStoredInteger(value: RankValue): bigint | undefined {
    if (!isRankArray(value) || !hasStoredInt32View(value) || value.shape.length !== 1) return undefined;
    const view = prepareStoredScalarView(value, true)!;
    const { offset, stride } = view.linear!, cells = view.compact!;
    let total = 0n;
    for (let start = 0; start < value.shape[0]; start += 4096) {
        const end = Math.min(value.shape[0], start + 4096);
        checkpoint('summing stored function plan', end - start);
        let sum = 0;
        for (let i = start; i < end; i++) sum += cells[offset + i * stride];
        total += BigInt(sum);
    }
    return total;
}

/** Preserve compact residues when completing a named multiply/mod stage. */
export function completeStoredModularProduct(left: RankValue, right: RankValue, modulus: RankValue): RankValue | undefined {
    if (!isRankArray(left) || !isRankArray(right) || typeof modulus !== 'bigint'
        || !hasStoredInt32View(left) || !hasStoredInt32View(right)) return undefined;
    return modularProduct(left, right, modulus);
}
