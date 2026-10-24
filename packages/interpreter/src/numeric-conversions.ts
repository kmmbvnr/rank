import { RankError } from './errors.js';
import { booleanCells, IntegerCells, typedArray } from './array-storage.js';
import { prepareStoredScalarView } from './integer-view.js';
import { checkpoint, privateLoopPolling } from './interrupt.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

/** Convert completed scalar storage directly into compact exact integers.
 * Host readers and observable polling retain the ordinary mapping path. */
export function integerArray(value: RankValue): RankArray | undefined {
    if (!privateLoopPolling() || !isRankArray(value)) return undefined;
    const bits = booleanCells(value);
    if (bits) {
        const cells = new Int32Array(bits.length);
        for (let start = 0; start < cells.length; start += 32) {
            if ((start & 4095) === 0) checkpoint('converting boolean array', Math.min(4096, cells.length - start));
            const word = bits.words[start >>> 5];
            const end = Math.min(start + 32, cells.length);
            for (let i = start; i < end; i++) cells[i] = word >>> (i - start) & 1;
        }
        return typedArray(cells, value.shape);
    }
    const view = prepareStoredScalarView(value, true);
    if (!view) return undefined;
    const size = value.shape.reduce((total, length) => total * length, 1);
    const cells = new IntegerCells(size);
    for (let i = 0; i < size; i++) {
        if ((i & 4095) === 0) checkpoint('converting integer array', Math.min(4096, size - i));
        cells.set(i, integerValue(view.read(i)));
    }
    return cells.array(value.shape);
}

export function integerValue(value: RankValue): bigint {
    if (typeof value === 'boolean') return value ? 1n : 0n;
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new RankError('integer expects a finite real', 'InvalidNumber', value);
        }
        return BigInt(Math.trunc(value));
    }
    if (typeof value !== 'string') {
        throw new RankError('integer expects an integer, real, boolean or text', 'TypeError');
    }
    if (!/^[+-]?[0-9]+$/.test(value)) {
        throw new RankError(`invalid integer text: ${value}`, 'InvalidNumber', value);
    }
    return BigInt(value);
}

export function realValue(value: RankValue): number {
    if (typeof value === 'number') return value;
    if (typeof value !== 'bigint' && typeof value !== 'string') {
        throw new RankError('real expects an integer, real or text', 'TypeError');
    }
    if (typeof value === 'string' && !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(value)) {
        throw new RankError(`invalid real text: ${value}`, 'InvalidNumber', value);
    }
    const result = Number(value);
    if (!Number.isFinite(result)) {
        throw new RankError('real conversion exceeds the finite range', 'InvalidNumber', value);
    }
    return result;
}
