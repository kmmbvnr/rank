import { arrayRevision, denseScalarItems, materializedArrayItems, storedScalarKinds } from './array-storage.js';
import { prepareStoredScalarView } from './integer-view.js';
import { privateLoopPolling } from './interrupt.js';
import { InterruptedError } from './interrupt.js';
import { RankError } from './errors.js';
import type { RankArray, RankValue } from './value.js';

export interface TensorInput {
    items: ArrayLike<RankValue>; offset: number; shape: readonly number[]; kind?: string; validate?(): void;
}

/** Inspect tracked storage without observing cells. Binding/cell validation is
 * deferred until all layout and scalar guards have accepted the kernel. */
export function tensorInput(value: RankArray): TensorInput | undefined {
    const view = privateLoopPolling() ? prepareStoredScalarView(value, true) : undefined;
    if (!view?.linear || view.linear.stride !== 1 || !view.validateUniform
        || !view.kinds?.every(kind => kind === 'integer')) {
        if (arrayRevision(value) === undefined) return undefined;
        const items = denseScalarItems(value) ?? materializedArrayItems(value);
        if (items && items.length === value.shape.reduce((a, b) => a * b, 1)) {
            const kinds = storedScalarKinds(value);
            return { items, offset: 0, shape: value.shape, kind: kinds?.length === 1 ? kinds[0] : undefined };
        }
        return undefined;
    }
    const validate = view.validate && value.shape.every(n => n > 0)
        ? () => view.validateUniform!(view.items[view.linear!.offset]) : undefined;
    return { items: view.items, offset: view.linear.offset, shape: value.shape, kind: 'integer', validate };
}

export function validateTensorInputs(checks: readonly (() => void)[] | undefined): boolean {
    try {
        if (checks) for (const check of checks) check();
        return true;
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return false;
        throw error;
    }
}
