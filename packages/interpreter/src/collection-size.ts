import { collectionProtocol, type CollectionProtocolFor } from '@arrrank/language';
import { RankDeque } from './containers.js';
import { RankError } from './errors.js';
import type { RankValue, RankArray, RankQueue, RankSequence } from './value.js';

/** Size and axes are separate capabilities; neither implies element traversal. */
export interface CollectionSize {
    length(): bigint;
    axes?(): readonly bigint[];
    axisLength?(axis: number): bigint;
}

function sequenceLength(value: RankSequence): bigint {
    if (value.plan.size.kind === 'infinite') throw new RankError('len requires a finite sequence');
    if (value.plan.size.kind === 'exact') return value.plan.size.value;
    let length = 0n;
    for (const _ of value.plan.iterate()) length++;
    return length;
}
const vector = (length: () => bigint): CollectionSize => ({
    length, axes: () => [length()], axisLength: axis => {
        if (axis !== 0) throw new RankError(`value has no axis ${axis}`);
        return length();
    },
});

type SizeValue = { readonly size: number | bigint };
const adapters = {
    array: (value: RankArray): CollectionSize => ({
        length: () => BigInt(value.shape[0] ?? 0),
        axes: () => value.shape.map(BigInt),
        axisLength: axis => {
            if (axis >= value.shape.length) throw new RankError(`array has no axis ${axis}`);
            return BigInt(value.shape[axis]);
        },
    }),
    sequence: (value: RankSequence) => vector(() => sequenceLength(value)),
    queue: (value: RankQueue) => vector(() => BigInt(value instanceof RankDeque ? value.size : value.items.length)),
    heap: (value: SizeValue): CollectionSize => ({ length: () => BigInt(value.size) }),
    multiset: (value: SizeValue) => vector(() => BigInt(value.size)),
    sized: (value: SizeValue) => vector(() => BigInt(value.size)),
    set: (value: { entries: ReadonlyMap<unknown, unknown> }): CollectionSize => ({ length: () => BigInt(value.entries.size) }),
    entries: (value: { entries: ReadonlyMap<unknown, unknown> }): CollectionSize => ({ length: () => BigInt(value.entries.size) }),
    tuple: (value: { items: readonly RankValue[] }): CollectionSize => ({ length: () => BigInt(value.items.length) }),
    table: (value: { length: number }): CollectionSize => ({ length: () => BigInt(value.length) }),
    text: (value: string) => vector(() => BigInt([...value].length)),
} satisfies Record<CollectionProtocolFor<'size' | 'shape'>, unknown>;

export function collectionSize(value: RankValue, capability: 'size' | 'shape' = 'size'): CollectionSize | undefined {
    const protocol = collectionProtocol(typeof value === 'string' ? 'text' : typeof value === 'object' ? value.kind : '', capability);
    if (!protocol || !(protocol in adapters)) return undefined;
    const adapt = adapters[protocol as keyof typeof adapters] as (value: RankValue) => CollectionSize;
    return adapt(value);
}
