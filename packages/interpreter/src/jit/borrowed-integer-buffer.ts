import { derivedArray } from '../array-storage.js';
import { setSemanticArrayType } from '../semantic-array-type.js';
import { currentDiagnostics } from '../diagnostics.js';
import { numberOverflow } from './number-arithmetic.js';

/** A call-scoped read view, never a publication or an owning binding.
 * Admission must prove no writes, external retention or reference return.
 * Do not cache the view: the caller can change its buffer after the call. */
export function borrowIntegerBuffer(cells: ArrayLike<number | bigint>) {
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.numberFunctionArrayBorrows++;
    return setSemanticArrayType(derivedArray([cells.length], [], index => {
        const value = cells[index];
        if (typeof value === 'bigint') return value;
        if (!Number.isSafeInteger(value)) throw numberOverflow;
        return BigInt(value);
    }, true), { key: '["integer"]', scalar: 'integer' });
}
