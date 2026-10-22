import { derivedArray, readArrayItem } from './array-storage.js';
import { prepareStoredScalarView } from './integer-view.js';
import { checkpoint, inspectionEnabled, privateLoopPolling } from './interrupt.js';
import type { NativeFunction, RankArray, RankValue } from './value.js';

// Only internal, pure scalar-to-scalar builtins opt in. Names and user-declared
// signatures are not evidence that ranked result assembly may be bypassed.
const operations = new WeakMap<NativeFunction, { call: NativeFunction['call']; scalar(value: RankValue): RankValue }>();

export function registerScalarBuiltin(fn: NativeFunction, operation: (value: RankValue) => RankValue): NativeFunction {
    operations.set(fn, { call: fn.call, scalar: operation });
    return fn;
}

/** A proved pure scalar body over completed storage. Each observation owns its
 * prepared reader; neither indexed reads nor full traversals retain results. */
export function scalarBuiltinArray(source: RankArray, fn: NativeFunction,
    frameAxes: readonly number[]): RankArray | undefined {
    const registered = operations.get(fn);
    if (!registered || registered.call !== fn.call || inspectionEnabled()
        || frameAxes.length !== source.shape.length
        || !frameAxes.every((axis, index) => axis === index)
        || !prepareStoredScalarView(source, true)) return undefined;
    const operation = registered.scalar;
    const shape = [...source.shape];
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    if (size === 0) return undefined;
    const read = (index: number): RankValue => {
        checkpoint('computing numbers');
        return operation(readArrayItem(source, index));
    };
    return derivedArray(shape, [source], read, true, undefined, function* () {
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
}
