import { checkpoint } from './interrupt.js';
import { reduceTensorMap } from './tensor-map.js';
import { collectionProtocol, type CollectionProtocolFor, type CollectionCapability } from '@arrrank/language';
import { arrayValues, denseScalarItems, float64Cells, readArrayItem, shouldStream, streamCells, typedElementKind } from './array-storage.js';
import { extremeMasked, presentReals, sumMasked } from './masked-kernels.js';
import { reduceSequence, sequenceValues } from './sequence.js';
import type { RankHeap } from './containers.js';
import type { RankMultiset } from './multiset.js';
import { MissingValueError, RankError } from './errors.js';
import { MISSING } from './value.js';
import type { RankArray, RankQueue, RankSequence, RankSet, RankValue } from './value.js';

/** Read-only element access. Optional hooks retain storage/plan optimizations.
 * Creating a source must not read its elements or materialize lazy storage. */
export interface ElementSource {
    values(): Iterable<RankValue>;
    readonly rank?: number;
    reduce?(operation: string): RankValue | undefined;
    /** Stored cells read in place, which may be a typed buffer. */
    denseItems?(): ArrayLike<RankValue> & Iterable<RankValue> | undefined;
    realCells?(): Float64Array | undefined;
    scalarItems?(): ArrayLike<RankValue> | undefined;
    presentItems?(): ArrayLike<RankValue> | undefined;
    presentValues?(): Iterable<RankValue>;
    streamingValues?(): Iterable<RankValue> | undefined;
}

interface ProtocolValues {
    array: RankArray;
    sequence: RankSequence;
    queue: RankQueue;
    set: RankSet;
    heap: RankHeap;
    multiset: RankMultiset;
    text: string;
}

const adapters: { [P in keyof ProtocolValues]: (value: ProtocolValues[P], operation: string) => ElementSource } = {
    array: value => ({
        rank: value.shape.length,
        values: () => arrayValues(value, shouldStream(value)),
        reduce: operation => {
            const tensor = reduceTensorMap(value, operation);
            if (tensor !== undefined) return tensor;
            if (operation === 'sum') return sumMasked(value);
            if (operation !== 'min' && operation !== 'max') return undefined;
            const masked = extremeMasked(value, operation === 'min' ? (a, b) => a < b : (a, b) => a > b);
            if (!masked) return undefined;
            if (!masked.found) throw new RankError(`${operation} requires at least one value`, 'EmptyReduction');
            return masked.result;
        },
        // Stored cells are a plain array or a typed buffer, both iterable;
        // reading `items` would unpack a typed buffer for good.
        denseItems: () => shouldStream(value) ? undefined
            : denseScalarItems(value) as ArrayLike<RankValue> & Iterable<RankValue> | undefined ?? value.items,
        realCells: () => typedElementKind(value) === 'real' ? float64Cells(value) : undefined,
        scalarItems: () => denseScalarItems(value),
        presentItems: () => denseScalarItems(value) ?? presentReals(value),
        streamingValues: () => shouldStream(value) ? streamCells(value) : undefined,
        *presentValues() {
            const size = value.shape.reduce((product, length) => product * length, 1);
            if (size === 0) { yield* arrayValues(value); return; }
            for (let index = 0; index < size; index++) {
                checkpoint('computing statistics');
                try {
                    const item = readArrayItem(value, index);
                    if (item !== MISSING) yield item;
                } catch (error) {
                    if (!(error instanceof MissingValueError)) throw error;
                }
            }
        },
    }),
    sequence: (value, operation) => ({
        rank: 1,
        values: () => sequenceValues(value, operation),
        reduce: operation => reduceSequence(value, operation),
    }),
    queue: value => ({ values: () => value.items, denseItems: () => value.items }),
    set: value => ({ values: () => value.entries.values() }),
    heap: value => ({ values: () => value.values() }),
    multiset: value => ({ values: () => value.values(),
        reduce: operation => operation === 'min' ? value.min() : operation === 'max' ? value.max() : undefined }),
    text: value => ({ values: () => value }),
};
const protocolAdapters: Record<CollectionProtocolFor<'elements' | 'extrema' | 'booleans' | 'series' | 'reduce' | 'positioned'>, unknown> = adapters;

/** The shared declaration selects the adapter; consumers never inspect concrete kinds. */
export function elementSource(value: RankValue, operation: string, capability: CollectionCapability = 'elements'): ElementSource | undefined {
    const protocol = typeof value === 'object' ? collectionProtocol(value.kind, capability)
        : typeof value === 'string' ? collectionProtocol('text', capability) : undefined;
    if (!protocol || !(protocol in protocolAdapters)) return undefined;
    // The declaration maps runtime kinds (including bytes) to the corresponding storage protocol.
    const adapt = adapters[protocol as keyof ProtocolValues] as (value: RankValue, operation: string) => ElementSource;
    return adapt(value, operation);
}
