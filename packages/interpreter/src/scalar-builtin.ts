import { arrayRevision, materializeCells, readArrayItem, registerArrayDependencies } from './array-storage.js';
import { prepareStoredScalarView } from './integer-view.js';
import { checkpoint, inspectionEnabled } from './interrupt.js';
import type { NativeFunction, RankArray, RankValue } from './value.js';

// Only internal, pure scalar-to-scalar builtins opt in. Names and user-declared
// signatures are not evidence that ranked result assembly may be bypassed.
const operations = new WeakMap<NativeFunction, (value: RankValue) => RankValue>();

export function registerScalarBuiltin(fn: NativeFunction, operation: (value: RankValue) => RankValue): NativeFunction {
    operations.set(fn, operation);
    return fn;
}

/** Stored operands have no effectful cell readers. A pure scalar map needs no
 * tensor coordinates or per-cell Map. Retain the first cell's shape/error
 * boundary and a complete materialization, not millions of boxed cache keys. */
export function scalarBuiltinArray(source: RankArray, fn: NativeFunction,
    frameAxes: readonly number[]): RankArray | undefined {
    const operation = operations.get(fn);
    if (!operation || inspectionEnabled()
        || frameAxes.length !== source.shape.length
        || !frameAxes.every((axis, index) => axis === index)
        || !prepareStoredScalarView(source, true)) return undefined;
    const shape = [...source.shape];
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    if (size === 0) return undefined;
    let seen: number | undefined;
    let first: RankValue | undefined;
    let materialized: RankValue[] | undefined;
    const refresh = () => {
        const revision = arrayRevision(source);
        if (revision === undefined || revision !== seen) {
            first = undefined;
            materialized = undefined;
            seen = revision;
        }
        return revision;
    };
    const compute = (index: number): RankValue => {
        checkpoint('computing numbers');
        return operation(readArrayItem(source, index));
    };
    const read = (index: number): RankValue => {
        const revision = refresh();
        if (index === 0 && first !== undefined) return first;
        const value = compute(index);
        if (index === 0 && revision !== undefined && arrayRevision(source) === revision) first = value;
        return value;
    };
    const result: RankArray = {
        kind: 'array', containsFiles: false,
        get shape() {
            // Ordinary ranked assembly demands cell zero when inferring shape.
            read(0);
            return shape;
        },
        itemAt: read,
        streamAt: read,
        get items() {
            const revision = refresh();
            if (materialized) return materialized;
            read(0);
            const items = materializeCells(size, read);
            if (revision !== undefined && arrayRevision(source) === revision) materialized = items;
            return items;
        },
    };
    return registerArrayDependencies(result, [source]);
}
