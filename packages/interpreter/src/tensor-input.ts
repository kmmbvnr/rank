import { arrayRevision, materializedArrayItems, storedScalarKinds } from './array-storage.js';
import { prepareStoredScalarView } from './integer-view.js';
import { privateLoopPolling } from './interrupt.js';
import { InterruptedError } from './interrupt.js';
import { RankError } from './errors.js';
import type { RankArray, RankValue } from './value.js';

export interface TensorInput { items: RankValue[]; offset: number; shape: readonly number[]; kind?: string }

/** Inspect tracked storage only. A contiguous homogeneous view validates its
 * scalar domain once before the synchronous callback-free kernel borrows it. */
export function tensorInput(value: RankArray): TensorInput | undefined {
    const view = privateLoopPolling() ? prepareStoredScalarView(value, true) : undefined;
    if (!view?.linear || view.linear.stride !== 1 || !view.validateUniform
        || !Array.isArray(view.items) || !view.kinds?.every(kind => kind === 'integer')) {
        if (arrayRevision(value) === undefined) return undefined;
        const items = materializedArrayItems(value);
        if (Array.isArray(items) && items.length === value.shape.reduce((a, b) => a * b, 1)) {
            const kinds = storedScalarKinds(value);
            return { items, offset: 0, shape: value.shape, kind: kinds?.length === 1 ? kinds[0] : undefined };
        }
        return undefined;
    }
    try {
        if (value.shape.every(n => n > 0)) view.validateUniform(view.items[view.linear.offset]);
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return { items: view.items, offset: view.linear.offset, shape: value.shape, kind: 'integer' };
}
