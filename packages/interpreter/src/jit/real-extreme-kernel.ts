import { float64Cells, typedArray, typedElementKind } from '../array-storage.js';
import { checkpoint, inspectionEnabled, privateLoopPolling } from '../interrupt.js';
import { arrayStrides, broadcastShape } from './tensor-layout.js';
import { isRankArray, type RankArray, type RankValue } from '../value.js';

const DENSE_REAL_MIN = 64;

/** Elementwise `min` or `max` of stored real arrays (or a real scalar) in one
 * typed loop, with the scalar comparison `a < b ? a : b` / `a > b ? a : b`
 * for every cell. Anything else declines. */
export function mapStoredRealExtreme(left: RankValue, right: RankValue, name: string): RankArray | undefined {
    if ((name !== 'min' && name !== 'max') || inspectionEnabled() || !privateLoopPolling()) return undefined;
    const operand = (value: RankValue): Float64Array | number | undefined => {
        if (typeof value === 'number') return value;
        return isRankArray(value) && typedElementKind(value) === 'real' && !value.columnNames ? float64Cells(value) : undefined;
    };
    const a = operand(left), b = operand(right);
    if (a === undefined || b === undefined || (typeof a === 'number' && typeof b === 'number')) return undefined;
    const aShape = isRankArray(left) ? left.shape : [], bShape = isRankArray(right) ? right.shape : [];
    const shape = broadcastShape(aShape, bShape);
    const size = shape.reduce((n, d) => n * d, 1);
    if (size < DENSE_REAL_MIN) return undefined;
    const out = new Float64Array(size);
    const min = name === 'min';
    if (typeof b === 'number' || typeof a === 'number') {
        const cells = (typeof a === 'number' ? b : a) as Float64Array, s = (typeof a === 'number' ? a : b) as number;
        const scalarLeft = typeof a === 'number';
        checkpoint('computing array', size);
        // The scalar keeps its operand position: a < b ? a : b is not symmetric on NaN and -0.
        if (min) { if (scalarLeft) for (let i = 0; i < size; i++) { const x = cells[i]; out[i] = s < x ? s : x; } else for (let i = 0; i < size; i++) { const x = cells[i]; out[i] = x < s ? x : s; } }
        else if (scalarLeft) for (let i = 0; i < size; i++) { const x = cells[i]; out[i] = s > x ? s : x; } else for (let i = 0; i < size; i++) { const x = cells[i]; out[i] = x > s ? x : s; }
        return typedArray(out, [...shape]);
    }
    // Broadcast strides: 0 where an operand has length 1 (or is missing).
    const strides = (own: readonly number[]) => {
        const own_ = arrayStrides(own);
        return shape.map((_, axis) => {
            const k = axis - (shape.length - own.length);
            return k < 0 || own[k] === 1 ? 0 : own_[k];
        });
    };
    const sa = strides(aShape), sb = strides(bShape);
    const last = shape.length - 1, n = shape[last], ia = sa[last], ib = sb[last];
    const index = new Array<number>(shape.length).fill(0);
    let oa = 0, ob = 0, at = 0;
    while (at < size) {
        checkpoint('computing array', n);
        if (min) for (let i = 0, p = oa, q = ob; i < n; i++, p += ia, q += ib) { const x = a[p], y = b[q]; out[at + i] = x < y ? x : y; }
        else for (let i = 0, p = oa, q = ob; i < n; i++, p += ia, q += ib) { const x = a[p], y = b[q]; out[at + i] = x > y ? x : y; }
        at += n;
        let axis = last - 1;
        for (; axis >= 0; axis--) {
            index[axis]++; oa += sa[axis]; ob += sb[axis];
            if (index[axis] < shape[axis]) break;
            oa -= sa[axis] * shape[axis]; ob -= sb[axis] * shape[axis]; index[axis] = 0;
        }
        if (axis < 0) break;
    }
    return typedArray(out, [...shape]);
}
