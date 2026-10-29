import { bitmapWords, bitmapTailMask } from './bitmap.js';
import { MISSING, type RankValue } from './value.js';

/** Number of 32-bit words holding a bitmap for this many cells. */
export const validityWords = bitmapWords;

/** A bitmap with the first `size` cells present. */
export function allPresent(size: number): Uint32Array {
    const bits = new Uint32Array(validityWords(size)).fill(0xFFFFFFFF);
    if (bits.length) bits[bits.length - 1] &= bitmapTailMask(size);
    return bits;
}

export function isPresentAt(validity: Uint32Array, index: number): boolean {
    return (validity[index >>> 5] >>> (index & 31) & 1) === 1;
}

/** Whether every one of the first `size` cells has a value. */
export function allValid(validity: Uint32Array, size: number): boolean {
    const whole = size >>> 5;
    for (let word = 0; word < whole; word += 1) if (validity[word] !== 0xFFFFFFFF) return false;
    if (!(size & 31)) return true;
    const tail = ((1 << (size & 31)) - 1) >>> 0;
    return ((validity[whole] & tail) >>> 0) === tail;
}

/**
 * 'scalar' for cells that are all numbers (nothing to do), the buffer and
 * bitmap when the cells are numbers of one kind and `.NA`, otherwise undefined.
 * Stops at the first cell of any other kind, so ordinary arrays cost a short scan.
 */
export function scanForMissing(items: readonly RankValue[]): 'scalar' | { values: Float64Array | BigInt64Array; validity: Uint32Array } | undefined {
    let kind = 0;
    let missing = false;
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item === MISSING) { missing = true; continue; }
        // BigInt64Array assignment truncates; wide integers must keep plain storage.
        if (typeof item === 'bigint' && BigInt.asIntN(64, item) !== item) return undefined;
        const type = typeof item === 'number' ? 1 : typeof item === 'bigint' ? 2 : 0;
        if (type === 0 || (kind !== 0 && type !== kind)) return undefined;
        kind = type;
    }
    if (!missing) return kind === 0 ? undefined : 'scalar';
    const validity = new Uint32Array(validityWords(items.length));
    const values = kind === 2 ? new BigInt64Array(items.length) : new Float64Array(items.length);
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item === MISSING) continue;
        (values as unknown as RankValue[])[index] = item;
        validity[index >>> 5] |= 1 << (index & 31);
    }
    return { values, validity };
}
