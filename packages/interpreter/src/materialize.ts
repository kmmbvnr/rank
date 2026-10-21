import { denseScalarItems, materializeCells, ownedArray, readArrayItem } from './array-storage.js';
import { checkpoint } from './interrupt.js';
import { inheritSemanticArrayType } from './semantic-array-type.js';
import { materializeSequence } from './sequence.js';
import { isRankArray, isRankSequence, type RankValue } from './value.js';

/** Complete a binding's final array/sequence result without forcing pipeline
 * intermediates. Already stored scalar arrays keep their packed storage and
 * identity; a lazy array becomes owned cells with exactly the same shape. */
export function materializeValue(value: RankValue): RankValue {
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
