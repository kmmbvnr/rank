import { arrayRevision, ownedArray, readArrayItem, readArrayShape } from './array-storage.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

/**
 * A boolean array made by testing an array (`A even`, `A greater 3`) remembers
 * the array it tested, so a numeric operation can read the cells it selects:
 * `A even sum`. The link holds only while neither array has been written since.
 */
const masks = new WeakMap<RankArray, { source: RankArray; revision: number; maskRevision: number }>();

export function markArrayMask(mask: RankValue, source: RankValue): RankValue {
    if (!isRankArray(mask) || !isRankArray(source)) return mask;
    const shape = readArrayShape(source);
    const maskShape = readArrayShape(mask);
    if (shape.length !== maskShape.length || shape.some((size, axis) => size !== maskShape[axis])) return mask;
    const revision = arrayRevision(source);
    const maskRevision = arrayRevision(mask);
    if (revision === undefined || maskRevision === undefined) return mask;
    masks.set(mask, { source, revision, maskRevision });
    return mask;
}

/** The array a still-valid mask was made from. */
export function arrayMaskSource(mask: RankValue): RankArray | undefined {
    if (!isRankArray(mask)) return undefined;
    const link = masks.get(mask);
    if (!link || arrayRevision(link.source) !== link.revision
        || arrayRevision(mask) !== link.maskRevision) return undefined;
    return link.source;
}

/** The source cells a mask selects, in row-major order, or undefined for any other value. */
export function arrayMaskSelection(mask: RankValue): RankArray | undefined {
    const source = arrayMaskSource(mask);
    if (!source) return undefined;
    const size = readArrayShape(source).reduce((total, length) => total * length, 1);
    const items: RankValue[] = [];
    for (let index = 0; index < size; index += 1) {
        if (readArrayItem(mask as RankArray, index) === true) items.push(readArrayItem(source, index));
    }
    return ownedArray(items, [items.length]);
}
