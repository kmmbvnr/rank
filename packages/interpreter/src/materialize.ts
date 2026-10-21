import type { CallParameter } from '@arrrank/language';
import { denseScalarItems, materializeCells, ownedArray, readArrayItem } from './array-storage.js';
import { demandValue } from './plan.js';
import { checkpoint } from './interrupt.js';
import { inheritSemanticArrayType } from './semantic-array-type.js';
import { materializeSequence } from './sequence.js';
import { isRankArray, isRankSequence, type RankValue } from './value.js';

/** Complete a binding's final array/sequence result without forcing pipeline
 * intermediates. Already stored scalar arrays keep their packed storage and
 * identity; a lazy array becomes owned cells with exactly the same shape. */
export function materializeValue(value: RankValue): RankValue {
    value = demandValue(value);
    if (isRankSequence(value)) return materializeSequence(value);
    if (!isRankArray(value) || value.kind === 'bytes' || denseScalarItems(value) !== undefined) return value;
    const size = value.shape.reduce((product, dimension) => product * dimension, 1);
    const cells = materializeCells(size, index => {
        checkpoint('materializing binding');
        return readArrayItem(value, index);
    });
    const result = ownedArray(cells, value.shape, false, value.columnNames);
    Object.assign(result, { tableScopes: value.tableScopes, sortKeys: value.sortKeys });
    return inheritSemanticArrayType(value, result);
}

/** Parameter modes apply before specialization, memo lookup or body execution.
 * Keep the original argument vector when no value changes: ownership transfers
 * and diagnostic summaries use its identity. */
export function materializeArguments(parameters: readonly CallParameter[], arguments_: RankValue[]): RankValue[] {
    let bound = arguments_;
    for (const parameter of parameters) {
        const value = arguments_[parameter.index];
        if (parameter.deferred || value === undefined) continue;
        const computed = materializeValue(value);
        if (computed === value) continue;
        if (bound === arguments_) bound = [...arguments_];
        bound[parameter.index] = computed;
    }
    return bound;
}
