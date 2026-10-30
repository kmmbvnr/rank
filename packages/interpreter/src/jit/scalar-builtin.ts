import { constructingTensorPlan, registerTensorScalarMap } from './tensor-map.js';
import { arrayValues, derivedArray, readArrayItem } from '../array-storage.js';
import { prepareStoredScalarView } from '../integer-view.js';
import { registerArrayCopy } from '../array-copy.js';
import { checkpoint, inspectionEnabled, privateLoopPolling } from '../interrupt.js';
import { isRankArray, type NativeFunction, type RankArray, type RankValue } from '../value.js';

// Only internal, pure scalar-to-scalar builtins opt in. Names and user-declared
// signatures are not evidence that ranked result assembly may be bypassed.
const operations = new WeakMap<NativeFunction, {
    call: NativeFunction['call']; scalar(value: RankValue): RankValue;
    batch?: (source: RankArray) => RankArray | undefined;
    result?: 'real' | 'integer' | 'numeric';
    intrinsic?: 'abs';
}>();

const completions = new WeakMap<RankArray, { reader: RankArray['itemAt']; complete(): RankArray | undefined }>();

/** The stored result of a scalar builtin over completed storage, or the array
 * itself. Dense arithmetic takes operands whole, like stored ones; the batch
 * pass declines when any cell would fail, so errors keep their lazy reads. */
export function completeScalarBuiltin(value: RankValue): RankValue {
    const plan = isRankArray(value) ? completions.get(value) : undefined;
    return plan && plan.reader === (value as RankArray).itemAt ? plan.complete() ?? value : value;
}

export function registerScalarBuiltin(fn: NativeFunction, operation: (value: RankValue) => RankValue,
    batch?: (source: RankArray) => RankArray | undefined, result?: 'real' | 'integer' | 'numeric', intrinsic?: 'abs'): NativeFunction {
    operations.set(fn, { call: fn.call, scalar: operation, batch, result, intrinsic });
    return fn;
}

/** A proved pure scalar body over storage or a native numeric recipe. Each
 * observation owns its readers; indexed reads and traversals retain no results. */
export function scalarBuiltinArray(source: RankArray, fn: NativeFunction,
    frameAxes: readonly number[]): RankArray | undefined {
    const registered = operations.get(fn);
    if (!registered || registered.call !== fn.call || inspectionEnabled()
        || frameAxes.length !== source.shape.length
        || !frameAxes.every((axis, index) => axis === index)
        || !prepareStoredScalarView(source, true) && !(registered.result && constructingTensorPlan(source))) return undefined;
    const operation = registered.scalar;
    const shape = [...source.shape];
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    if (size === 0) return undefined;
    const read = (index: number): RankValue => {
        checkpoint('computing numbers');
        return operation(readArrayItem(source, index));
    };
    const result = derivedArray(shape, [source], read, true, undefined, function* () {
        // Batch work belongs to this observation, just like scalar reads.
        const batch = registered.batch?.(source);
        if (batch) { yield* arrayValues(batch); return; }
        // Opaque host polling may replace storage between cells. Only a pass
        // without host callbacks can keep a prepared completed-storage reader.
        const stored = privateLoopPolling() ? prepareStoredScalarView(source, true) : undefined;
        for (let index = 0; index < size; index++) {
            if (stored) {
                checkpoint('computing numbers');
                yield operation(stored.read(index));
            } else yield read(index);
        }
    });
    if (registered.batch) {
        registerArrayCopy(result, () => registered.batch!(source));
        completions.set(result, { reader: result.itemAt, complete: () => registered.batch!(source) });
    }
    return registered.result ? registerTensorScalarMap(result, source, operation, registered.result,
        () => registered.call === fn.call, registered.intrinsic) : result;
}
