import { MissingValueError, RankError } from '../errors.js';
import { prepareIntegerView } from '../integer-view.js';
import { arrayRevision } from '../array-revision.js';
import { indexGet, indexKey } from '../index-storage.js';
import { RankDeque } from '../containers.js';
import { atArray } from '../selectors.js';
import type { RankArray, RankIndex, RankValue } from '../value.js';

/** Entry proofs guarantee a dense array's full scalar address, an integer
 * index key or a queue position. Bounds/missing checks remain observable;
 * generic selector dispatch and tensor-shape planning are unnecessary here. */
export function scalarSelection(source: RankArray | RankIndex | RankDeque, indices: readonly bigint[]): RankValue {
    if (source instanceof RankDeque) {
        const position = indices[0];
        if (position < 0n) throw new MissingValueError('queue index out of bounds');
        const value = source.at(Number(position));
        if (value === undefined) throw new MissingValueError(`queue index out of bounds: ${position}`);
        return value;
    }
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

/** Read a captured integer array by its full scalar address. A binding
 * replaced during the call (a COW copy) is proved again before reading.
 * `current` lets a later call reuse the proof of an unchanged binding. */
export function capturedIntegerReader(resolve: () => RankValue | undefined, rank: number):
    { read(indices: bigint[]): bigint; current(): boolean } | undefined {
    const prove = (value: RankValue | undefined) => {
        const view = value === undefined ? undefined : prepareIntegerView(value, true);
        return view?.shape.length === rank ? view : undefined;
    };
    let source = resolve(), view = prove(source);
    let revision = view && arrayRevision(source as RankArray);
    if (!view) return undefined;
    return {
        current: () => {
            const value = resolve();
            return value === source && view !== undefined && arrayRevision(value as RankArray) === revision;
        },
        read: indices => {
            const current = resolve();
            if (current !== source || !view) {
                source = current;
                view = prove(current);
                if (!view) throw new RankError('captured array no longer holds integer cells');
                revision = arrayRevision(current as RankArray);
            }
            let offset = 0;
            for (let axis = 0; axis < rank; axis++) {
                const index = indices[axis], size = view.shape[axis];
                // Out-of-range addresses keep the ordinary selection errors.
                if (index < 0n || index >= size) return scalarSelection(current as RankArray, indices) as bigint;
                offset = offset * size + Number(index);
            }
            return view.read(offset);
        },
    };
}
