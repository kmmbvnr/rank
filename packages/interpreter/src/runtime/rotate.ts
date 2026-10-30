import { checkpoint } from '../interrupt.js';
import { RankError } from '../errors.js';
import { denseScalarItems, float64Cells, integer32Cells, integer64Cells, ownedArray, readArrayItem, realCells, typedArray, typedElementKind } from './array-storage.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

/**
 * `Values rotate Count`: moves rows of the leading axis cyclically, positive
 * counts to the right as in `np.roll`. Packed storage is copied as two typed
 * blocks into the new buffer.
 */
export function rotateArray(value: RankValue, countValue: RankValue, axis = 0): RankArray {
    if (!isRankArray(value) || !value.shape.length) throw new RankError('rotate expects an array', 'TypeError');
    if (typeof countValue !== 'bigint') throw new RankError('rotate count must be an integer', 'TypeError');
    const rank = value.shape.length;
    if (axis < -rank || axis >= rank) throw new RankError(`rotate axis out of bounds: ${axis}`);
    axis = (axis + rank) % rank;
    const rows = value.shape[axis];
    const inner = value.shape.slice(axis + 1).reduce((product, dimension) => product * dimension, 1);
    const width = rows * inner;
    const total = value.shape.reduce((product, dimension) => product * dimension, 1);
    const turn = rows === 0 ? 0 : Number(((countValue % BigInt(rows)) + BigInt(rows)) % BigInt(rows)) * inner;
    const packed = integer32Cells(value) ?? integer64Cells(value) ?? float64Cells(value);
    if (packed) {
        const out = new (packed.constructor as { new (length: number): Int32Array })(total);
        const source = packed as Int32Array;
        for (let base = 0; base < total; base += width) {
            if (width > 0) checkpoint('rotating array');
            out.set(source.subarray(base + width - turn, base + width), base);
            out.set(source.subarray(base, base + width - turn), base + turn);
        }
        return typedArray(out, value.shape);
    }
    const kind = typedElementKind(value);
    const reals = realCells(value) !== undefined;
    const out: RankValue[] | Float64Array | BigInt64Array = reals ? new Float64Array(total)
        : kind === 'integer' ? new BigInt64Array(total) : new Array(total);
    const cells = out as unknown as RankValue[];
    for (let at = 0; at < total; at += 1) {
        if ((at & 0xfff) === 0) checkpoint('rotating array');
        const base = at - at % width;
        cells[base + (at - base + turn) % width] = readArrayItem(value, at);
    }
    if (!Array.isArray(out)) return typedArray(out, value.shape);
    return ownedArray(out, value.shape, denseScalarItems(value) !== undefined);
}
