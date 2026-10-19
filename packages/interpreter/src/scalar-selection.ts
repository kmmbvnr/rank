import { MissingValueError } from './errors.js';
import { indexGet, indexKey } from './index-storage.js';
import { atArray } from './selectors.js';
import type { RankArray, RankIndex, RankValue } from './value.js';

/** Entry proofs guarantee a dense array's full scalar address or an integer
 * index key. Bounds/missing checks remain observable; generic selector dispatch
 * and tensor-shape planning are unnecessary for these scalar reads. */
export function scalarSelection(source: RankArray | RankIndex, indices: readonly bigint[]): RankValue {
    if (source.kind !== 'index') {
        if (source.kind === 'array' && indices.length === 1 && indices[0] < 0n) {
            throw new MissingValueError('array index out of bounds on axis 0');
        }
        return atArray(source, indices);
    }
    const value = indexGet(source, indexKey(indices));
    if (value === undefined) throw new MissingValueError('missing keyed value');
    return value;
}
